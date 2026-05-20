/**
 * Expand internal clinical guidance into patient-facing drafts.
 */

const { isOpenAIConfigured, chatCompletion } = require("./openai");
const {
  resolvePatientContextStrategy,
  buildPatientContextStrategyPromptBlock,
} = require("./patientContextStrategy");
const {
  buildDiscussionMemory,
  buildRepetitionSuppressionPromptBlock,
  readDiscussionMemoryFromFlags,
} = require("./conversationRepetitionMemory");
const { JOURNEY_GUARDRAIL_PROMPT } = require("./clinicJourneyPrompt");
const { DOCUMENT_INTAKE_GUARDRAIL_PROMPT } = require("./aiPatientDocumentPrompt");
const { buildConversionStrategyForAi } = require("./conversionEngineForAi");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { applyClinicalGuidanceSafety, MEDICAL_GUARDRAIL_PROMPT } = require("./clinicalGuidanceSafety");
const { INTENT_TAGS, REWRITE_PROMPTS, normalizeIntentTags, normalizeStringList } = require("./clinicalGuidanceTypes");
const {
  extractReplyFromCoordinatorObject,
  isInvalidPatientFacingReply,
} = require("./coordinatorReplySanitize.cjs");

const EXPAND_SYSTEM = `You are the Clinifly AI Communication Assistant — NOT a dentist.
A licensed doctor or coordinator wrote INTERNAL clinical guidance. Your job is to expand it into a patient-facing message.

CRITICAL RULES:
* NEVER copy internal guidance verbatim to the patient.
* NEVER present internal notes as facts the patient already has.
* Use operational, empathetic language — not diagnosis, not guarantees, not pressure.
* Prefer: "may be considered", "doctor evaluation may be required", "further review may help", "final plan depends on examination".
* Do not invent clinical findings, prices, or timelines not implied by the guidance.
* Keep under 150 words unless guidance requires more detail.
* Match the patient's conversation language when specified.

${MEDICAL_GUARDRAIL_PROMPT}

Return JSON only:
{
  "patientDraft": "message text only",
  "confidence": 0.0 to 1.0,
  "detectedRisks": ["short_code", ...]
}`;

/**
 * @param {Record<string, unknown>} guidance
 * @param {{ patientContext?: string, conversationLanguage?: string, conversionPromptBlock?: string }} ctx
 */
function buildExpandUserPrompt(guidance, ctx) {
  const tags = normalizeIntentTags(guidance.intent_tags || guidance.intentTags);
  const constraints = normalizeStringList(guidance.constraints);
  const goals = normalizeStringList(guidance.communication_goals || guidance.communicationGoals);
  const lines = [
    "INTERNAL CLINICAL GUIDANCE (doctor-facing — do NOT quote directly):",
    String(guidance.intent_text || guidance.intentText || "").trim(),
  ];
  if (tags.length) lines.push(`Intent tags: ${tags.join(", ")}`);
  if (constraints.length) lines.push(`Constraints: ${constraints.join("; ")}`);
  if (goals.length) lines.push(`Communication goals: ${goals.join("; ")}`);
  if (ctx.patientContext) lines.push(`\nPatient context:\n${ctx.patientContext}`);
  if (ctx.conversationLanguage) {
    lines.push(`\nWrite the patientDraft in language code: ${ctx.conversationLanguage}`);
  }
  if (ctx.conversionPromptBlock) {
    lines.push(`\nConversion coordination (trust-first, not salesy):\n${ctx.conversionPromptBlock}`);
  }
  lines.push("\nExpand into one patient-facing message.");
  return lines.join("\n");
}

/**
 * @param {{
 *   guidance: Record<string, unknown>,
 *   clinicId: string,
 *   profileId?: string|null,
 *   patientContext?: string,
 *   conversationLanguage?: string,
 *   forbiddenCategories?: Record<string, string[]>,
 *   profileRow?: Record<string, unknown>|null,
 *   patientMessage?: string|null,
 *   conversationSummary?: string|null,
 *   leadData?: Record<string, unknown>|null,
 * }} params
 */
