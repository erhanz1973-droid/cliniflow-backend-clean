/**
 * Treatment journey intelligence — types & future extension points.
 */

/** Suggested treatment slugs for admin UI. */
const SUGGESTED_TREATMENT_TYPES = [
  { value: "implant", label: "Implant" },
  { value: "full_mouth_implant", label: "Full mouth implant" },
  { value: "veneers", label: "Veneers" },
  { value: "crowns", label: "Crowns" },
  { value: "aligners", label: "Aligners" },
  { value: "whitening", label: "Whitening" },
];

/**
 * @typedef {object} ClinicTreatmentProtocolDto
 * @property {string} id
 * @property {string} clinicId
 * @property {string} treatmentType
 * @property {number|null} typicalVisitCount
 * @property {string|null} estimatedStayDuration
 * @property {string|null} secondVisitAfter
 * @property {string|null} healingNotes
 * @property {string|null} postOpNotes
 * @property {boolean} xrayRequired
 * @property {boolean} temporaryTeethPossible
 * @property {string|null} languages
 * @property {string|null} aiNotes
 * @property {boolean} isActive
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** Future capabilities — not implemented yet. */
const FUTURE_JOURNEY_FEATURES = [
  "procedure_stages",
  "recovery_milestones",
  "medication_reminders",
  "coordinator_checklists",
  "travel_timeline_builder",
  "appointment_sequencing",
  "post_op_follow_up_plans",
];

module.exports = {
  SUGGESTED_TREATMENT_TYPES,
  FUTURE_JOURNEY_FEATURES,
};
