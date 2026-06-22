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
const ARABIC_SCRIPT_CONFIDENCE = 0.96;

const ARABIC_SCRIPT_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

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
  "olur",
  "tamam",
  "peki",
  "tabii",
  "alo",
  "yardım",
  "yardim",
  "ağrı",
  "agri",
  "dişler",
  "disler",
];

const RU_MARKERS = [
  "здравствуйте",
  "здравствуй",
  "привет",
  "спасибо",
  "пожалуйста",
  "клиник",
  "имплант",
  "запись",
  "записаться",
  "лечен",
  "стоимость",
  "цена",
  "сколько",
  "хочу",
  "можно",
  "когда",
  "где",
  "зуб",
  "зубы",
  "врач",
  "консультац",
];

/** Russian written in Latin script (common on mobile keyboards). Avoid shared dental/English tokens (e.g. implant). */
const RU_LATIN_MARKERS = [
  "privet",
  "zdravstvuyte",
  "zdravstvuite",
  "spasibo",
  "pozhaluysta",
  "pozhaluista",
  "skolko",
  "stoimost",
  "tsena",
  "zapis",
  "zapisatsya",
  "lechenie",
  "zuby",
  "zub",
];

/** Common Arabic words in Latin transliteration (Gulf/Levant messaging). */
const AR_LATIN_MARKERS = [
  "marhaba",
  "marhaban",
  "ahlan",
  "salam alaikum",
  "assalamu",
  "shukran",
  "shukran jazeelan",
  "afwan",
  "kayf halak",
  "kayf halik",
  "ana ",
  "uriid",
  "urid",
  "musaadat",
  "musaeada",
  "asnan",
  "asnan",
  "tabib",
  "mustashfa",
  "mustashfaa",
  "kam ",
  "bikam",
  "saar",
  "saaar",
  "hal yumkin",
  "min fadlik",
  "min fadlak",
  "arabi",
  "arabic",
];

const EN_MARKERS = [
  "how are you",
  "how are u",
  "how's it going",
  "hows it going",
  "what's up",
  "whats up",
  "how much",
  "how many",
  "where is",
  "where are",
  "your clinic",
  "at your clinic",
  "located at",
  "thank you",
  "thanks",
  "could you",
  "would you",
  "please tell",
  "i want",
  "i need",
  "i would",
  "i'm fine",
  "im fine",
  "appointment",
  "consultation",
  "dental clinic",
  "one implant",
  "implant cost",
  "cost at",
  "price for",
  "do you have",
  "what is the",
  "how do i",
  "our clinic",
  "nice to meet",
  "good to see",
];

/** Common short English openers / small talk (Latin script). */
const EN_CONVERSATIONAL_RE =
  /\b(how are you|how're you|how r u|hows it going|how's it going|what's up|whats up|how do you do|nice to meet you|good to see you|hope you(?:'re| are) well|how have you been)\b/i;

/**
 * @param {string} text
 */
function hasArabicScript(text) {
  return ARABIC_SCRIPT_RE.test(String(text || ""));
}

