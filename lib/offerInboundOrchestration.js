/**
 * AI orchestration for patient inbound offer_messages (first-class coordination workspace).
 */

const { resolveOperationalClinicId, logAiOrchestrationSkip } = require("./clinicOperationalContext");
const {
  resolveCoordinationOfferIdForPatientClinic,
  isPatientEnrolledAtClinic,
} = require("./patientCoordinationChat");
const { maybeAutoAssignRespondingDoctor } = require("./autoAssignRespondingDoctor");
const { sanitizePatientFacingReply } = require("./coordinatorReplySanitize.cjs");
const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  CLINIC_AI_ACTOR_KIND,
  UUID_RE,
  buildClinicAiOfferMessageInsert,
  buildDoctorHumanOfferMessageInsert,
} = require("./offerMessageActors");

/** @type {null | ((table: string, row: object, select?: string) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertWithPruningFn = null;
/** @type {null | ((offerId: string, message: object) => void)} */
let emitOfferNewMessageFn = null;

/**
 * @param {{ insertIntoTableWithColumnPruning: typeof insertWithPruningFn, emitOfferNewMessage?: typeof emitOfferNewMessageFn }} deps
 */
function setupOfferInboundOrchestration(deps) {
  insertWithPruningFn = deps.insertIntoTableWithColumnPruning || null;
  emitOfferNewMessageFn = deps.emitOfferNewMessage || null;
}

/**
 * Post clinic/AI reply into the offer thread (canonical offer chat).
 * @param {{
 *   offerId: string,
 *   message: string,
 *   senderName?: string,
 *   clinicId?: string|null,
 *   doctorId?: string|null,
 *   authorKind?: "doctor"|"clinic_ai",
 *   patientId?: string|null,
 *   conversationLanguage?: string|null,
 *   patientMessageForLang?: string|null,
 * }} params
 */
async function insertClinicReplyToOfferThread(params) {
  const offerId = String(params.offerId || "").trim();
  const rawMessage = String(params.message || "").trim();
  const isDirectDoctor =
    params.sendMode === "direct" ||
    params.skipSanitize === true ||
    (params.authorKind === "doctor" && params.messageSource === "doctor_direct");
  const message = isDirectDoctor
    ? rawMessage
    : sanitizePatientFacingReply(rawMessage, {
        lang: params.conversationLanguage || null,
        patientMessage: params.patientMessageForLang || null,
        logLabel: "offer_thread_outbound",
      });
  if (!UUID_RE.test(offerId) || !message || !insertWithPruningFn) {
    return { data: null, error: { message: "offer_reply_insert_not_configured" } };
  }

  const authorKind =
    params.authorKind === "doctor" || params.asDoctor === true ? "doctor" : "clinic_ai";
  const built =
    authorKind === "doctor"
      ? await buildDoctorHumanOfferMessageInsert({
          offerId,
          message,
          senderName: params.senderName,
          doctorId: String(params.doctorId || "").trim(),
          sendMode: params.sendMode,
          messageSource: params.messageSource,
        })
      : await buildClinicAiOfferMessageInsert({
          offerId,
          message,
          senderName: params.senderName || "Care Team",
          clinicId: params.clinicId,
          doctorId: params.doctorId,
        });
  if (!built.row || built.error) {
    return { data: null, error: built.error || { message: "clinic_sender_uuid_unresolved" } };
  }

  const senderName = String(built.row.sender_name || (authorKind === "doctor" ? "Doctor" : "Care Team"));
  const roleAttempts =
    authorKind === "doctor" ? ["doctor"] : ["assistant", "clinic", "ai", "doctor", "system"];
  const payloadActorKind =
    authorKind === "doctor" ? "doctor" : CLINIC_AI_ACTOR_KIND;

  let lastErr = null;
  for (const sender_role of roleAttempts) {
    const insertRow = { ...built.row, sender_role };
    const { data, error } = await insertWithPruningFn("offer_messages", insertRow, "*");
    if (!error && data) {
      const row = data;
      const payload = {
        id: String(row.id),
        offer_id: offerId,
        sender_id: String(row.sender_id || built.actor.senderId),
        sender_role: row.sender_role || sender_role,
        sender_name: String(row.sender_name || senderName),
        text: row.text,
        attachment_url: row.attachment_url || null,
        attachment_type: row.attachment_type || null,
        created_at: row.created_at,
        actor_kind: payloadActorKind,
        message_source: built.row.message_source || payloadActorKind,
      };
      try {
        emitOfferNewMessageFn?.(offerId, payload);
      } catch {
        /* non-fatal */
      }
      console.log("[offerInboundOrchestration] clinic reply inserted to offer_messages", {
        offerId: offerId.slice(0, 8),
        messageId: payload.id.slice(0, 8),
        sender_role: payload.sender_role,
        sender_id: String(payload.sender_id).slice(0, 8),
        actor_kind: payloadActorKind,
        authorKind,
      });
      if (authorKind === "doctor") {
        const pid = String(params.patientId || "").trim();
        const cid = String(params.clinicId || "").trim();
        const did = String(params.doctorId || payload.sender_id || "").trim();
        if (pid && cid && did) {
          void maybeAutoAssignRespondingDoctor({
            patientId: pid,
            clinicId: cid,
            doctorId: did,
          }).catch((e) =>
            console.warn("[autoAssignRespondingDoctor] coordination_offer:", e?.message || e),
          );
        }
      }
      const { markTreatmentRequestResponded } = require("./treatmentRequestLifecycle");
      void markTreatmentRequestResponded({
        offerId,
        clinicId: params.clinicId,
        source: "coordinator_reply",
      }).catch((e) =>
        console.warn("[treatmentRequestLifecycle] offer_reply:", e?.message || e),
      );
      return { data: payload, error: null };
    }
    lastErr = error;
    const msg = String(error?.message || "").toLowerCase();
    const code = String(error?.code || "");
    const isRoleReject =
      code === "23514" || msg.includes("check constraint") || msg.includes("sender_role");
    const isUuidReject =
      code === "22P02" || msg.includes("invalid input syntax for type uuid");
    if (!isRoleReject && !isUuidReject) break;
  }

  console.warn("[offerInboundOrchestration] offer_messages insert failed:", lastErr?.message || lastErr);
  return { data: null, error: lastErr || { message: "offer_reply_insert_failed" } };
}

