/**
 * GREETING_INTENT — short, warm replies for greeting-only patient messages (TR / EN / KA).
 */

const GREETING_ONLY_RES = [
  /^(?:merhaba|selam|selamlar|günaydın|gunaydin|iyi\s+akşamlar|iyi\s+aksamlar|iyi\s+geceler)(?:[\s!.?,…—-]|$)*$/iu,
  /^(?:hello|hi|hey|good\s+morning|good\s+evening|good\s+night)(?:[\s!.?,…—-]|$)*$/iu,
  /^(?:გამარჯობა|მოგესალმებით|დილა\s*მშვიდობისა|gamarjoba|mogesalmebit)(?:[\s!.?,…—-]|$)*$/iu,
];

const GEORGIAN_SCRIPT_RE = /[\u10A0-\u10FF]/;

/** Turkish İ / dotted i — default toLowerCase breaks «İyi geceler» matching. */
function normalizeForIntentMatch(text) {
  return String(text || "")
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip emoji / symbols so «Merhaba ☀️» still counts as greeting-only. */
function stripGreetingDecorations(text) {
  return String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]/gu, "")
    .trim();
}

/**
 * Message is only a greeting (no treatment / booking question in the same line).
 * @param {string} text
 */
function isGreetingOnlyMessage(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 64) return false;
  const t = normalizeForIntentMatch(stripGreetingDecorations(raw));
  return GREETING_ONLY_RES.some((re) => re.test(t));
}

/**
 * @param {string} text
 * @returns {"tr"|"en"|"ka"}
 */
function detectGreetingLanguage(text) {
  const raw = String(text || "").trim();
  const t = normalizeForIntentMatch(raw);
  if (GEORGIAN_SCRIPT_RE.test(raw) || /\b(gamarjoba|mogesalmebit)\b/i.test(t)) {
    return "ka";
  }
  if (
    /[çğıöşüÇĞİÖŞÜ]/.test(raw) ||
    /\b(merhaba|selam|selamlar|gunaydin|iyi\s+aksam|iyi\s+gece)\b/.test(t)
  ) {
    return "tr";
  }
  if (/\b(hello|hi|hey|good\s+morning|good\s+evening|good\s+night)\b/.test(t)) {
    return "en";
  }
  return "tr";
}

/**
 * Echo the patient's greeting word (Merhaba / Selam / Hello …).
 * @param {string} patientMessage
 * @param {"tr"|"en"|"ka"|string} lang
 */
function echoPatientGreeting(patientMessage, lang) {
  const t = normalizeForIntentMatch(stripGreetingDecorations(patientMessage));
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  if (/^selam/.test(t)) {
    if (code === "ka") return "გამარჯობა";
    if (code === "en") return "Hi";
    return "Selam";
  }
  if (/^merhaba/.test(t)) {
    if (code === "en") return "Hello";
    return "Merhaba";
  }
  if (/^günaydın|^gunaydin/.test(t)) {
    if (code === "en") return "Good morning";
    return "Günaydın";
  }
  if (/^hello|^hi\b|^hey\b/.test(t)) {
    if (code === "tr") return "Merhaba";
    if (code === "ka") return "გამარჯობა";
    return "Hello";
  }
  if (GEORGIAN_SCRIPT_RE.test(String(patientMessage || ""))) return "გამარჯობა";
  if (code === "en") return "Hello";
  if (code === "ka") return "გამარჯობა";
  return "Merhaba";
}

/**
 * @param {"tr"|"en"|"ka"|string} lang
 * @param {string} [patientMessage]
 */
function greetingReplyForLanguage(lang, patientMessage = "") {
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  const greet = patientMessage ? echoPatientGreeting(patientMessage, code) : null;
  if (code === "ka") {
    return `${greet || "გამარჯობა"}! რით შემიძლია დაგეხმაროთ?`;
  }
  if (code === "en") {
    return `${greet || "Hello"}! How can I help you today?`;
  }
  return `${greet || "Merhaba"}! Size nasıl yardımcı olabilirim?`;
}

/**
 * @param {string} patientMessage
 * @param {string} [preferredLang] conversation language hint
 * @param {{ bookingContinuity?: boolean }} [options]
 */
function buildGreetingDirectReply(patientMessage, preferredLang, options = {}) {
  const t = normalizeForIntentMatch(patientMessage);
  const fromMessage = detectGreetingLanguage(patientMessage);
  const pref = String(preferredLang || "").slice(0, 2).toLowerCase();
  const lang =
    pref === "ka" || pref === "en" || pref === "tr" ? pref : fromMessage;
  const greet = echoPatientGreeting(patientMessage, lang);
  const bookingContinuity = options?.bookingContinuity === true;

  if (/iyi\s+gece|good\s+night/.test(t)) {
    if (lang === "ka") return "ღამე მშვიდობისა! სხვა კითხვა გაქვთ — მოგვწერეთ.";
    if (lang === "en") return "Good night! Message us anytime if you need anything.";
    return "İyi geceler! Başka bir sorunuz olursa yazabilirsiniz.";
  }
  if (/iyi\s+aksam|good\s+evening/.test(t)) {
    if (lang === "ka") return "საღამო მშვიდობისა! რით შემიძლია დაგეხმაროთ?";
    if (lang === "en") return "Good evening! How can I help you?";
    return "İyi akşamlar! Size nasıl yardımcı olabilirim?";
  }

  if (bookingContinuity) {
    if (lang === "ka") {
      return `${greet}! ჩაწერაზე გაგრძელებით დაგეხმარებით — აირჩიეთ შეთავაზებული დრო ან დაგვიწერეთ სასურველი დღე/საათი.`;
    }
    if (lang === "en") {
      return `${greet}! I can keep helping with your appointment — pick a time we offered or suggest another day.`;
    }
    return `${greet}! Randevu için size yardımcı olmaya devam edebilirim — paylaştığımız saatlerden birini seçebilir veya uygun bir gün/saat yazabilirsiniz.`;
  }

  return greetingReplyForLanguage(lang, patientMessage);
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
    "* Mirror the patient's greeting (e.g. they wrote Merhaba → start with Merhaba, not only Tamam or OK).\n" +
    "* Do NOT use a long introduction.\n" +
    `* Example tone (adapt naturally): ${example}`
  );
}

module.exports = {
  normalizeForIntentMatch,
  isGreetingOnlyMessage,
  detectGreetingLanguage,
  echoPatientGreeting,
  buildGreetingDirectReply,
  buildGreetingIntentPromptBlock,
};
