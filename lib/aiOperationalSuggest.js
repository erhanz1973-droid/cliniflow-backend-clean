/**
 * Rule-based operational reply hints for coordinator suggest-reply (non-diagnostic).
 */

/**
 * @param {Record<string, unknown>|null|undefined} flags
 * @returns {string|null}
 */
function buildOperationalSuggestHint(flags) {
  const f = flags || {};
  const tags = f.patientReportedTags || [];

  if (tags.includes("implant_interest") && f.missingXray) {
    return (
      "OPERATIONAL SUGGESTION: Patient reported implant interest; panoramic X-ray not uploaded yet. " +
      "Invite a recent panoramic X-ray for clinic coordination. Do not interpret imaging or confirm suitability."
    );
  }

  if (
    (tags.includes("veneer_interest") || tags.includes("cosmetic_goal")) &&
    f.missingSmilePhotos
  ) {
    return (
      "OPERATIONAL SUGGESTION: Cosmetic / veneer interest; smile photos missing. " +
      "Invite clear smile or intraoral photos for intake — not a diagnosis."
    );
  }

  if (f.missingTravelTimeline && (tags.includes("implant_interest") || f.readinessPercent >= 40)) {
    return (
      "OPERATIONAL SUGGESTION: Ask when they hope to travel or start visits (operational planning only)."
    );
  }

  if (f.doctorReviewNeeded) {
    return (
      "OPERATIONAL SUGGESTION: Imaging uploaded — explain a licensed dentist will review and the coordinator will follow up. No clinical interpretation."
    );
  }

  if (f.journeyStage === "consultation_ready") {
    return (
      "OPERATIONAL SUGGESTION: Intake looks reasonably complete operationally — offer to arrange a consultation with the clinic team."
    );
  }

  if (f.missingTreatmentPreference) {
    return (
      "OPERATIONAL SUGGESTION: Ask what they would like to improve or explore (patient-reported goals, not diagnosis)."
    );
  }

  return null;
}

module.exports = { buildOperationalSuggestHint };
