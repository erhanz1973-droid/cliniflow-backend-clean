/**
 * Layered AI delegation — clinic policy ceiling + inquiry-level mode.
 * Humans retain ownership; AI never silently self-takes over.
 */

const { detectEscalationSignals } = require("./aiCoordinatorEscalation");

/** Legacy column values — kept in sync with aiCoordinatorCoordination. */
const COORDINATION_AI = "ai_active";
const COORDINATION_HUMAN = "human_active";

const AI_MODE = Object.freeze({
  HUMAN_ONLY: "HUMAN_ONLY",
  AI_DRAFT: "AI_DRAFT",
  AI_ASSISTED: "AI_ASSISTED",
  AI_ACTIVE: "AI_ACTIVE",
  ESCALATION_REQUIRED: "ESCALATION_REQUIRED",
});

const AI_MODE_SET = new Set(Object.values(AI_MODE));

/** Clinic-wide maximum modes (ordered permissiveness). */
const MODE_RANK = {
  HUMAN_ONLY: 0,
  ESCALATION_REQUIRED: 0,
  AI_DRAFT: 1,
  AI_ASSISTED: 2,
  AI_ACTIVE: 3,
};

/**
 * @param {string|undefined|null} raw
 */
function normalizeAiMode(raw) {
  const m = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  if (AI_MODE_SET.has(m)) return m;
  return AI_MODE.AI_ASSISTED;
}

/**
 * @param {string} coordinationMode
 */
function aiModeFromLegacyCoordination(coordinationMode) {
  return String(coordinationMode || "") === COORDINATION_HUMAN
    ? AI_MODE.HUMAN_ONLY
    : AI_MODE.AI_ASSISTED;
}

/**
 * @param {string} aiMode
 * @param {boolean} [aiPaused]
 */
function legacyCoordinationFromAiMode(aiMode, aiPaused) {
  const mode = normalizeAiMode(aiMode);
  if (mode === AI_MODE.HUMAN_ONLY || mode === AI_MODE.ESCALATION_REQUIRED || aiPaused) {
    return COORDINATION_HUMAN;
  }
  return COORDINATION_AI;
}

/**
 * Medical / emergency phrases → force escalation (no auto-reply).
 * @param {string} text
 */
