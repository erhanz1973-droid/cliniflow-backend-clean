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
  waiting_for_consultation: "Waiting for consultation",
  appointment_scheduled: "Appointment scheduled",
  consultation_completed: "Consultation completed",
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

  if (flags.journeyStage === "consultation_completed") {
    return {
      journeyStage: "consultation_completed",
      journeyStageLabel: JOURNEY_STAGES.consultation_completed,
    };
  }

  const activeAppt =
    flags.activeAppointment && typeof flags.activeAppointment === "object"
      ? flags.activeAppointment
      : null;
  if (activeAppt?.startAt || flags.appointmentScheduled === true) {
    const startTs = activeAppt?.startAt ? Date.parse(String(activeAppt.startAt)) : NaN;
    if (Number.isFinite(startTs) && startTs < Date.now() - 3 * 60 * 60 * 1000) {
      return {
        journeyStage: "waiting_for_consultation",
        journeyStageLabel: JOURNEY_STAGES.waiting_for_consultation,
      };
    }
    return {
      journeyStage: "appointment_scheduled",
      journeyStageLabel: JOURNEY_STAGES.appointment_scheduled,
    };
  }

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
