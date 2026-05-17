/**
 * Coordinator draft reply suggestions (assistant only — never auto-send).
 */

const { isOpenAIConfigured, chatCompletion } = require("./openai");
const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const { TRAVEL_BOOKING_GUARDRAIL_PROMPT } = require("./clinicTravelPrompt");
const { JOURNEY_GUARDRAIL_PROMPT } = require("./clinicJourneyPrompt");
const { DOCUMENT_INTAKE_GUARDRAIL_PROMPT } = require("./aiPatientDocumentPrompt");
const { buildOperationalSuggestHint } = require("./aiOperationalSuggest");
const { buildTreatmentTagsPromptBlock } = require("./treatmentInterestTags");

const SUGGEST_SYSTEM = `You are assisting a human dental clinic coordinator drafting a reply to a prospective international patient.
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

  const { content } = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          SUGGEST_SYSTEM +
          "\n" +
          TRAVEL_BOOKING_GUARDRAIL_PROMPT +
          "\n" +
          JOURNEY_GUARDRAIL_PROMPT +
          "\n" +
          DOCUMENT_INTAKE_GUARDRAIL_PROMPT,
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
