/**
 * Operational document-request / intake journey stages (non-clinical).
 */

const JOURNEY_STAGES = {
  intake_started: "Intake started",
  awaiting_photos: "Awaiting smile photos",
  awaiting_xray: "Awaiting panoramic X-ray",
  doctor_review_pending: "Doctor review pending",
  coordinator_followup: "Coordinator follow-up",
  consultation_ready: "Consultation ready (operational)",
};

/**
 * @param {{
 *   flags: Record<string, unknown>,
 *   documents?: Array<unknown>,
 *   leadData?: import('./leadIntelligence').LeadData|null,
 *   profile?: { coordinationMode?: string, aiUnresolved?: boolean }|null,
 *   readinessPercent?: number,
 * }} input
 */
function computeJourneyStage(input) {
  const flags = input.flags || {};
  const profile = input.profile || {};
  const readiness = input.readinessPercent ?? 0;

  if (profile.coordinationMode === "human_active" || profile.aiUnresolved) {
    return {
      journeyStage: "coordinator_followup",
      journeyStageLabel: JOURNEY_STAGES.coordinator_followup,
    };
  }

  if (flags.doctorReviewNeeded) {
    return {
      journeyStage: "doctor_review_pending",
      journeyStageLabel: JOURNEY_STAGES.doctor_review_pending,
    };
  }

  if (flags.missingXray) {
    return {
      journeyStage: "awaiting_xray",
      journeyStageLabel: JOURNEY_STAGES.awaiting_xray,
    };
  }

  if (flags.missingSmilePhotos) {
    return {
      journeyStage: "awaiting_photos",
      journeyStageLabel: JOURNEY_STAGES.awaiting_photos,
    };
  }

  const hasGoals =
    !!(input.leadData?.treatmentInterest) || (flags.patientReportedTags || []).length > 0;

  if (readiness >= 70 && hasGoals && !flags.missingXray && !flags.doctorReviewNeeded) {
    return {
      journeyStage: "consultation_ready",
      journeyStageLabel: JOURNEY_STAGES.consultation_ready,
    };
  }

  return {
    journeyStage: "intake_started",
    journeyStageLabel: JOURNEY_STAGES.intake_started,
  };
}

module.exports = {
  JOURNEY_STAGES,
  computeJourneyStage,
};