async function expandClinicalGuidance(params) {
  if (!isOpenAIConfigured()) {
    const err = new Error("OPENAI_API_KEY not configured");
    err.code = "ai_not_configured";
    throw err;
  }

  const clinicId = String(params.clinicId || "").trim();
  let conversionPromptBlock = "";
  let forbiddenCategories = params.forbiddenCategories;
  /** @type {Record<string, unknown>|null} */
  let clinicProfile = null;
  try {
    clinicProfile = await getClinicAiProfile(clinicId);
    const kb = clinicProfile?.knowledgeBase || {};
    forbiddenCategories =
      forbiddenCategories ||
      kb.conversionEngine?.forbiddenCategories ||
      kb.conversion_engine?.forbiddenCategories;
    if (params.profileId) {
      const strategy = await buildConversionStrategyForAi(clinicId, {
        profileId: params.profileId,
        recordTimelineEvents: false,
      });
      conversionPromptBlock = strategy.promptBlock || "";
    }
  } catch (e) {
    console.warn("[clinicalGuidanceExpand] clinic context:", e?.message || e);
  }

  const patientContextStrategy = resolvePatientContextStrategy({
    message: params.patientMessage,
    conversationSummary: params.conversationSummary,
    leadData: params.leadData,
    profileRow: params.profileRow,
    clinicProfile,
  });
  const patientContextStrategyPrompt =
    buildPatientContextStrategyPromptBlock(patientContextStrategy);

  const discussionMemory = buildDiscussionMemory({
    patientMessage: params.patientMessage,
    conversationSummary: params.conversationSummary,
    recentTurns: [],
    persistedMemory: readDiscussionMemoryFromFlags(params.profileRow?.operational_intake_flags),
  });
  const repetitionSuppressionPrompt = buildRepetitionSuppressionPromptBlock(discussionMemory, {
    patientMessage: params.patientMessage,
  });

  const userPrompt = buildExpandUserPrompt(params.guidance, {
    patientContext: params.patientContext,
    conversationLanguage: params.conversationLanguage,
    conversionPromptBlock,
  });

  const { content } = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          EXPAND_SYSTEM +
          "\n" +
          patientContextStrategyPrompt +
          (repetitionSuppressionPrompt ? `\n${repetitionSuppressionPrompt}` : "") +
          "\n" +
          JOURNEY_GUARDRAIL_PROMPT +
          "\n" +
          DOCUMENT_INTAKE_GUARDRAIL_PROMPT,
      },
      { role: "user", content: userPrompt },
    ],
    jsonMode: true,
    maxTokens: 500,
    timeoutMs: 30000,
  });

  let patientDraft = "";
  let modelConfidence = 0.75;
  let detectedRisks = [];
  try {
    const parsed = JSON.parse(content);
    patientDraft = extractReplyFromCoordinatorObject(parsed) ||
      String(parsed.patientDraft || parsed.reply || "").trim();
    modelConfidence = Number(parsed.confidence);
    if (!Number.isFinite(modelConfidence)) modelConfidence = 0.75;
    detectedRisks = Array.isArray(parsed.detectedRisks) ? parsed.detectedRisks.map(String) : [];
  } catch {
    patientDraft = String(content || "").trim();
  }
  if (isInvalidPatientFacingReply(patientDraft)) {
    patientDraft = "";
  }

  const safety = applyClinicalGuidanceSafety(patientDraft, {
    userContext: params.patientContext,
    forbiddenCategories,
  });

  return {
    patientDraft: safety.patientDraft,
    confidence: Math.min(modelConfidence, safety.confidence),
    detectedRisks: [...new Set([...detectedRisks, ...safety.safetyReport.warnings])],
    safetyReport: safety.safetyReport,
    rewriteMetadata: {
      source: "ai_expanded",
      intentTags: normalizeIntentTags(params.guidance.intent_tags || params.guidance.intentTags),
      conversionEngineUsed: !!conversionPromptBlock,
    },
  };
}

/**
 * @param {{
 *   draftText: string,
 *   action: string,
 *   clinicId?: string,
 *   patientContext?: string,
 * }} params
 */
async function rewriteClinicalDraft(params) {
  if (!isOpenAIConfigured()) {
    const err = new Error("OPENAI_API_KEY not configured");
    err.code = "ai_not_configured";
    throw err;
  }

  const action = String(params.action || "").trim();
  const instruction = REWRITE_PROMPTS[action];
  if (!instruction) {
    const err = new Error("invalid_rewrite_action");
    err.code = "invalid_rewrite_action";
    throw err;
  }

  const { content } = await chatCompletion({
    messages: [
      {
        role: "system",
        content: `${EXPAND_SYSTEM}\nRewrite task: ${instruction}\nReturn JSON: { "patientDraft": "..." }`,
      },
      {
        role: "user",
        content: `Current draft:\n${String(params.draftText || "").trim()}\n\n${params.patientContext ? `Context:\n${params.patientContext}` : ""}`,
      },
    ],
    jsonMode: true,
    maxTokens: 400,
    timeoutMs: 25000,
  });

  let patientDraft = "";
  try {
    const parsed = JSON.parse(content);
    patientDraft = String(parsed.patientDraft || "").trim();
  } catch {
    patientDraft = String(content || "").trim();
  }

  const safety = applyClinicalGuidanceSafety(patientDraft, { userContext: params.patientContext });
  return {
    patientDraft: safety.patientDraft,
    confidence: safety.confidence,
    safetyReport: safety.safetyReport,
    rewriteMetadata: { rewriteAction: action },
  };
}

module.exports = {
  expandClinicalGuidance,
  rewriteClinicalDraft,
  INTENT_TAGS,
};
