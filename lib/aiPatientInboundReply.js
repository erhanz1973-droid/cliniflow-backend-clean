/**
 * AI replies on clinic patient threads (chat message OR treatment quote request).
 * Uses the same coordinator brain as POST /ai/chat, delivered via patient_messages.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  coordinatorChatReply,
  isOpenAIConfigured,
  isInvalidPatientFacingReply,
  sanitizePatientFacingReply,
} = require("./openai");
const { mergeLeadData, normalizeLeadData } = require("./leadIntelligence");
const { normalizeConversationSummary } = require("./conversationMemory");
const { persistAiCoordinatorLead, asUuid } = require("./aiLeadPipeline");
const { resolveInquiryDelegation, buildClinicPolicySummary } = require("./aiDelegation");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { resolveInboundCoordinatorChannel } = require("./coordinatorChannels");
const { getTopHotelsForAi } = require("./clinicPartnerHotels");
const {
  resolvePatientContextStrategy,
  buildPatientContextStrategyPromptBlock,
  buildTravelContextForStrategy,
} = require("./patientContextStrategy");
const { fetchRecentCoordinatorTurns } = require("./coordinatorRecentHistory");
const {
  buildDiscussionMemory,
  buildRepetitionSuppressionPromptBlock,
  updateDiscussionMemoryAfterTurn,
  readDiscussionMemoryFromFlags,
  applyConversationRepetitionGuardrails,
} = require("./conversationRepetitionMemory");
const { getRelevantProtocolsForAi } = require("./clinicTreatmentProtocols");
const { buildTreatmentJourneyPromptBlock } = require("./clinicJourneyPrompt");
const { listDocumentsForPatient, listDocumentsForProfile } = require("./aiPatientDocuments");
const {
  buildDocumentIntakePromptBlock,
  syncOperationalIntakeFlags,
  buildOperationalIntakeState,
} = require("./aiIntakeFlags");
const { buildClinicSalesPromptForAi } = require("./clinicSalesPromptForAi");
const { buildConversionStrategyForAi } = require("./conversionEngineForAi");
const { buildReferralAwarenessForAi } = require("./referralAwarenessForAi");
const {
  readConversationTopicFromFlags,
  resolveActiveConversationTopic,
  assembleReferralAwarenessContext,
  buildConversationTopicGuardPromptBlock,
  updateConversationTopicAfterTurn,
} = require("./conversationTopicTracking");
const { buildAppointmentAwarenessPromptBlock } = require("./appointmentCoordinationSync");
const {
  resolveConversationLanguageForTurn,
  buildConversationLanguagePromptBlock,
  persistConversationLanguage,
  readConversationLanguageFromProfile,
  resolveConversationLanguage,
  enforcePatientReplyLanguage,
} = require("./conversationLanguage");
const { logAiReplyLatency } = require("./aiReplyOrchestration");
const {
  buildPatientQuestionAnchoringPromptBlock,
  repairGenericDeflectionReply,
  detectPatientTreatmentTopic,
} = require("./patientQuestionAnchoring");
const { markTreatmentRequestResponded } = require("./treatmentRequestLifecycle");
const { projectCoordinationState } = require("./coordinationProjection");
const {
  evaluateWhatsappCollectionCandidate,
  buildWhatsappCollectionPromptBlock,
  extractWhatsappFromPatientMessage,
  resolveWhatsappFromPatientTurn,
  buildWhatsappAcknowledgmentPromptBlock,
  buildPhoneNumberAcknowledgmentTurnBlock,
  isPhoneOnlyPatientMessage,
  patientMessageSharesWhatsappNumber,
  resolvePhoneAcknowledgmentLanguage,
  formatPhoneAcknowledgmentReply,
  repairPhoneNumberTurnReply,
  repairCoordinatorCapabilityMisreply,
  normalizeWhatsappNumber,
  patientSaysAlreadyShared,
  coordinatorRecentlyAskedForWhatsapp,
  persistWhatsappCollection,
  markWhatsappPromptOffered,
  processWhatsappAfterCoordinationTurn,
} = require("./whatsappCollection");
const {
  looksLikeStandaloneNameLine,
  syncPatientNameColumn,
  extractPatientNameFromMessage,
  coordinatorRecentlyAskedForName,
} = require("./patientNameSync");
const {
  patientNeedsClinicEnrollmentNotice,
  fetchClinicCodeByClinicId,
  buildPatientAppOnboardingPromptBlock,
  patientAskedAboutAppRegistration,
} = require("./patientClinicEnrollment");
const {
  prepareAiAppointmentBookingTurn,
  finalizeAiAppointmentBookingTurn,
  markAppointmentOfferInAiReply,
} = require("./aiAppointmentBooking");
const {
  evaluateConversationWorkflowTurn,
  workflowAfterAssistantReply,
  readConversationWorkflow,
} = require("./conversationWorkflowState");
const { isTimeOnlyPatientMessage } = require("./conversationalTimeParse");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");
const { deliverOutboundMessage } = require("./omnichannel/outboundDelivery");
const {
  resolveOperationalClinicId,
  logAiOrchestrationSkip,
  logAiDelegationEvaluation,
} = require("./clinicOperationalContext");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((opts: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertClinicMessageFn = null;

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
 * Per-inbound-message dedupe (WhatsApp wamid / Messenger mid).
 * @param {Record<string, unknown>} row
 * @param {string|null|undefined} externalMessageId
 */
