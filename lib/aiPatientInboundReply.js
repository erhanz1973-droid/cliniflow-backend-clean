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
const {
  fetchRecentCoordinatorTurns,
  fetchCoordinatorTurnsForSnoozeCatchUp,
} = require("./coordinatorRecentHistory");
const {
  needsSnoozeCatchUp,
  snoozeCatchUpSinceIso,
  buildSnoozeCatchUpDoneFlags,
  buildSnoozeCatchUpPromptBlock,
  maybeAutoResumeAiAfterSnooze,
} = require("./aiSnoozeCatchUp");
const {
  buildDiscussionMemory,
  buildRepetitionSuppressionPromptBlock,
  updateDiscussionMemoryAfterTurn,
  readDiscussionMemoryFromFlags,
  applyConversationRepetitionGuardrails,
  buildConversationForwardReply,
  isConversationalShortReply,
  preventRepetitiveAssistantReply,
  detectNearDuplicateAssistantReply,
} = require("./conversationRepetitionMemory");
const {
  isGreetingOnlyMessage,
  buildGreetingDirectReply,
  buildGreetingIntentPromptBlock,
} = require("./greetingIntent");
const {
  claimPatientInboundTurn,
  releasePatientInboundTurn,
  beginAiReplyGeneration,
  endAiReplyGeneration,
  detectDuplicatePatientInbound,
  buildRepliedPatientMessageFlags,
  aiAlreadyRepliedToSamePatientText,
} = require("./patientInboundDedup");
const { getRelevantProtocolsForAi } = require("./clinicTreatmentProtocols");
const { buildTreatmentJourneyPromptBlock } = require("./clinicJourneyPrompt");
const { listDocumentsForPatient, listDocumentsForProfile } = require("./aiPatientDocuments");
const {
  buildDocumentIntakePromptBlock,
  syncOperationalIntakeFlags,
  buildOperationalIntakeState,
} = require("./aiIntakeFlags");
const { buildClinicSalesPromptForAi } = require("./clinicSalesPromptForAi");
const { buildDoctorProfilesPromptForAi } = require("./doctorProfilesForAi");
const {
  detectPatientCommercialIntent,
  patientAskedCostSensitivityOnly,
} = require("./clinicPricingIntent");
const {
  buildMessagingBrevityPromptBlock,
  resolveCoordinatorMaxTokens,
  isSimpleDirectPatientQuestion,
  buildCostSensitivityReassuranceReply,
  enforceNoNumericPricingUnlessDirectAsk,
} = require("./aiReplyBrevity");
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
  buildPhoneCorrectionTurnBlock,
  isPhoneOnlyPatientMessage,
  patientMessageSharesWhatsappNumber,
  patientClaimsPhoneCorrection,
  resolvePhoneAcknowledgmentLanguage,
  formatPhoneAcknowledgmentReply,
  formatPhoneCorrectionAcknowledgmentReply,
  repairPhoneNumberTurnReply,
  repairCoordinatorCapabilityMisreply,
  normalizeWhatsappNumber,
  patientSaysAlreadyShared,
  coordinatorRecentlyAskedForWhatsapp,
  persistWhatsappCollection,
  markWhatsappPromptOffered,
  processWhatsappAfterCoordinationTurn,
} = require("./whatsappCollection");
const { tryLinkOmnichannelLeadByPhone } = require("./omnichannel/linkOmnichannelLeadByPhone");
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
  buildPatientAppDownloadDirectReply,
  buildCliniflyFreeDirectReply,
  patientAskedAboutAppRegistration,
  patientAskedAboutCliniflyPricing,
  APP_DOWNLOAD_QUESTION_RE,
} = require("./patientClinicEnrollment");
const { runPostConversationLearningAnalysis } = require("./aiLearningSystem");
const {
  buildLearnedPatternsPromptBlock,
  isApprovedLearnedGreeting,
} = require("./aiLearningKnowledge");
const {
  prepareAiAppointmentBookingTurn,
  finalizeAiAppointmentBookingTurn,
  markAppointmentOfferInAiReply,
  isBookingConfirmationYes,
  isBareSlotListIndexMessage,
  shouldUseBookingDirectReply,
  readDurableBookingState,
  patientMessageIsAlternativeSlotRequest,
  detectConsecutiveBookingPromptLoop,
  detectBookingSelectSlotDeadlock,
  logBookingLoopDetected,
  logBookingDeadlockDetected,
  buildAlternativeSlotCheckingReply,
  recoverSelectSlotDatetimeReply,
  coordinatorRecentlyAskedSlotConfirmation,
  isSlotConfirmationNudgeReply,
  patientRequestsSlotListResend,
  patientRequestsNewSchedulingWindow,
  patientMessageAdvancesSlotBooking,
} = require("./aiAppointmentBooking");
const {
  BOOKING_PENDING_ACTIONS,
  isBookingFlowInProgress,
  resolveBookingRouterLock,
  shouldExemptBookingMessageFromDedup,
  logBookingAudit,
  logBookingAuditEvent,
  BOOKING_AUDIT_EVENTS,
  resolvesPendingConfirmation,
  patientBlocksBookingConfirmation,
  preserveBookingStateInFlags,
  hasCompletedCanonicalBooking,
  isBookingStatusInquiry,
} = require("./aiBookingState");
const {
  evaluateConversationWorkflowTurn,
  workflowAfterAssistantReply,
  readConversationWorkflow,
} = require("./conversationWorkflowState");
const { isTimeOnlyPatientMessage, isClinicServicesCatalogQuestion } = require("./conversationalTimeParse");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");
const { deliverOutboundMessage } = require("./omnichannel/outboundDelivery");
const {
  resolveOperationalClinicId,
  logAiOrchestrationSkip,
  logAiDelegationEvaluation,
} = require("./clinicOperationalContext");
const { resolveWhatsappFromInboundChannel } = require("./whatsappCollection");
const {
  isSchedulingContinuationFragment,
  aiRepliedRecentlyInBurst,
  messageHasSchedulingIntent,
  logAiRouter,
  logDuplicateReplyDetected,
  repairWhatsappNumberAskOnChannel,
} = require("./aiInboundRouter");

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

  let patientId = String(params.patientId || "").trim();
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
      "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, channel_metadata, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
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
        "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, channel_metadata, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
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
      "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, channel_metadata, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("id", profileRow.id)
    .maybeSingle();
  if (freshProfile?.id) profileRow = freshProfile;
  profileRow = await maybeAutoResumeAiAfterSnooze(profileRow);

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

  const recentTurnsEarly = await fetchRecentCoordinatorTurns(profileRow.id, {
    maxTurns: 8,
    patientId,
    clinicId,
    includeClinicChat: true,
  });

  if (
    isSchedulingContinuationFragment(message, recentTurnsEarly) &&
    aiRepliedRecentlyInBurst(profileRow)
  ) {
    logAiRouter({
      message_id: params.externalMessageId || null,
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      workflow_selected: "suppressed_continuation",
      router_reason: "scheduling_burst_already_answered",
      response_generated: false,
      patient_preview: message.slice(0, 80),
    });
    return { sent: false, reason: "scheduling_continuation_suppressed" };
  }

  const dupInbound = await detectDuplicatePatientInbound({
    profileRow,
    patientId,
    clinicId,
    message,
    recentTurns: recentTurnsEarly,
    externalMessageId: params.externalMessageId || null,
  });
  const bookingDedupExempt = shouldExemptBookingMessageFromDedup(
    message,
    profileRow.operational_intake_flags,
  );
  let reuseReplyFromDup = null;
  if (dupInbound.duplicate && !bookingDedupExempt) {
    if (dupInbound.reuseReply) {
      reuseReplyFromDup = String(dupInbound.reuseReply).trim();
      console.log("[aiPatientInboundReply] duplicate within 30s — will reuse prior reply", {
        profileId: String(profileRow.id).slice(0, 8),
        reason: dupInbound.reason,
      });
    } else {
      console.log("[aiPatientInboundReply] skipped: duplicate_patient_message", {
        profileId: String(profileRow.id).slice(0, 8),
        reason: dupInbound.reason,
      });
      return { sent: false, reason: "duplicate_patient_message", detail: dupInbound.reason };
    }
  }

  if (!claimPatientInboundTurn(patientId, clinicId, message)) {
    console.log("[aiPatientInboundReply] skipped: duplicate_patient_message_inflight", {
      profileId: String(profileRow.id).slice(0, 8),
    });
    return { sent: false, reason: "duplicate_patient_message_inflight" };
  }

  const generationSlot = beginAiReplyGeneration(patientId, clinicId, message, {
    recentTurns: recentTurnsEarly,
  });
  if (!generationSlot.allowed) {
    if (generationSlot.deferRetry) {
      logAiRouter({
        message_id: params.externalMessageId || null,
        patient_id: patientId.slice(0, 8),
        clinic_id: clinicId.slice(0, 8),
        workflow_selected: "deferred_parallel",
        router_reason: generationSlot.reason || "parallel_ai_generation_deferred",
        response_generated: false,
        patient_preview: message.slice(0, 80),
      });
      releasePatientInboundTurn(patientId, clinicId);
      return {
        sent: false,
        reason: "parallel_ai_generation_deferred",
        deferRetry: true,
      };
    }
    logDuplicateReplyDetected({
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      message_id: params.externalMessageId || null,
      reason: generationSlot.reason || "parallel_burst_suppressed",
      patient_preview: message.slice(0, 80),
    });
    logAiRouter({
      message_id: params.externalMessageId || null,
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      workflow_selected: "suppressed_parallel",
      router_reason: generationSlot.reason || "parallel_burst_suppressed",
      response_generated: false,
      patient_preview: message.slice(0, 80),
    });
    releasePatientInboundTurn(patientId, clinicId);
    return { sent: false, reason: generationSlot.reason || "parallel_burst_suppressed" };
  }

  let workflowSelected = "coordinator_llm";
  let routerReason = "default_llm";
  try {
  if (inboundTurnSupersededByNewerPatientMessage(profileRow, inboundPatientMessageAt)) {
    return { sent: false, reason: "superseded_by_newer_patient_message" };
  }

  const lastPatientAt = String(inboundPatientMessageAt || "");
  if (
    !params.externalMessageId &&
    (aiAlreadyRepliedSinceLastPatient(profileRow) ||
      aiAlreadyRepliedToSamePatientText(profileRow, message))
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
  const simpleDirectQuestion = isSimpleDirectPatientQuestion(message);
  const patientAsksScheduling =
    /\b(randevu|appointment|saat|slot|tarih|date|ne\s+zaman|ertele|iptal|cancel|reschedule|onay|confirm)\b/i.test(
      String(message || ""),
    );
  const apptAwareness = buildAppointmentAwarenessPromptBlock(persistedFlags);
  if (apptAwareness && !(simpleDirectQuestion && !patientAsksScheduling)) {
    documentIntakeContext = `${apptAwareness}\n\n${documentIntakeContext}`;
  }
  if (simpleDirectQuestion && detectPatientCommercialIntent(message, priorLeadData || {}).asksDirectPrice) {
    documentIntakeContext = documentIntakeContext
      .split("\n")
      .filter((line) => !/panoramic|x-ray|röntgen|rontgen|missing for intake/i.test(line))
      .join("\n")
      .trim();
  }
  const catchUpNeeded = needsSnoozeCatchUp(persistedFlags);
  const catchUpSince = catchUpNeeded ? snoozeCatchUpSinceIso(persistedFlags) : null;
  const recentTurns = await fetchRecentCoordinatorTurns(profileRow.id, {
    maxTurns: catchUpNeeded ? 14 : 10,
    patientId,
    clinicId,
    sinceIso: catchUpSince,
    includeClinicChat: true,
  });
  let snoozeCatchUpPrompt = "";
  if (catchUpNeeded && catchUpSince) {
    const gapTurns = await fetchCoordinatorTurnsForSnoozeCatchUp(profileRow.id, {
      patientId,
      clinicId,
      sinceIso: catchUpSince,
      maxTurns: 24,
    });
    snoozeCatchUpPrompt = buildSnoozeCatchUpPromptBlock(
      gapTurns,
      profileRow.conversation_primary_language || profileRow.preferred_language || "tr",
    );
    if (__DEV__ && snoozeCatchUpPrompt) {
      console.log("[aiPatientInboundReply] snooze catch-up", {
        profileId: String(profileRow.id).slice(0, 8),
        gapTurns: gapTurns.length,
        since: catchUpSince.slice(0, 19),
      });
    }
  }

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

  const commercialIntent = detectPatientCommercialIntent(message, priorLeadData || {});
  const conversationalShort = isConversationalShortReply(message);
  if (conversationalShort && !commercialIntent.asksDirectPrice) {
    pricingSalesContext = "";
  }

  const durableBooking = readDurableBookingState(persistedFlags);
  let bookingRouter = resolveBookingRouterLock(persistedFlags, {
    recentTurns,
    patientMessage: message,
  });
  let bookingActiveLock = bookingRouter.locked;
  if (bookingActiveLock) {
    pricingSalesContext = "";
  }

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

  let doctorProfilesContext = null;
  if (UUID_RE.test(clinicId) && !bookingActiveLock && !patientAskedCostSensitivityOnly(message)) {
    try {
      doctorProfilesContext = await buildDoctorProfilesPromptForAi(clinicId, {
        clinicName: clinicContext,
        lang: languageState.conversationLanguage,
      });
    } catch (doctorProfileErr) {
      console.warn("[doctorProfilesForAi] prompt:", doctorProfileErr?.message || doctorProfileErr);
    }
  }
  if (bookingActiveLock || patientAskedCostSensitivityOnly(message)) {
    doctorProfilesContext = null;
  }

  const conversationLanguagePolicy = buildConversationLanguagePromptBlock(languageState);
  const patientQuestionAnchoringPrompt = buildPatientQuestionAnchoringPromptBlock(message);
  const treatmentTopic = detectPatientTreatmentTopic(message);

  const clinicAiProfile = await getClinicAiProfile(clinicId);
  const inboundChannel = resolveInboundCoordinatorChannel(params.source, params.channel);
  const whatsappBeforeTurn = normalizeWhatsappNumber(profileRow.whatsapp_number);
  const preWhatsapp = resolveWhatsappFromPatientTurn(message, {
    recentTurns,
    flags: persistedFlags,
    profileRow,
  });
  const phoneCorrectedThisTurn =
    preWhatsapp?.source === "correction" &&
    !!preWhatsapp?.number &&
    !!whatsappBeforeTurn &&
    preWhatsapp.number !== whatsappBeforeTurn;
  if (preWhatsapp?.declined) {
    await persistWhatsappCollection(profileRow.id, { declined: true, source: params.source });
  } else if (preWhatsapp?.number) {
    await persistWhatsappCollection(profileRow.id, {
      number: preWhatsapp.number,
      previousNumber: preWhatsapp.previousNumber || null,
      source: params.source,
    });
    profileRow = {
      ...profileRow,
      whatsapp_number: preWhatsapp.number,
      whatsapp_collection_stage: "collected",
    };
    persistedFlags.whatsappCollectionStage = "collected";
    persistedFlags.hasWhatsapp = true;
    if (phoneCorrectedThisTurn) {
      persistedFlags.whatsappPreviousNumber = whatsappBeforeTurn;
      persistedFlags.whatsappCorrectedAt = new Date().toISOString();
    }

    if (["messenger", "instagram"].includes(inboundChannel)) {
      const linkResult = await tryLinkOmnichannelLeadByPhone({
        stubPatientId: patientId,
        clinicId,
        whatsappNumber: preWhatsapp.number,
        channel: inboundChannel,
        profileId: profileRow.id,
        previousWhatsappNumber: preWhatsapp.previousNumber || whatsappBeforeTurn || null,
      });
      if (linkResult.linked && linkResult.patientId) {
        patientId = String(linkResult.patientId);
        if (linkResult.profileRow) {
          profileRow = { ...profileRow, ...linkResult.profileRow };
        } else if (linkResult.profileId) {
          profileRow = { ...profileRow, id: linkResult.profileId, patient_id: patientId };
        } else {
          profileRow = { ...profileRow, patient_id: patientId };
        }
      }
    }
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

  if (
    whatsappBeforeTurn &&
    restatedWhatsapp &&
    restatedWhatsapp === whatsappBeforeTurn &&
    !phoneCorrectedThisTurn &&
    !patientClaimsPhoneCorrection(message)
  ) {
    console.log("[aiPatientInboundReply] skipped: duplicate_phone_restatement", {
      profileId: String(profileRow.id).slice(0, 8),
      number: restatedWhatsapp.slice(0, 6) + "…",
    });
    return { sent: false, reason: "duplicate_phone_restatement" };
  }

  let whatsappCollectionContext = "";
  if (phoneCorrectedThisTurn && knownWhatsapp) {
    whatsappCollectionContext = buildPhoneCorrectionTurnBlock(
      knownWhatsapp,
      whatsappBeforeTurn,
      phoneAckLang,
    );
  } else if (knownWhatsapp && phoneOnlyTurn) {
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
      channel: params.channel || profileRow.primary_channel || null,
      inboundSource: params.source || params.channel || profileRow.primary_channel || null,
    });
  } catch (bookingErr) {
    console.warn("[aiPatientInboundReply] booking_prep_failed:", bookingErr?.message || bookingErr);
  }

  if (profileRow?.id && isSupabaseEnabled()) {
    try {
      const { data: freshRow } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("operational_intake_flags")
        .eq("id", profileRow.id)
        .maybeSingle();
      if (
        freshRow?.operational_intake_flags &&
        typeof freshRow.operational_intake_flags === "object"
      ) {
        persistedFlags = freshRow.operational_intake_flags;
      }
    } catch {
      /* keep in-memory flags */
    }
  }

  bookingRouter = resolveBookingRouterLock(persistedFlags, {
    bookingPrep,
    recentTurns,
    patientMessage: message,
  });
  bookingActiveLock = bookingRouter.locked;
  const durableBookingAfterPrep = bookingRouter.durable || readDurableBookingState(persistedFlags);
  if (bookingActiveLock) {
    pricingSalesContext = "";
    console.log("[booking.router]", {
      profileId: String(profileRow.id).slice(0, 8),
      locked: true,
      reason: bookingRouter.reason,
      pendingAction:
        durableBookingAfterPrep.pendingAction || durableBookingAfterPrep.awaitingAction || null,
      stage: durableBookingAfterPrep.stage || null,
    });
  }
  let bookingStatusLock =
    hasCompletedCanonicalBooking(persistedFlags) &&
    (isBookingStatusInquiry(message) ||
      bookingPrep.statusQuery === true ||
      bookingPrep.postBookingGuard === true);
  if (bookingStatusLock) {
    pricingSalesContext = "";
  }

  if (bookingPrep.confirmationPaused) {
    bookingActiveLock = false;
    bookingStatusLock = false;
    bookingPrep = {
      ...bookingPrep,
      engaged: false,
      awaitingConfirmation: false,
      directReply: null,
      promptBlock: "",
      schedulingPromptForLlm: false,
    };
  }

  const servicesCatalogQuestion = isClinicServicesCatalogQuestion(message);
  if (servicesCatalogQuestion) {
    bookingActiveLock = false;
    bookingStatusLock = false;
    if (bookingPrep?.directReply) {
      bookingPrep = { ...bookingPrep, engaged: false, directReply: null, promptBlock: "" };
    }
    if (!pricingSalesContext) {
      pricingSalesContext = await buildClinicSalesPromptForAi(clinicId, {
        message,
        leadData: priorLeadData,
        clinicName: clinicContext,
        discussionMemory,
      });
    }
  }

  const schedulingTz = "Europe/Istanbul";
  const altSlotDatetimeRequest = patientMessageIsAlternativeSlotRequest(message, {
    timezone: schedulingTz,
  });
  if (
    bookingActiveLock &&
    altSlotDatetimeRequest &&
    !bookingPrep.directReply
  ) {
    try {
      const recovered = await recoverSelectSlotDatetimeReply({
        clinicId,
        patientId,
        profileRow,
        patientMessage: message,
        leadData: priorLeadData,
        locale: languageState.conversationLanguage,
        recentTurns,
        channel: params.channel || profileRow.primary_channel || null,
        inboundSource: params.source || params.channel || profileRow.primary_channel || null,
      });
      if (recovered?.directReply) {
        bookingPrep = { ...bookingPrep, ...recovered, engaged: true };
      }
    } catch (recoveryErr) {
      console.warn(
        "[aiPatientInboundReply] select_slot_datetime_recovery:",
        recoveryErr?.message || recoveryErr,
      );
    }
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
  const offeredSlotCount = Array.isArray(durableBookingAfterPrep.offeredSlots)
    ? durableBookingAfterPrep.offeredSlots.length
    : Array.isArray(abFlags.offeredSlots)
      ? abFlags.offeredSlots.length
      : 0;
  const isSlotIndexReply =
    offeredSlotCount > 0 && isBareSlotListIndexMessage(message, offeredSlotCount);
  const bookingOwnsSlotIndex =
    bookingPrep.engaged &&
    isSlotIndexReply &&
    (bookingPrep.directReply ||
      bookingPrep.booked ||
      bookingPrep.needContact ||
      bookingPrep.needName ||
      bookingPrep.awaitingConfirmation);
  const bookingOwnsConfirmYes =
    bookingPrep.engaged &&
    !patientBlocksBookingConfirmation(message) &&
    isBookingConfirmationYes(message, { recentTurns, pendingConfirmation: true }) &&
    (resolvesPendingConfirmation(message, durableBookingAfterPrep, { recentTurns }) ||
      String(abFlags.stage || "") === "awaiting_slot_confirm" ||
      abFlags.appointmentOfferPending === true ||
      /onayl[iı]yor musunuz/i.test(
        String(recentTurns?.[recentTurns.length - 1]?.text || recentTurns?.[recentTurns.length - 2]?.text || ""),
      )) &&
    (bookingPrep.directReply || bookingPrep.booked || bookingPrep.needContact || bookingPrep.needName);
  const bookingOwnsShortTime =
    bookingPrep.engaged &&
    isTimeOnlyPatientMessage(message) &&
    !bookingOwnsSlotIndex &&
    (bookingPrep.directReply || bookingPrep.promptBlock || bookingPrep.needContact || bookingPrep.needName);
  const workflowDirectReply =
    workflowEval.directReply &&
    !bookingActiveLock &&
    !bookingStatusLock &&
    !(bookingOwnsShortTime && workflowEval.parsedIntent === "appointment_time_answer") &&
    !bookingOwnsSlotIndex &&
    !bookingOwnsConfirmYes
      ? workflowEval.directReply
      : null;

  const conversionStrategy = bookingActiveLock || bookingStatusLock
    ? { promptBlock: "", meta: { signals: {} } }
    : await buildConversionStrategyForAi(clinicId, {
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

  const referralAwareness = bookingActiveLock
    ? { state: null, promptBlock: "" }
    : await buildReferralAwarenessForAi({
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

  let greetingOnly = isGreetingOnlyMessage(message);
  if (!greetingOnly && UUID_RE.test(clinicId)) {
    try {
      greetingOnly = await isApprovedLearnedGreeting(clinicId, message);
    } catch {
      /* ignore */
    }
  }
  const appDownloadQuestion = !isTreatmentGuide && patientAskedAboutAppRegistration(message);
  const cliniflyPricingQuestion = !isTreatmentGuide && patientAskedAboutCliniflyPricing(message);
  const hasAppDownloadIntent =
    APP_DOWNLOAD_QUESTION_RE.test(String(message || "")) ||
    /\b(indir\w*|yukle\w*|yükley\w*|download|app\s*store|google\s*play)\b/i.test(String(message || ""));

  const messageOnlyCommercial =
    commercialIntent.asksDirectPrice ||
    commercialIntent.asksBrand ||
    commercialIntent.asksDuration;
  const costSensitivityOnly =
    patientAskedCostSensitivityOnly(message) && !bookingActiveLock && !bookingPrep.engaged;

  if (greetingOnly && (!bookingActiveLock || !bookingPrep.engaged)) {
    replyText = buildGreetingDirectReply(message, languageState.conversationLanguage);
    turnLeadData = priorLeadData;
    workflowSelected = "greeting";
    routerReason = "greeting_only";
  } else if (costSensitivityOnly) {
    replyText = buildCostSensitivityReassuranceReply(
      message,
      languageState.conversationLanguage,
      clinicContext,
    );
    turnLeadData = priorLeadData;
    workflowSelected = "cost_sensitivity_direct";
    routerReason = "pahali_mi_reassurance";
  } else if (
    conversationalShort &&
    !messageOnlyCommercial &&
    !costSensitivityOnly &&
    !bookingActiveLock &&
    !bookingPrep.engaged
  ) {
    replyText = buildConversationForwardReply({
      patientMessage: message,
      language: languageState.conversationLanguage,
      discussionMemory,
      recentTurns,
    });
    console.log("[repeat_prevented]", {
      reason: discussionMemory.pricingAlreadyDiscussed
        ? "early_conversational_short_after_pricing"
        : "early_conversational_short_no_commercial",
      patientPreview: String(message || "").slice(0, 48),
    });
    turnLeadData = priorLeadData;
    workflowSelected = "social_ack_direct";
    routerReason = "conversational_short";
  } else if ((appDownloadQuestion || hasAppDownloadIntent) && !bookingActiveLock) {
    const clinicCodeForApp = UUID_RE.test(clinicId)
      ? await fetchClinicCodeByClinicId(clinicId)
      : null;
    replyText = buildPatientAppDownloadDirectReply(
      languageState.conversationLanguage,
      clinicCodeForApp,
    );
    turnLeadData = priorLeadData;
  } else if (cliniflyPricingQuestion && !bookingActiveLock) {
    replyText = buildCliniflyFreeDirectReply(languageState.conversationLanguage);
    turnLeadData = priorLeadData;
    workflowSelected = "app_pricing_direct";
    routerReason = "clinifly_free_fact";
  } else if (bookingPrep.awaitingConfirmation && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
    workflowSelected = "booking_direct";
    routerReason = bookingPrep.rescheduleMode ? "booking_reschedule_confirm" : "booking_confirm";
  } else if (bookingPrep.rescheduleNeedDetails && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
    workflowSelected = "booking_direct";
    routerReason = "booking_reschedule_need_details";
  } else if (bookingPrep.booked && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
    workflowSelected = "booking_direct";
    routerReason = "booking_confirmed";
  } else if (bookingPrep.statusQuery && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
    workflowSelected = "booking_direct";
    routerReason = "booking_status_query";
  } else if (bookingPrep.postBookingGuard && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
  } else if (
    bookingPrep.directReply &&
    shouldUseBookingDirectReply(bookingPrep, message, persistedFlags, {
      timezone: "Europe/Istanbul",
      recentTurns,
      locale: languageState.conversationLanguage,
    })
  ) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
    workflowSelected = "booking_direct";
    routerReason = bookingRouter.reason || "booking_slots_or_intent";
  } else if (phoneForAck && (phoneOnlyTurn || sharesWhatsappNumber)) {
    replyText = formatPhoneAcknowledgmentReply(phoneForAck, phoneAckLang);
    turnLeadData = priorLeadData;
  } else if (bookingPrep.needName && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
  } else if (bookingActiveLock && bookingPrep.directReply) {
    replyText = bookingPrep.directReply;
    turnLeadData = priorLeadData;
    workflowSelected = "booking_lock";
    routerReason = bookingRouter.reason || "booking_router_lock";
  } else if (
    bookingActiveLock &&
    durableBookingAfterPrep.awaitingAction === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING &&
    !durableBookingAfterPrep.confirmationNudgePaused &&
    !bookingPrep.confirmationPaused
  ) {
    const lang = String(languageState.conversationLanguage || "tr").slice(0, 2);
    replyText =
      bookingPrep.directReply ||
      (lang === "tr"
        ? "Randevunuzu onaylamak için «Evet» yazmanız yeterli."
        : "Please reply «Yes» to confirm your appointment.");
    turnLeadData = priorLeadData;
  } else if (
    bookingActiveLock &&
    durableBookingAfterPrep.awaitingAction === BOOKING_PENDING_ACTIONS.SELECT_SLOT
  ) {
    const lang = String(languageState.conversationLanguage || "tr").slice(0, 2);
    const max = Math.min(Math.max(durableBookingAfterPrep.offeredSlots.length, 1), 12);
    const bookingStateForAdvance = {
      offeredSlots: durableBookingAfterPrep.offeredSlots || [],
    };
    const patientWantsSlotRefresh =
      patientRequestsSlotListResend(message) ||
      patientRequestsNewSchedulingWindow(message) ||
      patientMessageAdvancesSlotBooking(message, bookingStateForAdvance, {
        timezone: schedulingTz,
      });
    const slotIndexIgnored =
      isSlotIndexReply &&
      !bookingPrep.directReply &&
      !bookingPrep.needContact &&
      !durableBookingAfterPrep.selectedSlot?.startAt;
    replyText =
      bookingPrep.directReply ||
      (slotIndexIgnored
        ? lang === "tr"
          ? "Seçiminizi aldım — kısa bir sorun oluştu, lütfen bir kez daha numarayı yazın veya saati «17:00» gibi belirtin."
          : "We received your choice — please send the option number once more or specify a time like «17:00»."
        : null) ||
      (altSlotDatetimeRequest
        ? buildAlternativeSlotCheckingReply(lang, String(message || "").trim().slice(0, 48))
        : patientWantsSlotRefresh
          ? lang === "tr"
            ? "Talebinizi aldım — güncel müsait saatleri kontrol edip paylaşıyorum."
            : "Got it — I am checking current available times for you."
          : durableBookingAfterPrep.offeredSlots.length
            ? lang === "tr"
              ? `Lütfen az önce paylaştığımız saatlerden birini seçmek için 1–${max} arası numara yazın.`
              : `Please reply with a number (1–${max}) from the appointment times we shared.`
            : lang === "tr"
              ? "Talep ettiğiniz gün ve saat için uygunluğu kontrol ediyorum — lütfen bir an bekleyin veya başka bir saat yazın."
              : "Checking availability for your requested day and time — please wait or suggest another time.");
    turnLeadData = priorLeadData;
    workflowSelected = altSlotDatetimeRequest ? "booking_alternative_slot" : "booking_lock";
    routerReason = altSlotDatetimeRequest
      ? "select_slot_datetime_request"
      : bookingRouter.reason || "booking_select_slot";
  } else if (workflowDirectReply) {
    replyText = workflowDirectReply;
    turnLeadData = workflowEval.leadDataPatch
      ? mergeLeadData(priorLeadData, workflowEval.leadDataPatch)
      : priorLeadData;
    workflowSelected = "workflow_direct";
    routerReason = workflowEval.parsedIntent || "workflow_direct_reply";
  } else if (reuseReplyFromDup) {
    replyText = reuseReplyFromDup;
    turnLeadData = priorLeadData;
    console.log("[repeat_prevented]", {
      reason: "reuse_reply_within_30s",
      patientPreview: String(message || "").slice(0, 48),
    });
  }

  if (!isOpenAIConfigured()) {
    console.log("[aiPatientInboundReply] skipped: openai_not_configured", {
      profileId: String(profileRow.id).slice(0, 8),
    });
    return { sent: false, reason: "openai_not_configured" };
  }

  let appOnboardingPrompt = "";
  if (!isTreatmentGuide) {
    const needsClinicAppEnrollment = await patientNeedsClinicEnrollmentNotice(patientId);
    if (needsClinicAppEnrollment) {
      if (patientAskedAboutAppRegistration(message) || bookingPrep.needName) {
        const clinicCodeForOnboarding = UUID_RE.test(clinicId)
          ? await fetchClinicCodeByClinicId(clinicId)
          : null;
        appOnboardingPrompt = buildPatientAppOnboardingPromptBlock({
          lang: languageState.conversationLanguage,
          clinicCode: clinicCodeForOnboarding,
          channel: inboundChannel,
          hasActiveAppointment: false,
        });
      }
    }
  }

  const bookingPromptBlock =
    bookingPrep.schedulingPromptForLlm && bookingPrep.promptBlock ? bookingPrep.promptBlock : "";
  const workflowPromptBlock = workflowEval.promptBlock || "";
  const greetingPromptBlock = buildGreetingIntentPromptBlock(
    message,
    languageState.conversationLanguage,
  );
  let learnedPatternsPrompt = "";
  if (
    !isTreatmentGuide &&
    !bookingActiveLock &&
    !bookingStatusLock &&
    !bookingPrep.confirmationPaused &&
    UUID_RE.test(clinicId)
  ) {
    try {
      learnedPatternsPrompt = await buildLearnedPatternsPromptBlock(clinicId);
    } catch (e) {
      console.warn("[aiLearning] prompt block:", e?.message || e);
    }
  }
  const documentIntakeWithBooking = bookingActiveLock || bookingStatusLock
    ? [bookingPromptBlock].filter(Boolean).join("\n\n")
    : [
        snoozeCatchUpPrompt,
        greetingPromptBlock,
        learnedPatternsPrompt,
        workflowPromptBlock,
        bookingPromptBlock,
        appOnboardingPrompt,
        documentIntakeContext,
      ]
        .filter(Boolean)
        .join("\n\n");

  let llmUsed = false;
  try {
    if (replyText) {
      turnLeadData = priorLeadData;
    } else if (bookingActiveLock) {
      const lang = String(languageState.conversationLanguage || "tr").slice(0, 2);
      replyText =
        bookingPrep.directReply ||
        (altSlotDatetimeRequest
          ? buildAlternativeSlotCheckingReply(lang, String(message || "").trim().slice(0, 48))
          : lang === "tr"
            ? "Randevu planlamasına devam edelim — lütfen paylaştığımız saatlerden birini seçin veya «Evet» ile onaylayın."
            : "Let's continue booking — please pick a time from our list or reply «Yes» to confirm.");
      turnLeadData = priorLeadData;
      workflowSelected = "booking_lock";
      routerReason = altSlotDatetimeRequest
        ? "select_slot_datetime_request"
        : bookingRouter.reason || "booking_lock_llm_fallback";
    } else {
    llmUsed = true;
    workflowSelected = "coordinator_llm";
    routerReason = bookingActiveLock ? "booking_lock" : "openai_coordinator";
    const result = await coordinatorChatReply({
      message,
      clinicContext,
      travelContext: isTreatmentGuide || bookingActiveLock ? null : travelContext,
      journeyContext: bookingActiveLock ? null : journeyContext,
      documentIntakeContext: documentIntakeWithBooking,
      pricingSalesContext: bookingActiveLock ? "" : pricingSalesContext,
      doctorProfilesContext: bookingActiveLock ? null : doctorProfilesContext,
      clinicDirectoryContext: null,
      history: recentTurns,
      conversationSummary,
      contextMode,
      conversationLanguage: languageState.conversationLanguage,
      conversationLanguagePolicy,
      whatsappCollectionContext,
      conversionStrategyContext: bookingActiveLock ? "" : conversionStrategy.promptBlock,
      patientContextStrategyPrompt,
      repetitionSuppressionPrompt,
      referralAwarenessContext,
      patientQuestionAnchoringPrompt,
      messagingBrevityPrompt: buildMessagingBrevityPromptBlock(inboundChannel, message),
      maxTokens: resolveCoordinatorMaxTokens(inboundChannel, message),
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
      logLabel: "aiPatientInboundReply",
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
      channel: inboundChannel,
    });
    replyText = enforceNoNumericPricingUnlessDirectAsk(replyText, message, {
      lang: languageState.conversationLanguage,
      clinicName: clinicContext,
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
    logAiRouter({
      message_id: params.externalMessageId || null,
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      workflow_selected: workflowSelected,
      router_reason: "empty_reply",
      response_generated: false,
      patient_preview: message.slice(0, 80),
    });
    return { sent: false, reason: "empty_reply" };
  }

  const channel = resolveInboundCoordinatorChannel(params.source, params.channel);
  const whatsappOnChannel =
    channel === "whatsapp" ||
    String(profileRow.primary_channel || "").toLowerCase() === "whatsapp";
  replyText = repairWhatsappNumberAskOnChannel(
    replyText,
    whatsappOnChannel ? "whatsapp" : channel,
    phoneForAck ||
      knownWhatsapp ||
      normalizeWhatsappNumber(resolveWhatsappFromInboundChannel(profileRow)),
  );

  if (
    aiRepliedRecentlyInBurst(profileRow) &&
    (isSchedulingContinuationFragment(message, recentTurns) ||
      (llmUsed && !messageHasSchedulingIntent(message)))
  ) {
    logDuplicateReplyDetected({
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      message_id: params.externalMessageId || null,
      reason: "second_reply_in_burst",
      workflow_selected: workflowSelected,
      patient_preview: message.slice(0, 80),
    });
    logAiRouter({
      message_id: params.externalMessageId || null,
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      workflow_selected: "suppressed_duplicate_burst",
      router_reason: "second_reply_in_burst",
      response_generated: false,
      patient_preview: message.slice(0, 80),
    });
    return { sent: false, reason: "duplicate_reply_burst" };
  }

  const repeatGuard = preventRepetitiveAssistantReply(replyText, {
    patientMessage: message,
    discussionMemory,
    conversationLanguage: languageState.conversationLanguage,
    recentTurns,
    logLabel: "aiPatientInboundReply_final",
    reusePriorReplyWithin30s: !bookingPrep.engaged && !bookingPrep.slotsOffered,
  });
  replyText = repeatGuard.reply;

  if (
    String(replyText || "").trim() &&
    (isSlotConfirmationNudgeReply(replyText) ||
      ((bookingPrep.awaitingConfirmation ||
        String(durableBookingAfterPrep.stage || "") === "awaiting_slot_confirm" ||
        durableBookingAfterPrep.awaitingAction === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING) &&
        detectNearDuplicateAssistantReply(replyText, recentTurns).duplicate) ||
      (isSlotConfirmationNudgeReply(replyText) &&
        coordinatorRecentlyAskedSlotConfirmation(recentTurns)))
  ) {
    logAiRouter({
      message_id: params.externalMessageId || null,
      patient_id: patientId.slice(0, 8),
      clinic_id: clinicId.slice(0, 8),
      workflow_selected: "suppressed_duplicate_booking_confirm",
      router_reason: "duplicate_booking_confirmation",
      response_generated: false,
      patient_preview: message.slice(0, 80),
      reply_preview: String(replyText || "").slice(0, 120),
    });
    return { sent: false, reason: "duplicate_booking_confirmation" };
  }

  if (
    replyText &&
    bookingActiveLock &&
    detectBookingSelectSlotDeadlock(recentTurns, replyText, message, {
      timezone: schedulingTz,
    })
  ) {
    logBookingDeadlockDetected({
      patient_id: patientId.slice(0, 8),
      booking_id: durableBookingAfterPrep.bookingId
        ? String(durableBookingAfterPrep.bookingId).slice(0, 8)
        : null,
      pendingAction:
        durableBookingAfterPrep.pendingAction || durableBookingAfterPrep.awaitingAction || null,
      user_message: String(message || "").slice(0, 120),
      proposed_reply_preview: String(replyText || "").slice(0, 120),
    });
    logBookingLoopDetected({
      patient_id: patientId.slice(0, 8),
      booking_id: durableBookingAfterPrep.bookingId
        ? String(durableBookingAfterPrep.bookingId).slice(0, 8)
        : null,
      pendingAction:
        durableBookingAfterPrep.pendingAction || durableBookingAfterPrep.awaitingAction || null,
      user_message: String(message || "").slice(0, 120),
    });
    if (
      bookingPrep.directReply &&
      !detectBookingSelectSlotDeadlock(recentTurns, bookingPrep.directReply, message, {
        timezone: schedulingTz,
      })
    ) {
      replyText = bookingPrep.directReply;
      routerReason = "booking_deadlock_recovery";
    } else if (altSlotDatetimeRequest) {
      try {
        const recovered = await recoverSelectSlotDatetimeReply({
          clinicId,
          patientId,
          profileRow,
          patientMessage: message,
          leadData: priorLeadData,
          locale: languageState.conversationLanguage,
          recentTurns,
          channel: params.channel || profileRow.primary_channel || null,
          inboundSource: params.source || params.channel || profileRow.primary_channel || null,
        });
        if (recovered?.directReply) {
          replyText = recovered.directReply;
          bookingPrep = { ...bookingPrep, ...recovered, engaged: true };
          routerReason = "booking_deadlock_recovery";
        } else {
          const lang = String(languageState.conversationLanguage || "tr").slice(0, 2);
          replyText = buildAlternativeSlotCheckingReply(lang, String(message || "").trim().slice(0, 48));
          routerReason = "booking_loop_recovery";
        }
      } catch (deadlockErr) {
        console.warn("[aiPatientInboundReply] booking_deadlock_recovery:", deadlockErr?.message || deadlockErr);
        const lang = String(languageState.conversationLanguage || "tr").slice(0, 2);
        replyText = buildAlternativeSlotCheckingReply(lang, String(message || "").trim().slice(0, 48));
        routerReason = "booking_loop_recovery";
      }
    }
  }

  const leadData = mergeLeadData(priorLeadData, turnLeadData || {});
  const nowIso = new Date().toISOString();

  logAiRouter({
    message_id: params.externalMessageId || null,
    patient_id: patientId.slice(0, 8),
    clinic_id: clinicId.slice(0, 8),
    workflow_selected: workflowSelected,
    router_reason: routerReason,
    response_generated: true,
    patient_preview: message.slice(0, 80),
    reply_preview: String(replyText || "").slice(0, 120),
    booking_engaged: bookingPrep.engaged === true,
    llm_used: llmUsed,
  });

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

  if (leadPipeline.profileId) {
    const { data: profFlags } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("operational_intake_flags")
      .eq("id", leadPipeline.profileId)
      .maybeSingle();
    const prevFlags =
      profFlags?.operational_intake_flags && typeof profFlags.operational_intake_flags === "object"
        ? profFlags.operational_intake_flags
        : {};
    const repliedFlags = buildRepliedPatientMessageFlags(message, prevFlags);
    if (
      workflowSelected.startsWith("booking") ||
      messageHasSchedulingIntent(message) ||
      bookingPrep.engaged
    ) {
      repliedFlags.lastAiSchedulingBurstReplyAt = nowIso;
    }
    if (params.externalMessageId) {
      repliedFlags.lastAiRepliedForExternalMessageId = String(params.externalMessageId).trim();
      repliedFlags.lastAiRepliedForPatientMessageAt = inboundPatientMessageAt || lastPatientAt || null;
    }
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        operational_intake_flags: preserveBookingStateInFlags(repliedFlags, prevFlags),
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
      patientContextStrategy: bookingActiveLock ? undefined : patientContextStrategy,
      discussionMemory: bookingActiveLock ? undefined : memoryAfterTurn,
      conversationTopic: bookingActiveLock ? undefined : topicAfterTurn,
      conversationalIntake: bookingActiveLock
        ? undefined
        : workflowEval.conversationalIntakePatch || undefined,
      conversationWorkflow: bookingActiveLock ? undefined : workflowForPersist,
    });
    if (catchUpNeeded) {
      const { data: flagRow } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("operational_intake_flags")
        .eq("id", leadPipeline.profileId)
        .maybeSingle();
      const prevF =
        flagRow?.operational_intake_flags && typeof flagRow.operational_intake_flags === "object"
          ? flagRow.operational_intake_flags
          : persistedFlags;
      await supabase
        .from("ai_coordinator_lead_profiles")
        .update({
          operational_intake_flags: buildSnoozeCatchUpDoneFlags(prevF),
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadPipeline.profileId);
    }
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

  if (!bookingActiveLock) {
    void markAppointmentOfferInAiReply(profileRow.id, replyText).catch((e) =>
      console.warn("[aiAppointmentBooking] offer_mark:", e?.message || e),
    );
  }

  void finalizeAiAppointmentBookingTurn({
    profileId: profileRow.id,
    patientMessage: message,
    locale: languageState.conversationLanguage,
    recentTurns,
  }).catch((e) => console.warn("[aiAppointmentBooking] finalize:", e?.message || e));

  void runPostConversationLearningAnalysis({
    clinicId,
    profileId: profileRow.id,
    patientMessage: message,
    aiReply: replyText,
    recentTurns,
    channel,
  }).catch((e) => console.warn("[aiLearning] analyze:", e?.message || e));

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

  logBookingAudit({
    event: "turn_complete",
    traceId: params.latencyTraceId || null,
    profileId: profileRow.id ? String(profileRow.id).slice(0, 8) : null,
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    userMessage: message.slice(0, 240),
    bookingState: {
      bookingActive: durableBookingAfterPrep.bookingActive,
      stage: durableBookingAfterPrep.stage || null,
      bookingId: durableBookingAfterPrep.bookingId
        ? String(durableBookingAfterPrep.bookingId).slice(0, 8)
        : null,
    },
    pendingAction:
      durableBookingAfterPrep.pendingAction ||
      durableBookingAfterPrep.awaitingAction ||
      durableBookingAfterPrep.pending_action ||
      null,
    selectedDate: durableBookingAfterPrep.selectedDate || null,
    selectedSlot: durableBookingAfterPrep.selectedSlot?.startAt || null,
    slotListId: durableBookingAfterPrep.slotListId || null,
    routerLock: bookingActiveLock,
    routerReason: bookingRouter.reason || null,
    intent: bookingStatusLock
      ? "booking_status"
      : bookingActiveLock
        ? "booking_lock"
        : greetingOnly
          ? "greeting"
          : "coordinator",
    toolCalls: [],
    bookingPayload: bookingPrep.booked
      ? {
          booked: true,
          selectedSlot: durableBookingAfterPrep.selectedSlot?.startAt || null,
          selectedDate: durableBookingAfterPrep.selectedDate || null,
        }
      : null,
    bookingPrep: {
      engaged: bookingPrep.engaged,
      directReply: !!bookingPrep.directReply,
      booked: bookingPrep.booked === true,
      awaitingConfirmation: bookingPrep.awaitingConfirmation === true,
    },
    llmUsed: llmUsed,
    finalResponse: String(replyText || "").slice(0, 400),
  });

  return {
    sent: true,
    profileId: profileRow.id,
    leadPipeline,
    outboundDelivered: externalChannels.has(channel) ? outboundDelivered : false,
  };
  } finally {
    releasePatientInboundTurn(patientId, clinicId);
    endAiReplyGeneration(patientId, clinicId);
  }
}

module.exports = {
  setupAiPatientInboundReply,
  runAiReplyForClinicInbound,
  aiAlreadyRepliedSinceLastPatient,
  hasAiOutboundSincePatient,
};
