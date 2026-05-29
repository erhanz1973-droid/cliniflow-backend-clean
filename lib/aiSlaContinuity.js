/**
 * SLA / immediate continuity messages when the clinic has not replied yet.
 * Reassurance only — not diagnosis or pricing offers.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { resolveInquiryDelegation, buildClinicPolicySummary } = require("./aiDelegation");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { normalizeCoordinatorChannel } = require("./coordinatorChannels");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");
const { COORDINATION_AI } = require("./aiCoordinatorCoordination");
const {
  readConversationLanguageFromProfile,
  resolveConversationLanguage,
} = require("./conversationLanguage");
const { markTreatmentRequestResponded } = require("./treatmentRequestLifecycle");
const { projectCoordinationState } = require("./coordinationProjection");
const {
  runAiReplyForClinicInbound,
  aiAlreadyRepliedSinceLastPatient,
  hasAiOutboundSincePatient,
} = require("./aiPatientInboundReply");
const {
  resolveOperationalClinicId,
  logAiOrchestrationSkip,
  logAiDelegationEvaluation,
} = require("./clinicOperationalContext");
const {
  resolveInboundAiOrchestration,
  startAiReplyLatencyTrace,
  logAiReplyLatency,
} = require("./aiReplyOrchestration");
const { isRoutineDentalChiefComplaint } = require("./aiDelegation");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((opts: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertClinicMessageFn = null;

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const pendingDoctorSilenceFallbacks = new Map();

/** @type {Map<string, { timer: ReturnType<typeof setTimeout>, payload: Record<string, unknown> }>} */
const pendingInstantAiReplies = new Map();

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
function cancelPendingInstantAiReply(patientId, clinicId) {
  const key = `${String(patientId || "").trim()}:${String(clinicId || "").trim()}`;
  const prev = pendingInstantAiReplies.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  pendingInstantAiReplies.delete(key);
}

/**
 * Merge rapid patient bursts ("Tamam" + "Alo") into one AI turn.
 * @param {string} key
 * @param {Record<string, unknown>} payload
 * @param {number} delayMs
 * @param {(p: Record<string, unknown>) => Promise<void>} runFn
 */
function scheduleCoalescedInstantAiReply(key, payload, delayMs, runFn) {
  const prev = pendingInstantAiReplies.get(key);
  if (prev?.timer) clearTimeout(prev.timer);

  const merged = prev?.payload
    ? {
        ...payload,
        patientMessage: [String(prev.payload.patientMessage || "").trim(), String(payload.patientMessage || "").trim()]
          .filter(Boolean)
          .join("\n"),
        externalMessageId: payload.externalMessageId || prev.payload.externalMessageId,
      }
    : { ...payload };

  const timer = setTimeout(() => {
    pendingInstantAiReplies.delete(key);
    void runFn(merged);
  }, delayMs);
  timer.unref?.();
  pendingInstantAiReplies.set(key, { timer, payload: merged });
}

