/**
 * Prevent empty JSON blobs ({}) from being sent or shown as patient-facing coordinator text.
 */

const HOLDING_BY_LANG = {
  en: "Thank you for your message. Someone from the clinic will respond shortly.",
  tr: "Mesajınız için teşekkürler. Klinik ekibimiz en kısa sürede size dönüş yapacaktır.",
  ru: "Спасибо за ваше сообщение. Команда клиники скоро ответит вам.",
  ka: "გმადლობთ შეტყობინებისთვის. კლინიკის გუნდი მალე დაგიბრუნდებათ.",
};

const NOTIFIED_BY_LANG = {
  en: "Thank you for your message. Your care team has been notified and will follow up shortly.",
  tr: "Mesajınız için teşekkürler. Bakım ekibiniz bilgilendirildi; en kısa sürede size dönüş yapacaktır.",
  ru: "Спасибо за ваше сообщение. Ваша команда ухода уведомлена и скоро свяжется с вами.",
  ka: "გმადლობთ შეტყობინებისთვის. თქვენი მოვლის გუნდი გაფრთხილებულია და მალე დაგიკავშირდებათ.",
};

/**
 * @param {string|null|undefined} lang
 * @param {Record<string, string>} table
 */
function pickLocalizedTemplate(lang, table) {
  const code = String(lang || "")
    .trim()
    .slice(0, 2)
    .toLowerCase();
  if (code && table[code]) return table[code];
  if (table.tr) return table.tr;
  return table.en;
}

/**
 * Resolve reply language for templated fallbacks (avoid English when patient wrote Turkish).
 * @param {{ lang?: string|null, patientMessage?: string }} opts
 */
function resolveCoordinatorReplyLang(opts = {}) {
  const explicit = String(opts.lang || "")
    .trim()
    .slice(0, 2)
    .toLowerCase();
  if (explicit && explicit !== "en" && HOLDING_BY_LANG[explicit]) return explicit;

  const msg = String(opts.patientMessage || "").trim();
  if (msg) {
    try {
      const { detectMessageLanguage } = require("./conversationLanguage");
      const detected = detectMessageLanguage(msg);
      if (
        detected.code &&
        detected.code !== "en" &&
        detected.confidence >= 0.38 &&
        HOLDING_BY_LANG[detected.code]
      ) {
        return detected.code;
      }
    } catch {
      /* ignore */
    }
  }

  if (explicit && HOLDING_BY_LANG[explicit]) return explicit;
  return "tr";
}

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
    "patient_message",
    "patientMessage",
    "response",
    "text",
    "answer",
    "output",
    "suggestedReply",
    "patientDraft",
    "assistant_message",
    "assistant_reply",
    "assistantReply",
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
  return pickLocalizedTemplate(lang, HOLDING_BY_LANG);
}

/**
 * @param {string} [lang] ISO 639-1
 */
function coordinatorNotifiedReply(lang) {
  return pickLocalizedTemplate(lang, NOTIFIED_BY_LANG);
}

/**
 * @param {string} text
 * @param {{ lang?: string, patientMessage?: string, logLabel?: string }} [opts]
 */
function sanitizePatientFacingReply(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!isInvalidPatientFacingReply(raw)) return raw;
  if (opts.logLabel) {
    console.warn(`[coordinatorReplySanitize] ${opts.logLabel}`, {
      preview: raw.slice(0, 120),
    });
  }
  return coordinatorHoldingReply(
    resolveCoordinatorReplyLang({
      lang: opts.lang,
      patientMessage: opts.patientMessage,
    }),
  );
}

module.exports = {
  isInvalidPatientFacingReply,
  extractReplyFromCoordinatorObject,
  coordinatorHoldingReply,
  coordinatorNotifiedReply,
  resolveCoordinatorReplyLang,
  sanitizePatientFacingReply,
  HOLDING_BY_LANG,
  NOTIFIED_BY_LANG,
};
