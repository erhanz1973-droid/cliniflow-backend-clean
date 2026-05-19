/**
 * Coordination Center UI strings — EN default, TR/RU/KA.
 * Used by API (timeline labels, workspace) and mirrored in public/locales/{lang}/coordination.js for admin.
 */

const SUPPORTED = new Set(["en", "tr", "ru", "ka"]);

/** @type {Record<string, Record<string, unknown>>} */
const MESSAGES = {
  en: require("./messages/en"),
  tr: require("./messages/tr"),
  ru: require("./messages/ru"),
  ka: require("./messages/ka"),
};

/**
 * @param {string} raw
 * @returns {'en'|'tr'|'ru'|'ka'}
 */
function normalizeUiLang(raw) {
  const base = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .split("-")[0];
  return SUPPORTED.has(base) ? /** @type {'en'|'tr'|'ru'|'ka'} */ (base) : "en";
}

/**
 * @param {string} lang
 * @param {string} key dot.path
 * @param {Record<string, string|number>} [params]
 */
function t(lang, key, params = {}) {
  const L = normalizeUiLang(lang);
  const keys = String(key || "").split(".");
  let value = MESSAGES[L];
  for (const k of keys) {
    if (!value || typeof value !== "object") {
      value = null;
      break;
    }
    value = value[k];
  }
  if (value == null || typeof value === "object") {
    let fallback = MESSAGES.en;
    for (const k of keys) {
      if (!fallback || typeof fallback !== "object") {
        fallback = null;
        break;
      }
      fallback = fallback[k];
    }
    value = typeof fallback === "string" ? fallback : String(key);
  }
  let out = String(value);
  Object.entries(params).forEach(([p, v]) => {
    out = out.replace(new RegExp(`\\{${p}\\}`, "g"), String(v));
  });
  return out;
}

/**
 * @param {string|Date|null|undefined} iso
 * @param {string} lang
 * @param {Intl.DateTimeFormatOptions} [opts]
 */
function formatDate(iso, lang, opts = {}) {
  if (!iso) return "—";
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const locale = { en: "en-GB", tr: "tr-TR", ru: "ru-RU", ka: "ka-GE" }[normalizeUiLang(lang)] || "en-GB";
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...opts,
    }).format(d);
  } catch {
    return String(iso);
  }
}

/**
 * @param {number} n
 * @param {string} lang
 */
function formatNumber(n, lang) {
  const locale = { en: "en-GB", tr: "tr-TR", ru: "ru-RU", ka: "ka-GE" }[normalizeUiLang(lang)] || "en-GB";
  return new Intl.NumberFormat(locale).format(n);
}

module.exports = {
  SUPPORTED_UI_LANGS: SUPPORTED,
  MESSAGES,
  normalizeUiLang,
  t,
  formatDate,
  formatNumber,
};
