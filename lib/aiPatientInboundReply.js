/**
 * AI replies on clinic patient threads (chat message OR treatment quote request).
 * Uses the same coordinator brain as POST /ai/chat, delivered via patient_messages.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { coordinatorChatReply, isOpenAIConfigured } = require("./openai");
const { mergeLeadData, normalizeLeadData } = require("./leadIntelligence");
const { normalizeConversationSummary } = require("./conversationMemory");
const { persistAiCoordinatorLead, asUuid } = require("./aiLeadPipeline");
const { resolveInquiryDelegation, buildClinicPolicySummary } = require("./aiDelegation");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { getTopHotelsForAi } = require("./clinicPartnerHotels");
const { buildTravelAccommodationPromptBlock } = require("./clinicTravelPrompt");
const { getRelevantProtocolsForAi } = require("./clinicTreatmentProtocols");
const { buildTreatmentJourneyPromptBlock } = require("./clinicJourneyPrompt");
const { listDocumentsForPatient, listDocumentsForProfile } = require("./aiPatientDocuments");
const {
  buildDocumentIntakePromptBlock,
  syncOperationalIntakeFlags,
  buildOperationalIntakeState,
} = require("./aiIntakeFlags");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((opts: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertClinicMessageFn = null;

const HOLDING = {
  en: "Thank you for your message. Someone from the clinic will respond shortly.",
  tr: "Mesajınız için teşekkürler. Klinik ekibimiz en kısa sürede size dönüş yapacaktır.",
};

/**
 * @param {{ insertClinicMessage: typeof insertClinicMessageFn }} deps
 */
function setupAiPatientInboundReply(deps) {
  insertClinicMessageFn = deps.insertClinicMessage || null;
}

/**
 * @param {Record<string, unknown>} row
 */
function leadDataFromProfileRow(row) {
  return normalizeLeadData({
    treatmentInterest: row.treatment_interest,
    country: row.country,
    language: row.preferred_language,
    travelTimeline: row.travel_timeline,
    urgency: row.urgency,
    bookingIntent: row.booking_intent,
    budgetSignal: row.budget_signal,
  });
}

/**
 * @param {string|Date|null|undefined} iso
 */
function toMs(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {Record<string, unknown>} row
 */
function aiAlreadyRepliedSinceLastPatient(row) {
  const lp = toMs(row.last_patient_message_at || row.last_channel_message_at);
  const la = toMs(row.last_ai_reply_at);
  if (!lp) return false;
  if (!la) return false;
  return la >= lp;
}

/**
 * @param {string} profileId
 * @param {string} lastPatientAt
 */
async function hasAiOutboundSincePatient(profileId, lastPatientAt) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id, event_type, created_at")
    .eq("profile_id", profileId)
    .gte("created_at", lastPatientAt)
    .in("event_type", ["ai_reply", "continuity_fallback"])
    .limit(3);
  if (error) return false;
  return (data || []).length > 0;
}

/**
 * @param {string} clinicId
 */
