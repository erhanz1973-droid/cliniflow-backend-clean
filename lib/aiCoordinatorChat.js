/**
 * POST /ai/chat — AI dental treatment coordinator + lead pipeline → CRM.
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  coordinatorChatReply,
  isOpenAIConfigured,
  OpenAIError,
} = require("./openai");
const {
  mergeLeadData,
  normalizeLeadData,
  normalizeChatHistory,
  leadDataHasSignals,
} = require("./leadIntelligence");
const { normalizeTagList } = require("./treatmentInterestTags");
const { normalizeConversationSummary } = require("./conversationMemory");
const { persistAiCoordinatorLead, asUuid } = require("./aiLeadPipeline");
const {
  isAiAutoReplyEnabled,
  isAiDraftGenerationEnabled,
  loadCoordinationBySession,
  COORDINATION_HUMAN,
} = require("./aiCoordinatorCoordination");
const { getTopHotelsForAi } = require("./clinicPartnerHotels");
const {
  resolvePatientContextStrategy,
  buildPatientContextStrategyPromptBlock,
  buildTravelContextForStrategy,
} = require("./patientContextStrategy");
const { getRelevantProtocolsForAi } = require("./clinicTreatmentProtocols");
const { buildTreatmentJourneyPromptBlock } = require("./clinicJourneyPrompt");
const { generateVisitPlanDraft } = require("./aiVisitPlanner");
const { listDocumentsForProfile, listDocumentsForPatient } = require("./aiPatientDocuments");
const {
  buildDocumentIntakePromptBlock,
  syncOperationalIntakeFlags,
  buildOperationalIntakeState,
} = require("./aiIntakeFlags");
const { buildIntakeJourneySteps } = require("./aiIntakeJourneySteps");
const { buildClinicDirectoryPromptBlock } = require("./clinicDirectoryForAi");
const { buildClinicSalesPromptForAi } = require("./clinicSalesPromptForAi");
const { buildConversionStrategyForAi } = require("./conversionEngineForAi");
const {
  resolveConversationLanguageForTurn,
  buildConversationLanguagePromptBlock,
  normalizeLangCode,
} = require("./conversationLanguage");
const { getClinicAiProfile } = require("./clinicAiSettings");
const {
  evaluateWhatsappCollectionCandidate,
  buildWhatsappCollectionPromptBlock,
  extractWhatsappFromPatientMessage,
  persistWhatsappCollection,
  markWhatsappPromptOffered,
  processWhatsappAfterCoordinationTurn,
} = require("./whatsappCollection");
const { fetchRecentCoordinatorTurns } = require("./coordinatorRecentHistory");
const {
  buildDiscussionMemory,
  buildRepetitionSuppressionPromptBlock,
  updateDiscussionMemoryAfterTurn,
  readDiscussionMemoryFromFlags,
} = require("./conversationRepetitionMemory");

const MAX_MESSAGE_CHARS = Math.min(
  8000,
  Math.max(500, parseInt(process.env.AI_COORDINATOR_MAX_MESSAGE_CHARS || "4000", 10) || 4000),
);

const aiChatLimiter = rateLimit({
  windowMs: parseInt(process.env.RL_AI_CHAT_WINDOW_MS || String(15 * 60 * 1000), 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RL_AI_CHAT_MAX || "30", 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "rate_limit_exceeded",
    message: "Too many requests. Please try again later.",
  },
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Optional patient UUID from Bearer JWT (does not require auth).
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function tryPatientIdFromAuth(req) {
  const auth = String(req.headers.authorization || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return null;
  const secret =
    typeof process.env.JWT_SECRET === "string" ? process.env.JWT_SECRET.trim() : "";
  if (secret.length < 8) return null;
  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(m[1].trim(), secret);
    return asUuid(
      decoded?.patientId || decoded?.patientUuid || decoded?.patient_uuid || decoded?.sub,
    );
  } catch {
    return null;
  }
}

/**
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function resolvePatientId(req) {
  const fromToken = tryPatientIdFromAuth(req);
  const fromBody = asUuid(req.body?.patientId ?? req.body?.patient_id);
  if (fromToken && fromBody && fromToken !== fromBody) {
    return fromToken;
  }
  return fromToken || fromBody || null;
}

/**
 * @param {string|undefined|null} clinicId
 * @returns {Promise<string|null>}
 */
