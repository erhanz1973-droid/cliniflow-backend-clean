/**
 * Keep coordinator replies short on chat channels (WhatsApp, Messenger, Instagram).
 */

const CHAT_CHANNELS = new Set(["whatsapp", "messenger", "instagram"]);

function isChatChannel(channel) {
  return CHAT_CHANNELS.has(String(channel || "").toLowerCase());
}

/**
 * Short, direct patient turn (e.g. "İmplant pahalı mı").
 * @param {string} message
 */
function isSimpleDirectPatientQuestion(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 140) return false;
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 2) return false;
  return true;
}

/**
 * @param {string|null|undefined} channel
 * @param {string} message
 */
function buildMessagingBrevityPromptBlock(channel, message) {
  if (!isChatChannel(channel)) return "";
  const simple = isSimpleDirectPatientQuestion(message);
  return [
    "MESSAGING BREVITY (mandatory on this chat channel):",
    "* Write like a coordinator texting — not a brochure, email, or sales script.",
    simple
      ? "* Short direct question → 2–3 sentences maximum. No bullet lists or multi-paragraph replies."
      : "* Maximum 4 short sentences unless the patient explicitly asked for a detailed explanation.",
    "* Answer ONLY what they asked this turn — one topic.",
    "* Do NOT stack in one reply: price + panoramic X-ray + Clinifly app + unrelated appointment dates + booking pitch.",
    "* Do NOT mention Clinifly app / clinic code / App Store unless they asked about the app OR your immediately previous message confirmed a new booking.",
    "* Do NOT bring up their other future appointments unless they asked about scheduling.",
    "* Skip long factor lists and filler (\"Ayrıca…\", \"Additionally…\") — be direct.",
  ].join("\n");
}

/**
 * @param {string|null|undefined} channel
 * @param {string} message
 */
function resolveCoordinatorMaxTokens(channel, message) {
  const envRaw = parseInt(process.env.AI_COORDINATOR_MAX_TOKENS || "450", 10);
  const base = Number.isFinite(envRaw) ? envRaw : 450;
  if (!isChatChannel(channel)) return base;
  if (isSimpleDirectPatientQuestion(message)) return Math.min(base, 260);
  return Math.min(base, 360);
}

module.exports = {
  isChatChannel,
  isSimpleDirectPatientQuestion,
  buildMessagingBrevityPromptBlock,
  resolveCoordinatorMaxTokens,
};
