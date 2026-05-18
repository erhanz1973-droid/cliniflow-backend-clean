/**
 * Coordinator operational queues — derived only from existing flags/tags (no new taxonomy).
 */

const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");

/** @typedef {{ id: string, label: string, description: string, filterKey: string, priority: number }} QueueDef */

/** Intake / operational queue definitions (maps to applyClientIntakeFilters keys). */
const INTAKE_QUEUES = [
  {
    id: "waiting_for_quote",
    label: "Waiting for treatment estimate",
    description: "Patient submitted a quote request — clinic must prepare and send an offer.",
    filterKey: "waiting_for_quote",
    priority: 3,
  },
  {
    id: "awaiting_xray",
    label: "Waiting on X-ray",
    description: "Panoramic imaging needed before planning can continue.",
    filterKey: "awaiting_xray",
    priority: 10,
  },
  {
    id: "awaiting_photos",
    label: "Waiting on photos",
    description: "Smile or intraoral photos still needed for intake.",
    filterKey: "awaiting_photos",
    priority: 20,
  },
  {
    id: "doctor_review",
    label: "Dentist review needed",
    description: "Uploads waiting for licensed dentist review.",
    filterKey: "doctor_review",
    priority: 5,
  },
  {
    id: "human_followup",
    label: "Coordinator follow-up",
    description: "Assigned to a coordinator or awaiting a personal reply.",
    filterKey: "human_followup",
    priority: 8,
  },
  {
    id: "consultation_ready",
    label: "Ready to schedule",
    description: "Intake complete enough to book a consultation.",
    filterKey: "consultation_ready",
    priority: 40,
  },
  {
    id: "high_readiness",
    label: "Nearly complete intake",
    description: "Most intake items received — check remaining gaps.",
    filterKey: "high_readiness",
    priority: 35,
  },
  {
    id: "tag_implant",
    label: "Implant inquiries",
    description: "Patients interested in implant treatment.",
    filterKey: "tag_implant",
    priority: 50,
  },
  {
    id: "tag_cosmetic",
    label: "Veneer & cosmetic inquiries",
    description: "Patients interested in veneers, whitening, or smile goals.",
    filterKey: "tag_cosmetic",
    priority: 55,
  },
];

/** Shown first in coordinator UI — action-oriented queues only. */
const PRIMARY_QUEUE_IDS = [
  "waiting_for_quote",
  "doctor_review",
  "human_followup",
  "awaiting_xray",
  "awaiting_photos",
];

/** Collapsed under “More queues” — still same filters, no new taxonomy. */
const SECONDARY_QUEUE_IDS = [
  "consultation_ready",
  "high_readiness",
  "tag_implant",
  "tag_cosmetic",
];

/**
 * @param {Record<string, unknown>} lead enriched lead
 * @param {import('express').Query} [query]
 */
function matchesIntakeQueue(lead, query) {
  const queue = String(query?.queue || query?.q || "").trim().toLowerCase();
  if (!queue) return true;

  const flags = lead.operationalIntakeFlags || {};
  const tags = flags.patientReportedTags || [];

  switch (queue) {
    case "waiting_for_quote":
    case "proposal_pending":
    case "waiting_for_clinic_quote": {
      const ps = String(flags.proposalStatus || flags.leadStatus || "").toLowerCase();
      if (
        [
          "waiting_for_quote",
          "proposal_pending",
          "quote_in_progress",
          "doctor_review_required",
          "ready_to_send",
        ].includes(ps)
      ) {
        return true;
      }
      return Boolean(flags.treatmentRequestId) && ps !== "quote_sent";
    }
    case "awaiting_xray":
      return flags.journeyStage === "awaiting_xray" || flags.missingXray === true;
    case "awaiting_photos":
      return flags.journeyStage === "awaiting_photos" || flags.missingSmilePhotos === true;
    case "doctor_review":
      return flags.doctorReviewNeeded === true || flags.journeyStage === "doctor_review_pending";
    case "consultation_ready":
      return (flags.readinessPercent ?? 0) >= 70 || flags.journeyStage === "consultation_ready";
    case "high_readiness": {
      const pct = flags.readinessPercent ?? 0;
      return pct >= 70 || (pct >= 50 && pct < 70);
    }
    case "human_followup":
      if (flags.journeyStage === "coordinator_followup") return true;
      if (lead.coordinationMode === COORDINATION_HUMAN) return true;
      if (lead.workspaceBucket === "waiting_human") return true;
      return false;
    case "tag_implant":
    case "implant_interest":
      return tags.includes("implant_interest");
    case "tag_cosmetic":
    case "cosmetic_goal":
    case "cosmetic_goals":
      return tags.some((t) =>
        ["cosmetic_goal", "veneer_interest", "whitening_interest", "orthodontic_interest"].includes(t),
      );
    default:
      return true;
  }
}