async function resolveClinicContext(clinicId) {
  const id = String(clinicId || "").trim();
  if (!id || !UUID_RE.test(id) || !isSupabaseEnabled()) return null;

  try {
    const { data, error } = await supabase
      .from("clinics")
      .select("name, clinic_code, city, country")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;

    const parts = [data.name, data.city, data.country].map((s) => String(s || "").trim()).filter(Boolean);
    if (parts.length) return parts.join(", ");
    return data.clinic_code ? String(data.clinic_code).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Patient Treatment Guide vs full coordinator operations (travel/hotels enabled).
 * @param {import('express').Request} req
 * @returns {'treatment_guide'|'coordinator'}
 */
function resolveContextMode(req) {
  const raw = String(req.body?.contextMode ?? req.body?.context_mode ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (raw === "treatment_guide") return "treatment_guide";
  if (req.body?.includeTravelContext === false || req.body?.include_travel_context === false) {
    return "treatment_guide";
  }
  return "coordinator";
}

const { buildClinicInquiryDraft } = require("./clinicInquiryDraft");

const router = express.Router();

/**
 * Build intake journey payload for patient UI (single source of truth).
 * @param {Record<string, unknown>|null} operationalIntakeFlags
 * @param {Array<Record<string, unknown>>} documents
 */
function buildIntakeJourneyPayload(operationalIntakeFlags, documents) {
  if (!operationalIntakeFlags) return null;
  return buildIntakeJourneySteps({
    operationalIntakeFlags,
    documents: documents || [],
    readiness: {
      percent: operationalIntakeFlags.readinessPercent,
      missing: operationalIntakeFlags.readinessMissing,
    },
  });
}

/**
 * Persist patient-reported goal tags and refresh operational intake state.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleIntakeTagsSave(req, res) {
  try {
    const patientId = resolvePatientId(req);
    const sessionId =
      String(req.body?.sessionId ?? req.body?.session_id ?? "").trim() || null;
    const clinicId = asUuid(req.body?.clinicId ?? req.body?.clinic_id);
    const incomingTags = normalizeTagList(
      req.body?.patientReportedTags ??
        req.body?.patient_reported_tags ??
        req.body?.tags,
    );

    if (!incomingTags.length) {
      return res.status(400).json({
        success: false,
        error: "tags_required",
        message: "Provide at least one patientReportedTags entry",
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "session_id_required",
        message: "sessionId is required",
      });
    }

    const priorLeadData = normalizeLeadData(
      req.body?.priorLeadData && typeof req.body.priorLeadData === "object"
        ? req.body.priorLeadData
        : req.body?.prior_lead_data,
    );

    const leadData = mergeLeadData(priorLeadData, {
      patientReportedTags: incomingTags,
    });

    const leadPipeline = await persistAiCoordinatorLead({
      sessionId,
      patientId,
      clinicId,
      leadData,
      turnLeadData: { patientReportedTags: incomingTags },
      patientMessage: "[patient-reported goals updated]",
      channel: "treatment_guide",
    });

    let operationalIntakeFlags = null;
    let profileDocs = [];
    if (leadPipeline.profileId) {
      profileDocs = await listDocumentsForProfile(leadPipeline.profileId, {
        clinicId: clinicId || undefined,
      });
      if (!profileDocs.length && patientId && clinicId) {
        profileDocs = await listDocumentsForPatient(patientId, clinicId);
      }
      const syncResult = await syncOperationalIntakeFlags(leadPipeline.profileId, leadData, profileDocs, {
        patientMessage: "patient-reported goals",
      });
      operationalIntakeFlags = syncResult.flags || null;
    } else {
      operationalIntakeFlags = buildOperationalIntakeState({
        leadData,
        documents: profileDocs,
        patientMessage: "patient-reported goals",
      });
    }

    const clinicInquiryDraft = buildClinicInquiryDraft({
      leadData,
      operationalIntakeFlags,
      documents: profileDocs,
      patientNarrative: String(req.body?.patientNarrative || req.body?.narrative || "").trim() || null,
    });

    return res.json({
      success: true,
      leadData,
      leadPipeline,
      operationalIntakeFlags,
      intakeJourney: buildIntakeJourneyPayload(operationalIntakeFlags, profileDocs),
      clinicInquiryDraft,
    });
  } catch (err) {
    console.error("[POST /ai/intake-tags]", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Could not save intake goals",
    });
  }
}

router.post("/intake-tags", aiChatLimiter, handleIntakeTagsSave);

router.post("/chat", aiChatLimiter, async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      return res.status(400).json({
        success: false,
        error: "message_required",
        message: "Request body must include a non-empty message string",
      });
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({
        success: false,
        error: "message_too_long",
        message: `message must be at most ${MAX_MESSAGE_CHARS} characters`,
      });
    }

    const clinicId = req.body?.clinicId ?? req.body?.clinic_id ?? null;
    const contextMode = resolveContextMode(req);
    const isTreatmentGuide = contextMode === "treatment_guide";
    const patientId = resolvePatientId(req);
    const sessionId =
      String(req.body?.sessionId ?? req.body?.session_id ?? "").trim() || null;
    const clinicContext = await resolveClinicContext(clinicId);
    const clinicUuid = asUuid(clinicId);
    let travelContext = null;
    let journeyContext = null;
    let documentIntakeContext = null;
    let pricingSalesContext = null;
    let clinicDirectoryContext = null;
    let protocols = [];
    let intakeDocuments = [];
    /** @type {Record<string, unknown>} */
    let priorFlags = {};
    const history = normalizeChatHistory(req.body?.history);
    const priorLeadData =
      req.body?.priorLeadData && typeof req.body.priorLeadData === "object"
        ? req.body.priorLeadData
        : req.body?.prior_lead_data && typeof req.body.prior_lead_data === "object"
          ? req.body.prior_lead_data
          : null;
    const conversationSummary = normalizeConversationSummary(
      req.body?.conversationSummary ?? req.body?.conversation_summary,
    );

    let patientContextStrategy = resolvePatientContextStrategy({
      message,
      conversationSummary,
      leadData: priorLeadData || {},
    });
    let patientContextStrategyPrompt =
      buildPatientContextStrategyPromptBlock(patientContextStrategy);

    if (clinicUuid) {
      if (!isTreatmentGuide && !patientContextStrategy.avoid_travel_coordination_topics) {
        const hotels = await getTopHotelsForAi(clinicUuid, 3);
        travelContext = buildTravelContextForStrategy(patientContextStrategy, hotels);
      }
      const treatmentInterest =
        priorLeadData?.treatmentInterest || priorLeadData?.treatment_interest || null;
      protocols = await getRelevantProtocolsForAi(clinicUuid, {
        message,
        treatmentInterest,
        max: 5,
      });
      journeyContext = buildTreatmentJourneyPromptBlock(protocols);

      if (patientId) {
        intakeDocuments = await listDocumentsForPatient(patientId, clinicUuid);
      }
      priorFlags = buildOperationalIntakeState({
        leadData: priorLeadData || {},
        documents: intakeDocuments,
        patientMessage: message,
      });
      documentIntakeContext = buildDocumentIntakePromptBlock(priorFlags, intakeDocuments, message);
      pricingSalesContext = await buildClinicSalesPromptForAi(clinicUuid, {
        message,
        leadData: priorLeadData || {},
        clinicName: clinicContext,
      });
    }

    if (isTreatmentGuide) {
      clinicDirectoryContext = await buildClinicDirectoryPromptBlock({
        message,
        linkedClinicId: clinicUuid,
        patientCountry: priorLeadData?.country || null,
      });
    }

    let delegation =
      sessionId && (await loadCoordinationBySession(sessionId))?.delegation || null;
    const autoReply =
      sessionId ? await isAiAutoReplyEnabled(sessionId) : true;
    const draftGen =
      sessionId ? await isAiDraftGenerationEnabled(sessionId) : true;
    const runAi = autoReply || draftGen;

    if (runAi && !isOpenAIConfigured()) {
      return res.status(503).json({
        success: false,
        error: "ai_not_configured",
        message: "OPENAI_API_KEY is not set on the server",
      });
    }

    let reply = "";
    let turnLeadData = null;
    let nextSummary = conversationSummary;
    let memoryMeta = null;

    let coordinatorDraft = null;
    let languageState = null;
    let conversationLanguagePolicy = null;
    let whatsappCollectionContext = null;
    let conversionStrategyContext = null;
    let waEval = { candidate: false };
    let profileRowForWa = null;
    let discussionMemory = null;
    let repetitionSuppressionPrompt = null;
    let historyForModel = history;

    if (clinicUuid) {
      let profileRowForLang = null;
      if (sessionId && isSupabaseEnabled()) {
        const { data: langProfile } = await supabase
          .from("ai_coordinator_lead_profiles")
          .select(
            "id, conversation_primary_language, preferred_language, operational_intake_flags, message_count, travel_timeline, last_ai_reply_at, last_human_reply_at, whatsapp_number, whatsapp_collection_stage, primary_channel",
          )
          .eq("session_id", sessionId)
          .maybeSingle();
        profileRowForLang = langProfile;
        profileRowForWa = langProfile;
        const clinicAiForContext = await getClinicAiProfile(clinicUuid);
        patientContextStrategy = resolvePatientContextStrategy({
          message,
          conversationSummary,
          leadData: priorLeadData || {},
          profileRow: profileRowForLang,
          clinicProfile: clinicAiForContext,
        });
        patientContextStrategyPrompt =
          buildPatientContextStrategyPromptBlock(patientContextStrategy);
        if (
          !isTreatmentGuide &&
          patientContextStrategy.avoid_travel_coordination_topics
        ) {
          travelContext = null;
        } else if (
          !isTreatmentGuide &&
          !travelContext &&
          !patientContextStrategy.avoid_travel_coordination_topics
        ) {
          const hotels = await getTopHotelsForAi(clinicUuid, 3);
          travelContext = buildTravelContextForStrategy(patientContextStrategy, hotels);
        }
      }
      const bodyConv = normalizeLangCode(
        req.body?.conversationPrimaryLanguage ?? req.body?.conversation_primary_language,
      );
      if (bodyConv && profileRowForLang) {
        profileRowForLang = {
          ...profileRowForLang,
          conversation_primary_language: bodyConv,
        };
      }
      languageState = await resolveConversationLanguageForTurn({
        message,
        profileRow: profileRowForLang,
        clinicId: clinicUuid,
        patientId,
      });
      conversationLanguagePolicy = buildConversationLanguagePromptBlock(languageState);

      if (!isTreatmentGuide && profileRowForWa?.id) {
        const clinicAiProfile = await getClinicAiProfile(clinicUuid);
        const flags =
          profileRowForWa.operational_intake_flags &&
          typeof profileRowForWa.operational_intake_flags === "object"
            ? profileRowForWa.operational_intake_flags
            : {};
        const preWhatsapp = extractWhatsappFromPatientMessage(message);
        if (preWhatsapp?.declined) {
          await persistWhatsappCollection(profileRowForWa.id, { declined: true, source: "ai_chat" });
        } else if (preWhatsapp?.number) {
          await persistWhatsappCollection(profileRowForWa.id, {
            number: preWhatsapp.number,
            source: "ai_chat",
          });
        }
        waEval = evaluateWhatsappCollectionCandidate(
          { ...profileRowForWa, communicationPolicy: clinicAiProfile.communicationPolicy },
          flags,
          priorLeadData || {},
          message,
        );
        whatsappCollectionContext = buildWhatsappCollectionPromptBlock(waEval, contextMode);
      }

      const conversionStrategy = await buildConversionStrategyForAi(clinicUuid, {
        message,
        leadData: priorLeadData || {},
        conversationSummary,
        operationalIntakeFlags: priorFlags,
        profileRow: profileRowForLang,
        profileId: profileRowForLang?.id ? String(profileRowForLang.id) : null,
        contextMode,
      });
      conversionStrategyContext = conversionStrategy.promptBlock;

      if (profileRowForLang?.id) {
        const serverTurns = await fetchRecentCoordinatorTurns(String(profileRowForLang.id), {
          maxTurns: 10,
        });
        if (serverTurns.length) historyForModel = serverTurns;
        const memFlags =
          profileRowForWa?.operational_intake_flags &&
          typeof profileRowForWa.operational_intake_flags === "object"
            ? profileRowForWa.operational_intake_flags
            : priorFlags;
        discussionMemory = buildDiscussionMemory({
          patientMessage: message,
          conversationSummary,
          recentTurns: historyForModel,
          persistedMemory: readDiscussionMemoryFromFlags(memFlags),
        });
        repetitionSuppressionPrompt = buildRepetitionSuppressionPromptBlock(discussionMemory, {
          patientMessage: message,
        });
        pricingSalesContext = await buildClinicSalesPromptForAi(clinicUuid, {
          message,
          leadData: priorLeadData || {},
          clinicName: clinicContext,
          discussionMemory,
        });
      }
    }

    if (!runAi) {
      reply =
        "Thank you for your message. Someone from the clinic will respond shortly.";
      turnLeadData = priorLeadData || null;
    } else {
      const result = await coordinatorChatReply({
        message,
        clinicContext,
        travelContext: isTreatmentGuide ? null : travelContext,
        journeyContext,
        documentIntakeContext,
        pricingSalesContext,
        clinicDirectoryContext,
        history: historyForModel,
        conversationSummary,
        contextMode,
        conversationLanguagePolicy,
        whatsappCollectionContext,
        conversionStrategyContext,
        patientContextStrategyPrompt,
        repetitionSuppressionPrompt,
      });
      coordinatorDraft = result.reply;
      if (autoReply) {
        reply = result.reply;
      } else {
        reply =
          "Thank you for your message. Your care team has been notified and will follow up shortly.";
      }
      turnLeadData = result.leadData;
      nextSummary = result.conversationSummary;
      memoryMeta = result.memoryMeta;
    }

    const leadData = mergeLeadData(priorLeadData, turnLeadData || {});

    const leadPipeline = await persistAiCoordinatorLead({
      sessionId,
      patientId,
      clinicId: asUuid(clinicId),
      leadData,
      turnLeadData,
      conversationSummary: nextSummary,
      patientMessage: message,
      aiReply: autoReply ? reply : null,
      channel: isTreatmentGuide ? "treatment_guide" : "in_app",
      conversationLanguage: languageState?.conversationLanguage || null,
    });

    let operationalIntakeFlags = null;
    let profileDocsForJourney = intakeDocuments;
    if (leadPipeline.profileId) {
      profileDocsForJourney = await listDocumentsForProfile(leadPipeline.profileId, {
        clinicId: clinicUuid || undefined,
      });
      const memoryAfterTurn =
        discussionMemory && autoReply
          ? updateDiscussionMemoryAfterTurn(discussionMemory, {
              patientMessage: message,
              aiReply: reply,
            })
          : discussionMemory;
      const syncResult = await syncOperationalIntakeFlags(
        leadPipeline.profileId,
        leadData,
        profileDocsForJourney.length ? profileDocsForJourney : intakeDocuments,
        {
          patientMessage: message,
          patientContextStrategy,
          discussionMemory: memoryAfterTurn,
        },
      );
      operationalIntakeFlags = syncResult.flags || null;

      void processWhatsappAfterCoordinationTurn({
        profileId: leadPipeline.profileId,
        patientMessage: message,
        leadData,
        source: "ai_chat",
      }).catch((e) => console.warn("[whatsappCollection] ai_chat:", e?.message || e));

      if (waEval.candidate) {
        void markWhatsappPromptOffered(leadPipeline.profileId, waEval.operationalStage).catch(() => {});
      }
    }

    let visitPlanDraft = null;
    if (autoReply && clinicUuid && leadPipeline.profileId) {
      try {
        const planResult = await generateVisitPlanDraft({
          clinicId: clinicUuid,
          patientId,
          leadProfileId: leadPipeline.profileId,
          sessionId,
          message,
          leadData,
          protocols,
          journeyContext,
          travelContext: isTreatmentGuide ? null : travelContext,
          conversationSummary: nextSummary,
        });
        if (planResult.generated && planResult.draft?.id) {
          visitPlanDraft = planResult.draft;
        }
      } catch (planErr) {
        console.warn("[POST /ai/chat] visit plan:", planErr?.message || planErr);
      }
    }

    if (leadDataHasSignals(leadData)) {
      console.log("[POST /ai/chat] leadData", {
        contextMode,
        clinicId: clinicId || null,
        patientId: patientId || null,
        leadData,
        memoryMeta,
        leadPipeline,
        visitPlan: visitPlanDraft?.id || null,
      });
    }

    return res.json({
      success: true,
      reply,
      leadData,
      conversationSummary: nextSummary,
      conversationPrimaryLanguage: languageState?.conversationLanguage || null,
      languageMeta: languageState
        ? {
            detectedInputLanguage: languageState.detectedInputLanguage,
            confidence: languageState.confidence,
            languageSwitched: languageState.languageSwitched,
          }
        : null,
      leadPipeline,
      contextMode,
      visitPlanDraft: visitPlanDraft || null,
      operationalIntakeFlags: operationalIntakeFlags || null,
      intakeJourney: buildIntakeJourneyPayload(operationalIntakeFlags, profileDocsForJourney),
      coordination: {
        mode: autoReply ? "ai_active" : COORDINATION_HUMAN,
        aiAutoReplyEnabled: autoReply,
        coordinatorDraft: coordinatorDraft && !autoReply ? coordinatorDraft : null,
        delegation: delegation
          ? {
              aiMode: delegation.aiMode,
              statusLabel: delegation.statusLabel,
              draftOnly: delegation.draftOnly,
            }
          : null,
      },
    });
  } catch (err) {
    if (err instanceof OpenAIError) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      console.error("[POST /ai/chat] OpenAI:", err.message, err.detail || "");
      return res.status(status).json({
        success: false,
        error: err.code || "openai_error",
        message: err.message,
      });
    }

    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.error("[POST /ai/chat] timeout:", err.message);
      return res.status(504).json({
        success: false,
        error: "openai_timeout",
        message: "AI request timed out. Please try again.",
      });
    }

    console.error("[POST /ai/chat]", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Could not generate a reply",
    });
  }
});

/**
 * @param {import("express").Express} app
 */
function registerAiCoordinatorChatRoutes(app) {
  app.use("/ai", router);
}

module.exports = {
  registerAiCoordinatorChatRoutes,
  aiCoordinatorRouter: router,
};
