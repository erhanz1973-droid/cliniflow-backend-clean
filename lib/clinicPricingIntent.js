/**
 * Detect commercial / pricing intent from patient messages (operational routing).
 */

/**
 * @param {string} message
 * @param {{ treatmentInterest?: string|null }} [leadData]
 */
function detectPatientCommercialIntent(message, leadData = {}) {
  const text = [message, leadData?.treatmentInterest || ""].filter(Boolean).join(" ");
  const t = text.toLowerCase();

  const asksPrice =
    /\b(how much|what('s| is) the (price|cost)|price range|cost of|estimate|quoted?|pricing)\b/i.test(
      text,
    ) || /\b\d+\s*(€|eur|usd|\$|try|tl)\b/i.test(text);

  const asksBrand =
    /\b(which|what)\s+(implant\s+)?brand/i.test(text) ||
    /\bbrand(s)?\s+(do you|you)\s+use/i.test(text) ||
    /\bimplant\s+system/i.test(text) ||
    (/\b(country of origin|where\b.*\b(from|made))\b/i.test(text) &&
      /\bimplant|straumann|nobel|osstem|megagen/i.test(text));

  const asksDuration =
    /\b(how long|duration|how many (days|minutes|hours)|appointment (take|last))\b/i.test(text);

  /** @type {string[]} */
  const topics = [];
  if (/\bimplant/i.test(t)) topics.push("implant");
  if (/\bfilling|composite|cavity\b/i.test(t)) topics.push("filling");
  if (/\bclean(ing|er)?|hygiene|prophylaxis|scaling\b/i.test(t)) topics.push("cleaning");
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
    asksBrand,
    asksDuration,
    topics,
    isCommercialQuestion: asksPrice || asksBrand || asksDuration,
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
    cleaning: ["CLEANING", "HYGIENE", "PROPHYLAXIS", "SCALING", "POLISH"],
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

module.exports = {
  detectPatientCommercialIntent,
  treatmentMatchesTopic,
};