/**
 * Mirror offer-thread AI/clinic replies into patient_messages so assigned doctors get socket realtime.
 * @param {string} patientId
 * @param {string} clinicId
 */
async function shouldMirrorOfferReplyToPatientMessages(patientId, clinicId) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return false;
  if (await isPatientEnrolledAtClinic(patientId, clinicId)) return true;
  if (!isSupabaseEnabled()) return false;
  try {
    const { data: thr } = await supabase
      .from("patient_chat_threads")
      .select("id, assigned_doctor_id")
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const assignee = String(thr?.assigned_doctor_id || "").trim();
    if (UUID_RE.test(String(thr?.id || ""))) return true;
    return UUID_RE.test(assignee);
  } catch {
    return false;
  }
}

/**
 * Wrap standard clinic message insert — routes to offer thread when offerId is set.
 * @param {(params: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>} baseInsert
 */
function createOfferAwareClinicMessageInsert(baseInsert) {
  return async function offerAwareInsertClinicMessage(params) {
    let offerId = String(params.offerId || "").trim();
    const patientId = String(params.patientId || "").trim();
    const clinicId = String(params.contextClinicId || params.clinicId || "").trim();

    if (!UUID_RE.test(offerId) && UUID_RE.test(patientId) && UUID_RE.test(clinicId)) {
      const resolved = await resolveCoordinationOfferIdForPatientClinic(patientId, clinicId, {
        createIfMissing: true,
      });
      if (resolved && UUID_RE.test(resolved)) {
        offerId = resolved;
        console.log("[offerInboundOrchestration] resolved coordination offer for clinic outbound", {
          offerId: offerId.slice(0, 8),
          patientId: patientId.slice(0, 8),
        });
      }
    }

    if (UUID_RE.test(offerId)) {
      console.log("[offerInboundOrchestration] routing AI/clinic reply to offer_messages", {
        offerId: offerId.slice(0, 8),
        channel: params.type || "text",
        actor_kind: CLINIC_AI_ACTOR_KIND,
      });
      const senderName = String(params.senderName || "").trim();
      const authorKind =
        params.authorKind === "doctor" || params.asDoctor === true ? "doctor" : "clinic_ai";
      const offerResult = await insertClinicReplyToOfferThread({
        offerId,
        message: String(params.message || ""),
        senderName: authorKind === "doctor" ? senderName || "Doctor" : senderName || "Care Team",
        clinicId: clinicId || null,
        doctorId: params.doctorId || null,
        patientId,
        authorKind,
        sendMode: params.sendMode,
        skipSanitize: params.skipSanitize === true,
        messageSource: params.messageProvenance?.message_source || params.messageSource,
        conversationLanguage:
          params.conversationLanguage ||
          params.messageProvenance?.conversation_language ||
          null,
        patientMessageForLang:
          params.patientMessageForLang ||
          params.messageProvenance?.patient_message_for_lang ||
          null,
      });
      if (!offerResult?.error) {
        if (UUID_RE.test(patientId) && UUID_RE.test(clinicId)) {
          const mirrorToPatientMessages = await shouldMirrorOfferReplyToPatientMessages(
            patientId,
            clinicId,
          );
          if (mirrorToPatientMessages) {
            try {
              await baseInsert({
                ...params,
                contextClinicId: clinicId,
                offerMessageId: offerResult.data?.id || null,
                messageProvenance: {
                  ...(params.messageProvenance && typeof params.messageProvenance === "object"
                    ? params.messageProvenance
                    : {}),
                  message_source:
                    params.messageProvenance?.message_source ||
                    params.messageSource ||
                    "ai_offer_mirror",
                  offer_message_id: offerResult.data?.id || null,
                },
              });
            } catch (e) {
              console.warn(
                "[offerInboundOrchestration] lead mirror to patient_messages:",
                e?.message || e,
              );
            }
          }
        }
        return offerResult;
      }
      console.warn(
        "[offerInboundOrchestration] offer_messages insert failed — fallback patient_messages",
        offerResult.error?.message || offerResult.error,
      );
    }
    return baseInsert(params);
  };
}