/**
 * @param {Record<string, unknown>} flags
 */
function deriveBlockingReason(flags) {
  const f = flags || {};
  const ps = String(f.proposalStatus || "").toLowerCase();
  if (
    f.treatmentRequestId &&
    ["waiting_for_quote", "quote_in_progress", "doctor_review_required", "ready_to_send"].includes(ps)
  ) {
    if (f.coordinatorQueueTitle) return String(f.coordinatorQueueTitle);
    return "Patient waiting for treatment estimate";
  }
  if (f.doctorReviewNeeded) return "Waiting on dentist review of uploads";
  if (f.missingXray) return "Waiting on panoramic X-ray";
  if (f.missingSmilePhotos) return "Waiting on smile photos";
  if (f.missingTreatmentPreference) return "Treatment goals not confirmed";
  if (f.missingTravelTimeline) return "Travel dates not confirmed";
  if (f.journeyStageLabel) return String(f.journeyStageLabel);
  const missing = (f.readinessMissing || [])[0];
  if (missing) {
    const short = String(missing)
      .replace(/Panoramic X-ray \/ imaging \(when relevant\)/i, "panoramic X-ray")
      .replace(/Smile \/ intraoral photos/i, "smile photos")
      .replace(/Licensed dentist review of uploads/i, "dentist review")
      .replace(/Treatment goals or patient-reported concerns/i, "treatment goals");
    return `Waiting on ${short}`;
  }
  return null;
}

/**
 * One-line coordinator prompt — operational, not clinical.
 * @param {Record<string, unknown>} lead
 * @param {Record<string, unknown>} flags
 * @param {'patient'|'clinic'|'none'} waitingParty
 */
function deriveNextAction(lead, flags, waitingParty) {
  const f = flags || {};
  const ps = String(f.proposalStatus || "").toLowerCase();
  if (f.treatmentRequestId && ps === "doctor_review_required") {
    return "Review AI draft estimate and send offer";
  }
  if (f.treatmentRequestId && ["waiting_for_quote", "quote_in_progress", "ready_to_send"].includes(ps)) {
    return "Prepare and send treatment estimate";
  }
  if (f.doctorReviewNeeded) return "Route uploads to dentist review";
  if (waitingParty === "clinic" && lead.coordinationMode === COORDINATION_HUMAN) {
    return "Send clinic reply";
  }
  if (waitingParty === "clinic") return "Needs follow-up";
  if (f.missingXray) return "Request panoramic X-ray";
  if (f.missingSmilePhotos) return "Request smile photos";
  if (f.missingTreatmentPreference) return "Confirm treatment goals";
  if ((f.readinessPercent ?? 0) >= 70) return "Offer consultation scheduling";
  if (waitingParty === "patient") return "Follow up with patient";
  if (lead.aiUnresolved) return "Review case";
  return "Review when ready";
}

/**
 * @param {Record<string, unknown>} lead
 * @param {Record<string, unknown>} flags
 * @returns {'patient'|'clinic'|'none'}
 */
