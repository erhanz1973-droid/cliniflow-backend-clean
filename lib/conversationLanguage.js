/**
 * Conversation-level reply language — stable primary language with confidence-based switching.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const LANG_RE = /^[a-z]{2}$/i;
const SWITCH_CONFIDENCE_HIGH = parseFloat(process.env.AI_LANG_SWITCH_CONFIDENCE || "0.82") || 0.82;
const BOOTSTRAP_CONFIDENCE = parseFloat(process.env.AI_LANG_BOOTSTRAP_CONFIDENCE || "0.62") || 0.62;
/** Minimum confidence to mirror the patient's latest message language in the AI reply. */
const REPLY_MATCH_DETECTED_CONFIDENCE =
  parseFloat(process.env.AI_LANG_REPLY_MATCH_CONFIDENCE || "0.38") || 0.38;
const SWITCH_MIN_CHARS = parseInt(process.env.AI_LANG_SWITCH_MIN_CHARS || "18", 10) || 18;
const DETECT_MIN_SCORE = 0.22;
const GEORGIAN_SCRIPT_CONFIDENCE = 0.96;

const LANGUAGE_NAMES = {
  en: "English",
  tr: "Turkish",
  ru: "Russian",
  ka: "Georgian",
  ar: "Arabic",
  de: "German",
  fr: "French",
};

/** Latin-transliterated Georgian cues (not Azerbaijani/Turkish). */
const KA_LATIN_MARKERS = [
  "gamarjoba",
  "gamarjobat",
  "gmadlobt",
  "gmadloba",
  "madloba",
  "rogor",
  "khar",
  "khart",
  "aris",
  "ara",
  "me minda",
  "mindia",
  "gindat",
  "tkven",
  "sheni",
  "chemi",
  "klinika",
  "klinikashi",
  "dghe",
  "dge",
  "tbilisi",
  "saqartvelo",
  "implanti",
  "implantebs",
];

/** Azerbaijani/Turkic-Latin cues — often confused with transliterated Georgian; do not auto-switch into these. */
const AZ_LATIN_TRAP = [
  "necesen",
  "necəsən",
  "salam necesen",
  "neçə",
  "nece",
  "qiymət",
  "qiymet",
  "hardasa",
  "xahiş",
  "xahis",
  "başa düşürəm",
];

const TR_MARKERS = [
  "merhaba",
  "merhabalar",
  "selam",
  "fiyat",
  "fiyatlar",
  "fiyatı",
  "fiyati",
  "randevu",
  "tedavi",
  "klinik",
  "teşekkür",
  "tesekkur",
  "teşekkürler",
  "tesekkurler",
  "lütfen",
  "lutfen",
  "nasıl",
  "nasil",
  "kaç",
  "kac",
  "diş",
  "dis",
  "nedir",
  "nerede",
  "ne zaman",
  "ne kadar",
  "istiyorum",
  "istiyor",
  "bilgi",
  "ücret",
  "ucret",
  "ücretler",
  "hocam",
  "sayın",
  "rica",
  "ederim",
  "evet",
  "hayır",
  "hayir",
  "var mı",
  "varmi",
  "musunuz",
  "misiniz",
  "miyim",
  "olur mu",
  "yardım",
  "yardim",
  "ağrı",
  "agri",
  "dişler",
  "disler",
];

const RU_MARKERS = [
  "здравствуйте",
  "спасибо",
  "клиник",
  "имплант",
  "запись",
  "лечен",
  "стоимость",
  "цена",
];

/**
 * @param {unknown} code
 */
function normalizeLangCode(code) {
  const s = String(code || "").trim().toLowerCase();
  if (!s || s === "null" || s === "unknown") return null;
  const base = s.split(/[-_]/)[0].slice(0, 2);
  return LANG_RE.test(base) ? base : null;
}

/**
 * @param {string} text
 */
function hasGeorgianScript(text) {
  return /[\u10A0-\u10FF]/.test(String(text || ""));
}

/**
 * @param {string} text
 */
function hasCyrillic(text) {
  return /[\u0400-\u04FF]/.test(String(text || ""));
}

/**
 * @param {string} text
 */
function hasTurkishDiacritics(text) {
  return /[çğıöşüÇĞİÖŞÜ]/.test(String(text || ""));
}

/**
 * @param {string} text
 */
