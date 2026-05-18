/**
 * Recent coordinator chat turns for memory + repetition awareness.
 */

const { supabase } = require("./supabase");
const { trimHistoryToRecent } = require("./conversationMemory");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} messageRole
 */
function channelRoleToOpenAi(messageRole) {
  const r = String(messageRole || "").toLowerCase();
  if (r === "patient") return "user";
  return "assistant";
}

/**
 * @param {string} profileId
 * @param {number} [limit]
 */
async function fetchChannelTurns(profileId, limit = 24) {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabase
    .from("ai_coordinator_channel_messages")
    .select("message_role, body, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[coordinatorRecentHistory] channel:", error.message);
    return [];
  }
  return (data || [])
    .map((row) => ({
      role: channelRoleToOpenAi(row.message_role),
      text: String(row.body || "").trim(),
      at: row.created_at,
    }))
    .filter((t) => t.text);
}

/**
 * @param {string} profileId
 * @param {number} [limit]
 */
async function fetchTimelineTurns(profileId, limit = 24) {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabase
    .from("ai_coordinator_lead_events")
    .select("patient_message, ai_reply, event_type, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[coordinatorRecentHistory] timeline:", error.message);
    return [];
  }
  /** @type {Array<{ role: string, text: string, at?: string }>} */
  const turns = [];
  for (const ev of data || []) {
    if (ev.patient_message) {
      turns.push({
        role: "user",
        text: String(ev.patient_message).trim(),
        at: ev.created_at,
      });
    }
    if (ev.ai_reply) {
      turns.push({
        role: "assistant",
        text: String(ev.ai_reply).trim(),
        at: ev.created_at,
      });
    }
  }
  return turns.filter((t) => t.text);
}

/**
 * @param {string} profileId
 * @param {{ maxTurns?: number }} [opts]
 */
async function fetchRecentCoordinatorTurns(profileId, opts = {}) {
  const maxTurns = opts.maxTurns || 12;
  const channel = await fetchChannelTurns(profileId, maxTurns * 2);
  const turns = channel.length >= 2 ? channel : await fetchTimelineTurns(profileId, maxTurns * 2);
  return trimHistoryToRecent(
    turns.map((t) => ({ role: t.role, text: t.text })),
    maxTurns,
  );
}

/**
 * Last N assistant texts (for repetition scan).
 * @param {Array<{ role: string, text: string }>} turns
 * @param {number} [n]
 */
function recentAssistantTexts(turns, n = 4) {
  return (turns || [])
    .filter((t) => t.role === "assistant")
    .map((t) => t.text)
    .slice(-n);
}

module.exports = {
  fetchRecentCoordinatorTurns,
  recentAssistantTexts,
};
