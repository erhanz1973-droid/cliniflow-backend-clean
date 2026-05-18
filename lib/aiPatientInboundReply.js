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
const { resolveInboundCoordinatorChannel } = require("./coordinatorChannels");
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
const { buildClinicSalesPromptForAi } = require("./clinicSalesPromptForAi");
const { buildAppointmentAwarenessPromptBlock } = require("./appointmentCoordinationSync");
const {
  resolveConversationLanguageForTurn,
  buildConversationLanguagePromptBlock,
  readConversationLanguageFromProfile,
} = require("./conversationLanguage");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");
const {
  resolveOperationalClinicId,
  logAiOrchestrationSkip,
  logAiDelegationEvaluation,
} = require("./clinicOperationalContext");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((opts: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertClinicMessageFn = null;

const HOLDING = {
  en: "Thank you for your message. Someone from the clinic will respond shortly.",
  tr: "Mesajınız için teşekkürler. Klinik ekibimiz en kısa sürede size dönüş yapacaktır.",
  ru: "Спасибо за ваше сообщение. Команда клиники скоро ответит вам.",
  ka: "გმადლობთ შეტყობინებისთვის. კლინიკის გუნდი მალე დაგიბრუნდებათ.",
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
    language: row.conversation_primary_language || row.preferred_language,
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
 * @param {Record<string, unknown>|null} [profileRow]
 */
async function pickLang(clinicId, profileRow = null) {
  const fromConversation = readConversationLanguageFromProfile(profileRow);
  if (fromConversation && HOLDING[fromConversation]) return fromConversation;
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
  let clinicId = String(params.clinicId || "").trim();
  const message = String(params.patientMessage || "").trim();
  if (!UUID_RE.test(patientId)) {
    return { sent: false, reason: "invalid_ids" };
  }
  if (!message) {
    return { sent: false, reason: "empty_message" };
  }

  if (!UUID_RE.test(clinicId)) {
    const resolved = await resolveOperationalClinicId(patientId, {
      offerId: params.offerId,
      treatmentRequestId: params.treatmentRequestId,
      logLabel: "ai_inbound_reply",
    });
    clinicId = String(resolved.clinicId || "").trim();
    if (!UUID_RE.test(clinicId)) {
      logAiOrchestrationSkip(null, patientId, {
        ...resolved,
        reason: "clinic_unresolved",
      });
      return { sent: false, reason: "clinic_unresolved" };
    }
  }

  let { data: profileRow, error: loadErr } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, session_id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (loadErr || !profileRow?.id) {
    const { touchLeadProfileFromInbound } = require("./aiSlaContinuity");
    const profileId = await touchLeadProfileFromInbound(patientId, clinicId, message);
    if (!profileId) {
      console.log("[aiPatientInboundReply] skipped: no_profile", {
        patientId: patientId.slice(0, 8),
        clinicId: clinicId.slice(0, 8),
      });
      return { sent: false, reason: "no_profile" };
    }
    const reload = await supabase
      .from("ai_coordinator_lead_profiles")
      .select(
        "id, session_id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
      )
      .eq("id", profileId)
      .maybeSingle();
    profileRow = reload.data;
    loadErr = reload.error;
    if (loadErr || !profileRow?.id) {
      return { sent: false, reason: "no_profile" };
    }
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
  const delegation = resolveInquiryDelegation(profileRow, {
    clinicPolicy,
    messageText: message,
  });
  logAiDelegationEvaluation(
    { ...delegation, offerId: params.offerId, source: params.source },
    clinicId,
  );

  if (delegation.aiEscalationRequired) {
    console.log("[aiPatientInboundReply] skipped: escalation_required", {
      profileId: String(profileRow.id).slice(0, 8),
    });
    return { sent: false, reason: "escalation" };
  }

  const canRunAi =
    !delegation.aiPaused &&
    (delegation.autoReplyAllowed || delegation.draftGenerationAllowed);

  if (!canRunAi) {
    console.log("[aiPatientInboundReply] skipped: ai_disabled", {
      profileId: String(profileRow.id).slice(0, 8),
      aiPaused: delegation.aiPaused,
      autoReplyAllowed: delegation.autoReplyAllowed,
      draftGenerationAllowed: delegation.draftGenerationAllowed,
    });
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
  let pricingSalesContext = null;
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
  documentIntakeContext = buildDocumentIntakePromptBlock(priorFlags, intakeDocuments, message);
  const persistedFlags =
    profileRow.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : priorFlags;
  const apptAwareness = buildAppointmentAwarenessPromptBlock(persistedFlags);
  if (apptAwareness) {
    documentIntakeContext = `${apptAwareness}\n\n${documentIntakeContext}`;
  }
  pricingSalesContext = await buildClinicSalesPromptForAi(clinicId, {
    message,
    leadData: priorLeadData,
    clinicName: clinicContext,
  });

  const languageState = await resolveConversationLanguageForTurn({
    message,
    profileRow,
    clinicId,
    patientId,
  });
  const conversationLanguagePolicy = buildConversationLanguagePromptBlock(languageState);

  let replyText = "";
  let turnLeadData = null;
  let nextSummary = conversationSummary;

  if (!isOpenAIConfigured()) {
    console.log("[aiPatientInboundReply] skipped: openai_not_configured", {
      profileId: String(profileRow.id).slice(0, 8),
    });
    return { sent: false, reason: "openai_not_configured" };
  }

  try {
    const result = await coordinatorChatReply({
      message,
      clinicContext,
      travelContext: isTreatmentGuide ? null : travelContext,
      journeyContext,
      documentIntakeContext,
      pricingSalesContext,
      clinicDirectoryContext: null,
      history: [],
      conversationSummary,
      contextMode,
      conversationLanguagePolicy,
    });

    turnLeadData = result.leadData;
    nextSummary = result.conversationSummary;

    if (delegation.autoReplyAllowed) {
      replyText = result.reply;
    } else if (delegation.draftGenerationAllowed) {
      replyText = result.reply;
    } else {
      const lang = await pickLang(clinicId, profileRow);
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
  const channel = resolveInboundCoordinatorChannel(params.source, params.channel);
  const nowIso = new Date().toISOString();

  const insertResult = await insertClinicMessageFn({
    patientId,
    message: replyText,
    type: "text",
    contextClinicId: clinicId,
    offerId: params.offerId || null,
    senderName: "Care Team",
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
    conversationLanguage: languageState.conversationLanguage,
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

  const { error: chMsgErr } = await insertChannelMessagesWithChannel({
    profile_id: profileRow.id,
    channel,
    direction: "outbound",
    message_role: "assistant",
    body: replyText,
  });
  if (chMsgErr) {
    console.warn("[aiPatientInboundReply] channel_messages:", chMsgErr.message);
  }

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
