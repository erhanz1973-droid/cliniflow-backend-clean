/**
 * Coordinator draft reply suggestions (assistant only — never auto-send).
 */

const { isOpenAIConfigured, chatCompletion } = require("./openai");
const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const { JOURNEY_GUARDRAIL_PROMPT } = require("./clinicJourneyPrompt");
const { DOCUMENT_INTAKE_GUARDRAIL_PROMPT } = require("./aiPatientDocumentPrompt");
const { buildOperationalSuggestHint } = require("./aiOperationalSuggest");
const { buildTreatmentTagsPromptBlock } = require("./treatmentInterestTags");
const {
  resolvePatientContextStrategy,
  buildPatientContextStrategyPromptBlock,
} = require("./patientContextStrategy");
const {
  buildDiscussionMemory,
  buildRepetitionSuppressionPromptBlock,
  readDiscussionMemoryFromFlags,
} = require("./conversationRepetitionMemory");
const { normalizeUiLang } = require("./i18n/coordinationLocales");

const LANG_LABEL = { en: "English", tr: "Turkish", ru: "Russian", ka: "Georgian" };

/**
 * @param {string} [coordinatorUiLang]
 * @param {string} [patientConversationLang]
 */
function buildCoordinatorLanguagePrompt(coordinatorUiLang, patientConversationLang) {
  const ui = normalizeUiLang(coordinatorUiLang || "en");
  const patient = patientConversationLang
    ? normalizeUiLang(patientConversationLang)
    : ui;
  let block = `\nWrite suggestedReply in ${LANG_LABEL[ui] || "English"} (coordinator UI language). Use natural native phrasing — not a translation of another draft.`;
  if (patient !== ui) {
    block += `\nPatient conversation language: ${LANG_LABEL[patient] || patient}. Patient-facing sentences should read naturally in that language; coordinator may still think in ${LANG_LABEL[ui]}.`;
  }
  return block;
}

const SUGGEST_SYSTEM = `You are assisting a human dental clinic coordinator drafting a reply to a prospective patient.
Write a warm, professional message the coordinator can send after editing.
Rules:
* Operational coordination only — never diagnose, interpret scans, or confirm treatment suitability.
* Do not guarantee outcomes or quote final prices as certain.
* Encourage consultation booking when appropriate.
* Keep under 120 words.
* Return JSON only: { "suggestedReply": "..." }`;

/**
 * @param {{
 *   conversationSummary?: string|null,
 *   events?: Array<{ patientMessage?: string, aiReply?: string, eventType?: string }>,
 *   leadContext?: Record<string, unknown>,
 *   operationalIntakeFlags?: Record<string, unknown>|null,
 *   travelContext?: string|null,
 *   journeyContext?: string|null,
 *   documentIntakeContext?: string|null,
 *   patientContextStrategyPrompt?: string|null,
 *   coordinatorUiLang?: string|null,
 *   patientConversationLang?: string|null,
 * }} params
 */
async function suggestCoordinatorReply(params) {
  if (!isOpenAIConfigured()) {
    const err = new Error("OPENAI_API_KEY not configured");
    err.code = "ai_not_configured";
    throw err;
  }

  const flags = params.operationalIntakeFlags || null;
  const operationalHint = buildOperationalSuggestHint(flags);

  const lines = [];
  if (params.conversationSummary) {
    lines.push(`Conversation summary:\n${params.conversationSummary}`);
  }
  if (params.leadContext) {
    lines.push(`Lead signals: ${JSON.stringify(params.leadContext)}`);
  }
  if (flags) {
    lines.push(
      `Operational intake: readiness ${flags.readinessPercent ?? "—"}%, journey: ${flags.journeyStageLabel || flags.journeyStage || "—"}`,
    );
    if (flags.readinessMissing?.length) {
      lines.push(`Still missing (operational): ${flags.readinessMissing.join("; ")}`);
    }
    lines.push(buildTreatmentTagsPromptBlock(flags.patientReportedTags || []));
  }
  if (operationalHint) lines.push(operationalHint);
  if (params.journeyContext) lines.push(params.journeyContext);
  if (params.travelContext) lines.push(params.travelContext);
  if (params.documentIntakeContext) lines.push(params.documentIntakeContext);
  for (const ev of params.events || []) {
    if (ev.patientMessage) lines.push(`Patient: ${ev.patientMessage}`);
    if (ev.aiReply) lines.push(`Prior AI: ${ev.aiReply}`);
  }
  lines.push("\nDraft the next coordinator reply to the patient.");

  const patientCtx = params.patientContextStrategyPrompt
    ? String(params.patientContextStrategyPrompt).trim()
    : buildPatientContextStrategyPromptBlock(
        resolvePatientContextStrategy({
          conversationSummary: params.conversationSummary,
          leadData: params.leadContext,
          profileRow: {
            operational_intake_flags: params.operationalIntakeFlags,
            country: params.leadContext?.country,
          },
        }),
      );

  const discussionMemory = buildDiscussionMemory({
    conversationSummary: params.conversationSummary,
    recentTurns: (params.events || [])
      .flatMap((ev) => {
        const turns = [];
        if (ev.patientMessage) turns.push({ role: "user", text: ev.patientMessage });
        if (ev.aiReply) turns.push({ role: "assistant", text: ev.aiReply });
        return turns;
      })
      .slice(-10),
    persistedMemory: readDiscussionMemoryFromFlags(params.operationalIntakeFlags),
  });
  const repetitionCtx =
    buildRepetitionSuppressionPromptBlock(discussionMemory) || "";

  const { content } = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          SUGGEST_SYSTEM +
          (patientCtx ? `\n${patientCtx}` : "") +
          (repetitionCtx ? `\n${repetitionCtx}` : "") +
          "\n" +
          JOURNEY_GUARDRAIL_PROMPT +
          "\n" +
          DOCUMENT_INTAKE_GUARDRAIL_PROMPT +
          buildCoordinatorLanguagePrompt(
            params.coordinatorUiLang,
            params.patientConversationLang,
          ),
      },
      { role: "user", content: lines.join("\n") },
    ],
    jsonMode: true,
    maxTokens: 400,
    timeoutMs: 25000,
  });

  let suggestedReply = "";
  try {
    const parsed = JSON.parse(content);
    suggestedReply = String(parsed.suggestedReply || parsed.reply || "").trim();
  } catch {
    suggestedReply = content.trim();
  }

  if (!suggestedReply) {
    throw new Error("Empty suggestion from model");
  }

  return {
    suggestedReply,
    assistantOnly: true,
    coordinationMode: COORDINATION_HUMAN,
    operationalHintUsed: !!operationalHint,
  };
}

module.exports = { suggestCoordinatorReply };
