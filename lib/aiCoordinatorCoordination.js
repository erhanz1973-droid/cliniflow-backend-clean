/**
 * Coordination mode — AI vs human takeover per lead session.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const COORDINATION_AI = "ai_active";
const COORDINATION_HUMAN = "human_active";

/**
 * @param {string} sessionId
 * @returns {Promise<{ coordinationMode: string, profileId?: string } | null>}
 */
async function loadCoordinationBySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid || !isSupabaseEnabled()) return null;

  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, coordination_mode")
    .eq("session_id", sid)
    .maybeSingle();

  if (error || !data) return null;
  return {
    profileId: data.id,
    coordinationMode: String(data.coordination_mode || COORDINATION_AI),
  };
}

/**
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function isAiAutoReplyEnabled(sessionId) {
  const row = await loadCoordinationBySession(sessionId);
  if (!row) return true;
  return row.coordinationMode !== COORDINATION_HUMAN;
}

module.exports = {
  COORDINATION_AI,
  COORDINATION_HUMAN,
  loadCoordinationBySession,
  isAiAutoReplyEnabled,
};