function doctorSilenceFallbackMinutes(overrideMinutes) {
  if (overrideMinutes != null && Number(overrideMinutes) > 0) {
    return Number(overrideMinutes);
  }
  const envSec = parseInt(process.env.AI_DOCTOR_SILENCE_FALLBACK_SECONDS || "", 10);
  if (Number.isFinite(envSec) && envSec >= 30) {
    return envSec / 60;
  }
  const n = parseFloat(process.env.AI_DOCTOR_SILENCE_FALLBACK_MINUTES || "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
function cancelDoctorSilenceAiFallback(patientId, clinicId) {
  const key = `${String(patientId || "").trim()}:${String(clinicId || "").trim()}`;
  const prev = pendingDoctorSilenceFallbacks.get(key);
  if (prev) clearTimeout(prev);
  pendingDoctorSilenceFallbacks.delete(key);
}

/**
 * Doctor offer-thread or human_reply since patient last wrote.
 * @param {string} lastPatientAt
 * @param {{ offerId?: string|null, profileRow: Record<string, unknown> }} ctx
 */
async function hasDoctorReplySince(lastPatientAt, ctx) {
  const lp = new Date(lastPatientAt).getTime();
  if (!Number.isFinite(lp)) return false;
  const lh = ctx.profileRow?.last_human_reply_at;
  if (lh && new Date(lh).getTime() >= lp) return true;

  const offerId = String(ctx.offerId || "").trim();
  if (!UUID_RE.test(offerId)) return false;

  const { data, error } = await supabase
    .from("offer_messages")
    .select("id, sender_role, created_at")
    .eq("offer_id", offerId)
    .eq("sender_role", "doctor")
    .gte("created_at", lastPatientAt)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[aiSlaContinuity] doctor reply check:", error.message);
    return false;
  }
  return (data || []).length > 0;
}

/**
 * @param {string} scheduleKey
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   patientMessage: string,
 *   scheduledForPatientAt: string,
 *   offerId?: string|null,
 *   treatmentRequestId?: string|null,
 *   inboundChannel?: string,
 *   contextMode?: string,
 *   source?: string,
 * }} params
 */
function scheduleDoctorSilenceAiFallback(scheduleKey, params) {
  if (process.env.AI_DOCTOR_SILENCE_FALLBACK_ENABLED === "false") return;
  if (params.skipSchedule === true) return;

  const prev = pendingDoctorSilenceFallbacks.get(scheduleKey);
  if (prev) clearTimeout(prev);

  const delayMs = Math.max(
    30_000,
    params.fallbackDelayMs != null
      ? Number(params.fallbackDelayMs)
      : Math.round(doctorSilenceFallbackMinutes(params.fallbackDelayMinutes) * 60 * 1000),
  );
  const timer = setTimeout(() => {
    pendingDoctorSilenceFallbacks.delete(scheduleKey);
    void runDoctorSilenceAiFallback(params).catch((e) =>
      console.warn("[aiSlaContinuity] doctor_silence_fallback:", e?.message || e),
    );
  }, delayMs);
  timer.unref?.();
  pendingDoctorSilenceFallbacks.set(scheduleKey, timer);

  console.log("[aiSlaContinuity] scheduled doctor-silence AI fallback", {
    patientId: params.patientId.slice(0, 8),
    clinicId: params.clinicId.slice(0, 8),
    delayMs,
    mode: "human_fallback",
    offerId: params.offerId ? String(params.offerId).slice(0, 8) : null,
  });
}

/**
 * After doctor-silence window: full AI coordinator reply if still unanswered and AI not disabled.
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   patientMessage: string,
 *   scheduledForPatientAt: string,
 *   offerId?: string|null,
 *   treatmentRequestId?: string|null,
 *   inboundChannel?: string,
 *   contextMode?: string,
 *   source?: string,
 * }} params
 */
async function runDoctorSilenceAiFallback(params) {
  if (!isSupabaseEnabled()) return { sent: false, reason: "supabase_off" };

  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const patientMessage = String(params.patientMessage || "").trim();
  const scheduledForPatientAt = String(params.scheduledForPatientAt || "").trim();
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId) || !patientMessage) {
    return { sent: false, reason: "invalid_params" };
  }

  const { data: row, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, last_patient_message, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !row?.id) {
    return { sent: false, reason: "no_profile" };
  }

  const lastPatientAt = String(
    row.last_patient_message_at || row.last_channel_message_at || "",
  );
  if (!lastPatientAt) return { sent: false, reason: "no_patient_turn" };

  if (
    scheduledForPatientAt &&
    lastPatientAt !== scheduledForPatientAt &&
    new Date(lastPatientAt).getTime() > new Date(scheduledForPatientAt).getTime()
  ) {
    return { sent: false, reason: "superseded_by_newer_patient_message" };
  }

  const offerId =
    (await resolveInboundOfferId(patientId, clinicId, {
      offerId:
        params.offerId ||
        row.operational_intake_flags?.coordinationOfferId ||
        row.operational_intake_flags?.coordination_offer_id,
      treatmentRequestId:
        params.treatmentRequestId ||
        row.operational_intake_flags?.treatmentRequestId ||
        row.operational_intake_flags?.treatment_request_id,
    })) || null;

  if (await hasDoctorReplySince(lastPatientAt, { offerId, profileRow: row })) {
    console.log("[aiSlaContinuity] doctor_silence_fallback skipped: doctor_replied", {
      profileId: String(row.id).slice(0, 8),
    });
    return { sent: false, reason: "doctor_replied" };
  }

  if (aiAlreadyRepliedSinceLastPatient(row)) {
    return { sent: false, reason: "ai_already_replied" };
  }
  if (await hasAiOutboundSincePatient(String(row.id), lastPatientAt)) {
    return { sent: false, reason: "ai_already_replied_event" };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const clinicPolicy = buildClinicPolicySummary(clinicProfile);
  const delegation = resolveInquiryDelegation(row, { clinicPolicy, messageText: patientMessage });
  logAiDelegationEvaluation(delegation, clinicId);

  if (delegation.aiEscalationRequired) {
    return { sent: false, reason: "escalation" };
  }
  if (!delegation.autoReplyAllowed) {
    console.log("[aiSlaContinuity] doctor_silence_fallback skipped: ai_disabled", {
      profileId: String(row.id).slice(0, 8),
      aiPaused: delegation.aiPaused,
      conversationOwner: delegation.conversationOwner,
    });
    return { sent: false, reason: "ai_disabled" };
  }

  const msg =
    String(row.last_patient_message || "").trim() || patientMessage;
  const aiResult = await runAiReplyForClinicInbound({
    patientId,
    clinicId,
    patientMessage: msg,
    channel: params.inboundChannel || "in_app",
    contextMode: params.contextMode || "coordinator",
    source: `${params.source || "inbound"}:doctor_silence_${doctorSilenceFallbackMinutes()}m`,
    offerId: offerId && UUID_RE.test(String(offerId)) ? String(offerId) : null,
    treatmentRequestId: params.treatmentRequestId || null,
  });

  if (aiResult.sent) {
    console.log("[aiSlaContinuity] doctor_silence_fallback sent AI reply", {
      profileId: String(row.id).slice(0, 8),
      patientId: patientId.slice(0, 8),
    });
    return aiResult;
  }

  console.log("[aiSlaContinuity] doctor_silence_fallback AI not sent", {
    profileId: String(row.id).slice(0, 8),
    reason: aiResult.reason,
  });
  return aiResult;
}

