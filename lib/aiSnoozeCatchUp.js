/**
 * After doctor AI snooze ends, inbound replies must include live chat the AI missed.
 */

const { getAiSnoozeUntilMs } = require("./aiDelegation");

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readOperationalFlags(flags) {
  return flags && typeof flags === "object" ? flags : {};
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function needsSnoozeCatchUp(flags) {
  const f = readOperationalFlags(flags);
  if (f.ai_snooze_catchup_done === true || f.aiSnoozeCatchupDone === true) return false;
  const startedRaw = f.ai_snooze_started_at || f.aiSnoozeStartedAt;
  if (!startedRaw) return false;
  const untilMs = getAiSnoozeUntilMs({ operational_intake_flags: f });
  if (untilMs != null && Date.now() < untilMs) return false;
  return true;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function snoozeCatchUpSinceIso(flags) {
  const f = readOperationalFlags(flags);
  const started = f.ai_snooze_started_at || f.aiSnoozeStartedAt;
  return started ? String(started).trim() : null;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {string} [nowIso]
 */
function buildSnoozeCatchUpDoneFlags(flags, nowIso) {
  const f = readOperationalFlags(flags);
  const ts = nowIso || new Date().toISOString();
  return {
    ...f,
    ai_snooze_catchup_done: true,
    ai_snooze_catchup_at: ts,
  };
}

/**
 * @param {Array<{ role: string, text: string, source?: string }>} turns
 * @param {string} [lang]
 */
function buildSnoozeCatchUpPromptBlock(turns, lang = "tr") {
  const list = Array.isArray(turns) ? turns.filter((t) => String(t.text || "").trim()) : [];
  if (!list.length) return "";

  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const header =
    key === "tr"
      ? "ÖNEMLİ — AI susturulduğu sürede doktor ve hasta şunları konuştu (bunu mutlaka oku):"
      : "IMPORTANT — While the AI was paused, the doctor and patient discussed the following (you MUST read this):";

  const lines = list.map((t) => {
    const role = String(t.role || "").toLowerCase();
    const text = String(t.text || "").trim().slice(0, 500);
    if (role === "patient" || role === "user") {
      return key === "tr" ? `Hasta: ${text}` : `Patient: ${text}`;
    }
    if (role === "doctor" || role === "human") {
      return key === "tr" ? `Doktor: ${text}` : `Doctor: ${text}`;
    }
    return key === "tr" ? `Klinik: ${text}` : `Clinic: ${text}`;
  });

  const footer =
    key === "tr"
      ? "Yanıtında bu konuşmayı dikkate al; doktorun söylediklerini tekrarlama, çelişme veya görmezden gelme."
      : "Use this in your reply; do not contradict or ignore what the doctor already told the patient.";

  return `${header}\n${lines.join("\n")}\n\n${footer}`;
}

module.exports = {
  needsSnoozeCatchUp,
  snoozeCatchUpSinceIso,
  buildSnoozeCatchUpDoneFlags,
  buildSnoozeCatchUpPromptBlock,
};
