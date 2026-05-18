/**
 * Hybrid AI + doctor responder modes for lead conversations.
 * AI Coordinator = operational brand (not "bot").
 */

const { AI_MODE } = require("./aiDelegation");

const RESPONDER_MODE = Object.freeze({
  AI_ACTIVE: "AI_ACTIVE",
  HUMAN_ACTIVE: "HUMAN_ACTIVE",
  HYBRID: "HYBRID",
  ESCALATED: "ESCALATED",
});

const PRIMARY_RESPONDER = Object.freeze({
  AI_COORDINATOR: "ai_coordinator",
  DOCTOR: "doctor",
  SHARED_QUEUE: "shared_queue",
});

const RESPONDER_LABELS = {
  AI_ACTIVE: "AI Coordinator",
  HUMAN_ACTIVE: "Human coordinator",
  HYBRID: "Hybrid (AI drafts)",
  ESCALATED: "Needs takeover",
};

/**
 * @param {Record<string, unknown>} row
 */
function deriveResponderMode(row) {
  const aiMode = String(row.ai_mode || "").toUpperCase();
  const paused = row.ai_paused === true;
  const escalated =
    row.ai_escalation_required === true || aiMode === AI_MODE.ESCALATION_REQUIRED;

  if (escalated) return RESPONDER_MODE.ESCALATED;
  if (paused || aiMode === AI_MODE.HUMAN_ONLY) return RESPONDER_MODE.HUMAN_ACTIVE;
  if (aiMode === AI_MODE.AI_DRAFT || aiMode === AI_MODE.AI_ASSISTED) {
    return RESPONDER_MODE.HYBRID;
  }
  if (aiMode === AI_MODE.AI_ACTIVE) return RESPONDER_MODE.AI_ACTIVE;
  return RESPONDER_MODE.HYBRID;
}

/**
 * @param {string} mode
 */
function aiModeForResponderMode(mode) {
  const m = String(mode || "").toUpperCase();
  switch (m) {
    case RESPONDER_MODE.HUMAN_ACTIVE:
      return AI_MODE.HUMAN_ONLY;
    case RESPONDER_MODE.ESCALATED:
      return AI_MODE.ESCALATION_REQUIRED;
    case RESPONDER_MODE.AI_ACTIVE:
      return AI_MODE.AI_ACTIVE;
    case RESPONDER_MODE.HYBRID:
    default:
      return AI_MODE.AI_ASSISTED;
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ doctorName?: string|null }} [ctx]
 */
function derivePrimaryResponder(row, ctx = {}) {
  const explicit = String(row.primary_responder_type || "").toLowerCase();
  if (explicit === PRIMARY_RESPONDER.DOCTOR && (ctx.doctorName || row.assigned_doctor_id)) {
    return {
      type: PRIMARY_RESPONDER.DOCTOR,
      label: ctx.doctorName ? `Dr. ${ctx.doctorName}` : "Doctor",
    };
  }
  if (explicit === PRIMARY_RESPONDER.SHARED_QUEUE) {
    return { type: PRIMARY_RESPONDER.SHARED_QUEUE, label: "Shared queue" };
  }
  if (explicit === PRIMARY_RESPONDER.AI_COORDINATOR) {
    return { type: PRIMARY_RESPONDER.AI_COORDINATOR, label: "AI Coordinator" };
  }

  const responder = deriveResponderMode(row);
  if (responder === RESPONDER_MODE.HUMAN_ACTIVE || responder === RESPONDER_MODE.ESCALATED) {
    if (row.assigned_doctor_id && ctx.doctorName) {
      return { type: PRIMARY_RESPONDER.DOCTOR, label: `Dr. ${ctx.doctorName}` };
    }
    return { type: PRIMARY_RESPONDER.SHARED_QUEUE, label: "Shared queue" };
  }
  return { type: PRIMARY_RESPONDER.AI_COORDINATOR, label: "AI Coordinator" };
}

/**
 * @param {string} responderMode
 * @param {{ primaryResponderType?: string, assignedDoctorId?: string|null }} [opts]
 */
function buildResponderPatch(responderMode, opts = {}) {
  const mode = String(responderMode || "").toUpperCase();
  const aiMode = aiModeForResponderMode(mode);
  const patch = {
    responder_mode: mode,
    ai_mode: aiMode,
    updated_at: new Date().toISOString(),
  };

  if (opts.primaryResponderType) {
    patch.primary_responder_type = String(opts.primaryResponderType).toLowerCase();
  }

  if (mode === RESPONDER_MODE.ESCALATED) {
    patch.ai_escalation_required = true;
    patch.ai_paused = true;
    patch.coordination_mode = "human_active";
  } else if (mode === RESPONDER_MODE.HUMAN_ACTIVE) {
    patch.ai_paused = true;
    patch.coordination_mode = "human_active";
    patch.ai_escalation_required = false;
  } else if (mode === RESPONDER_MODE.AI_ACTIVE) {
    patch.ai_paused = false;
    patch.coordination_mode = "ai_active";
    patch.ai_escalation_required = false;
    patch.ai_unresolved = false;
  } else if (mode === RESPONDER_MODE.HYBRID) {
    patch.ai_paused = false;
    patch.coordination_mode = "ai_active";
    patch.ai_escalation_required = false;
  }

  if (opts.assignedDoctorId !== undefined) {
    patch.assigned_doctor_id = opts.assignedDoctorId;
  }

  return patch;
}

const HANDLING_STATE = Object.freeze({
  AI_HANDLING: "ai_handling",
  HUMAN_HANDLING: "human_handling",
  HYBRID: "hybrid",
  NEEDS_TAKEOVER: "needs_takeover",
  ESCALATED: "escalated",
  WAITING_FOR_DOCTOR: "waiting_for_doctor",
  WAITING_FOR_PATIENT: "waiting_for_patient",
});