const CONTINUITY_TEMPLATES = {
  en: `Thank you for your request 😊\nOur clinic team is currently reviewing your information and any files you shared. We will get back to you shortly with treatment details and estimated pricing.`,
  tr: `Talebiniz için teşekkür ederiz 😊\nKlinik ekibimiz bilgilerinizi ve paylaştığınız dosyaları inceliyor. Kısa süre içinde tedavi detayları ve tahmini fiyatlandırma ile size dönüş yapacağız.`,
  ru: `Спасибо за ваш запрос 😊\nКоманда клиники сейчас изучает вашу информацию и загруженные файлы. Мы скоро свяжемся с вами с деталями лечения и ориентировочной стоимостью.`,
  ka: `გმადლობთ მოთხოვნისთვის 😊\nჩვენი კლინიკის გუნდი ამჟამად გადაიხედებს თქვენს ინფორმაციასა და ფაილებს. მალე დაგიბრუნდებით მკურნალობის დეტალებითა და სავარაუდო ფასებით.`,
};

/**
 * @param {{ insertClinicMessage: typeof insertClinicMessageFn }} deps
 */
function setupAiSlaContinuity(deps) {
  insertClinicMessageFn = deps.insertClinicMessage || null;
  if (process.env.AI_SLA_CONTINUITY_ENABLED === "false") return;
  const sweepMs = Math.max(
    60_000,
    parseInt(process.env.AI_SLA_CONTINUITY_SWEEP_MS || String(2 * 60 * 1000), 10) || 120_000,
  );
  setInterval(() => {
    runSlaContinuitySweep().catch((e) => {
      console.warn("[aiSlaContinuity] sweep:", e?.message || e);
    });
  }, sweepMs).unref?.();
  console.log("[aiSlaContinuity] SLA continuity sweep every", sweepMs, "ms");
}

/**
 * @param {string} clinicId
 * @param {Record<string, unknown>|null} [profileRow]
 */
/**
 * @param {string} clinicId
 * @param {Record<string, unknown>|null} [profileRow]
 * @param {string} [lastPatientMessage]
 */
function pickContinuityLanguage(clinicId, profileRow = null, lastPatientMessage = "") {
  const msg = String(lastPatientMessage || profileRow?.last_patient_message || "").trim();
  if (msg) {
    return getClinicAiProfile(clinicId).then((clinicProfile) => {
      const state = resolveConversationLanguage({
        message: msg,
        conversationPrimaryLanguage: readConversationLanguageFromProfile(profileRow),
        clinicPrimaryLanguage: clinicProfile.tone?.primaryLanguage,
        enabledLanguageCodes: clinicProfile.tone?.enabledLanguageCodes,
        messageCount: Number(profileRow?.message_count) || 0,
      });
      const code = state.conversationLanguage;
      if (CONTINUITY_TEMPLATES[code]) return code;
      return CONTINUITY_TEMPLATES.en ? "en" : "en";
    });
  }
  const fromConversation = readConversationLanguageFromProfile(profileRow);
  if (fromConversation && CONTINUITY_TEMPLATES[fromConversation]) {
    return Promise.resolve(fromConversation);
  }
  return getClinicAiProfile(clinicId).then((profile) => {
    const code =
      String(profile.tone?.primaryLanguage || profile.tone?.enabledLanguageCodes?.[0] || "en")
        .trim()
        .toLowerCase()
        .slice(0, 2) || "en";
    return CONTINUITY_TEMPLATES[code] ? code : "en";
  });
}

/**
 * Dedupe: only one continuity per patient-waiting window.
 * @param {string} profileId
 * @param {string|null} lastPatientAt
 */
async function shouldSkipContinuity(profileId, lastPatientAt) {
  if (!lastPatientAt) return true;
  const { data, error } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id, event_type, event_metadata, created_at")
    .eq("profile_id", profileId)
    .gte("created_at", lastPatientAt)
    .in("event_type", ["continuity_fallback", "system"])
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    console.warn("[aiSlaContinuity] dedupe:", error.message);
    return false;
  }
  for (const row of data || []) {
    if (row.event_type === "continuity_fallback") return true;
    const meta = row.event_metadata && typeof row.event_metadata === "object" ? row.event_metadata : {};
    if (meta.kind === "continuity_fallback") return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} row
 */
function isWaitingOnClinic(row) {
  const lp = row.last_patient_message_at || row.last_channel_message_at;
  const lh = row.last_human_reply_at;
  if (!lp) return false;
  if (!lh) return true;
  return new Date(lp).getTime() > new Date(lh).getTime();
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} [patientMessage]
 */