function aiAlreadyRepliedForExternalMessage(row, externalMessageId) {
  const mid = String(externalMessageId || "").trim();
  if (!mid) return false;
  const flags =
    row.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? row.operational_intake_flags
      : {};
  const prev = String(
    flags.lastAiRepliedForExternalMessageId ||
      flags.last_ai_replied_for_external_message_id ||
      "",
  ).trim();
  return prev.length > 0 && prev === mid;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string|null|undefined} inboundPatientMessageAt
 */
function inboundTurnSupersededByNewerPatientMessage(row, inboundPatientMessageAt) {
  const inboundMs = toMs(inboundPatientMessageAt);
  const latestMs = toMs(row.last_patient_message_at || row.last_channel_message_at);
  if (inboundMs == null || latestMs == null) return false;
  // Rapid follow-ups ("Tamam" then "Alo") — still answer the in-flight turn
  if (latestMs - inboundMs < 5000) return false;
  return latestMs > inboundMs;
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
async function pickLang(clinicId, profileRow = null, patientMessage = "") {
  const msg = String(patientMessage || profileRow?.last_patient_message || "").trim();
  const profile = await getClinicAiProfile(clinicId);
  if (msg) {
    const state = resolveConversationLanguage({
      message: msg,
      conversationPrimaryLanguage: readConversationLanguageFromProfile(profileRow),
      clinicPrimaryLanguage: profile.tone?.primaryLanguage,
      enabledLanguageCodes: profile.tone?.enabledLanguageCodes,
      messageCount: Number(profileRow?.message_count) || 0,
    });
    if (state.conversationLanguage) return state.conversationLanguage;
  }
  const fromConversation = readConversationLanguageFromProfile(profileRow);
  if (fromConversation) return fromConversation;
  const code =
    String(profile.tone?.primaryLanguage || profile.tone?.enabledLanguageCodes?.[0] || "tr")
      .trim()
      .toLowerCase()
      .slice(0, 2) || "tr";
  return code;
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
      "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
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
        "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
      )
      .eq("id", profileId)
      .maybeSingle();
    profileRow = reload.data;
    loadErr = reload.error;
    if (loadErr || !profileRow?.id) {
      return { sent: false, reason: "no_profile" };
    }
  }

  const { data: freshProfile } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("id", profileRow.id)
    .maybeSingle();
  if (freshProfile?.id) profileRow = freshProfile;

  const inboundPatientMessageAt =
    params.inboundPatientMessageAt ||
    profileRow.last_patient_message_at ||
    profileRow.last_channel_message_at ||
    null;

  if (params.externalMessageId && aiAlreadyRepliedForExternalMessage(profileRow, params.externalMessageId)) {
    console.log("[aiPatientInboundReply] skipped: already_replied_external_id", {
      profileId: String(profileRow.id).slice(0, 8),
      externalMessageId: String(params.externalMessageId).slice(0, 24),
    });
    return { sent: false, reason: "already_replied_external_id" };
  }

  if (inboundTurnSupersededByNewerPatientMessage(profileRow, inboundPatientMessageAt)) {
    return { sent: false, reason: "superseded_by_newer_patient_message" };
  }

  const lastPatientAt = String(inboundPatientMessageAt || "");
  if (
    !params.externalMessageId &&
    aiAlreadyRepliedSinceLastPatient(profileRow)
  ) {
    return { sent: false, reason: "already_replied" };
  }
  if (
    lastPatientAt &&
    !params.externalMessageId &&
    (await hasAiOutboundSincePatient(profileRow.id, lastPatientAt))
  ) {
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

  if (!delegation.autoReplyAllowed) {
    console.log("[aiPatientInboundReply] skipped: not_ai_owner", {
      profileId: String(profileRow.id).slice(0, 8),
      conversationOwner: delegation.conversationOwner,
      aiPaused: delegation.aiPaused,
      autoReplyAllowed: delegation.autoReplyAllowed,
    });
    return { sent: false, reason: "conversation_owner_not_ai" };
  }

  const sessionId = String(profileRow.session_id || `inq_${patientId}_${clinicId}`);
  const priorLeadData = leadDataFromProfileRow(profileRow);
  const conversationSummary = normalizeConversationSummary(profileRow.conversation_summary);
  const contextMode = params.contextMode === "treatment_guide" ? "treatment_guide" : "coordinator";
  const isTreatmentGuide = contextMode === "treatment_guide";

  const clinicContext = await resolveClinicContext(clinicId);
  const patientContextStrategy = resolvePatientContextStrategy({
    message,
    conversationSummary,
    leadData: priorLeadData,
    profileRow,
    clinicProfile,
  });
  const patientContextStrategyPrompt =
    buildPatientContextStrategyPromptBlock(patientContextStrategy);
  let travelContext = null;
  let journeyContext = null;
  let documentIntakeContext = null;
  let pricingSalesContext = null;
  let intakeDocuments = [];

  if (!isTreatmentGuide && !patientContextStrategy.avoid_travel_coordination_topics) {
    const hotels = await getTopHotelsForAi(clinicId, 3);
    travelContext = buildTravelContextForStrategy(patientContextStrategy, hotels);
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
  const recentTurns = await fetchRecentCoordinatorTurns(profileRow.id, { maxTurns: 10 });

  const extractedName =
    extractPatientNameFromMessage(message, {
      coordinatorAskedName: coordinatorRecentlyAskedForName(recentTurns),
    }) || (looksLikeStandaloneNameLine(message) ? String(message).trim() : null);
  if (extractedName) {
    await syncPatientNameColumn(patientId, extractedName, { source: params.source || "inbound" });
  }
  const topicContext = resolveActiveConversationTopic({
    patientMessage: message,
    conversationSummary,
    recentTurns,
    persistedTopic: readConversationTopicFromFlags(persistedFlags),
  });
  if (topicContext.referral_topic_locked) {
    const guard = buildConversationTopicGuardPromptBlock(topicContext);
    documentIntakeContext = guard
      ? `${guard}\n\n(Do not run clinical/document intake pivots while referral topic is active.)`
      : documentIntakeContext;
  }
  const discussionMemory = buildDiscussionMemory({
    patientMessage: message,
    conversationSummary,
    recentTurns,
    persistedMemory: readDiscussionMemoryFromFlags(persistedFlags),
  });
  const repetitionSuppressionPrompt = buildRepetitionSuppressionPromptBlock(
    discussionMemory,
    { patientMessage: message, recentTurns },
  );

  pricingSalesContext = await buildClinicSalesPromptForAi(clinicId, {
    message,
    leadData: priorLeadData,
    clinicName: clinicContext,
    discussionMemory,
  });

  const languageState = await resolveConversationLanguageForTurn({
    message,
    profileRow,
    clinicId,
    patientId,
  });
  if (profileRow?.id) {
    await persistConversationLanguage(profileRow.id, languageState, persistedFlags);
    profileRow = {
      ...profileRow,
      conversation_primary_language: languageState.conversationLanguage,
      preferred_language: languageState.conversationLanguage,
    };
  }
  const conversationLanguagePolicy = buildConversationLanguagePromptBlock(languageState);
  const patientQuestionAnchoringPrompt = buildPatientQuestionAnchoringPromptBlock(message);
  const treatmentTopic = detectPatientTreatmentTopic(message);

  const clinicAiProfile = await getClinicAiProfile(clinicId);
  const whatsappBeforeTurn = normalizeWhatsappNumber(profileRow.whatsapp_number);
  const preWhatsapp = resolveWhatsappFromPatientTurn(message, {
    recentTurns,
    flags: persistedFlags,
    profileRow,
  });
  if (preWhatsapp?.declined) {
    await persistWhatsappCollection(profileRow.id, { declined: true, source: params.source });
  } else if (preWhatsapp?.number) {
    await persistWhatsappCollection(profileRow.id, { number: preWhatsapp.number, source: params.source });
    profileRow = {
      ...profileRow,
      whatsapp_number: preWhatsapp.number,
      whatsapp_collection_stage: "collected",
    };
    persistedFlags.whatsappCollectionStage = "collected";
    persistedFlags.hasWhatsapp = true;
  }

  const waEval = evaluateWhatsappCollectionCandidate(
    { ...profileRow, communicationPolicy: clinicAiProfile.communicationPolicy },
    persistedFlags,
    priorLeadData,
    message,
  );

  const knownWhatsapp =
    normalizeWhatsappNumber(profileRow.whatsapp_number) || preWhatsapp?.number || null;
  const phoneOnlyTurn = isPhoneOnlyPatientMessage(message);
  const sharesWhatsappNumber = patientMessageSharesWhatsappNumber(message);
  const restatedWhatsapp = extractWhatsappFromPatientMessage(message, { awaiting: true })?.number;

  const phoneAckLang = resolvePhoneAcknowledgmentLanguage({
    languageState,
    profileRow,
    message,
    recentTurns,
  });

  if (whatsappBeforeTurn && restatedWhatsapp && restatedWhatsapp === whatsappBeforeTurn) {
    console.log("[aiPatientInboundReply] skipped: duplicate_phone_restatement", {
      profileId: String(profileRow.id).slice(0, 8),
      number: restatedWhatsapp.slice(0, 6) + "…",
    });
    return { sent: false, reason: "duplicate_phone_restatement" };
  }

  let whatsappCollectionContext = "";
  if (knownWhatsapp && phoneOnlyTurn) {
    whatsappCollectionContext = buildPhoneNumberAcknowledgmentTurnBlock(
      knownWhatsapp,
      phoneAckLang,
    );
  } else if (knownWhatsapp) {
    whatsappCollectionContext = buildWhatsappAcknowledgmentPromptBlock(
      knownWhatsapp,
      phoneAckLang,
    );
  } else if (waEval.candidate) {
    whatsappCollectionContext = buildWhatsappCollectionPromptBlock(waEval, contextMode);
  } else if (
    patientSaysAlreadyShared(message) &&
    (persistedFlags.whatsappCollectionPrompted === true ||
      coordinatorRecentlyAskedForWhatsapp(recentTurns))
  ) {
    whatsappCollectionContext = buildWhatsappAcknowledgmentPromptBlock(
      null,
      languageState.conversationLanguage,
    );
  }

  // Keep booking pipeline active in all coordinator modes so calendar persistence
  // does not silently stop when a lead is in treatment-guide flow.
  let bookingPrep = { engaged: false, promptBlock: "", directReply: null };
  try {
    bookingPrep = await prepareAiAppointmentBookingTurn({
      clinicId,
      patientId,
      profileRow,
      patientMessage: message,
      leadData: priorLeadData,
      locale: languageState.conversationLanguage,
      recentTurns,
    });
  } catch (bookingErr) {
    console.warn("[aiPatientInboundReply] booking_prep_failed:", bookingErr?.message || bookingErr);
  }

  const workflowEval = evaluateConversationWorkflowTurn({
    patientMessage: message,
    recentTurns,
    flags: persistedFlags,
    leadData: priorLeadData,
    language: languageState.conversationLanguage,
  });
  const abFlags =
    persistedFlags?.aiBooking && typeof persistedFlags.aiBooking === "object"
      ? persistedFlags.aiBooking
      : {};
  const offeredSlotCount = Array.isArray(abFlags.offeredSlots) ? abFlags.offeredSlots.length : 0;
  const isSlotIndexReply = /^\s*#?\s*(\d{1,2})\s*[.!)?]*\s*$/i.test(String(message || "").trim());
  const bookingOwnsSlotIndex =
    bookingPrep.engaged &&
    isSlotIndexReply &&
    offeredSlotCount > 0 &&
    Number(message.match(/^\s*#?\s*(\d{1,2})/i)?.[1] || 0) <= offeredSlotCount &&
    (bookingPrep.directReply || bookingPrep.booked || bookingPrep.needContact || bookingPrep.needName);
  const bookingOwnsShortTime =
    bookingPrep.engaged &&
    isTimeOnlyPatientMessage(message) &&
    !bookingOwnsSlotIndex &&
    (bookingPrep.directReply || bookingPrep.promptBlock || bookingPrep.needContact || bookingPrep.needName);
  const workflowDirectReply =
    workflowEval.directReply &&
    !(bookingOwnsShortTime && workflowEval.parsedIntent === "appointment_time_answer") &&
    !bookingOwnsSlotIndex
      ? workflowEval.directReply
      : null;

  const conversionStrategy = await buildConversionStrategyForAi(clinicId, {
    message,
    leadData: priorLeadData,
    conversationSummary,
    operationalIntakeFlags: persistedFlags,
    profileRow,
    profileId: profileRow.id ? String(profileRow.id) : null,
    contextMode,
  });
  if (topicContext.referral_topic_locked && conversionStrategy.promptBlock) {
    conversionStrategy.promptBlock = `${conversionStrategy.promptBlock}\n\n* ACTIVE TOPIC: referral — do not pivot to clinical procedures, imaging, or travel this turn.`;
  }

  const referralAwareness = await buildReferralAwarenessForAi({
    clinicId,
    patientId,
    message,
    leadData: priorLeadData,
    messageCount: profileRow.message_count,
    pricingBlocker: conversionStrategy.meta?.signals?.pricingBlocker === true,
    topicContext,
    recentTurns,
  });
  const referralAwarenessContext = assembleReferralAwarenessContext(
    topicContext,
    referralAwareness,
  );

  let replyText = "";
  let turnLeadData = null;
  let nextSummary = conversationSummary;

  const phoneForAck =
    knownWhatsapp ||
    normalizeWhatsappNumber(preWhatsapp?.number) ||
    normalizeWhatsappNumber(extractWhatsappFromPatientMessage(message, { awaiting: true })?.number);

  if (bookingPrep.booked && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
  } else if (bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
  } else if (phoneForAck && (phoneOnlyTurn || sharesWhatsappNumber)) {
    replyText = formatPhoneAcknowledgmentReply(phoneForAck, phoneAckLang);
    turnLeadData = priorLeadData;
  } else if (bookingPrep.needName && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
  } else if (workflowDirectReply) {
    replyText = workflowDirectReply;
    turnLeadData = workflowEval.leadDataPatch
      ? mergeLeadData(priorLeadData, workflowEval.leadDataPatch)
      : priorLeadData;
  }

  if (!isOpenAIConfigured()) {
    console.log("[aiPatientInboundReply] skipped: openai_not_configured", {
      profileId: String(profileRow.id).slice(0, 8),
    });
    return { sent: false, reason: "openai_not_configured" };
  }

  const inboundChannel = resolveInboundCoordinatorChannel(params.source, params.channel);
  let appOnboardingPrompt = "";
  if (!isTreatmentGuide) {
    const needsClinicAppEnrollment = await patientNeedsClinicEnrollmentNotice(patientId);
    if (needsClinicAppEnrollment) {
      const omnichannelLead = ["whatsapp", "messenger", "instagram"].includes(inboundChannel);
      const hasActiveAppointment =
        bookingPrep.booked === true ||
        !!(
          persistedFlags?.activeAppointment &&
          typeof persistedFlags.activeAppointment === "object" &&
          persistedFlags.activeAppointment.startAt
        );
      if (
        omnichannelLead ||
        patientAskedAboutAppRegistration(message) ||
        hasActiveAppointment ||
        bookingPrep.needName
      ) {
        const clinicCodeForOnboarding = UUID_RE.test(clinicId)
          ? await fetchClinicCodeByClinicId(clinicId)
          : null;
        appOnboardingPrompt = buildPatientAppOnboardingPromptBlock({
          lang: languageState.conversationLanguage,
          clinicCode: clinicCodeForOnboarding,
          channel: inboundChannel,
          hasActiveAppointment,
        });
      }
    }
  }

  const bookingPromptBlock = bookingPrep.promptBlock || "";
  const workflowPromptBlock = workflowEval.promptBlock || "";
  const documentIntakeWithBooking = [
    workflowPromptBlock,
    bookingPromptBlock,
    appOnboardingPrompt,
    documentIntakeContext,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    if (replyText) {
      turnLeadData = priorLeadData;
    } else {
    const result = await coordinatorChatReply({
      message,
      clinicContext,
      travelContext: isTreatmentGuide ? null : travelContext,
      journeyContext,
      documentIntakeContext: documentIntakeWithBooking,
      pricingSalesContext,
      clinicDirectoryContext: null,
      history: recentTurns,
      conversationSummary,
      contextMode,
      conversationLanguage: languageState.conversationLanguage,
      conversationLanguagePolicy,
      whatsappCollectionContext,
      conversionStrategyContext: conversionStrategy.promptBlock,
      patientContextStrategyPrompt,
      repetitionSuppressionPrompt,
      referralAwarenessContext,
      patientQuestionAnchoringPrompt,
    });

    turnLeadData = result.leadData;
    if (treatmentTopic && turnLeadData && !turnLeadData.treatmentInterest) {
      turnLeadData = { ...turnLeadData, treatmentInterest: treatmentTopic.slug };
    }
    nextSummary = result.conversationSummary;

    replyText = applyConversationRepetitionGuardrails(result.reply, {
      patientMessage: message,
      discussionMemory,
      conversationLanguage: languageState.conversationLanguage,
      recentTurns,
    });
    replyText = repairGenericDeflectionReply(replyText, message, {
      conversationLanguage: languageState.conversationLanguage,
    });
    replyText = repairCoordinatorCapabilityMisreply(replyText, message, {
      lang: phoneAckLang || languageState.conversationLanguage,
      languageState,
      profileRow,
      recentTurns,
      whatsappNumber: phoneForAck || knownWhatsapp,
    });
    replyText = enforcePatientReplyLanguage(replyText, {
      expectedLang: languageState.conversationLanguage,
      patientMessage: message,
      logLabel: "aiPatientInboundReply",
    });
    }
  } catch (e) {
    console.warn("[aiPatientInboundReply] OpenAI:", e?.message || e);
    return { sent: false, reason: "openai_failed" };
  }

  if (isInvalidPatientFacingReply(replyText)) {
    replyText = sanitizePatientFacingReply(replyText, {
      lang: languageState.conversationLanguage,
      patientMessage: message,
      logLabel: "aiPatientInboundReply",
    });
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
    messageProvenance: {
      message_source: "ai_auto_reply",
      operational_channel: channel,
      latency_trace_id: params.latencyTraceId || null,
      conversation_language: languageState.conversationLanguage,
      patient_message_for_lang: message,
    },
    conversationLanguage: languageState.conversationLanguage,
    patientMessageForLang: message,
  });

  if (insertResult?.error) {
    console.warn("[aiPatientInboundReply] insert:", insertResult.error?.message || insertResult.error);
    return { sent: false, reason: "insert_failed" };
  }

  const externalChannels = new Set(["messenger", "instagram", "whatsapp"]);
  let outboundDelivered =
    insertResult?.outboundDelivery?.delivered === true ||
    insertResult?.outboundDelivery?.ok === true;
  if (channel === "whatsapp" && !outboundDelivered && String(replyText || "").trim()) {
    try {
      const ext = await deliverOutboundMessage({
        patientId,
        clinicId,
        text: replyText,
        channel: "whatsapp",
        profileId: profileRow.id,
        metadata: { message_source: "ai_auto_reply_fallback" },
      });
      outboundDelivered = ext.delivered === true || ext.ok === true;
      if (!outboundDelivered) {
        console.warn("[aiPatientInboundReply] whatsapp fallback delivery failed", {
          profileId: String(profileRow.id).slice(0, 8),
          error: ext.error || ext.detail || null,
        });
      }
    } catch (e) {
      console.warn("[aiPatientInboundReply] whatsapp fallback:", e?.message || e);
    }
  }
  if (params.latencyTraceId && externalChannels.has(channel)) {
    logAiReplyLatency(params.latencyTraceId, "outbound_dispatched", {
      channel,
      delivered: outboundDelivered,
      deliveryStatus: insertResult?.outboundDelivery?.deliveryStatus || null,
    });
  }
  if (externalChannels.has(channel) && !outboundDelivered) {
    console.warn("[aiPatientInboundReply] external outbound not delivered", {
      profileId: String(profileRow.id).slice(0, 8),
      patientId: patientId.slice(0, 8),
      channel,
      deliveryError: insertResult?.outboundDelivery?.error || insertResult?.outboundDelivery?.detail || null,
      deliveryStatus: insertResult?.outboundDelivery?.deliveryStatus || null,
    });
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

  if (leadPipeline.profileId && params.externalMessageId) {
    const { data: profFlags } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("operational_intake_flags")
      .eq("id", leadPipeline.profileId)
      .maybeSingle();
    const prevFlags =
      profFlags?.operational_intake_flags && typeof profFlags.operational_intake_flags === "object"
        ? profFlags.operational_intake_flags
        : {};
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        operational_intake_flags: {
          ...prevFlags,
          lastAiRepliedForExternalMessageId: String(params.externalMessageId).trim(),
          lastAiRepliedForPatientMessageAt: inboundPatientMessageAt || lastPatientAt || null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadPipeline.profileId);
  }

  if (leadPipeline.profileId) {
    const profileDocs = await listDocumentsForProfile(leadPipeline.profileId, { clinicId });
    const memoryAfterTurn = updateDiscussionMemoryAfterTurn(discussionMemory, {
      patientMessage: message,
      aiReply: replyText,
    });
    const topicAfterTurn = updateConversationTopicAfterTurn(topicContext, {
      patientMessage: message,
      aiReply: replyText,
      referralState: referralAwareness.state,
    });
    const workflowForPersist = workflowAfterAssistantReply(
      replyText,
      workflowEval.workflowPatch || readConversationWorkflow(persistedFlags),
    );
    await syncOperationalIntakeFlags(leadPipeline.profileId, leadData, profileDocs, {
      patientMessage: message,
      patientContextStrategy,
      discussionMemory: memoryAfterTurn,
      conversationTopic: topicAfterTurn,
      conversationalIntake: workflowEval.conversationalIntakePatch || undefined,
      conversationWorkflow: workflowForPersist,
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

  void markTreatmentRequestResponded({
    requestId: params.treatmentRequestId,
    patientId,
    clinicId,
    offerId: params.offerId,
    profileId: profileRow.id,
    source: params.source === "quote_request" ? "coordinator_reply" : "ai_reply",
  }).catch((e) =>
    console.warn("[treatmentRequestLifecycle] ai_reply:", e?.message || e),
  );
  void projectCoordinationState(profileRow.id).catch((e) =>
    console.warn("[coordinationProjection] ai_reply:", e?.message || e),
  );

  void processWhatsappAfterCoordinationTurn({
    profileId: profileRow.id,
    patientMessage: message,
    leadData,
    source: params.source || "inbound",
  }).catch((e) => console.warn("[whatsappCollection] after_turn:", e?.message || e));

  void markAppointmentOfferInAiReply(profileRow.id, replyText).catch((e) =>
    console.warn("[aiAppointmentBooking] offer_mark:", e?.message || e),
  );

  void finalizeAiAppointmentBookingTurn({
    profileId: profileRow.id,
    patientMessage: message,
    locale: languageState.conversationLanguage,
    recentTurns,
  }).catch((e) => console.warn("[aiAppointmentBooking] finalize:", e?.message || e));

  if (waEval.candidate) {
    void markWhatsappPromptOffered(profileRow.id, waEval.operationalStage).catch(() => {});
  }

  console.log("[aiPatientInboundReply] sent", {
    profileId: String(profileRow.id).slice(0, 8),
    source: params.source || "inbound",
    channel,
    autoReply: delegation.autoReplyAllowed,
    traceId: params.latencyTraceId || null,
  });

  return {
    sent: true,
    profileId: profileRow.id,
    leadPipeline,
    outboundDelivered: externalChannels.has(channel) ? outboundDelivered : false,
  };
}

module.exports = {
  setupAiPatientInboundReply,
  runAiReplyForClinicInbound,
  aiAlreadyRepliedSinceLastPatient,
  hasAiOutboundSincePatient,
};
