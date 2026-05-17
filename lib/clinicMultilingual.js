/**
 * Multilingual clinic AI orchestration — one knowledge source, runtime localization.
 * Clinics configure enabled languages + optional patient-facing localized strings.
 * Structured ops data (brands, pricing, logistics) stays language-neutral for AI to localize at reply time.
 */

/** MVP priority + future-ready language presets for admin UI. */
const CLINIC_LANGUAGE_PRESETS = [
  { code: "en", label: "English", priority: "mvp" },
  { code: "tr", label: "Turkish", priority: "mvp" },
  { code: "ru", label: "Russian", priority: "mvp" },
  { code: "ka", label: "Georgian", priority: "mvp" },
  { code: "ar", label: "Arabic", priority: "future" },
  { code: "de", label: "German", priority: "future" },
  { code: "fr", label: "French", priority: "future" },
];

const PRESET_CODE_SET = new Set(CLINIC_LANGUAGE_PRESETS.map((l) => l.code));

const RUNTIME_LOCALIZATION_GUIDANCE = [
  "Respond in the patient's language when it is enabled for this clinic.",
  "Do not require duplicate operational knowledge per language — localize brands, pricing ranges, logistics, and workflow facts at reply time.",
  "Use localizedStrings for assistant name, signature, and welcome text when available for the target language.",
  "For treatment names, prefer labelI18n when present; otherwise use the canonical treatment code/name and localize naturally.",
  "Never invent prices or policies — use structured clinic data with non-binding estimate language.",
].join(" ");

/**
 * @param {unknown} raw
 * @returns {Array<{ code: string, enabled: boolean, primary: boolean, humanSupport: boolean }>}
 */
function normalizeSupportedLanguages(raw) {
  /** @type {Array<{ code: string, enabled: boolean, primary: boolean, humanSupport: boolean }>} */
  const out = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        const code = item.trim().toLowerCase();
        if (!code) continue;
        out.push({ code, enabled: true, primary: false, humanSupport: true });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const code = String(item.code || item.lang || "").trim().toLowerCase();
      if (!code) continue;
      out.push({
        code,
        enabled: item.enabled !== false,
        primary: item.primary === true,
        humanSupport: item.human_support !== false && item.humanSupport !== false,
      });
    }
  }

  if (!out.length) {
    return [
      { code: "en", enabled: true, primary: true, humanSupport: true },
      { code: "tr", enabled: true, primary: false, humanSupport: true },
    ];
  }

  const seen = new Set();
  const deduped = out.filter((row) => {
    if (seen.has(row.code)) return false;
    seen.add(row.code);
    return true;
  });

  const enabled = deduped.filter((r) => r.enabled);
  if (!enabled.some((r) => r.primary)) {
    const first = enabled[0] || deduped[0];
    if (first) first.primary = true;
  } else {
    let primarySet = false;
    for (const row of deduped) {
      if (row.primary && row.enabled) {
        if (primarySet) row.primary = false;
        else primarySet = true;
      } else if (row.primary && !row.enabled) {
        row.primary = false;
      }
    }
    if (!primarySet && enabled[0]) enabled[0].primary = true;
  }

  return deduped;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function normalizeLocalizedMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const code = String(key || "").trim().toLowerCase();
    const text = String(val ?? "").trim();
    if (code && text) out[code] = text;
  }
  return out;
}

/**
 * @param {Record<string, string>|null|undefined} map
 * @param {string} lang
 * @param {string} [fallback]
 */
function pickLocalizedText(map, lang, fallback = "") {
  if (!map || typeof map !== "object") return fallback;
  const code = String(lang || "").trim().toLowerCase();
  if (code && map[code]) return map[code];
  if (map.en) return map.en;
  const first = Object.values(map).find((v) => String(v || "").trim());
  return first ? String(first) : fallback;
}

/**
 * Normalize tone_config multilingual fields (read/write clinic_ai_settings).
 * @param {Record<string, unknown>} raw
 */
function normalizeToneMultilingual(raw) {
  const supportedLanguages = normalizeSupportedLanguages(raw.supportedLanguages);
  const primary =
    supportedLanguages.find((l) => l.primary && l.enabled)?.code ||
    supportedLanguages.find((l) => l.enabled)?.code ||
    "en";

  const displayNameLocalized = normalizeLocalizedMap(
    raw.displayNameLocalized || raw.display_name_localized,
  );
  const signatureLocalized = normalizeLocalizedMap(
    raw.signatureLocalized || raw.signature_localized,
  );
  const welcomeMessageLocalized = normalizeLocalizedMap(
    raw.welcomeMessageLocalized || raw.welcome_message_localized,
  );

  const legacyDisplay = String(raw.displayName || "").trim();
  if (legacyDisplay && !Object.keys(displayNameLocalized).length) {
    displayNameLocalized.en = legacyDisplay;
  }

  const enabledCodes = supportedLanguages.filter((l) => l.enabled).map((l) => l.code);

  return {
    supportedLanguages,
    primaryLanguage: String(raw.primaryLanguage || raw.primary_language || primary).toLowerCase(),
    enabledLanguageCodes: enabledCodes,
    /** @deprecated use supportedLanguages — kept for legacy callers */
    supportedLanguagesLegacy: enabledCodes,
    displayNameLocalized,
    signatureLocalized,
    welcomeMessageLocalized,
    displayName: pickLocalizedText(displayNameLocalized, primary, legacyDisplay || "Clinic Assistant"),
  };
}

/**
 * @param {Record<string, unknown>} tone
 */
function buildMultilingualOrchestrationBlock(tone) {
  const m = normalizeToneMultilingual(tone || {});
  return {
    primaryLanguage: m.primaryLanguage,
    enabledLanguages: m.supportedLanguages.filter((l) => l.enabled),
    supportedLanguages: m.supportedLanguages,
    localizedStrings: {
      displayName: m.displayNameLocalized,
      signature: m.signatureLocalized,
      welcomeMessage: m.welcomeMessageLocalized,
    },
    runtimeLocalization: {
      mode: "orchestration",
      guidance: RUNTIME_LOCALIZATION_GUIDANCE,
      localizeAtRuntime: [
        "implantBrands",
        "materialTypes",
        "pricingRanges",
        "workflowTimings",
        "travelLogistics",
        "paymentPolicies",
      ],
      doNotDuplicatePerLanguage: true,
    },
  };
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function normalizeTreatmentLabelI18n(raw) {
  return normalizeLocalizedMap(raw);
}

module.exports = {
  CLINIC_LANGUAGE_PRESETS,
  PRESET_CODE_SET,
  RUNTIME_LOCALIZATION_GUIDANCE,
  normalizeSupportedLanguages,
  normalizeLocalizedMap,
  normalizeToneMultilingual,
  normalizeTreatmentLabelI18n,
  pickLocalizedText,
  buildMultilingualOrchestrationBlock,
};
