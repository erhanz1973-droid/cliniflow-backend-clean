/**
 * Detect commercial / pricing intent from patient messages (operational routing).
 */

const COST_SENSITIVITY_RE =
  /(pahalı|pahali|ucuz|expensive|cheap|affordable|uygun\s+fiyat|bütçe|butce|budget)/i;

const DIRECT_PRICE_RE =
  /\b(how much|what('s| is) the (price|cost)|price range|cost of|estimate|quoted?|pricing)\b/i;

const DIRECT_PRICE_TR_RE =
  /\b(fiyat\w*|ücret\w*|ucret\w*|ne\s+kadar|kaç\s+para|kac\s+para|maliyet|tutar\w*|bedel\w*|kaça|kaca|kaç\s+lira|kac\s+lira|tl\s+olarak|price\s+in\s+tl)\b/i;

const DIRECT_PRICE_AMOUNT_RE = /\b\d+\s*(€|eur|usd|\$|try|tl|₺|lira)\b/i;

/**
 * Explicit amount request — OK to share configured price ranges.
 * @param {string} text
 */
function patientAskedDirectPrice(text) {
  const t = String(text || "");
  const wantsNumericQuote =
    /\b(ne\s+kadar|kaç\s+para|kac\s+para|kaç\s+lira|kac\s+lira|kaça|kaca|how\s+much|what('s| is) the (price|cost)|price range|cost of)\b/i.test(
      t,
    ) || DIRECT_PRICE_AMOUNT_RE.test(t);

  /** «fiyatlarınız pahalı mı» has «fiyat» but is NOT «kaç lira» */
  if (patientAskedCostSensitivity(t) && !wantsNumericQuote) {
    return false;
  }

  return (
    DIRECT_PRICE_RE.test(t) ||
    wantsNumericQuote ||
    (DIRECT_PRICE_TR_RE.test(t) && wantsNumericQuote) ||
    /\b(fiyat\w*|ücret\w*|ucret\w*)\s+nedir\b/i.test(t)
  );
}

/**
 * Vague cost question (expensive/cheap) — qualitative answer only, no numbers.
 * @param {string} text
 */
function patientAskedCostSensitivity(text) {
  return COST_SENSITIVITY_RE.test(text);
}

/**
 * «Pahalı mı» / expensive — not a numeric price request.
 * @param {string} message
 */
function patientAskedCostSensitivityOnly(message) {
  const patientText = String(message || "").trim();
  return (
    patientAskedCostSensitivity(patientText) &&
    !patientAskedDirectPrice(patientText)
  );
}

function detectPatientCommercialIntent(message, leadData = {}) {
  const patientText = String(message || "").trim();
  const fullText = [patientText, leadData?.treatmentInterest || ""].filter(Boolean).join(" ");

  const asksDirectPrice = patientAskedDirectPrice(patientText);
  const asksCostSensitivity = patientAskedCostSensitivity(patientText);
  /** Numeric quotes only when direct price was asked */
  const asksPrice = asksDirectPrice;

  /** Avoid past lead «implant» polluting «klinik fiyatlarınız pahalı mı» turns */
  const textForTopics =
    asksCostSensitivity && !asksDirectPrice ? patientText : fullText;
  const t = textForTopics.toLowerCase();

  const asksBrand =
    /\b(which|what)\s+(implant\s+)?brand/i.test(patientText) ||
    /\bbrand(s)?\s+(do you|you)\s+use/i.test(patientText) ||
    /\bimplant\s+system/i.test(patientText) ||
    (/\b(country of origin|where\b.*\b(from|made))\b/i.test(patientText) &&
      /\bimplant|straumann|nobel|osstem|megagen/i.test(patientText));

  const asksDuration =
    /\b(how long|duration|how many (days|minutes|hours)|appointment (take|last))\b/i.test(
      patientText,
    ) ||
    /\b(kaç\s*dakika|kac\s*dakika|kaç\s*dk|kac\s*dk|ne\s*kadar\s*sür\w*|ne\s*kadar\s*sur\w*|süresi\s*ne|suresi\s*ne|yaklaşık\s*süre|yaklasik\s*sure|kaç\s*saat\s*sür\w*|dakika\s*sür\w*|ne\s*kadar\s*uzun)\b/i.test(
      patientText,
    );

  /** @type {string[]} */
  const topics = [];
  if (/\bimplant/i.test(t)) topics.push("implant");
  if (/\bfilling|composite|cavity|dolgu\b/i.test(t)) topics.push("filling");
  if (/\bclean(ing|er)?|hygiene|prophylaxis|scaling|temizleme|temizlik|diş\s*temiz|dis\s*temiz\b/i.test(t)) {
    topics.push("cleaning");
  }
  if (/\bwhiten|bleach/i.test(t)) topics.push("whitening");
  if (/\bveneer|smile makeover/i.test(t)) topics.push("veneer");
  if (/\bcrown|bridge\b/i.test(t)) topics.push("crown");
  if (/\broot canal|endodont/i.test(t)) topics.push("root_canal");
  if (/\ball[\s-]?on|full[\s-]?mouth/i.test(t)) topics.push("full_mouth");
  if (!topics.length && leadData?.treatmentInterest) {
    topics.push(String(leadData.treatmentInterest).trim().toLowerCase().replace(/\s+/g, "_"));
  }

  return {
    asksPrice,
    asksDirectPrice,
    asksCostSensitivity,
    asksBrand,
    asksDuration,
    topics,
    isCommercialQuestion:
      asksDirectPrice || asksCostSensitivity || asksBrand || asksDuration,
    primaryTopic: topics[0] || null,
  };
}

/**
 * @param {string} code
 * @param {string} name
 * @param {string} topic
 */
function treatmentMatchesTopic(code, name, topic) {
  const blob = `${code} ${name}`.toUpperCase();
  const map = {
    implant: ["IMPLANT", "IMPLANTS", "DENTAL_IMPLANT"],
    filling: ["FILLING", "COMPOSITE", "CARIES"],
    cleaning: [
      "CLEANING",
      "HYGIENE",
      "PROPHYLAXIS",
      "SCALING",
      "POLISH",
      "TEMIZ",
      "TEMIZLEME",
      "DIS_TEMIZ",
    ],
    whitening: ["WHITEN", "BLEACH", "WHITENING"],
    veneer: ["VENEER", "LAMINATE", "SMILE"],
    crown: ["CROWN", "BRIDGE", "CAP"],
    root_canal: ["ROOT", "ENDO", "CANAL"],
    full_mouth: ["ALL_ON", "FULL_MOUTH", "FULL MOUTH", "REHAB"],
  };
  const keys = map[topic] || [topic.toUpperCase()];
  if (keys.some((k) => blob.includes(k))) return true;
  return new RegExp(topic.replace(/_/g, "[\\s-]?"), "i").test(`${code} ${name}`);
}

/**
 * Duration / «kaç dakika» — not a numeric price request.
 * @param {string} message
 * @param {Record<string, unknown>} [leadData]
 */
function patientAskedDurationOnly(message, leadData = {}) {
  const intent = detectPatientCommercialIntent(message, leadData);
  return (
    intent.asksDuration &&
    !intent.asksDirectPrice &&
    !patientAskedCostSensitivityOnly(message)
  );
}

module.exports = {
  detectPatientCommercialIntent,
  patientAskedDirectPrice,
  patientAskedCostSensitivity,
  patientAskedCostSensitivityOnly,
  patientAskedDurationOnly,
  treatmentMatchesTopic,
};