async function touchLeadProfileFromInbound(patientId, clinicId, patientMessage) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const sessionId = `inq_${patientId}_${clinicId}`;
  const msg = String(patientMessage || "").trim().slice(0, 4000) || null;

  const { data: existing } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, session_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (existing?.id) {
    const patch = {
      last_patient_message: msg,
      last_patient_message_at: nowIso,
      last_channel_message_at: nowIso,
      updated_at: nowIso,
    };
    const mode = String(existing.ai_mode || "").toUpperCase().replace(/-/g, "_");
    const doctorExplicitTakeover =
      existing.ai_paused === true && mode === "HUMAN_ONLY";
    const routineDental = msg ? isRoutineDentalChiefComplaint(msg) : false;
    if (routineDental && !doctorExplicitTakeover) {
      patch.coordination_mode = COORDINATION_AI;
      patch.ai_mode = "AI_ACTIVE";
      patch.ai_paused = false;
      patch.ai_escalation_required = false;
    } else if (!doctorExplicitTakeover && existing.ai_escalation_required !== true) {
      patch.coordination_mode = COORDINATION_AI;
      patch.ai_mode = "AI_ACTIVE";
      patch.ai_paused = false;
    } else if (
      existing.ai_paused !== true &&
      existing.ai_escalation_required !== true &&
      mode !== "HUMAN_ONLY" &&
      mode !== "ESCALATION_REQUIRED" &&
      (!mode || mode === "AI_ASSISTED" || mode === "AI_DRAFT")
    ) {
      patch.ai_mode = "AI_ACTIVE";
      patch.coordination_mode = COORDINATION_AI;
    }
    await supabase.from("ai_coordinator_lead_profiles").update(patch).eq("id", existing.id);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .insert({
      session_id: sessionId,
      patient_id: patientId,
      clinic_id: clinicId,
      coordination_mode: COORDINATION_AI,
      ai_mode: "AI_ACTIVE",
      last_patient_message: msg,
      last_patient_message_at: nowIso,
      last_channel_message_at: nowIso,
      source: "patient_inquiry",
      primary_channel: "in_app",
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("id")
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      return again?.id || null;
    }
    console.warn("[aiSlaContinuity] touch profile:", error.message);
    return null;
  }
  return inserted?.id || null;
}

/**
 * Resolve coordination offer thread for inbound AI (offer chat, patient tab, quote request).
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ offerId?: string|null, treatmentRequestId?: string|null }} params
 */
