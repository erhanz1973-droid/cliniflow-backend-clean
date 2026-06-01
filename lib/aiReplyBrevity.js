/**
 * Keep coordinator replies short on chat channels (WhatsApp, Messenger, Instagram).
 */

const {
  patientAskedDirectPrice,
  patientAskedCostSensitivityOnly,
} = require("./clinicPricingIntent");

const CHAT_CHANNELS = new Set(["whatsapp", "messenger", "instagram"]);

const PRICE_AMOUNT_IN_SENTENCE_RE =
  /(\d[\d.,\s]*\s*(?:tl|lira|₺|€|eur|\$|usd|try|euro)\b|(?:yaklaşık|yaklasik|approximately|starting from|starts at|genellikle|from|başlay|baslay)\s*[\d€$₺]|\d+\s*[-–]\s*\d+\s*(?:tl|lira|€|eur|\$))/i;

function sentenceMentionsImplantPricing(sentence) {
  const s = String(sentence || "");
  return (
    /\bimplant\b/i.test(s) &&
    /\b(fiyat|ücret|ucret|price|cost|tl|lira|€|eur|\$|marka|brand|kemik|bone)\b/i.test(s)
  );
}

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

/**
 * @param {string} patientMessage
 * @param {string} [lang]
 * @param {string|null} [clinicName]
 */
function buildCostSensitivityReassuranceReply(patientMessage, lang = "tr", clinicName = null) {
  const tr =
    String(lang || "").slice(0, 2).toLowerCase() === "tr" ||
    /[çğıöşüÇĞİÖŞÜ]/.test(String(patientMessage || ""));
  const clinic = String(clinicName || "").trim();
  if (tr) {
    if (clinic) {
      return `Hayır, ${clinic} olarak fiyatlarımızı pahalı bulmuyoruz; genelde uygun ve şeffaf bir fiyatlandırma sunuyoruz.`;
    }
    return "Hayır, fiyatlarımız pahalı değil; genelde uygun ve şeffaf bir fiyatlandırma sunuyoruz.";
  }
  if (clinic) {
    return `No — at ${clinic} we don't consider our prices high; we aim for fair, transparent pricing.`;
  }
  return "No, our prices are not high — we aim for fair, transparent pricing.";
}

function costSensitivityFallbackReply(patientMessage, lang, clinicName) {
  return buildCostSensitivityReassuranceReply(patientMessage, lang, clinicName);
}

/**
 * Strip numeric prices when patient only asked «pahalı mı» — not a direct amount request.
 * @param {string} reply
 * @param {string} patientMessage
 */
function enforceNoNumericPricingUnlessDirectAsk(reply, patientMessage, opts = {}) {
  const out = String(reply || "").trim();
  const patientText = String(patientMessage || "");
  if (!out || patientAskedDirectPrice(patientText)) return out;

  const costOnly = patientAskedCostSensitivityOnly(patientText);
  const parts = out.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = parts.filter((sentence) => {
    if (PRICE_AMOUNT_IN_SENTENCE_RE.test(sentence)) return false;
    if (costOnly && sentenceMentionsImplantPricing(sentence)) return false;
    return true;
  });

  if (kept.length) {
    const joined = kept.join(" ").trim();
    if (costOnly && /\bimplant\b/i.test(joined) && /\b(fiyat|price|cost|tl|lira)\b/i.test(joined)) {
      return buildCostSensitivityReassuranceReply(
        patientMessage,
        opts.lang,
        opts.clinicName,
      );
    }
    return joined;
  }
  return costSensitivityFallbackReply(patientMessage, opts.lang, opts.clinicName);
}

module.exports = {
  isChatChannel,
  isSimpleDirectPatientQuestion,
  buildMessagingBrevityPromptBlock,
  resolveCoordinatorMaxTokens,
  buildCostSensitivityReassuranceReply,
  enforceNoNumericPricingUnlessDirectAsk,
};
