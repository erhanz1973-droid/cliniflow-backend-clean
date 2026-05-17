/**
 * Coordination mode — AI vs human takeover per lead session.
 * Delegation layer (ai_mode) is source of truth when present.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { resolveInquiryDelegation } = require("./aiDelegation");

const COORDINATION_AI = "ai_active";
const COORDINATION_HUMAN = "human_active";

/**
 * @param {string} sessionId
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function loadProfileBySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid || !isSupabaseEnabled()) return null;

  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, assigned_coordinator_id, assigned_doctor_id",
    )
    .eq("session_id", sid)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ coordinationMode: string, profileId?: string, delegation?: ReturnType<typeof resolveInquiryDelegation> } | null>}
 */
async function loadCoordinationBySession(sessionId) {
  const data = await loadProfileBySession(sessionId);
  if (!data) return null;
  const delegation = resolveInquiryDelegation(data);
  return {
    profileId: data.id,
    coordinationMode: delegation.coordinationMode,
    delegation,
  };
}

/**
 * Patient-facing auto-reply allowed (never when paused / escalation / human only).
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function isAiAutoReplyEnabled(sessionId) {
  const row = await loadProfileBySession(sessionId);
  if (!row) return true;
  return resolveInquiryDelegation(row).autoReplyAllowed;
}

/**
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function isAiDraftGenerationEnabled(sessionId) {
  const row = await loadProfileBySession(sessionId);
  if (!row) return true;
  return resolveInquiryDelegation(row).draftGenerationAllowed;
}

module.exports = {
  COORDINATION_AI,
  COORDINATION_HUMAN,
  loadProfileBySession,
  loadCoordinationBySession,
  isAiAutoReplyEnabled,
  isAiDraftGenerationEnabled,
};
