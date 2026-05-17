/**
 * AI visit planner — types & future extension points.
 */

/** @typedef {'draft'|'reviewed'|'approved'|'archived'} VisitPlanStatus */

/**
 * @typedef {object} VisitPlanTimelineDay
 * @property {number} day
 * @property {string} label
 * @property {string} [detail]
 * @property {string} [phase]
 */

/**
 * @typedef {object} AiVisitPlanDraftDto
 * @property {string} id
 * @property {string} clinicId
 * @property {string|null} patientId
 * @property {string|null} leadProfileId
 * @property {string|null} sessionId
 * @property {string|null} treatmentType
 * @property {number|null} proposedVisitCount
 * @property {string|null} estimatedStayDuration
 * @property {VisitPlanTimelineDay[]} draftTimeline
 * @property {string|null} aiSummary
 * @property {string|null} coordinatorNotes
 * @property {VisitPlanStatus} status
 * @property {string} generatedAt
 * @property {string|null} reviewedBy
 * @property {string|null} reviewedAt
 * @property {string} createdAt
 * @property {string} updatedAt
 */

const FUTURE_VISIT_PLAN_FEATURES = [
  "appointment_sequencing",
  "surgery_windows",
  "travel_milestones",
  "recovery_tracking",
  "coordinator_approval_workflow",
  "calendar_sync",
];

module.exports = { FUTURE_VISIT_PLAN_FEATURES };
