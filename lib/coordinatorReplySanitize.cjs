/**
 * Prevent empty JSON blobs ({}) from being sent or shown as patient-facing coordinator text.
 */

const HOLDING_BY_LANG = {
  en: "Thank you for your message. Someone from the clinic will respond shortly.",
  tr: "Mesajınız için teşekkürler. Klinik ekibimiz en kısa sürede size dönüş yapacaktır.",
  ru: "Спасибо за ваше сообщение. Команда клиники скоро ответит вам.",
  ka: "გმადლობთ შეტყობინებისთვის. კლინიკის გუნდი მალე დაგიბრუნდებათ.",
};

/**
 * @param {string} text
 */
function isInvalidPatientFacingReply(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t === "{}" || t === "[]" || t === "null") return true;
  if (/^\{\s*\}$/.test(t) || /^\[\s*\]$/.test(t)) return true;
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.length === 0;
      if (parsed && typeof parsed === "object") {
        const inner = extractReplyFromCoordinatorObject(parsed);
        return !inner;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 */
function extractReplyFromCoordinatorObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const keys = [
    "reply",
    "message",
    "patient_reply",
    "patientReply",
    "response",
    "text",
    "suggestedReply",
    "patientDraft",
    "assistant_message",
    "content",
  ];
  for (const key of keys) {
    const v = raw[key];
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s && !isInvalidPatientFacingReply(s)) return s;
  }
  return "";
}

/**
 * @param {string} [lang] ISO 639-1
 */
function coordinatorHoldingReply(lang) {
  const code = String(lang || "en")
    .trim()
    .slice(0, 2)
    .toLowerCase();
  return HOLDING_BY_LANG[code] || HOLDING_BY_LANG.en;
}

/**
 * @param {string} text
 * @param {{ lang?: string, logLabel?: string }} [opts]
 */
function sanitizePatientFacingReply(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!isInvalidPatientFacingReply(raw)) return raw;
  if (opts.logLabel) {
    console.warn(`[coordinatorReplySanitize] ${opts.logLabel}`, {
      preview: raw.slice(0, 120),
    });
  }
  return coordinatorHoldingReply(opts.lang);
}

module.exports = {
  isInvalidPatientFacingReply,
  extractReplyFromCoordinatorObject,
  coordinatorHoldingReply,
  sanitizePatientFacingReply,
  HOLDING_BY_LANG,
};