async function resolveInboundOfferId(patientId, clinicId, params = {}) {
  let offerId = String(params.offerId || "").trim();
  if (UUID_RE.test(offerId)) return offerId;

  const trId = String(params.treatmentRequestId || "").trim();
  if (UUID_RE.test(trId)) {
    try {
      const { ensureCoordinationOfferForRequest } = require("./patientCoordinationChat");
      const ensured = await ensureCoordinationOfferForRequest(trId, { createIfMissing: false });
      if (ensured.ok && ensured.offerId && UUID_RE.test(String(ensured.offerId))) {
        return String(ensured.offerId);
      }
    } catch (e) {
      console.warn("[aiSlaContinuity] resolve offer from TR:", e?.message || e);
    }
  }

  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return null;
  try {
    const { resolveCoordinationOfferIdForPatientClinic } = require("./patientCoordinationChat");
    const resolved = await resolveCoordinationOfferIdForPatientClinic(patientId, clinicId, {
      createIfMissing: false,
    });
    if (resolved && UUID_RE.test(resolved)) return String(resolved);
  } catch (e) {
    console.warn("[aiSlaContinuity] resolve offer from patient:", e?.message || e);
  }

  const { data: tr } = await supabase
    .from("treatment_requests")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tr?.id) {
    try {
      const { ensureCoordinationOfferForRequest } = require("./patientCoordinationChat");
      const ensured = await ensureCoordinationOfferForRequest(String(tr.id), { createIfMissing: false });
      if (ensured.ok && ensured.offerId) return String(ensured.offerId);
    } catch {
      /* non-fatal */
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {{ immediate?: boolean }} [opts]
 */
async function trySendContinuityForProfile(profileRow, opts = {}) {
  if (!insertClinicMessageFn) return { sent: false, reason: "not_configured" };

  const profileId = String(profileRow.id || "");
  const patientId = String(profileRow.patient_id || "");
  const clinicId = String(profileRow.clinic_id || "");
  if (!UUID_RE.test(profileId) || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { sent: false, reason: "invalid_ids" };
  }

  if (!isWaitingOnClinic(profileRow)) {
    return { sent: false, reason: "not_waiting" };
  }

  const lastPatientAt = String(
    profileRow.last_patient_message_at || profileRow.last_channel_message_at || "",
  );
  if (await shouldSkipContinuity(profileId, lastPatientAt)) {
    return { sent: false, reason: "already_sent" };
  }

  const { data: recentAi } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id")
    .eq("profile_id", profileId)
    .eq("event_type", "ai_reply")
    .gte("created_at", lastPatientAt)
    .limit(1);
  if (recentAi?.length) {
    return { sent: false, reason: "ai_already_replied" };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const clinicPolicy = buildClinicPolicySummary(clinicProfile);
  const delegation = resolveInquiryDelegation(profileRow, { clinicPolicy });
  logAiDelegationEvaluation(delegation, clinicId);

  if (delegation.aiEscalationRequired) {
    console.log("[aiSlaContinuity] continuity skipped: escalation_required", {
      profileId: profileId.slice(0, 8),
    });
    return { sent: false, reason: "escalation" };
  }
  const continuityAllowed = delegation.autoReplyAllowed === true;
  if (!continuityAllowed) {
    console.log("[aiSlaContinuity] continuity skipped: ai_disabled", {
      profileId: profileId.slice(0, 8),
      aiPaused: delegation.aiPaused,
      autoReplyAllowed: delegation.autoReplyAllowed,
      draftGenerationAllowed: delegation.draftGenerationAllowed,
    });
    return { sent: false, reason: "ai_disabled" };
  }

  const fallbackMin = Number(clinicProfile.escalation?.aiFallbackAfterMinutes) || 30;
  const immediateEnabled = process.env.AI_CONTINUITY_IMMEDIATE !== "false";
  const immediateMin = Math.max(
    0,
    parseFloat(process.env.AI_CONTINUITY_IMMEDIATE_MINUTES || "0") || 0,
  );
  const thresholdMin = opts.immediate && immediateEnabled ? immediateMin : fallbackMin;

  const waitingMs =
    Date.now() - new Date(lastPatientAt).getTime();
  if (!Number.isFinite(waitingMs) || waitingMs < thresholdMin * 60 * 1000) {
    return { sent: false, reason: "below_threshold", waitingMs, thresholdMin };
  }

  const lang = await pickContinuityLanguage(
    clinicId,
    profileRow,
    String(profileRow?.last_patient_message || "").trim(),
  );
  const text = CONTINUITY_TEMPLATES[lang] || CONTINUITY_TEMPLATES.en;
  const nowIso = new Date().toISOString();

  const insertResult = await insertClinicMessageFn({
    patientId,
    message: text,
    type: "continuity_ack",
    contextClinicId: clinicId,
    senderName: "Care Team",
    offerId: opts.offerId || null,
  });

  if (insertResult?.error) {
    console.warn("[aiSlaContinuity] insert message:", insertResult.error?.message || insertResult.error);
    return { sent: false, reason: "insert_failed" };
  }

  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      last_ai_reply_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", profileId);

  await insertTimelineEvent({
    profileId,
    eventType: "continuity_fallback",
    eventMetadata: {
      kind: "continuity_fallback",
      mode: opts.immediate ? "immediate" : "sla",
      thresholdMinutes: thresholdMin,
      language: lang,
    },
    aiReply: text,
    channel: normalizeCoordinatorChannel(opts.channel, "ai_continuity"),
  });

  const { error: chErr } = await insertChannelMessagesWithChannel({
    profile_id: profileId,
    channel: normalizeCoordinatorChannel(opts.channel, "ai_continuity"),
    direction: "outbound",
    message_role: "assistant",
    body: text,
  });
  if (chErr) {
    console.warn("[aiSlaContinuity] channel_messages:", chErr.message);
  }

  void markTreatmentRequestResponded({
    patientId,
    clinicId,
    offerId: opts.offerId,
    profileId,
    source: "continuity_fallback",
  }).catch((e) =>
    console.warn("[treatmentRequestLifecycle] continuity:", e?.message || e),
  );
  void projectCoordinationState(profileId).catch((e) =>
    console.warn("[coordinationProjection] continuity:", e?.message || e),
  );

  console.log("[aiSlaContinuity] sent continuity", {
    profileId: profileId.slice(0, 8),
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    mode: opts.immediate ? "immediate" : "sla",
  });

  return { sent: true, profileId };
}

/**
 * Shorter delay for first patient messages so AI greets before doctor is online.
 * @param {string|null} profileId
 * @param {string} source
 * @param {boolean} isQuoteRequest
 */
async function resolveInboundReplyDelayMs(profileId, source, isQuoteRequest) {
  if (isQuoteRequest) {
    return Math.max(
      200,
      parseInt(process.env.AI_QUOTE_REQUEST_REPLY_DELAY_MS || "500", 10) || 500,
    );
  }

  let isFirstPatientTurn = true;
  if (profileId && isSupabaseEnabled()) {
    const { data } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("message_count, last_ai_reply_at")
      .eq("id", profileId)
      .maybeSingle();
    const mc = Number(data?.message_count) || 0;
    isFirstPatientTurn = !data?.last_ai_reply_at || mc <= 2;
  }

  if (source === "offer_chat" && isFirstPatientTurn) {
    return Math.max(
      150,
      parseInt(process.env.AI_FIRST_OFFER_REPLY_DELAY_MS || "350", 10) || 350,
    );
  }
  if (isFirstPatientTurn) {
    return Math.max(
      200,
      parseInt(process.env.AI_FIRST_INBOUND_REPLY_DELAY_MS || "500", 10) || 500,
    );
  }
  return Math.max(400, parseInt(process.env.AI_INBOUND_REPLY_DELAY_MS || "1200", 10) || 1200);
}

/**
 * After patient sends a clinic-thread message or treatment quote request.
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   patientMessage?: string,
 *   source?: 'chat'|'quote_request'|'offer_chat',
 *   contextMode?: 'coordinator'|'treatment_guide',
 *   offerId?: string|null,
 *   treatmentRequestId?: string|null,
 *   preferOfferThread?: boolean,
 * }} params
 */
async function afterPatientInboundMessage(params) {
  if (process.env.AI_SLA_CONTINUITY_ENABLED === "false") {
    console.log("[aiSlaContinuity] inbound skipped: AI_SLA_CONTINUITY_ENABLED=false");
    return;
  }
  if (!isSupabaseEnabled()) return;

  const patientId = String(params.patientId || "").trim();
  let clinicId = String(params.clinicId || "").trim();
  const patientMessage = String(params.patientMessage || "").trim();
  const inboundSource = String(params.source || "chat").trim();
  if (!UUID_RE.test(patientId)) return;
  if (!patientMessage) return;

  if (!UUID_RE.test(clinicId)) {
    const resolved = await resolveOperationalClinicId(patientId, {
      contextClinicId: params.clinicId,
      offerId: params.offerId,
      treatmentRequestId: params.treatmentRequestId,
      logLabel: "inbound_ai_hook",
    });
    clinicId = String(resolved.clinicId || "").trim();
    if (!UUID_RE.test(clinicId)) {
      logAiOrchestrationSkip(null, patientId, {
        ...resolved,
        reason: "clinic_unresolved",
        source: params.source,
      });
      return;
    }
  }

  let profileId = null;
  if (inboundSource === "whatsapp") {
    const { data: prof } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    profileId = prof?.id ? String(prof.id) : null;
  }
  if (!profileId) {
    profileId = await touchLeadProfileFromInbound(patientId, clinicId, patientMessage);
  }
  let scheduledForPatientAt = new Date().toISOString();
  if (profileId) {
    const { data: fresh } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("last_patient_message_at")
      .eq("id", profileId)
      .maybeSingle();
    if (fresh?.last_patient_message_at) {
      scheduledForPatientAt = String(fresh.last_patient_message_at);
    }
  }

  const source = inboundSource || "chat";
  const isQuoteRequest = source === "quote_request";

  const contextMode = params.contextMode || "coordinator";
  const resolvedOfferId = await resolveInboundOfferId(patientId, clinicId, {
    offerId: params.offerId,
    treatmentRequestId: params.treatmentRequestId,
  });
  const useOfferThread =
    Boolean(resolvedOfferId) &&
    (source === "offer_chat" ||
      isQuoteRequest ||
      source === "chat" ||
      params.preferOfferThread !== false);
  let inboundChannel = useOfferThread ? "offer_chat" : isQuoteRequest ? "coordinator" : "in_app";
  if (params.channel) {
    inboundChannel = normalizeCoordinatorChannel(params.channel, inboundChannel);
  } else if (source === "messenger" || source === "instagram" || source === "whatsapp") {
    inboundChannel = normalizeCoordinatorChannel(source, inboundChannel);
  }

  let isFirstPatientTurn = true;
  if (profileId && isSupabaseEnabled()) {
    const { data: prof } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("message_count, last_ai_reply_at, ai_mode, ai_paused, coordination_mode")
      .eq("id", profileId)
      .maybeSingle();
    const mc = Number(prof?.message_count) || 0;
    isFirstPatientTurn = !prof?.last_ai_reply_at || mc <= 2;
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const clinicPolicy = buildClinicPolicySummary(clinicProfile);
  let profileRowForDelegation = null;
  if (profileId) {
    const { data: profRow } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select(
        "id, ai_mode, ai_paused, ai_escalation_required, coordination_mode, escalation_flags, assigned_doctor_id, operational_intake_flags, human_takeover_at",
      )
      .eq("id", profileId)
      .maybeSingle();
    if (profRow) {
      const { maybeAutoResumeAiAfterSnooze } = require("./aiSnoozeCatchUp");
      profileRowForDelegation = await maybeAutoResumeAiAfterSnooze(profRow);
    }
  }
  const delegation = resolveInquiryDelegation(profileRowForDelegation || {}, {
    clinicPolicy,
    messageText: patientMessage,
  });

  const orch = await resolveInboundAiOrchestration({
    clinicId,
    channel: inboundChannel,
    source,
    isFirstPatientTurn,
    isQuoteRequest,
    delegation,
  });

  const latency = startAiReplyLatencyTrace({
    channel: inboundChannel,
    source,
    patientId,
    clinicId,
  });
  latency.mark("webhook_received");

  if (source === "offer_chat") {
    console.log("[offerInboundOrchestration] dispatching AI pipeline", {
      offerId: resolvedOfferId ? resolvedOfferId.slice(0, 8) : null,
      clinicId: clinicId.slice(0, 8),
      replyMode: orch.replyMode,
    });
  }

  console.log("[aiSlaContinuity] inbound orchestration", {
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    channel: inboundChannel,
    replyMode: orch.replyMode,
    runInstant: orch.runInstant,
    scheduleHumanFallback: orch.scheduleHumanFallback,
    instantDelayMs: orch.instantDelayMs,
    fallbackDelayMinutes: orch.fallbackDelayMinutes,
    autoReplyAllowed: delegation.autoReplyAllowed,
    traceId: latency.traceId,
  });

  if (orch.scheduleHumanFallback) {
    scheduleDoctorSilenceAiFallback(`${patientId}:${clinicId}`, {
      patientId,
      clinicId,
      patientMessage,
      scheduledForPatientAt,
      offerId: useOfferThread ? resolvedOfferId : null,
      treatmentRequestId: params.treatmentRequestId || null,
      inboundChannel,
      contextMode,
      source,
      fallbackDelayMs: orch.fallbackDelayMs,
      fallbackDelayMinutes: orch.fallbackDelayMinutes,
    });
  }

  const runInstantAi = async (turnPayload = {}) => {
    const turnMessage = String(turnPayload.patientMessage || patientMessage).trim();
    const turnScheduledAt =
      turnPayload.scheduledForPatientAt || turnPayload.inboundPatientMessageAt || scheduledForPatientAt;
    const turnExternalId = turnPayload.externalMessageId || params.externalMessageId || null;
    try {
      latency.mark("ai_generation_start");
      const aiResult = await runAiReplyForClinicInbound({
        patientId,
        clinicId,
        patientMessage: turnMessage,
        channel: inboundChannel,
        contextMode,
        source,
        offerId: useOfferThread ? resolvedOfferId : null,
        treatmentRequestId: params.treatmentRequestId,
        latencyTraceId: latency.traceId,
        inboundPatientMessageAt: turnScheduledAt,
        externalMessageId: turnExternalId,
      });
      latency.mark("ai_generation_end");

      if (aiResult.sent) {
        cancelDoctorSilenceAiFallback(patientId, clinicId);
        if (aiResult.outboundDelivered !== true && inboundChannel === "whatsapp") {
          console.warn("[aiSlaContinuity] whatsapp AI reply stored but not delivered externally", {
            patientId: patientId.slice(0, 8),
            clinicId: clinicId.slice(0, 8),
            traceId: latency.traceId,
          });
        }
        latency.finish({
          mode: "instant",
          sent: true,
          outboundDelivered: aiResult.outboundDelivered === true,
        });
        return;
      }

      if (
        aiResult.reason === "conversation_owner_not_ai" ||
        aiResult.reason === "ai_disabled" ||
        aiResult.reason === "escalation"
      ) {
        cancelDoctorSilenceAiFallback(patientId, clinicId);
        logAiReplyLatency(latency.traceId, "instant_skipped", {
          aiReason: aiResult.reason,
          replyMode: orch.replyMode,
        });
        return;
      }

      if (aiResult.reason === "superseded_by_newer_patient_message") {
        const { data: latestProf } = await supabase
          .from("ai_coordinator_lead_profiles")
          .select("last_patient_message, last_patient_message_at")
          .eq("patient_id", patientId)
          .eq("clinic_id", clinicId)
          .maybeSingle();
        const latestMsg = String(latestProf?.last_patient_message || turnMessage).trim();
        if (latestMsg) {
          const retry = await runAiReplyForClinicInbound({
            patientId,
            clinicId,
            patientMessage: latestMsg,
            channel: inboundChannel,
            contextMode,
            source,
            offerId: useOfferThread ? resolvedOfferId : null,
            treatmentRequestId: params.treatmentRequestId,
            latencyTraceId: latency.traceId,
            inboundPatientMessageAt: latestProf?.last_patient_message_at || turnScheduledAt,
            externalMessageId: turnExternalId,
          });
          if (retry.sent) {
            cancelDoctorSilenceAiFallback(patientId, clinicId);
            latency.finish({
              mode: "instant",
              sent: true,
              outboundDelivered: retry.outboundDelivered === true,
              retriedAfterSuperseded: true,
            });
            return;
          }
        }
      }

      if (
        aiResult.reason === "already_replied" ||
        aiResult.reason === "already_replied_event"
      ) {
        cancelDoctorSilenceAiFallback(patientId, clinicId);
        latency.finish({ mode: "instant", sent: false, aiReason: aiResult.reason });
        return;
      }

      if (!aiResult.sent && orch.scheduleHumanFallback) {
        logAiReplyLatency(latency.traceId, "instant_failed_fallback_scheduled", {
          aiReason: aiResult.reason,
          fallbackDelayMinutes: orch.fallbackDelayMinutes,
        });
      } else {
        latency.finish({ mode: "instant", sent: false, aiReason: aiResult.reason });
      }
    } catch (e) {
      console.warn("[aiSlaContinuity] inbound:", e?.message || e);
      latency.finish({ mode: "instant", error: e?.message || String(e) });
    }
  };

  if (!orch.runInstant) {
    logAiReplyLatency(latency.traceId, "instant_disabled", {
      replyMode: orch.replyMode,
      autoReplyAllowed: delegation.autoReplyAllowed,
      scheduleHumanFallback: orch.scheduleHumanFallback,
      channel: inboundChannel,
    });
    if (!orch.scheduleHumanFallback) {
      console.warn("[aiSlaContinuity] no instant AI and no fallback scheduled", {
        patientId: patientId.slice(0, 8),
        clinicId: clinicId.slice(0, 8),
        channel: inboundChannel,
        replyMode: orch.replyMode,
        autoReplyAllowed: delegation.autoReplyAllowed,
        aiMode: delegation.aiMode,
        conversationOwner: delegation.conversationOwner,
      });
    }
    return;
  }

  cancelPendingInstantAiReply(patientId, clinicId);

  const isOmnichannelBurst =
    inboundChannel === "whatsapp" ||
    inboundChannel === "messenger" ||
    inboundChannel === "instagram" ||
    source === "whatsapp" ||
    source === "messenger" ||
    source === "instagram";
  const burstCoalesceMs = isOmnichannelBurst ? 280 : 180;
  const delayMs = Math.max(Number(orch.instantDelayMs) || 0, burstCoalesceMs);
  const instantKey = `${patientId}:${clinicId}`;
  const turnPayload = {
    patientMessage,
    scheduledForPatientAt,
    externalMessageId: params.externalMessageId || null,
  };
  if (delayMs <= 0) {
    void runInstantAi(turnPayload);
    return;
  }
  scheduleCoalescedInstantAiReply(instantKey, turnPayload, delayMs, runInstantAi);
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ immediate?: boolean }} [opts]
 */
async function runContinuityForPatientClinic(patientId, clinicId, opts = {}) {
  const offerId = opts.offerId ? String(opts.offerId).trim() : null;
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, conversation_primary_language, preferred_language, operational_intake_flags, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !data) return { sent: false, reason: "no_profile" };
  return trySendContinuityForProfile(data, { ...opts, offerId: offerId || opts.offerId });
}

/**
 * Periodic sweep for all clinics — SLA threshold from clinic AI settings.
 */
async function runSlaContinuitySweep() {
  if (process.env.AI_SLA_CONTINUITY_ENABLED === "false") return { scanned: 0 };
  if (!isSupabaseEnabled() || !insertClinicMessageFn) return { scanned: 0 };

  const maxAgeHours = Math.max(1, parseInt(process.env.AI_SLA_CONTINUITY_MAX_AGE_HOURS || "72", 10) || 72);
  const sinceIso = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, coordination_mode, primary_channel, ai_mode, ai_paused, ai_escalation_required, escalation_flags, conversation_primary_language, preferred_language, operational_intake_flags, last_patient_message, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .not("patient_id", "is", null)
    .not("clinic_id", "is", null)
    .gte("last_patient_message_at", sinceIso)
    .order("last_patient_message_at", { ascending: true })
    .limit(80);

  if (error) {
    console.warn("[aiSlaContinuity] sweep query:", error.message);
    return { scanned: 0, error: error.message };
  }

  let sent = 0;
  let aiFallbackSent = 0;
  const silenceMin = doctorSilenceFallbackMinutes();
  for (const row of rows || []) {
    if (!isWaitingOnClinic(row)) continue;
    const lastPatientAt = String(
      row.last_patient_message_at || row.last_channel_message_at || "",
    );
    const waitingMs = Date.now() - new Date(lastPatientAt).getTime();
    const flags =
      row.operational_intake_flags && typeof row.operational_intake_flags === "object"
        ? row.operational_intake_flags
        : {};
    const offerId = flags.coordinationOfferId || flags.coordination_offer_id || null;

    if (
      Number.isFinite(waitingMs) &&
      waitingMs >= silenceMin * 60 * 1000 &&
      process.env.AI_DOCTOR_SILENCE_FALLBACK_ENABLED !== "false"
    ) {
      const sweepChannel = normalizeCoordinatorChannel(row.primary_channel, "in_app");
      const sweepSource =
        sweepChannel === "whatsapp"
          ? "whatsapp"
          : sweepChannel === "messenger"
            ? "messenger"
            : sweepChannel === "instagram"
              ? "instagram"
              : "sla_sweep";
      const aiFb = await runDoctorSilenceAiFallback({
        patientId: String(row.patient_id),
        clinicId: String(row.clinic_id),
        patientMessage: String(row.last_patient_message || "").trim() || "Hello",
        scheduledForPatientAt: lastPatientAt,
        offerId,
        inboundChannel: sweepChannel,
        source: sweepSource,
      });
      if (aiFb.sent) {
        aiFallbackSent += 1;
        continue;
      }
    }

    const result = await trySendContinuityForProfile(row, { immediate: false });
    if (result.sent) sent += 1;
  }

  if (sent > 0 || aiFallbackSent > 0) {
    console.log("[aiSlaContinuity] sweep", {
      continuity: sent,
      doctorSilenceAi: aiFallbackSent,
    });
  }
  return { scanned: (rows || []).length, sent, aiFallbackSent };
}

module.exports = {
  setupAiSlaContinuity,
  afterPatientInboundMessage,
  runContinuityForPatientClinic,
  runSlaContinuitySweep,
  touchLeadProfileFromInbound,
  scheduleDoctorSilenceAiFallback,
  cancelDoctorSilenceAiFallback,
  runDoctorSilenceAiFallback,
  doctorSilenceFallbackMinutes,
};
