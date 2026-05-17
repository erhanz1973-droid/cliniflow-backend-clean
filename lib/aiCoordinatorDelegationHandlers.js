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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return {
    ...lead,
    delegation,
    clinicPolicy: clinicPolicy || null,
    aiStatusLabel: delegation.statusLabel,
  };
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
      message: "Provide aiMode, uiPreset (OFF|ASSIST|ACTIVE), pauseAi, or requireDoctorReview",
    };
  }

  const clinicPolicy = await loadClinicPolicyForClinic(clinicId);
  const cappedMode = normalizeAiMode(capModeToClinicCeiling(aiMode, clinicPolicy.ceilingMode));

  const nowIso = new Date().toISOString();
  const clearEscalation =
    body.clearEscalation === true || body.clear_escalation === true;
  const patch = buildAiModePatch(cappedMode, {
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
  }
  if (body.requireDoctorReview === true && !clearEscalation) {
    patch.ai_mode = AI_MODE.ESCALATION_REQUIRED;
    patch.ai_escalation_required = true;
    patch.ai_paused = true;
    patch.coordination_mode = COORDINATION_HUMAN;
  }

  if (cappedMode === AI_MODE.HUMAN_ONLY || cappedMode === AI_MODE.ESCALATION_REQUIRED) {
    patch.human_takeover_at = nowIso;
    if (params.actorRole === "coordinator" && params.actorId) {
      patch.assigned_coordinator_id = params.actorId;
    }
    if (params.actorRole === "doctor" && params.actorId) {
      patch.assigned_doctor_id = params.actorId;
    }
  }

  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update(patch)
    .eq("id", profileId)
    .eq("clinic_id", clinicId)
    .select(
      "id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, human_takeover_at, assigned_coordinator_id, assigned_doctor_id, escalation_flags",
    )
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "update_failed", message: error.message };
  }
  if (!data) {
    return { ok: false, status: 404, error: "not_found" };
  }

  const eventType =
    cappedMode === AI_MODE.HUMAN_ONLY || cappedMode === AI_MODE.ESCALATION_REQUIRED
      ? "human_takeover"
      : "coordination_change";
  await insertTimelineEvent({
    profileId,
    eventType,
    eventMetadata: {
      aiMode: cappedMode,
      requestedMode: aiMode,
      actorRole: params.actorRole || null,
      actorId: params.actorId || null,
    },
  });

  const delegation = resolveInquiryDelegation(data, { clinicPolicy });

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
  };
}

module.exports = {
  loadClinicPolicyForClinic,
  attachDelegationToLead,
  patchInquiryDelegation,
};
