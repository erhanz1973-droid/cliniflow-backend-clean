/**
 * Shared inquiry-level AI delegation updates (admin + doctor).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const {
  AI_MODE,
  normalizeAiMode,
  aiModeFromUiPreset,
  buildAiModePatch,
  resolveInquiryDelegation,
  buildClinicPolicySummary,
  capModeToClinicCeiling,
} = require("./aiDelegation");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const {
  RESPONDER_MODE,
  PRIMARY_RESPONDER,
  RESPONDER_LABELS,
  deriveResponderMode,
  derivePrimaryResponder,
  aiModeForResponderMode,
  buildResponderPatch,
  attachResponderToLead,
} = require("./responderMode");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {{ actorRole?: string, actorId?: string|null }} params
 */
async function resolveActorLabel(params) {
  if (!params.actorId || !UUID_RE.test(String(params.actorId))) return null;
  if (params.actorRole === "doctor") {
    const { data } = await supabase
      .from("doctors")
      .select("full_name, name")
      .eq("id", params.actorId)
      .maybeSingle();
    const name = String(data?.full_name || data?.name || "").trim();
    return name ? `Dr. ${name}` : "Doctor";
  }
  return "Coordinator";
}

/**
 * @param {string} clinicId
 */
async function loadClinicPolicyForClinic(clinicId) {
  if (!UUID_RE.test(String(clinicId || ""))) {
    return buildClinicPolicySummary({ autonomy: { categories: {} } });
  }
  const profile = await getClinicAiProfile(clinicId);
  return buildClinicPolicySummary(profile);
}

/**
 * @param {Record<string, unknown>} lead
 * @param {{ ceilingMode?: string, ceilingLabel?: string }} [clinicPolicy]
 */
function attachDelegationToLead(lead, clinicPolicy) {
  const delegation = resolveInquiryDelegation(
    {
      ai_mode: lead.aiMode,
      coordination_mode: lead.coordinationMode,
      ai_paused: lead.aiPaused,
      ai_escalation_required: lead.aiEscalationRequired,
      escalation_flags: lead.escalationFlags,
      assigned_coordinator_id: lead.assignedCoordinatorId,
      assigned_doctor_id: lead.assignedDoctorId,
    },
    { clinicPolicy },
  );
  const merged = {
    ...lead,
    delegation,
    clinicPolicy: clinicPolicy || null,
    aiStatusLabel: delegation.statusLabel,
    responderMode: lead.responderMode,
    primaryResponderType: lead.primaryResponderType,
    assignedDoctorName: lead.assignedDoctorName,
  };
  return attachResponderToLead(merged);
}

/**
 * @param {string} action
 */
function normalizeAction(action) {
  const a = String(action || "")
    .trim()
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
  return a;
}

/**
 * @param {{
 *   clinicId: string,
 *   profileId: string,
 *   body: Record<string, unknown>,
 *   actorId?: string|null,
 *   actorRole?: string,
 * }} params
 */
