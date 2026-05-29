/**
 * GREETING_INTENT — short, warm replies for greeting-only patient messages (TR / EN / KA).
 */

const GREETING_ONLY_RES = [
  /^(?:merhaba|selam|selamlar|günaydın|gunaydin|iyi\s+akşamlar|iyi\s+aksamlar|iyi\s+geceler)(?:[\s!.?,…—-]|$)*$/iu,
  /^(?:hello|hi|hey|good\s+morning|good\s+evening|good\s+night)(?:[\s!.?,…—-]|$)*$/iu,
  /^(?:გამარჯობა|მოგესალმებით|დილა\s*მშვიდობისა|gamarjoba|mogesalmebit)(?:[\s!.?,…—-]|$)*$/iu,
];

const GEORGIAN_SCRIPT_RE = /[\u10A0-\u10FF]/;

/**
 * Message is only a greeting (no treatment / booking question in the same line).
 * @param {string} text
 */
function isGreetingOnlyMessage(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 64) return false;
  return GREETING_ONLY_RES.some((re) => re.test(t));
}

/**
 * @param {string} text
 * @returns {"tr"|"en"|"ka"}
 */
function detectGreetingLanguage(text) {
  const t = String(text || "").trim();
  if (GEORGIAN_SCRIPT_RE.test(t) || /\b(gamarjoba|mogesalmebit)\b/i.test(t)) {
    return "ka";
  }
  if (
    /[çğıöşüÇĞİÖŞÜ]/.test(t) ||
    /\b(merhaba|selam|selamlar|günaydın|gunaydin|iyi\s+akşamlar|iyi\s+geceler)\b/i.test(t)
  ) {
    return "tr";
  }
  if (/\b(hello|hi|hey|good\s+morning|good\s+evening|good\s+night)\b/i.test(t)) {
    return "en";
  }
  return "tr";
}

/**
 * @param {"tr"|"en"|"ka"|string} lang
 */
function greetingReplyForLanguage(lang) {
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  if (code === "ka") {
    return "გამარჯობა! რით შემიძლია დაგეხმაროთ?";
  }
  if (code === "en") {
    return "Hello! How can I help you today?";
  }
  return "Merhaba! Size nasıl yardımcı olabilirim?";
}

/**
 * @param {string} patientMessage
 * @param {string} [preferredLang] conversation language hint
 */
function buildGreetingDirectReply(patientMessage, preferredLang) {
  const fromMessage = detectGreetingLanguage(patientMessage);
  const pref = String(preferredLang || "").slice(0, 2).toLowerCase();
  const lang =
    pref === "ka" || pref === "en" || pref === "tr" ? pref : fromMessage;
  return greetingReplyForLanguage(lang);
}

/**
 * Prompt block when greeting-only (backup if model is invoked).
 * @param {string} patientMessage
 * @param {string} [lang]
 */
function buildGreetingIntentPromptBlock(patientMessage, lang) {
  if (!isGreetingOnlyMessage(patientMessage)) return "";
  const example = buildGreetingDirectReply(patientMessage, lang);
  return (
    "GREETING_INTENT (mandatory — patient sent only a greeting):\n" +
    "* Reply in 1–2 short, warm sentences in the patient's language.\n" +
    "* Do NOT list appointment slots, prices, WhatsApp collection, or clinic facts.\n" +
    "* Do NOT use a long introduction.\n" +
    `* Example tone (adapt naturally): ${example}`
  );
}

module.exports = {
  isGreetingOnlyMessage,
  detectGreetingLanguage,
  buildGreetingDirectReply,
  buildGreetingIntentPromptBlock,
};