function deriveWaitingParty(lead, flags) {
  const f = flags || {};
  if (f.doctorReviewNeeded) return "clinic";
  if (lead.coordinationMode === COORDINATION_HUMAN) {
    const sla = lead.sla || {};
    const lp = sla.lastPatientMessageAt;
    const lh = sla.lastHumanReplyAt;
    if (lp && (!lh || new Date(lp) > new Date(lh))) return "clinic";
  }
  if (f.missingXray || f.missingSmilePhotos || f.missingTreatmentPreference) {
    return "patient";
  }
  if (f.journeyStage === "awaiting_photos" || f.journeyStage === "awaiting_xray") {
    return "patient";
  }
  return "none";
}

/**
 * @param {Record<string, unknown>} lead
 */
function enrichLeadForCoordinatorUI(lead) {
  const flags = lead.operationalIntakeFlags || {};
  const waitingParty = deriveWaitingParty(lead, flags);
  const blockingReason = deriveBlockingReason(flags);
  const missingTypes = flags.missingDocumentTypes || [];
  const tags = flags.patientReportedTags || [];

  return {
    ...lead,
    blockingReason,
    nextAction: deriveNextAction(lead, flags, waitingParty),
    waitingParty,
    waitingPartyLabel:
      waitingParty === "patient"
        ? "Ball in patient’s court"
        : waitingParty === "clinic"
          ? "Ball in clinic’s court"
          : null,
    needsReview: lead.aiUnresolved === true,
    needsAttention:
      !!blockingReason ||
      waitingParty === "clinic" ||
      !!(lead.sla && (lead.sla.isWaiting1h || lead.sla.isWaiting4h || lead.sla.isInactive24h)),
    readinessPercent: flags.readinessPercent ?? lead.readinessPercent ?? null,
    journeyStage: flags.journeyStage || lead.journeyStage || null,
    journeyStageLabel: flags.journeyStageLabel || lead.journeyStageLabel || null,
    documentCompleteness: {
      needsXray: !!flags.missingXray,
      needsPhotos: !!flags.missingSmilePhotos,
      missingTypes,
      hasTags: tags.length > 0,
    },
  };
}

/**
 * @param {Array<Record<string, unknown>>} leads
 */
function computeIntakeQueueCounts(leads) {
  const counts = {};
  for (const q of INTAKE_QUEUES) {
    counts[q.id] = 0;
  }
  for (const L of leads) {
    for (const q of INTAKE_QUEUES) {
      if (matchesIntakeQueue(L, { queue: q.id })) counts[q.id] += 1;
    }
  }
  return counts;
}

/**
 * Priority sort for coordinator scanning (lower = more urgent).
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function compareLeadsForCoordinatorInbox(a, b) {
  const score = (L) => {
    let s = 0;
    const ps = String(L.operationalIntakeFlags?.proposalStatus || "").toLowerCase();
    if (
      L.operationalIntakeFlags?.treatmentRequestId &&
      ["waiting_for_quote", "quote_in_progress", "doctor_review_required", "ready_to_send"].includes(ps)
    ) {
      s += 400;
      if ((L.operationalIntakeFlags?.proposalEscalationLevel ?? 0) >= 2) s += 200;
    }
    const sla = L.sla || {};
    if (sla.isWaiting4h) s += 1000;
    else if (sla.isWaiting1h) s += 500;
    if (L.operationalIntakeFlags?.doctorReviewNeeded) s += 200;
    if (L.waitingParty === "clinic") s += 150;
    if (L.escalationFlags?.emergency) s += 800;
    if (L.isHot) s += 80;
    return s;
  };
  const diff = score(b) - score(a);
  if (diff !== 0) return diff;
  const ra = a.readinessPercent != null ? a.readinessPercent : -1;
  const rb = b.readinessPercent != null ? b.readinessPercent : -1;
  if (rb !== ra) return rb - ra;
  return (b.leadScore != null ? b.leadScore : 0) - (a.leadScore != null ? a.leadScore : 0);
}

module.exports = {
  INTAKE_QUEUES,
  PRIMARY_QUEUE_IDS,
  SECONDARY_QUEUE_IDS,
  matchesIntakeQueue,
  deriveBlockingReason,
  deriveNextAction,
  deriveWaitingParty,
  enrichLeadForCoordinatorUI,
  computeIntakeQueueCounts,
  compareLeadsForCoordinatorInbox,
};
