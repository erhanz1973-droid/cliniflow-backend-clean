/**
 * Coordinator operational queues — derived only from existing flags/tags (no new taxonomy).
 */

const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const {
  formatBlockingReason,
  formatNextAction,
  localizeLeadLabels,
} = require("./i18n/localizeCoordination");
const { normalizeUiLang, t } = require("./i18n/coordinationLocales");

/** @typedef {{ id: string, label: string, description: string, filterKey: string, priority: number }} QueueDef */

/** Intake / operational queue definitions (maps to applyClientIntakeFilters keys). */
const INTAKE_QUEUES = [
  {
    id: "coordinator_responded",
    label: "Clinic engaged",
    description: "AI or coordinator replied — patient is in active coordination.",
    filterKey: "coordinator_responded",
    priority: 6,
  },
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
    id: "appointment_scheduled",
    label: "Appointment scheduled",
    description: "Consultation or visit booked — prepare for arrival.",
    filterKey: "appointment_scheduled",
    priority: 2,
  },
  {
    id: "waiting_for_consultation",
    label: "Waiting for consultation",
    description: "Upcoming clinic visit — confirm logistics if needed.",
    filterKey: "waiting_for_consultation",
    priority: 4,
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
  "appointment_scheduled",
  "waiting_for_consultation",
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
    case "coordinator_responded":
      return (
        String(flags.operationalStatus || "").toLowerCase() === "coordinator_responded" ||
        String(flags.proposalStatus || "").toLowerCase() === "coordinator_responded"
      );
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
    case "appointment_scheduled":
      return (
        flags.journeyStage === "appointment_scheduled" ||
        flags.appointmentScheduled === true ||
        !!(flags.activeAppointment && flags.activeAppointment.startAt)
      );
    case "waiting_for_consultation":
      return flags.journeyStage === "waiting_for_consultation" || flags.waitingForConsultation === true;
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
 * @param {string} raw
 * @returns {{ itemKey: string|null, item?: string }}
 */
function readinessMissingMeta(raw) {
  const s = String(raw || "");
  if (/panoramic|x-ray|imaging/i.test(s)) return { itemKey: "panoramic_xray" };
  if (/smile|intraoral|photo/i.test(s)) return { itemKey: "smile_photos" };
  if (/dentist review/i.test(s)) return { itemKey: "dentist_review" };
  if (/treatment goals/i.test(s)) return { itemKey: "treatment_goals" };
  const short = s
    .replace(/Panoramic X-ray \/ imaging \(when relevant\)/i, "panoramic X-ray")
    .replace(/Smile \/ intraoral photos/i, "smile photos")
    .replace(/Licensed dentist review of uploads/i, "dentist review")
    .replace(/Treatment goals or patient-reported concerns/i, "treatment goals");
  return { itemKey: null, item: short };
}

/**
 * @param {Record<string, unknown>} flags
 * @returns {Record<string, unknown>|null}
 */
function deriveBlockingReasonMeta(flags) {
  const f = flags || {};
  const ps = String(f.proposalStatus || "").toLowerCase();
  if (
    f.treatmentRequestId &&
    ["waiting_for_quote", "quote_in_progress", "doctor_review_required", "ready_to_send"].includes(ps)
  ) {
    if (f.coordinatorQueueTitle) {
      return { key: "coordinator_queue", title: String(f.coordinatorQueueTitle) };
    }
    return { key: "treatment_estimate_waiting" };
  }
  if (f.doctorReviewNeeded) return { key: "dentist_review_uploads" };
  if (f.missingXray) return { key: "panoramic_xray" };
  if (f.missingSmilePhotos) return { key: "smile_photos" };
  if (f.missingTreatmentPreference) return { key: "treatment_goals" };
  if (f.missingTravelTimeline) return { key: "travel_dates" };
  if (f.journeyStageLabel) return { key: "journey_stage", stage: String(f.journeyStageLabel) };
  const missing = (f.readinessMissing || [])[0];
  if (missing) {
    const meta = readinessMissingMeta(missing);
    return { key: "readiness_missing", ...meta };
  }
  return null;
}

/**
 * @param {Record<string, unknown>} flags
 */
function deriveBlockingReason(flags) {
  return formatBlockingReason(deriveBlockingReasonMeta(flags), "en");
}

/**
 * @param {Record<string, unknown>} lead
 * @param {Record<string, unknown>} flags
 * @param {'patient'|'clinic'|'none'} waitingParty
 * @returns {string|null}
 */
function deriveNextActionKey(lead, flags, waitingParty) {
  const f = flags || {};
  const ps = String(f.proposalStatus || "").toLowerCase();
  if (f.treatmentRequestId && ps === "doctor_review_required") {
    return "review_estimate_send";
  }
  if (f.treatmentRequestId && ["waiting_for_quote", "quote_in_progress", "ready_to_send"].includes(ps)) {
    return "prepare_estimate";
  }
  if (f.doctorReviewNeeded) return "route_dentist_review";
  if (waitingParty === "clinic" && lead.coordinationMode === COORDINATION_HUMAN) {
    return "send_clinic_reply";
  }
  if (waitingParty === "clinic") return "needs_follow_up";
  if (f.missingXray) return "request_panoramic_xray";
  if (f.missingSmilePhotos) return "request_smile_photos";
  if (f.missingTreatmentPreference) return "confirm_treatment_goals";
  if ((f.readinessPercent ?? 0) >= 70) return "offer_consultation";
  if (waitingParty === "patient") return "follow_up_patient";
  if (lead.aiUnresolved) return "review_case";
  return "review_when_ready";
}

/**
 * One-line coordinator prompt — operational, not clinical.
 * @param {Record<string, unknown>} lead
 * @param {Record<string, unknown>} flags
 * @param {'patient'|'clinic'|'none'} waitingParty
 */
function deriveNextAction(lead, flags, waitingParty) {
  return formatNextAction(deriveNextActionKey(lead, flags, waitingParty), "en");
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
 * @param {string} [lang]
 */
const { formatPreparationSummaryForUI } = require("./patientPreparationIntake");

function enrichLeadForCoordinatorUI(lead, lang = "en") {
  const L = normalizeUiLang(lang);
  const flags = lead.operationalIntakeFlags || {};
  const preparationSummary = formatPreparationSummaryForUI(flags.conversationalIntake);
  const waitingParty = deriveWaitingParty(lead, flags);
  const blockingMeta = deriveBlockingReasonMeta(flags);
  const nextKey = deriveNextActionKey(lead, flags, waitingParty);
  const missingTypes = flags.missingDocumentTypes || [];
  const tags = flags.patientReportedTags || [];

  const primaryChannel = String(
    lead.primaryChannel || lead.primary_channel || "in_app",
  )
    .trim()
    .toLowerCase();
  const channelLabels = {
    messenger: "Messenger",
    instagram: "Instagram",
    whatsapp: "WhatsApp",
    in_app: "In-app",
    patient_chat: "Patient chat",
    offer_chat: "Offer chat",
  };

  const enriched = {
    ...lead,
    primaryChannel,
    channelBadge: channelLabels[primaryChannel] || primaryChannel.replace(/_/g, " "),
    channelIsExternal: ["messenger", "instagram", "whatsapp", "sms"].includes(primaryChannel),
    blockingReason: formatBlockingReason(blockingMeta, L),
    nextAction: formatNextAction(nextKey, L),
    waitingParty,
    waitingPartyLabel:
      waitingParty === "patient"
        ? t(L, "ops.waitingParty.patient")
        : waitingParty === "clinic"
          ? t(L, "ops.waitingParty.clinic")
          : null,
    needsReview: lead.aiUnresolved === true,
    needsAttention:
      !!blockingMeta ||
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
    conversationalIntake: flags.conversationalIntake || null,
    preparationSummary,
  };

  return localizeLeadLabels(enriched, L);
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
  const activityMs = (L) => {
    const at =
      L.lastPatientMessageAt ||
      L.last_patient_message_at ||
      L.lastChannelMessageAt ||
      L.last_channel_message_at ||
      L.updatedAt ||
      L.updated_at;
    const ms = at != null ? Date.parse(String(at)) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  };
  const actDiff = activityMs(b) - activityMs(a);
  if (actDiff !== 0) return actDiff;
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
  deriveBlockingReasonMeta,
  deriveBlockingReason,
  deriveNextActionKey,
  deriveNextAction,
  deriveWaitingParty,
  enrichLeadForCoordinatorUI,
  computeIntakeQueueCounts,
  compareLeadsForCoordinatorInbox,
};
