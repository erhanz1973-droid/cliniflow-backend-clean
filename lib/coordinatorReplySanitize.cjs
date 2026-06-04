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
      const { detectMessageLanguage, looksClearlyEnglish } = require("./conversationLanguage");
      if (looksClearlyEnglish(msg)) return "en";
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
function looksLikeCoordinatorJsonBlob(text) {
  const t = String(text || "").trim();
  if (!t.startsWith("{")) return false;
  return (
    /"reply"\s*:/.test(t) ||
    /"conversationSummary"\s*:/.test(t) ||
    /"conversation_summary"\s*:/.test(t) ||
    /"leadData"\s*:/.test(t) ||
    /"lead_data"\s*:/.test(t)
  );
}

/**
 * Extract "reply" from truncated / non-parseable coordinator JSON text.
 * @param {string} text
 */
function extractReplyFieldFromJsonText(text) {
  const s = String(text || "");
  const m = s.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  if (!m?.[1]) return "";
  try {
    return JSON.parse(`"${m[1]}"`).trim();
  } catch {
    return m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  }
}

/**
 * @param {string} text
 */
function isInvalidPatientFacingReply(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t === "{}" || t === "[]" || t === "null") return true;
  if (/^\{\s*\}$/.test(t) || /^\[\s*\]$/.test(t)) return true;
  if (looksLikeCoordinatorJsonBlob(t)) {
    const inner =
      extractReplyFieldFromJsonText(t) ||
      (() => {
        try {
          const parsed = JSON.parse(t);
          return extractReplyFromCoordinatorObject(parsed);
        } catch {
          return "";
        }
      })();
    return !inner;
  }
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.length === 0;
      if (parsed && typeof parsed === "object") {
        const inner = extractReplyFromCoordinatorObject(parsed);
        return !inner;
      }
    } catch {
      return true;
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
 * Strip coordinator JSON wrappers so patients never see raw leadData / conversationSummary blobs.
 * @param {string} text
 * @param {{ lang?: string, patientMessage?: string, logLabel?: string, allowFallback?: boolean }} [opts]
 */
function coercePatientFacingReply(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) {
    return opts.allowFallback === false
      ? ""
      : coordinatorHoldingReply(
          resolveCoordinatorReplyLang({
            lang: opts.lang,
            patientMessage: opts.patientMessage,
          }),
        );
  }

  if (!looksLikeCoordinatorJsonBlob(raw)) {
    if (isInvalidPatientFacingReply(raw)) {
      if (opts.logLabel) {
        console.warn(`[coordinatorReplySanitize] ${opts.logLabel}`, {
          preview: raw.slice(0, 120),
        });
      }
      return opts.allowFallback === false
        ? ""
        : coordinatorHoldingReply(
            resolveCoordinatorReplyLang({
              lang: opts.lang,
              patientMessage: opts.patientMessage,
            }),
          );
    }
    return raw;
  }

  let inner = "";
  try {
    const parsed = JSON.parse(raw);
    inner = extractReplyFromCoordinatorObject(parsed);
  } catch {
    inner = extractReplyFieldFromJsonText(raw);
  }
  if (!inner) {
    inner = extractReplyFieldFromJsonText(raw);
  }
  if (inner && !isInvalidPatientFacingReply(inner)) return inner;

  if (opts.logLabel) {
    console.warn(`[coordinatorReplySanitize] json_blob_unparsed ${opts.logLabel}`, {
      preview: raw.slice(0, 160),
    });
  }
  return opts.allowFallback === false
    ? ""
    : coordinatorHoldingReply(
        resolveCoordinatorReplyLang({
          lang: opts.lang,
          patientMessage: opts.patientMessage,
        }),
      );
}

/**
 * @param {string} text
 * @param {{ lang?: string, patientMessage?: string, logLabel?: string }} [opts]
 */
function sanitizePatientFacingReply(text, opts = {}) {
  return coercePatientFacingReply(text, opts);
}

module.exports = {
  isInvalidPatientFacingReply,
  extractReplyFromCoordinatorObject,
  looksLikeCoordinatorJsonBlob,
  extractReplyFieldFromJsonText,
  coercePatientFacingReply,
  coordinatorHoldingReply,
  coordinatorNotifiedReply,
  resolveCoordinatorReplyLang,
  sanitizePatientFacingReply,
  HOLDING_BY_LANG,
  NOTIFIED_BY_LANG,
};
