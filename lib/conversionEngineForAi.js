/**
 * Load clinic conversion settings, build strategy prompt, optional timeline analytics events.
 */

const { getClinicAiProfile } = require("./clinicAiSettings");
const { runConversionEngine } = require("./conversionEngine");
const { normalizeConversionConfig } = require("./conversionEnginePresets");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");

/**
 * @param {string} profileId
 * @param {Array<{ eventType: string, meta?: Record<string, unknown> }>} events
 */
async function recordConversionTimelineEvents(profileId, events) {
  if (!profileId || !events?.length) return;
  for (const ev of events) {
    await insertTimelineEvent({
      profileId,
      eventType: ev.eventType,
      eventMetadata: { ...ev.meta, subsystem: "conversion_engine" },
    });
  }
}

/**
 * @param {string} clinicId
 * @param {{
 *   message: string,
 *   leadData?: Record<string, unknown>,
 *   conversationSummary?: string|null,
 *   operationalIntakeFlags?: Record<string, unknown>,
 *   profileRow?: Record<string, unknown>,
 *   profileId?: string|null,
 *   contextMode?: string,
 * }} params
 */
async function buildConversionStrategyForAi(clinicId, params) {
  if (params.contextMode === "treatment_guide") {
    return { promptBlock: "", meta: { skipped: "treatment_guide" }, timelineEvents: [] };
  }

  const profile = await getClinicAiProfile(clinicId);
  const conversionConfig = normalizeConversionConfig(
    profile.knowledgeBase?.conversionEngine || profile.knowledgeBase?.conversion_engine,
  );

  const row = params.profileRow || {};
  const profileId =
    params.profileId ||
    (row.id ? String(row.id) : null) ||
    (row.profile_id ? String(row.profile_id) : null);

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

  if (profileId && result.timelineEvents?.length && result.config.recordTimelineEvents) {
    void recordConversionTimelineEvents(profileId, result.timelineEvents).catch((e) => {
      console.warn("[conversionEngine] timeline:", e?.message || e);
    });
  }

  return {
    promptBlock: result.promptBlock,
    timelineEvents: result.timelineEvents || [],
    meta: {
      preset: result.config.preset,
      coordinatorIntensity: result.config.coordinatorIntensity,
      ctaStyle: result.config.ctaStyle,
      primaryNextStep: result.strategy.primaryNextStep,
      primaryGoal: result.strategy.primaryGoal,
      priorities: result.strategy.priorities,
      signals: result.analysis.signals,
    },
  };
}

module.exports = {
  buildConversionStrategyForAi,
  normalizeConversionConfig,
  recordConversionTimelineEvents,
};
