/**
 * Rolling memory for AI coordinator — summary + last N turns (no full history to OpenAI).
 */

const MAX_RECENT_TURNS = Math.min(
  12,
  Math.max(2, parseInt(process.env.AI_COORDINATOR_MAX_RECENT_TURNS || "8", 10) || 8),
);
const MAX_SUMMARY_CHARS = Math.min(
  2000,
  Math.max(200, parseInt(process.env.AI_COORDINATOR_MAX_SUMMARY_CHARS || "1200", 10) || 1200),
);

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeConversationSummary(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "none") return "";
  return s.slice(0, MAX_SUMMARY_CHARS);
}

/**
 * Keep only the most recent turns (each user/assistant line = 1 turn).
 * @param {Array<{ role: string, text: string }>} turns
 * @param {number} [max]
 */
function trimHistoryToRecent(turns, max = MAX_RECENT_TURNS) {
  if (!Array.isArray(turns) || !turns.length) return [];
  return turns.slice(-max);
}

/**
 * @param {{ conversationSummary?: string|null, recentTurns?: Array<{ role: string, text: string }> }} params
 * @returns {string|null}
 */
function buildMemoryPreamble({ conversationSummary, recentTurns }) {
  const summary = normalizeConversationSummary(conversationSummary);
  const recent = Array.isArray(recentTurns) ? recentTurns.length : 0;
  if (!summary && recent === 0) return null;

  const lines = ["[Coordinator memory — internal context, not shown to the patient]"];
  if (summary) {
    lines.push(`Rolling summary of earlier conversation:\n${summary}`);
  } else {
    lines.push("Rolling summary: (none yet — this is an early conversation.)");
  }
  lines.push(
    `Only the last ${MAX_RECENT_TURNS} messages below include recent detail; rely on the summary for older context.`,
  );
  return lines.join("\n\n");
}

const MEMORY_POLICY_PROMPT = `
Conversation memory policy:
* You receive a rolling conversationSummary (may be empty) plus at most the last ${MAX_RECENT_TURNS} chat turns — never assume you have the full transcript.
* Each response MUST include an updated conversationSummary: one concise paragraph (max ~120 words) merging prior summary with new facts (goals, country, timeline, budget, concerns). Omit greetings and filler.
* Do not repeat the summary text inside reply — reply is only what the patient reads.
* Track what you already explained in recent turns (pricing, brands, CTAs, reassurance, clinic team size) — advance the dialogue instead of looping the same blocks.
* On thanks, good evening, or other short social messages only: reply briefly (1–2 sentences) without re-stating facts you already gave.`;

module.exports = {
  MAX_RECENT_TURNS,
  MAX_SUMMARY_CHARS,
  MEMORY_POLICY_PROMPT,
  normalizeConversationSummary,
  trimHistoryToRecent,
  buildMemoryPreamble,
};