function looksClearlyEnglish(text) {
  const t = String(text || "").trim();
  if (!t || hasCyrillic(t) || hasGeorgianScript(t) || hasArabicScript(t) || hasTurkishDiacritics(t)) {
    return false;
  }
  if (EN_CONVERSATIONAL_RE.test(t)) return true;
  const enHits = countMarkerHits(t, EN_MARKERS);
  if (enHits >= 2) return true;
  if (enHits >= 1 && /\b(how|what|where|when|much|many|your|the|is|are|at|our|clinic|cost|price|thanks|thank)\b/i.test(t)) {
    return true;
  }
  if (
    t.length >= 5 &&
    t.length <= 64 &&
    /^[a-z0-9\s.,!?'"-]+$/i.test(t) &&
    countMarkerHits(t, TR_MARKERS) === 0 &&
    countMarkerHits(t, KA_LATIN_MARKERS) === 0 &&
    countMarkerHits(t, RU_LATIN_MARKERS) === 0 &&
    countMarkerHits(t, AZ_LATIN_TRAP) === 0 &&
    /\b(how|what|hello|hi|hey|thanks|thank|please|you|your|are|is|the|can|could|would|good|fine|well|nice)\b/i.test(t)
  ) {
    return true;
  }
  if (
    t.length >= 24 &&
    /^[a-z0-9\s.,!?'"-]+$/i.test(t) &&
    /\b(the|your|our|how|what|where|clinic|cost|price|implant|dental)\b/i.test(t) &&
    countMarkerHits(t, TR_MARKERS) === 0 &&
    countMarkerHits(t, RU_LATIN_MARKERS) === 0
  ) {
    return true;
  }
  return false;
}

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
  const scores = { en: 0.1, tr: 0, ru: 0, ka: 0, ar: 0 };

  if (!len) {
    return { code: null, confidence: 0, georgianScript: false, cyrillic: false, messageLength: 0, scores };
  }

  /** Digits-only WhatsApp/mobile — not a language sample; keep conversation primary language. */
  const digitsOnly = text.replace(/\D/g, "");
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
    const nonPhone = text.replace(/[\d\s().+-]/g, "");
    if (nonPhone.length <= 2) {
      return {
        code: null,
        confidence: 0,
        georgianScript: false,
        cyrillic: false,
        messageLength: len,
        phoneOnly: true,
        scores,
      };
    }
  }

  if (/^(olur|tamam|evet|hayır|hayir|peki|tabii|alo|merhaba|selam)[\s!.?…]*$/i.test(text)) {
    return {
      code: "tr",
      confidence: 0.78,
      georgianScript: false,
      cyrillic: false,
      messageLength: len,
      scores: { tr: 0.78, en: 0.1 },
    };
  }

  if (hasGeorgianScript(text)) {
    return {
      code: "ka",
      confidence: GEORGIAN_SCRIPT_CONFIDENCE,
      georgianScript: true,
      arabicScript: false,
      cyrillic: false,
      messageLength: len,
      scores: { ka: GEORGIAN_SCRIPT_CONFIDENCE },
    };
  }

  if (hasArabicScript(text)) {
    return {
      code: "ar",
      confidence: ARABIC_SCRIPT_CONFIDENCE,
      georgianScript: false,
      arabicScript: true,
      cyrillic: false,
      messageLength: len,
      scores: { ar: ARABIC_SCRIPT_CONFIDENCE },
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

  if (looksClearlyEnglish(text)) {
    return {
      code: "en",
      confidence: len <= 24 ? 0.8 : 0.88,
      georgianScript: false,
      cyrillic: false,
      messageLength: len,
      scores: { en: len <= 24 ? 0.8 : 0.88, tr: 0, ru: 0, ka: 0 },
    };
  }

  const arLatinHits = countMarkerHits(text, AR_LATIN_MARKERS);
  if (arLatinHits >= 2 && len >= 8 && !hasTurkishDiacritics(text)) {
    scores.ar = Math.min(0.9, 0.55 + arLatinHits * 0.12);
    return {
      code: "ar",
      confidence: scores.ar,
      georgianScript: false,
      arabicScript: false,
      cyrillic: false,
      messageLength: len,
      scores,
    };
  }

  const ruLatinHits = countMarkerHits(text, RU_LATIN_MARKERS);
  if (ruLatinHits >= 2 && len >= 12) {
    scores.ru = Math.min(0.9, 0.58 + ruLatinHits * 0.12);
    return {
      code: "ru",
      confidence: scores.ru,
      georgianScript: false,
      cyrillic: false,
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
  const ruHitsLatin = countMarkerHits(text, RU_LATIN_MARKERS);

  scores.ar = Math.min(0.85, 0.1 + arLatinHits * 0.14);
  scores.tr = Math.min(0.92, 0.15 + trHits * 0.14);
  if (trHits >= 1 || hasTurkishDiacritics(text) || hasTurkishQuestionParticles(text)) {
    scores.tr = Math.max(scores.tr, 0.58);
  }
  scores.ka = Math.min(0.88, 0.1 + kaHits * 0.16);
  scores.ru = Math.min(0.85, 0.08 + ruHitsLatin * 0.14);
  scores.en = Math.min(0.75, 0.2 + (len > 30 && trHits === 0 && kaHits === 0 && ruHitsLatin === 0 ? 0.25 : 0));

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
  // Keep the patient's detected language even if the clinic UI omitted it — never force English.
  if (c) return c;
  if (enabled.has("en")) return "en";
  return [...enabled][0] || "en";
}

const ENGLISH_FALLBACK_PHRASE_MARKERS = [
  "thank you for your message",
  "someone from the clinic will respond",
  "your care team has been notified",
  "will follow up shortly",
  "will respond shortly",
];

/**
 * @param {string} text
 */
function isKnownEnglishCoordinatorFallback(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  return ENGLISH_FALLBACK_PHRASE_MARKERS.some((m) => t.includes(m));
}

/**
 * Never send English (or another wrong language) when the patient is writing in Turkish etc.
 * @param {string} replyText
 * @param {{ expectedLang?: string|null, lockedConversationLanguage?: string|null, patientMessage?: string, logLabel?: string }} [opts]
 */
function enforcePatientReplyLanguage(replyText, opts = {}) {
  const reply = String(replyText || "").trim();
  if (!reply) return reply;

  const patientMessage = String(opts.patientMessage || "").trim();
  const patientDetect = patientMessage ? detectMessageLanguage(patientMessage) : null;
  const sessionLocked = normalizeLangCode(opts.lockedConversationLanguage);
  let expected = sessionLocked || normalizeLangCode(opts.expectedLang);

  if (
    !sessionLocked &&
    patientDetect?.code &&
    patientDetect.code !== "en" &&
    patientDetect.confidence >= REPLY_MATCH_DETECTED_CONFIDENCE
  ) {
    expected = patientDetect.code;
  }

  if (patientMessage && looksClearlyEnglish(patientMessage)) {
    expected = "en";
  }

  if (!expected || expected === "en") {
    if (
      isKnownEnglishCoordinatorFallback(reply) &&
      patientDetect?.code &&
      patientDetect.code !== "en" &&
      !looksClearlyEnglish(patientMessage)
    ) {
      expected = patientDetect.code;
    } else if (
      patientDetect?.code &&
      patientDetect.code !== "en" &&
      !looksClearlyEnglish(patientMessage)
    ) {
      expected = patientDetect.code;
    } else {
      if (expected === "en" && looksClearlyEnglish(patientMessage)) {
        const replyDetect = detectMessageLanguage(reply);
        const wrongLang =
          replyDetect.code &&
          replyDetect.code !== "en" &&
          (replyDetect.confidence >= 0.42 ||
            (replyDetect.code === "tr" && hasTurkishDiacritics(reply)));
        if (wrongLang) {
          const { coordinatorHoldingReply } = require("./coordinatorReplySanitize.cjs");
          if (opts.logLabel) {
            console.warn(`[conversationLanguage] ${opts.logLabel} english_expected_wrong_reply`, {
              replyLang: replyDetect.code,
              preview: reply.slice(0, 120),
            });
          }
          return coordinatorHoldingReply("en");
        }
      }
      return reply;
    }
  }

  if (isKnownEnglishCoordinatorFallback(reply)) {
    const { coordinatorHoldingReply } = require("./coordinatorReplySanitize.cjs");
    if (opts.logLabel) {
      console.warn(`[conversationLanguage] ${opts.logLabel} english_fallback_replaced`, {
        expected,
        preview: reply.slice(0, 80),
      });
    }
    return coordinatorHoldingReply(expected);
  }

  const replyDetect = detectMessageLanguage(reply);
  const replyLang = replyDetect.code;
  const patientLangClear =
    patientDetect?.code &&
    patientDetect.confidence >= REPLY_MATCH_DETECTED_CONFIDENCE &&
    !looksClearlyEnglish(patientMessage);

  const mismatchEnglish =
    expected &&
    expected !== "en" &&
    (replyLang === "en" || isKnownEnglishCoordinatorFallback(reply)) &&
    (replyDetect.confidence >= 0.35 || isKnownEnglishCoordinatorFallback(reply));

  const mismatchWrongLang =
    expected &&
    patientLangClear &&
    expected === patientDetect.code &&
    replyLang &&
    replyLang !== expected &&
    replyDetect.confidence >= 0.32;

  if (!mismatchEnglish && !mismatchWrongLang) return reply;

  const { coordinatorHoldingReply } = require("./coordinatorReplySanitize.cjs");
  if (opts.logLabel) {
    console.warn(`[conversationLanguage] ${opts.logLabel} reply_language_mismatch`, {
      expected,
      replyLang,
      replyConfidence: replyDetect.confidence,
      preview: reply.slice(0, 120),
    });
  }
  return coordinatorHoldingReply(expected);
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
    (params.enabledLanguageCodes || ["en", "tr", "ru", "ka", "ar"]).map((c) => normalizeLangCode(c)).filter(Boolean),
  );
  const clinicPrimary = clampToEnabled(params.clinicPrimaryLanguage || "en", enabled);

  const lockedPrimary = readConversationLanguageFromProfile({
    conversation_primary_language: params.conversationPrimaryLanguage,
    operational_intake_flags: {
      conversationPrimaryLanguage: params.conversationPrimaryLanguage,
    },
  });

  const fallbackPrimary =
    lockedPrimary ||
    normalizeLangCode(params.patientAppLanguage) ||
    normalizeLangCode(params.profilePreferredLanguage) ||
    clinicPrimary;

  const detected = detectMessageLanguage(params.message || "");
  const detectedCode = detected.code ? clampToEnabled(detected.code, enabled) : null;

  let conversationLanguage = clampToEnabled(lockedPrimary || fallbackPrimary, enabled);
  let languageSwitched = false;
  let primaryLocked = Boolean(lockedPrimary);

  if (!lockedPrimary) {
    if (detectedCode && (detected.confidence >= BOOTSTRAP_CONFIDENCE || detected.cyrillic)) {
      conversationLanguage = detectedCode;
      primaryLocked = true;
      if (detectedCode !== fallbackPrimary) languageSwitched = true;
    } else if (detectedCode && detected.confidence >= REPLY_MATCH_DETECTED_CONFIDENCE) {
      conversationLanguage = detectedCode;
      primaryLocked = true;
      if (detectedCode !== fallbackPrimary) languageSwitched = true;
    }
  } else {
    conversationLanguage = clampToEnabled(lockedPrimary, enabled);

    if (
      detectedCode &&
      detectedCode !== lockedPrimary &&
      (detected.cyrillic || detected.georgianScript || detected.arabicScript) &&
      detected.confidence >= REPLY_MATCH_DETECTED_CONFIDENCE
    ) {
      conversationLanguage = detectedCode;
      languageSwitched = true;
    } else if (
      detectedCode &&
      detectedCode !== lockedPrimary &&
      detected.confidence >= SWITCH_CONFIDENCE_HIGH &&
      (detected.cyrillic ||
        detected.georgianScript ||
        detected.arabicScript ||
        detected.messageLength >= SWITCH_MIN_CHARS)
    ) {
      conversationLanguage = detectedCode;
      languageSwitched = true;
    } else if (
      detectedCode === "en" &&
      lockedPrimary &&
      lockedPrimary !== "en" &&
      looksClearlyEnglish(params.message || "")
    ) {
      conversationLanguage = "en";
      languageSwitched = true;
    }
  }

  const conversationPrimaryLanguage = primaryLocked
    ? languageSwitched
      ? conversationLanguage
      : lockedPrimary || conversationLanguage
    : conversationLanguage;

  return {
    conversationLanguage,
    conversationPrimaryLanguage,
    lockedPrimaryLanguage: lockedPrimary,
    detectedInputLanguage: detectedCode,
    confidence: detected.confidence,
    languageSwitched,
    georgianScript: detected.georgianScript,
    arabicScript: detected.arabicScript === true,
    phoneOnly: detected.phoneOnly === true,
    detectionScores: detected.scores,
    policy: {
      switchThreshold: SWITCH_CONFIDENCE_HIGH,
      bootstrapThreshold: BOOTSTRAP_CONFIDENCE,
      minCharsForSwitch: SWITCH_MIN_CHARS,
      stickySessionLanguage: Boolean(lockedPrimary),
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
    state.policy?.stickySessionLanguage
      ? `* This conversation started in ${langName}. Keep EVERY reply in ${langName} unless the user clearly writes a long message in another language.`
      : null,
    state.phoneOnly
      ? `* User's latest message is ONLY a phone/WhatsApp number — reply in ${langName}; do NOT discuss your language skills.`
      : `* Write the ENTIRE "reply" field ONLY in ${langName} — the same language as the user's latest message.`,
    state.phoneOnly
      ? "* detected_input_language: phone_number_only (not a language sample)."
      : `* detected_input_language: ${detected} (${detectedName}, confidence ${conf}).`,
    state.phoneOnly
      ? null
      : `* If the user wrote in Turkish, reply in Turkish. If Arabic, reply in Arabic. If Russian, reply in Russian. Never default to English or Turkish unless the user message is clearly in that language.`,
    `* conversation_primary_language (session lock): ${state.conversationPrimaryLanguage || lang} (${LANGUAGE_NAMES[state.conversationPrimaryLanguage || lang] || lang})`,
  ].filter(Boolean);

  if (state.languageSwitched) {
    lines.push(
      `* language_switched: true — user is using ${detectedName}; do not continue in a previous language.`,
    );
  } else {
    lines.push(`* language_switched: false — stay in ${langName} for this reply (do not switch to English).`);
  }

  lines.push(
    "* Do NOT reply in Azerbaijani (not a supported clinic language). Transliterated Georgian is NOT Azerbaijani.",
    "* Clinic names, city names, and medical brand names may stay Latin; all explanatory sentences must be in the reply language.",
  );

  if (lang === "ka" || state.georgianScript) {
    lines.push("* For Georgian script (Mkhedruli), use standard Georgian — not Turkish or Azerbaijani.");
  }
  if (lang === "ar" || state.arabicScript) {
    lines.push("* For Arabic script, use Modern Standard Arabic or Gulf-friendly Arabic — not Turkish.");
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

  const prevFlags =
    existingFlags && typeof existingFlags === "object" ? existingFlags : {};
  const prevPrimary =
    normalizeLangCode(prevFlags.conversationPrimaryLanguage) ||
    normalizeLangCode(prevFlags.conversation_primary_language);

  const shouldLockPrimary =
    !prevPrimary || state.languageSwitched === true || !state.lockedPrimaryLanguage;

  const lang = clampToEnabled(
    shouldLockPrimary
      ? state.conversationPrimaryLanguage || state.conversationLanguage
      : prevPrimary || state.conversationLanguage,
    new Set(["en", "tr", "ru", "ka", "ar", "de", "fr"]),
  );

  const flags = {
    ...prevFlags,
    conversationPrimaryLanguage: lang,
    lastDetectedInputLanguage: state.detectedInputLanguage,
    lastLanguageConfidence: state.confidence,
    lastReplyLanguage: state.conversationLanguage,
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
  const enabled = profile.tone?.enabledLanguageCodes || ["en", "tr", "ru", "ka", "ar"];
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
  looksClearlyEnglish,
  hasArabicScript,
  detectMessageLanguage,
  resolveConversationLanguage,
  resolveConversationLanguageForTurn,
  buildConversationLanguagePromptBlock,
  persistConversationLanguage,
  readConversationLanguageFromProfile,
  loadPatientAppLanguage,
  normalizeLangCode,
  enforcePatientReplyLanguage,
  isKnownEnglishCoordinatorFallback,
  LANGUAGE_NAMES,
};