async function patchInquiryDelegation(params) {
  const clinicId = String(params.clinicId || "").trim();
  const profileId = String(params.profileId || "").trim();
  if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
    return { ok: false, status: 400, error: "invalid_id" };
  }
  if (!isSupabaseEnabled()) {
    return { ok: false, status: 503, error: "supabase_required" };
  }

  const body = params.body || {};
  const action = normalizeAction(body.action);
  const actorLabel = await resolveActorLabel(params);
  const clinicPolicy = await loadClinicPolicyForClinic(clinicId);
  const nowIso = new Date().toISOString();
  const clearEscalation =
    body.clearEscalation === true || body.clear_escalation === true;

  let targetResponderMode =
    body.responderMode != null
      ? String(body.responderMode).toUpperCase()
      : body.responder_mode != null
        ? String(body.responder_mode).toUpperCase()
        : null;

  let primaryResponderType =
    body.primaryResponderType != null
      ? String(body.primaryResponderType).toLowerCase()
      : body.primary_responder_type != null
        ? String(body.primary_responder_type).toLowerCase()
        : null;

  if (action === "take_over" || action === "takeover") {
    targetResponderMode = RESPONDER_MODE.HUMAN_ACTIVE;
    if (params.actorRole === "doctor") {
      primaryResponderType = PRIMARY_RESPONDER.DOCTOR;
    }
  } else if (action === "pause_ai") {
    targetResponderMode = RESPONDER_MODE.HUMAN_ACTIVE;
  } else if (action === "resume_ai") {
    targetResponderMode =
      targetResponderMode && targetResponderMode !== RESPONDER_MODE.ESCALATED
        ? targetResponderMode
        : RESPONDER_MODE.HYBRID;
  } else if (action === "set_hybrid") {
    targetResponderMode = RESPONDER_MODE.HYBRID;
  } else if (action === "escalate") {
    targetResponderMode = RESPONDER_MODE.ESCALATED;
  }

  if (body.pauseAi === true || body.ai_paused === true) {
    targetResponderMode = RESPONDER_MODE.HUMAN_ACTIVE;
  }
  if (body.requireDoctorReview === true || body.ai_escalation_required === true) {
    if (!clearEscalation) targetResponderMode = RESPONDER_MODE.ESCALATED;
  }

  let patch = null;
  let timelineEvents = [];
  let requestedMode = null;

  if (targetResponderMode) {
    const cappedAiMode = capModeToClinicCeiling(
      aiModeForResponderMode(targetResponderMode),
      clinicPolicy.ceilingMode,
    );
    if (
      targetResponderMode === RESPONDER_MODE.AI_ACTIVE &&
      cappedAiMode !== AI_MODE.AI_ACTIVE
    ) {
      targetResponderMode = RESPONDER_MODE.HYBRID;
    }

    patch = buildResponderPatch(targetResponderMode, {
      primaryResponderType: primaryResponderType || undefined,
      assignedDoctorId:
        params.actorRole === "doctor" && params.actorId ? params.actorId : undefined,
    });

    if (clearEscalation) {
      patch.ai_escalation_required = false;
      patch.ai_unresolved = false;
    }

    if (
      targetResponderMode === RESPONDER_MODE.HUMAN_ACTIVE ||
      targetResponderMode === RESPONDER_MODE.ESCALATED
    ) {
      patch.human_takeover_at = nowIso;
      if (params.actorRole === "coordinator" && params.actorId) {
        patch.assigned_coordinator_id = params.actorId;
      }
      if (params.actorRole === "doctor" && params.actorId) {
        patch.assigned_doctor_id = params.actorId;
      }
    }

    requestedMode = targetResponderMode;

    if (action === "take_over" || action === "takeover") {
      timelineEvents.push({
        eventType: "human_takeover",
        meta: { actorLabel, responderMode: targetResponderMode },
      });
      if (params.actorRole === "doctor") {
        timelineEvents.push({
          eventType: "doctor_joined",
          meta: { actorLabel, doctorName: actorLabel },
        });
      }
    } else if (body.pauseAi === true || action === "pause_ai") {
      timelineEvents.push({ eventType: "ai_paused", meta: { actorLabel } });
    } else if (action === "resume_ai" || clearEscalation) {
      timelineEvents.push({
        eventType: "ai_resumed",
        meta: { actorLabel, responderMode: targetResponderMode },
      });
    } else if (targetResponderMode === RESPONDER_MODE.ESCALATED) {
      timelineEvents.push({ eventType: "escalation_detected", meta: { actorLabel } });
    } else {
      timelineEvents.push({
        eventType: "coordination_change",
        meta: {
          actorLabel,
          responderMode: targetResponderMode,
          responderModeLabel: RESPONDER_LABELS[targetResponderMode],
        },
      });
    }
  } else {
    let aiMode = null;
    if (body.aiMode != null || body.ai_mode != null) {
      aiMode = normalizeAiMode(body.aiMode ?? body.ai_mode);
    } else if (body.uiPreset != null || body.ui_preset != null) {
      aiMode = aiModeFromUiPreset(body.uiPreset ?? body.ui_preset);
    } else if (body.pauseAi === true || body.ai_paused === true) {
      aiMode = AI_MODE.HUMAN_ONLY;
    } else if (body.requireDoctorReview === true || body.ai_escalation_required === true) {
      aiMode = AI_MODE.ESCALATION_REQUIRED;
    }

    if (!aiMode) {
      return {
        ok: false,
        status: 400,
        error: "invalid_mode",
        message:
          "Provide responderMode, action (takeOver|pauseAi|resumeAi), aiMode, uiPreset, pauseAi, or requireDoctorReview",
      };
    }

    requestedMode = aiMode;
    const cappedMode = normalizeAiMode(capModeToClinicCeiling(aiMode, clinicPolicy.ceilingMode));
    patch = buildAiModePatch(cappedMode, {
      assignedCoordinatorId:
        params.actorRole === "coordinator" &&
        (cappedMode === AI_MODE.HUMAN_ONLY || cappedMode === AI_MODE.ESCALATION_REQUIRED)
          ? params.actorId || undefined
          : undefined,
      assignedDoctorId:
        params.actorRole === "doctor" ? params.actorId || undefined : undefined,
      clearEscalation,
    });

    if (body.pauseAi === true || body.ai_paused === true) {
      patch.ai_paused = true;
      patch.coordination_mode = COORDINATION_HUMAN;
      timelineEvents.push({ eventType: "ai_paused", meta: { actorLabel } });
    }
    if (body.requireDoctorReview === true && !clearEscalation) {
      patch.ai_mode = AI_MODE.ESCALATION_REQUIRED;
      patch.ai_escalation_required = true;
      patch.ai_paused = true;
      patch.coordination_mode = COORDINATION_HUMAN;
      patch.responder_mode = RESPONDER_MODE.ESCALATED;
      timelineEvents.push({ eventType: "escalation_detected", meta: { actorLabel } });
    }

    if (cappedMode === AI_MODE.HUMAN_ONLY || cappedMode === AI_MODE.ESCALATION_REQUIRED) {
      patch.human_takeover_at = nowIso;
      patch.responder_mode =
        cappedMode === AI_MODE.ESCALATION_REQUIRED
          ? RESPONDER_MODE.ESCALATED
          : RESPONDER_MODE.HUMAN_ACTIVE;
      if (params.actorRole === "coordinator" && params.actorId) {
        patch.assigned_coordinator_id = params.actorId;
      }
      if (params.actorRole === "doctor" && params.actorId) {
        patch.assigned_doctor_id = params.actorId;
      }
      timelineEvents.push({
        eventType:
          cappedMode === AI_MODE.ESCALATION_REQUIRED ? "escalation_detected" : "human_takeover",
        meta: { aiMode: cappedMode, actorLabel },
      });
    } else if (clearEscalation) {
      patch.responder_mode = RESPONDER_MODE.HYBRID;
      timelineEvents.push({ eventType: "ai_resumed", meta: { actorLabel, aiMode: cappedMode } });
    } else {
      patch.responder_mode = deriveResponderMode({
        ai_mode: cappedMode,
        ai_paused: patch.ai_paused,
        ai_escalation_required: patch.ai_escalation_required,
      });
      timelineEvents.push({
        eventType: "coordination_change",
        meta: { aiMode: cappedMode, actorLabel, responderMode: patch.responder_mode },
      });
    }
  }

  if (primaryResponderType) {
    patch.primary_responder_type = primaryResponderType;
  }

  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update(patch)
    .eq("id", profileId)
    .eq("clinic_id", clinicId)
    .select(
      "id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, human_takeover_at, assigned_coordinator_id, assigned_doctor_id, escalation_flags, responder_mode, primary_responder_type",
    )
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "update_failed", message: error.message };
  }
  if (!data) {
    return { ok: false, status: 404, error: "not_found" };
  }

  for (const ev of timelineEvents) {
    await insertTimelineEvent({
      profileId,
      eventType: ev.eventType,
      eventMetadata: ev.meta || {},
    });
  }

  const delegation = resolveInquiryDelegation(data, { clinicPolicy });
  const responderMode = data.responder_mode || deriveResponderMode(data);
  const primary = derivePrimaryResponder(
    { ...data, responder_mode: responderMode },
    { doctorName: actorLabel?.replace(/^Dr\.\s*/i, "") },
  );

  return {
    ok: true,
    coordinationMode: data.coordination_mode,
    aiMode: data.ai_mode,
    aiPaused: data.ai_paused,
    aiEscalationRequired: data.ai_escalation_required,
    humanTakeoverAt: data.human_takeover_at,
    aiDisabled: !delegation.autoReplyAllowed,
    delegation,
    clinicPolicy,
    responderMode,
    responderModeLabel: RESPONDER_LABELS[responderMode] || responderMode,
    primaryResponder: primary,
    primaryResponderLabel: primary.label,
    requestedMode,
  };
}

module.exports = {
  loadClinicPolicyForClinic,
  attachDelegationToLead,
  patchInquiryDelegation,
  resolveActorLabel,
};