function detectMedicalEmergency(text) {
  const t = String(text || "").toLowerCase();
  return (
    /\b(uncontrolled bleed|bleeding heavily|won'?t stop bleeding|hemorrhage)\b/i.test(t) ||
    /\b(can'?t breathe|difficulty breathing|shortness of breath|choking)\b/i.test(t) ||
    /\b(severe pain|unbearable pain|excruciating)\b/i.test(t) ||
    /\b(post[- ]?op complication|after surgery (pain|bleed|swell)|infection after (implant|surgery))\b/i.test(t) ||
    /\b(facial swell|swollen face|spread(?:ing)? infection)\b/i.test(t)
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} profileRow
 * @param {{ messageText?: string, escalationFlags?: Record<string, unknown> }} [ctx]
 */
function resolveInquiryDelegation(profileRow, ctx) {
  const row = profileRow || {};
  const flags =
    ctx?.escalationFlags && typeof ctx.escalationFlags === "object"
      ? ctx.escalationFlags
      : row.escalation_flags && typeof row.escalation_flags === "object"
        ? row.escalation_flags
        : {};

  let aiMode = normalizeAiMode(row.ai_mode || aiModeFromLegacyCoordination(row.coordination_mode));
  const aiPaused = row.ai_paused === true;
  let aiEscalationRequired =
    row.ai_escalation_required === true || flags.emergency === true || flags.severePain === true;

  const msg = ctx?.messageText || "";
  const signals = msg ? detectEscalationSignals(msg) : { any: false, emergency: false };
  const medicalEmergency = msg ? detectMedicalEmergency(msg) : false;

  if (medicalEmergency || signals.emergency) {
    aiMode = AI_MODE.ESCALATION_REQUIRED;
    aiEscalationRequired = true;
  } else if (aiEscalationRequired && aiMode !== AI_MODE.HUMAN_ONLY) {
    aiMode = AI_MODE.ESCALATION_REQUIRED;
  }

  if (aiPaused && aiMode !== AI_MODE.HUMAN_ONLY) {
    aiMode = AI_MODE.HUMAN_ONLY;
  }

  const autoReplyAllowed =
    !aiPaused &&
    !aiEscalationRequired &&
    (aiMode === AI_MODE.AI_ACTIVE || aiMode === AI_MODE.AI_ASSISTED);

  const draftGenerationAllowed =
    !aiPaused &&
    !aiEscalationRequired &&
    (aiMode === AI_MODE.AI_DRAFT ||
      aiMode === AI_MODE.AI_ASSISTED ||
      aiMode === AI_MODE.AI_ACTIVE);

  const statusLabel = statusLabelForMode(aiMode, aiPaused, aiEscalationRequired);

  return {
    aiMode,
    aiPaused,
    aiEscalationRequired,
    assignedCoordinatorId: row.assigned_coordinator_id || null,
    assignedDoctorId: row.assigned_doctor_id || null,
    aiAutonomyLevel: row.ai_autonomy_level || null,
    coordinationMode: legacyCoordinationFromAiMode(aiMode, aiPaused),
    autoReplyAllowed,
    draftGenerationAllowed,
    draftOnly: aiMode === AI_MODE.AI_DRAFT,
    statusLabel,
    medicalEmergencyDetected: medicalEmergency,
  };
}

/**
 * @param {string} aiMode
 * @param {boolean} aiPaused
 * @param {boolean} aiEscalationRequired
 */
function statusLabelForMode(aiMode, aiPaused, aiEscalationRequired) {
  if (aiEscalationRequired || aiMode === AI_MODE.ESCALATION_REQUIRED) return "Human review required";
  if (aiPaused || aiMode === AI_MODE.HUMAN_ONLY) return "Human only";
  if (aiMode === AI_MODE.AI_DRAFT) return "AI draft only";
  if (aiMode === AI_MODE.AI_ACTIVE) return "AI coordinating";
  if (aiMode === AI_MODE.AI_ASSISTED) return "AI assisting";
  return "Human only";
}

/**
 * Patch fields when escalation is detected on an inbound patient message.
 * @param {Record<string, unknown>} flags json escalation_flags
 * @param {string} [messageText]
 */
function buildEscalationPatch(flags, messageText) {
  const f = flags && typeof flags === "object" ? flags : {};
  const signals = messageText ? detectEscalationSignals(messageText) : { emergency: false };
  const medical = messageText ? detectMedicalEmergency(messageText) : false;
  const force = medical || f.emergency === true || signals.emergency;

  if (!force) return null;

  return {
    ai_mode: AI_MODE.ESCALATION_REQUIRED,
    ai_escalation_required: true,
    ai_paused: true,
    coordination_mode: COORDINATION_HUMAN,
    ai_unresolved: true,
    updated_at: new Date().toISOString(),
  };
}

/**
 * DB patch for coordinator/doctor setting inquiry AI mode.
 * @param {string} aiMode
 * @param {{ assignedCoordinatorId?: string|null, assignedDoctorId?: string|null, clearEscalation?: boolean }} [opts]
 */
function buildAiModePatch(aiMode, opts) {
  const mode = normalizeAiMode(aiMode);
  const patch = {
    ai_mode: mode,
    coordination_mode: legacyCoordinationFromAiMode(mode, false),
    updated_at: new Date().toISOString(),
  };

  if (mode === AI_MODE.HUMAN_ONLY) {
    patch.ai_paused = true;
    patch.coordination_mode = COORDINATION_HUMAN;
  } else if (mode === AI_MODE.ESCALATION_REQUIRED) {
    patch.ai_paused = true;
    patch.ai_escalation_required = true;
    patch.coordination_mode = COORDINATION_HUMAN;
  } else {
    patch.ai_paused = false;
    if (opts?.clearEscalation) {
      patch.ai_escalation_required = false;
      patch.ai_unresolved = false;
    }
  }

  if (opts?.assignedCoordinatorId !== undefined) {
    patch.assigned_coordinator_id = opts.assignedCoordinatorId;
  }
  if (opts?.assignedDoctorId !== undefined) {
    patch.assigned_doctor_id = opts.assignedDoctorId;
  }

  return patch;
}

/**
 * Cap inquiry mode to clinic ceiling (future: per-category). For now returns inquiry mode.
 * @param {string} inquiryMode
 * @param {string} [clinicCeilingMode]
 */
function capModeToClinicCeiling(inquiryMode, clinicCeilingMode) {
  const inquiry = normalizeAiMode(inquiryMode);
  const ceiling = normalizeAiMode(clinicCeilingMode || AI_MODE.AI_ACTIVE);
  const ir = MODE_RANK[inquiry] ?? 2;
  const cr = MODE_RANK[ceiling] ?? 3;
  if (ir <= cr) return inquiry;
  const entries = Object.entries(MODE_RANK).sort((a, b) => a[1] - b[1]);
  for (const [key, rank] of entries) {
    if (rank === cr) return key;
  }
  return AI_MODE.AI_ASSISTED;
}

module.exports = {
  AI_MODE,
  AI_MODE_SET,
  normalizeAiMode,
  aiModeFromLegacyCoordination,
  legacyCoordinationFromAiMode,
  detectMedicalEmergency,
  resolveInquiryDelegation,
  buildEscalationPatch,
  buildAiModePatch,
  capModeToClinicCeiling,
  statusLabelForMode,
};