async function resolveClinicContext(clinicId) {
  const id = String(clinicId || "").trim();
  if (!UUID_RE.test(id) || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase
      .from("clinics")
      .select("name, clinic_code, city, country")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const parts = [data.name, data.city, data.country].map((s) => String(s || "").trim()).filter(Boolean);
    return parts.length ? parts.join(", ") : data.clinic_code ? String(data.clinic_code).trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} clinicId
 */
async function pickLang(clinicId) {
  const profile = await getClinicAiProfile(clinicId);
  const code =
    String(profile.tone?.primaryLanguage || profile.tone?.enabledLanguageCodes?.[0] || "en")
      .trim()
      .toLowerCase()
      .slice(0, 2) || "en";
  return HOLDING[code] ? code : "en";
}

/**
 * Generate coordinator reply and post to patient↔clinic thread.
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   patientMessage: string,
 *   channel?: string,
 *   contextMode?: 'coordinator'|'treatment_guide',
 *   source?: string,
 * }} params
 */
async function runAiReplyForClinicInbound(params) {
  if (!insertClinicMessageFn || !isSupabaseEnabled()) {
    return { sent: false, reason: "not_configured" };
  }

  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const message = String(params.patientMessage || "").trim();
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { sent: false, reason: "invalid_ids" };
  }
  if (!message) {
    return { sent: false, reason: "empty_message" };
  }

  const { data: profileRow, error: loadErr } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, session_id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, conversation_summary, treatment_interest, country, preferred_language, travel_timeline, urgency, booking_intent, budget_signal, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (loadErr || !profileRow?.id) {
    return { sent: false, reason: "no_profile" };
  }

  const lastPatientAt = String(
    profileRow.last_patient_message_at || profileRow.last_channel_message_at || "",
  );
  if (aiAlreadyRepliedSinceLastPatient(profileRow)) {
    return { sent: false, reason: "already_replied" };
  }
  if (lastPatientAt && (await hasAiOutboundSincePatient(profileRow.id, lastPatientAt))) {
    return { sent: false, reason: "already_replied_event" };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const clinicPolicy = buildClinicPolicySummary(clinicProfile);
  const delegation = resolveInquiryDelegation(profileRow, { clinicPolicy });

  if (delegation.aiEscalationRequired) {
    return { sent: false, reason: "escalation" };
  }

  const canRunAi =
    !delegation.aiPaused &&
    (delegation.autoReplyAllowed || delegation.draftGenerationAllowed);

  if (!canRunAi) {
    return { sent: false, reason: "ai_disabled" };
  }

  const sessionId = String(profileRow.session_id || `inq_${patientId}_${clinicId}`);
  const priorLeadData = leadDataFromProfileRow(profileRow);
  const conversationSummary = normalizeConversationSummary(profileRow.conversation_summary);
  const contextMode = params.contextMode === "treatment_guide" ? "treatment_guide" : "coordinator";
  const isTreatmentGuide = contextMode === "treatment_guide";

  const clinicContext = await resolveClinicContext(clinicId);
  let travelContext = null;
  let journeyContext = null;
  let documentIntakeContext = null;
  let intakeDocuments = [];

  if (!isTreatmentGuide) {
    const hotels = await getTopHotelsForAi(clinicId, 3);
    travelContext = buildTravelAccommodationPromptBlock(hotels);
  }
  const protocols = await getRelevantProtocolsForAi(clinicId, {
    message,
    treatmentInterest: priorLeadData.treatmentInterest,
    max: 5,
  });
  journeyContext = buildTreatmentJourneyPromptBlock(protocols);
  intakeDocuments = await listDocumentsForPatient(patientId, clinicId);
  const priorFlags = buildOperationalIntakeState({
    leadData: priorLeadData,
    documents: intakeDocuments,
    patientMessage: message,
  });
  documentIntakeContext = buildDocumentIntakePromptBlock(priorFlags, intakeDocuments);

  let replyText = "";
  let turnLeadData = null;
  let nextSummary = conversationSummary;

  if (!isOpenAIConfigured()) {
    return { sent: false, reason: "openai_not_configured" };
  }

  try {
    const result = await coordinatorChatReply({
      message,
      clinicContext,
      travelContext: isTreatmentGuide ? null : travelContext,
      journeyContext,
      documentIntakeContext,
      clinicDirectoryContext: null,
      history: [],
      conversationSummary,
      contextMode,
    });

    turnLeadData = result.leadData;
    nextSummary = result.conversationSummary;

    if (delegation.autoReplyAllowed) {
      replyText = result.reply;
    } else if (delegation.draftGenerationAllowed) {
      replyText = result.reply;
    } else {
      const lang = await pickLang(clinicId);
      replyText = HOLDING[lang] || HOLDING.en;
    }
  } catch (e) {
    console.warn("[aiPatientInboundReply] OpenAI:", e?.message || e);
    return { sent: false, reason: "openai_failed" };
  }

  if (!String(replyText || "").trim()) {
    return { sent: false, reason: "empty_reply" };
  }

  const leadData = mergeLeadData(priorLeadData, turnLeadData || {});
  const channel = String(params.channel || "in_app").trim() || "in_app";
  const nowIso = new Date().toISOString();

  const insertResult = await insertClinicMessageFn({
    patientId,
    message: replyText,
    type: "text",
    contextClinicId: clinicId,
  });

  if (insertResult?.error) {
    console.warn("[aiPatientInboundReply] insert:", insertResult.error?.message || insertResult.error);
    return { sent: false, reason: "insert_failed" };
  }

  const leadPipeline = await persistAiCoordinatorLead({
    sessionId,
    patientId,
    clinicId: asUuid(clinicId),
    leadData,
    turnLeadData,
    conversationSummary: nextSummary,
    patientMessage: message,
    aiReply: replyText,
    channel,
  });

  if (leadPipeline.profileId) {
    const profileDocs = await listDocumentsForProfile(leadPipeline.profileId, { clinicId });
    await syncOperationalIntakeFlags(leadPipeline.profileId, leadData, profileDocs, {
      patientMessage: message,
    });
  }

  await insertTimelineEvent({
    profileId: profileRow.id,
    eventType: "ai_reply",
    eventMetadata: {
      source: params.source || "clinic_inbound",
      autoReply: delegation.autoReplyAllowed,
      draftOnly: !delegation.autoReplyAllowed && delegation.draftGenerationAllowed,
    },
    patientMessage: message,
    aiReply: replyText,
    channel,
  });

  await supabase.from("ai_coordinator_channel_messages").insert({
    profile_id: profileRow.id,
    channel,
    direction: "outbound",
    message_role: "assistant",
    body: replyText,
  });

  console.log("[aiPatientInboundReply] sent", {
    profileId: String(profileRow.id).slice(0, 8),
    source: params.source || "inbound",
    autoReply: delegation.autoReplyAllowed,
  });

  return { sent: true, profileId: profileRow.id, leadPipeline };
}

module.exports = {
  setupAiPatientInboundReply,
  runAiReplyForClinicInbound,
};