function hasTurkishQuestionParticles(text) {
  return /\b(mi|mı|mu|mü|misin|misiniz|miyim|miyiz|musun|musunuz)\b/i.test(String(text || ""));
}

/**
 * @param {string} text
 * @param {string[]} markers
 */
function countMarkerHits(text, markers) {
  const t = String(text || "").toLowerCase();
  let hits = 0;
  for (const m of markers) {
    if (m.length >= 4 && t.includes(m)) hits += 1;
    else if (new RegExp(`\\b${m}\\b`, "i").test(t)) hits += 1;
  }
  return hits;
}

/**
 * @param {string} message
 * @returns {{
 *   code: string|null,
 *   confidence: number,
 *   georgianScript: boolean,
 *   cyrillic: boolean,
 *   messageLength: number,
 *   scores: Record<string, number>,
 * }}
 */
function detectMessageLanguage(message) {
  const text = String(message || "").trim();
  const len = text.length;
  /** @type {Record<string, number>} */
  const scores = { en: 0.1, tr: 0, ru: 0, ka: 0 };

  if (!len) {
    return { code: null, confidence: 0, georgianScript: false, cyrillic: false, messageLength: 0, scores };
  }

  if (hasGeorgianScript(text)) {
    return {
      code: "ka",
      confidence: GEORGIAN_SCRIPT_CONFIDENCE,
      georgianScript: true,
      cyrillic: false,
      messageLength: len,
      scores: { ka: GEORGIAN_SCRIPT_CONFIDENCE },
    };
  }

  if (hasCyrillic(text)) {
    const ruHits = countMarkerHits(text, RU_MARKERS);
    scores.ru = Math.min(0.95, 0.72 + ruHits * 0.08);
    return {
      code: "ru",
      confidence: scores.ru,
      georgianScript: false,
      cyrillic: true,
      messageLength: len,
      scores,
    };
  }

  const trHits =
    countMarkerHits(text, TR_MARKERS) +
    (hasTurkishDiacritics(text) ? 2 : 0) +
    (hasTurkishQuestionParticles(text) ? 2 : 0);
  const kaHits = countMarkerHits(text, KA_LATIN_MARKERS);
  const azHits = countMarkerHits(text, AZ_LATIN_TRAP);

  scores.tr = Math.min(0.92, 0.15 + trHits * 0.14);
  if (trHits >= 1 || hasTurkishDiacritics(text) || hasTurkishQuestionParticles(text)) {
    scores.tr = Math.max(scores.tr, 0.58);
  }
  scores.ka = Math.min(0.88, 0.1 + kaHits * 0.16);
  scores.en = Math.min(0.75, 0.2 + (len > 30 && trHits === 0 && kaHits === 0 ? 0.25 : 0));

  if (azHits >= 2 && kaHits === 0 && trHits === 0) {
    scores.tr = Math.max(scores.tr, 0.35);
  }

  if (kaHits > 0 && azHits > 0) {
    scores.ka = Math.max(0.2, scores.ka - azHits * 0.08);
  }

  let best = "en";
  let bestScore = scores.en;
  for (const [code, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }

  const sorted = Object.values(scores).sort((a, b) => b - a);
  const margin = (sorted[0] || 0) - (sorted[1] || 0);
  let confidence = Math.min(0.92, bestScore + margin * 0.35);

  if (len < 8) {
    if (trHits >= 1 || hasTurkishDiacritics(text) || hasTurkishQuestionParticles(text)) {
      confidence = Math.max(confidence, 0.52);
    } else {
      confidence *= 0.55;
    }
  } else if (len < SWITCH_MIN_CHARS) {
    confidence *= 0.75;
  }

  if (kaHits > 0 && !hasGeorgianScript(text) && confidence < 0.88) {
    confidence = Math.min(0.87, confidence);
  }

  return {
    code: bestScore >= DETECT_MIN_SCORE ? best : null,
    confidence: Number(confidence.toFixed(3)),
    georgianScript: false,
    cyrillic: false,
    messageLength: len,
    scores,
  };
}

/**
 * @param {string|null} code
 * @param {Set<string>} enabled
 */
function clampToEnabled(code, enabled) {
  const c = normalizeLangCode(code);
  if (c && enabled.has(c)) return c;
  if (enabled.has("en")) return "en";
  return [...enabled][0] || "en";
}

/**
 * Read persisted conversation language from profile row / flags.
 * @param {Record<string, unknown>|null|undefined} profileRow
 */
function readConversationLanguageFromProfile(profileRow) {
  const row = profileRow || {};
  const col = normalizeLangCode(row.conversation_primary_language);
  if (col) return col;
  const flags =
    row.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? row.operational_intake_flags
      : {};
  return normalizeLangCode(
    flags.conversationPrimaryLanguage || flags.conversation_primary_language,
  );
}

/**
 * @param {{
 *   message: string,
 *   conversationPrimaryLanguage?: string|null,
 *   patientAppLanguage?: string|null,
 *   profilePreferredLanguage?: string|null,
 *   clinicPrimaryLanguage?: string|null,
 *   enabledLanguageCodes?: string[],
 *   messageCount?: number,
 * }} params
 */
function resolveConversationLanguage(params) {
  const enabled = new Set(
    (params.enabledLanguageCodes || ["en", "tr", "ru", "ka"]).map((c) => normalizeLangCode(c)).filter(Boolean),
  );
  const clinicPrimary = clampToEnabled(params.clinicPrimaryLanguage || "en", enabled);

  let primary =
    readConversationLanguageFromProfile({
      conversation_primary_language: params.conversationPrimaryLanguage,
      operational_intake_flags: {
        conversationPrimaryLanguage: params.conversationPrimaryLanguage,
      },
    }) ||
    normalizeLangCode(params.conversationPrimaryLanguage) ||
    normalizeLangCode(params.patientAppLanguage) ||
    normalizeLangCode(params.profilePreferredLanguage) ||
    clinicPrimary;

  primary = clampToEnabled(primary, enabled);

  const detected = detectMessageLanguage(params.message || "");
  let languageSwitched = false;
  let conversationLanguage = primary;

  const detectedCode = detected.code ? clampToEnabled(detected.code, enabled) : null;
  const isBootstrap = !params.conversationPrimaryLanguage && (params.messageCount || 0) <= 1;

  if (detectedCode && detected.confidence >= BOOTSTRAP_CONFIDENCE && isBootstrap) {
    conversationLanguage = detectedCode;
    if (detectedCode !== primary) languageSwitched = true;
  } else if (
    detectedCode &&
    detected.confidence >= SWITCH_CONFIDENCE_HIGH &&
    detectedCode !== primary
  ) {
    const longEnough =
      detected.georgianScript || detected.messageLength >= SWITCH_MIN_CHARS;
    const georgianTransliterationTrap =
      primary === "tr" &&
      detectedCode === "ka" &&
      !detected.georgianScript &&
      detected.confidence < 0.9;

    if (longEnough && !georgianTransliterationTrap) {
      conversationLanguage = detectedCode;
      languageSwitched = true;
    }
  }

  // Reply in the same language as the patient's latest message (Messenger / WhatsApp / chat).
  if (detectedCode && detected.confidence >= REPLY_MATCH_DETECTED_CONFIDENCE) {
    if (detectedCode !== conversationLanguage) {
      conversationLanguage = detectedCode;
      if (detectedCode !== primary) languageSwitched = true;
    }
  }

  return {
    conversationLanguage,
    conversationPrimaryLanguage: conversationLanguage,
    detectedInputLanguage: detectedCode,
    confidence: detected.confidence,
    languageSwitched,
    georgianScript: detected.georgianScript,
    detectionScores: detected.scores,
    policy: {
      switchThreshold: SWITCH_CONFIDENCE_HIGH,
      bootstrapThreshold: BOOTSTRAP_CONFIDENCE,
      minCharsForSwitch: SWITCH_MIN_CHARS,
    },
  };
}

/**
 * @param {ReturnType<typeof resolveConversationLanguage>} state
 */
function buildConversationLanguagePromptBlock(state) {
  const lang = state.conversationLanguage || "en";
  const langName = LANGUAGE_NAMES[lang] || lang;
  const detected = state.detectedInputLanguage || "unknown";
  const detectedName = LANGUAGE_NAMES[detected] || detected;
  const conf = state.confidence != null ? state.confidence : 0;

  const lines = [
    "CONVERSATION LANGUAGE POLICY (strict — highest priority for the reply field):",
    `* reply_language_for_this_turn: ${langName} (${lang})`,
    `* Write the ENTIRE "reply" field ONLY in ${langName} — the same language as the patient's latest message.`,
    `* detected_input_language: ${detected} (${detectedName}, confidence ${conf}).`,
    `* If the patient wrote in Turkish, reply in Turkish. If Russian, reply in Russian. Never default to English unless the patient message is clearly English.`,
    `* conversation_primary_language (continuity): ${lang} (${langName})`,
  ];

  if (state.languageSwitched) {
    lines.push(
      `* language_switched: true — patient is using ${detectedName}; do not continue in a previous language.`,
    );
  } else {
    lines.push(`* language_switched: false — stay in ${langName} for this reply.`);
  }

  lines.push(
    "* Do NOT reply in Azerbaijani (not a supported clinic language). Transliterated Georgian is NOT Azerbaijani.",
    "* Clinic names, city names, and medical brand names may stay Latin; all explanatory sentences must be in the reply language.",
  );

  if (lang === "ka" || state.georgianScript) {
    lines.push("* For Georgian script (Mkhedruli), use standard Georgian — not Turkish or Azerbaijani.");
  }

  return lines.join("\n");
}

/**
 * @param {string} profileId
 * @param {ReturnType<typeof resolveConversationLanguage>} state
 * @param {Record<string, unknown>} [existingFlags]
 */
async function persistConversationLanguage(profileId, state, existingFlags = {}) {
  if (!isSupabaseEnabled() || !profileId) return { ok: false };

  const lang = clampToEnabled(state.conversationLanguage, new Set(["en", "tr", "ru", "ka", "ar", "de", "fr"]));
  const prevFlags =
    existingFlags && typeof existingFlags === "object" ? existingFlags : {};
  const flags = {
    ...prevFlags,
    conversationPrimaryLanguage: lang,
    lastDetectedInputLanguage: state.detectedInputLanguage,
    lastLanguageConfidence: state.confidence,
    lastLanguageSwitchedAt: state.languageSwitched
      ? new Date().toISOString()
      : prevFlags.lastLanguageSwitchedAt || null,
  };

  const patch = {
    conversation_primary_language: lang,
    preferred_language: lang,
    operational_intake_flags: flags,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update(patch)
    .eq("id", profileId);

  if (error) {
    const msg = String(error.message || "");
    if (msg.includes("conversation_primary_language")) {
      const { error: err2 } = await supabase
        .from("ai_coordinator_lead_profiles")
        .update({
          preferred_language: lang,
          operational_intake_flags: flags,
          updated_at: patch.updated_at,
        })
        .eq("id", profileId);
      if (err2) return { ok: false, error: err2.message };
      return { ok: true, fallback: "flags_only" };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, conversationLanguage: lang };
}

/**
 * @param {string} patientId
 */
async function loadPatientAppLanguage(patientId) {
  if (!isSupabaseEnabled() || !patientId) return null;
  const { data } = await supabase.from("patients").select("language").eq("id", patientId).maybeSingle();
  return normalizeLangCode(data?.language);
}

/**
 * Build language state for an inbound AI turn.
 * @param {{
 *   message: string,
 *   profileRow: Record<string, unknown>|null,
 *   clinicId: string,
 *   patientId?: string,
 * }} params
 */
async function resolveConversationLanguageForTurn(params) {
  const { getClinicAiProfile } = require("./clinicAiSettings");
  const profile = await getClinicAiProfile(params.clinicId);
  const enabled = profile.tone?.enabledLanguageCodes || ["en", "tr", "ru", "ka"];
  const patientLang = params.patientId ? await loadPatientAppLanguage(params.patientId) : null;
  const row = params.profileRow || {};

  return resolveConversationLanguage({
    message: params.message,
    conversationPrimaryLanguage: readConversationLanguageFromProfile(row),
    patientAppLanguage: patientLang,
    profilePreferredLanguage: row.preferred_language,
    clinicPrimaryLanguage: profile.tone?.primaryLanguage,
    enabledLanguageCodes: enabled,
    messageCount: Number(row.message_count) || 0,
  });
}

module.exports = {
  SWITCH_CONFIDENCE_HIGH,
  BOOTSTRAP_CONFIDENCE,
  REPLY_MATCH_DETECTED_CONFIDENCE,
  detectMessageLanguage,
  resolveConversationLanguage,
  resolveConversationLanguageForTurn,
  buildConversationLanguagePromptBlock,
  persistConversationLanguage,
  readConversationLanguageFromProfile,
  loadPatientAppLanguage,
  normalizeLangCode,
  LANGUAGE_NAMES,
};
