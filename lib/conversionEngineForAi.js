/**
 * Load clinic conversion settings and build prompt block for coordinator replies.
 */

const { getClinicAiProfile } = require("./clinicAiSettings");
const { runConversionEngine, normalizeConversionConfig } = require("./conversionEngine");

/**
 * @param {string} clinicId
 * @param {{
 *   message: string,
 *   leadData?: Record<string, unknown>,
 *   conversationSummary?: string|null,
 *   operationalIntakeFlags?: Record<string, unknown>,
 *   profileRow?: Record<string, unknown>,
 *   contextMode?: string,
 * }} params
 */
async function buildConversionStrategyForAi(clinicId, params) {
  if (params.contextMode === "treatment_guide") {
    return { promptBlock: "", meta: { skipped: "treatment_guide" } };
  }

  const profile = await getClinicAiProfile(clinicId);
  const conversionConfig = normalizeConversionConfig(
    profile.knowledgeBase?.conversionEngine || profile.knowledgeBase?.conversion_engine,
  );

  const row = params.profileRow || {};
  const result = runConversionEngine({
    message: params.message,
    leadData: params.leadData,
    conversationSummary: params.conversationSummary,
    operationalIntakeFlags: params.operationalIntakeFlags,
    messageCount: row.message_count ?? row.messageCount,
    lastPatientMessageAt: row.last_patient_message_at ?? row.lastPatientMessageAt,
    lastAiReplyAt: row.last_ai_reply_at ?? row.lastAiReplyAt,
    conversionConfig,
  });

  return {
    promptBlock: result.promptBlock,
    meta: {
      preset: result.config.preset,
      primaryGoal: result.strategy.primaryGoal,
      priorities: result.strategy.priorities,
      signals: result.analysis.signals,
    },
  };
}

module.exports = { buildConversionStrategyForAi, normalizeConversionConfig };
