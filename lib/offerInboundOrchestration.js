/**
 * AI orchestration for patient inbound offer_messages (first-class coordination workspace).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { resolveOperationalClinicId, logAiOrchestrationSkip } = require("./clinicOperationalContext");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * @param {{ offerId: string, message: string, senderName?: string, type?: string }} params
 */
async function insertClinicReplyToOfferThread(params) {
  const offerId = String(params.offerId || "").trim();
  const message = String(params.message || "").trim();
  if (!UUID_RE.test(offerId) || !message || !insertWithPruningFn) {
    return { data: null, error: { message: "offer_reply_insert_not_configured" } };
  }

  const senderName = String(params.senderName || "Care Team").trim() || "Care Team";
  const roleAttempts = ["clinic", "assistant", "system"];

  let lastErr = null;
  for (const sender_role of roleAttempts) {
    const insertRow = {
      offer_id: offerId,
      sender_id: "clinic_ai",
      sender_role,
      sender_name: senderName,
      text: message,
    };
    const { data, error } = await insertWithPruningFn("offer_messages", insertRow, "*");
    if (!error && data) {
      const row = data;
      const payload = {
        id: String(row.id),
        offer_id: offerId,
        sender_id: String(row.sender_id || "clinic_ai"),
        sender_role: row.sender_role || sender_role,
        sender_name: String(row.sender_name || senderName),
        text: row.text,
        attachment_url: row.attachment_url || null,
        attachment_type: row.attachment_type || null,
        created_at: row.created_at,
      };
      try {
        emitOfferNewMessageFn?.(offerId, payload);
      } catch {
        /* non-fatal */
      }
      console.log("[offerInboundOrchestration] clinic reply inserted to offer_messages", {
        offerId: offerId.slice(0, 8),
        messageId: payload.id.slice(0, 8),
        sender_role,
      });
      return { data: payload, error: null };
    }
    lastErr = error;
    const msg = String(error?.message || "").toLowerCase();
    const code = String(error?.code || "");
    const isRoleReject =
      code === "23514" || msg.includes("check constraint") || msg.includes("sender_role");
    if (!isRoleReject) break;
  }

  console.warn("[offerInboundOrchestration] offer_messages insert failed:", lastErr?.message || lastErr);
  return { data: null, error: lastErr || { message: "offer_reply_insert_failed" } };
}

/**
 * Wrap standard clinic message insert — routes to offer thread when offerId is set.
 * @param {(params: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>} baseInsert
 */
function createOfferAwareClinicMessageInsert(baseInsert) {
  return async function offerAwareInsertClinicMessage(params) {
    const offerId = String(params.offerId || "").trim();
    if (UUID_RE.test(offerId)) {
      console.log("[offerInboundOrchestration] routing AI/clinic reply to offer_messages", {
        offerId: offerId.slice(0, 8),
        channel: params.type || "text",
      });
      return insertClinicReplyToOfferThread({
        offerId,
        message: String(params.message || ""),
        senderName: params.senderName || "Care Team",
        type: params.type,
      });
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