/**
 * After patient POST /api/offer-messages — unified AI orchestration entry.
 * @param {{
 *   offerId: string,
 *   patientId: string,
 *   patientMessage: string,
 *   clinicId?: string|null,
 *   treatmentRequestId?: string|null,
 * }} params
 */
async function afterPatientOfferMessageInbound(params) {
  const offerId = String(params.offerId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const patientMessage = String(params.patientMessage || "").trim();

  console.log("[offerInboundOrchestration] patient offer message — AI orchestration start", {
    offerId: offerId.slice(0, 8),
    patientId: patientId.slice(0, 8),
    hasText: Boolean(patientMessage),
  });

  if (!UUID_RE.test(offerId) || !UUID_RE.test(patientId)) {
    console.log("[offerInboundOrchestration] skipped: invalid_ids");
    return;
  }
  if (!patientMessage) {
    console.log("[offerInboundOrchestration] skipped: empty_message");
    return;
  }

  let clinicId = String(params.clinicId || "").trim();
  if (!UUID_RE.test(clinicId)) {
    const resolved = await resolveOperationalClinicId(patientId, {
      offerId,
      treatmentRequestId: params.treatmentRequestId,
      logLabel: "offer_messages_inbound",
    });
    clinicId = String(resolved.clinicId || "").trim();
    if (!UUID_RE.test(clinicId)) {
      logAiOrchestrationSkip(null, patientId, {
        ...resolved,
        reason: "clinic_unresolved",
        source: "offer_chat",
        offerId,
      });
      return;
    }
  }

  const { afterPatientInboundMessage } = require("./aiSlaContinuity");
  await afterPatientInboundMessage({
    patientId,
    clinicId,
    patientMessage,
    source: "offer_chat",
    contextMode: "coordinator",
    offerId,
    treatmentRequestId: params.treatmentRequestId,
  });
}

module.exports = {
  setupOfferInboundOrchestration,
  createOfferAwareClinicMessageInsert,
  insertClinicReplyToOfferThread,
  afterPatientOfferMessageInbound,
};