const HANDLING_LABELS = {
  ai_handling: "AI handling",
  human_handling: "Human handling",
  hybrid: "Hybrid",
  needs_takeover: "Needs takeover",
  escalated: "Escalated",
  waiting_for_doctor: "Waiting for doctor",
  waiting_for_patient: "Waiting for patient",
};

/**
 * @param {Record<string, unknown>} lead
 */
function deriveHandlingState(lead) {
  const responder = lead.responderMode || deriveResponderMode(lead);
  const waiting = String(lead.waitingParty || "").toLowerCase();

  if (responder === RESPONDER_MODE.ESCALATED) {
    return HANDLING_STATE.ESCALATED;
  }
  if (responder === RESPONDER_MODE.HUMAN_ACTIVE) {
    if (lead.aiEscalationRequired) return HANDLING_STATE.NEEDS_TAKEOVER;
    return HANDLING_STATE.HUMAN_HANDLING;
  }
  if (waiting === "patient") return HANDLING_STATE.WAITING_FOR_PATIENT;
  if (waiting === "clinic" && responder !== RESPONDER_MODE.AI_ACTIVE) {
    return HANDLING_STATE.WAITING_FOR_DOCTOR;
  }
  if (responder === RESPONDER_MODE.HYBRID) return HANDLING_STATE.HYBRID;
  if (responder === RESPONDER_MODE.AI_ACTIVE) return HANDLING_STATE.AI_HANDLING;
  return HANDLING_STATE.HYBRID;
}

/**
 * @param {Record<string, unknown>} lead
 * @param {string} filterId
 */
function matchesHandlingFilter(lead, filterId) {
  const f = String(filterId || "").toLowerCase();
  if (!f) return true;
  const state = lead.handlingState || deriveHandlingState(lead);
  const responder = lead.responderMode || deriveResponderMode(lead);

  switch (f) {
    case "ai_handling":
      return state === HANDLING_STATE.AI_HANDLING || state === HANDLING_STATE.HYBRID;
    case "human_handling":
      return state === HANDLING_STATE.HUMAN_HANDLING;
    case "hybrid":
      return state === HANDLING_STATE.HYBRID || responder === RESPONDER_MODE.HYBRID;
    case "needs_takeover":
      return (
        state === HANDLING_STATE.NEEDS_TAKEOVER ||
        state === HANDLING_STATE.ESCALATED ||
        lead.needsTakeover === true
      );
    case "escalated":
      return state === HANDLING_STATE.ESCALATED || responder === RESPONDER_MODE.ESCALATED;
    case "waiting_for_doctor":
      return (
        state === HANDLING_STATE.WAITING_FOR_DOCTOR ||
        lead.aiEscalationRequired === true ||
        responder === RESPONDER_MODE.ESCALATED
      );
    case "waiting_for_patient":
      return state === HANDLING_STATE.WAITING_FOR_PATIENT || lead.waitingParty === "patient";
    default:
      return state === f;
  }
}

const HANDLING_FILTERS = [
  { id: "", label: "All handling", description: "Every responder state" },
  { id: "ai_handling", label: "AI handling", description: "AI Coordinator active or hybrid" },
  { id: "human_handling", label: "Human handling", description: "Doctor or coordinator owns replies" },
  { id: "needs_takeover", label: "Needs takeover", description: "Escalation or human review required" },
  { id: "escalated", label: "Escalated", description: "AI paused until clinician resumes" },
  { id: "waiting_for_doctor", label: "Waiting for doctor", description: "Clinic must respond" },
  { id: "waiting_for_patient", label: "Waiting for patient", description: "Patient must reply or upload" },
];

/**
 * @param {Record<string, unknown>} lead
 */
function attachResponderToLead(lead) {
  const row = {
    ai_mode: lead.aiMode,
    ai_paused: lead.aiPaused,
    ai_escalation_required: lead.aiEscalationRequired,
    assigned_doctor_id: lead.assignedDoctorId,
    primary_responder_type: lead.primaryResponderType,
  };
  const responderMode = lead.responderMode || deriveResponderMode(row);
  const primary = derivePrimaryResponder(
    { ...row, responder_mode: responderMode },
    { doctorName: lead.assignedDoctorName || lead.doctorName },
  );
  const handlingState = deriveHandlingState({
    ...lead,
    responderMode,
    waitingParty: lead.waitingParty,
  });

  return {
    ...lead,
    responderMode,
    responderModeLabel: RESPONDER_LABELS[responderMode] || responderMode,
    primaryResponder: primary,
    primaryResponderLabel: primary.label,
    handlingState,
    handlingStateLabel: HANDLING_LABELS[handlingState] || handlingState,
    isAiHandling:
      responderMode === RESPONDER_MODE.AI_ACTIVE || responderMode === RESPONDER_MODE.HYBRID,
    needsTakeover:
      responderMode === RESPONDER_MODE.ESCALATED ||
      (responderMode === RESPONDER_MODE.HUMAN_ACTIVE && lead.aiEscalationRequired),
  };
}

module.exports = {
  RESPONDER_MODE,
  PRIMARY_RESPONDER,
  RESPONDER_LABELS,
  HANDLING_STATE,
  HANDLING_LABELS,
  HANDLING_FILTERS,
  deriveResponderMode,
  aiModeForResponderMode,
  derivePrimaryResponder,
  deriveHandlingState,
  matchesHandlingFilter,
  buildResponderPatch,
  attachResponderToLead,
};
