/**
 * Post-generation safety filtering for clinical-guidance expansion.
 */

const { applyReplyGuardrails, detectRiskTopics, MEDICAL_GUARDRAIL_PROMPT } = require("./aiGuardrails");
const { buildDefaultForbiddenCategories } = require("./conversionEnginePresets");

const URGENCY_PATTERNS = [
  /\b(act now|last chance|only today|limited time only|book now or)\b/i,
  /\b(don'?t wait|hurry|urgent.{0,20}book)\b/i,
];

const PRESSURE_PATTERNS = [
  /\b(you must|you have to|you need to get|required to start)\b/i,
  /\b(don'?t miss out|before it'?s too late)\b/i,
];

const PREFERRED_SOFTENINGS = [
  { pattern: /\byou (have|need) (an |a )?infection\b/i, hint: "this may indicate" },
  { pattern: /\bdefinitely need\b/i, hint: "may be considered" },
  { pattern: /\bguaranteed\b/i, hint: "cannot guarantee" },
];

/**
 * @param {string} line
 * @param {string[]} forbiddenLines
 */
function lineMatchesForbidden(line, forbiddenLines) {
  const lower = String(line || "").toLowerCase();
  for (const f of forbiddenLines) {
    const needle = String(f || "").trim().toLowerCase();
    if (needle.length >= 4 && lower.includes(needle)) return needle;
  }
  return null;
}

/**
 * @param {string} text
 * @param {Record<string, string[]>} [forbiddenCategories]
 */
function scanForbiddenPhrases(text, forbiddenCategories) {
  const cats = forbiddenCategories || buildDefaultForbiddenCategories();
  const hits = [];
  const lower = String(text || "").toLowerCase();
  for (const [category, lines] of Object.entries(cats)) {
    for (const phrase of lines || []) {
      const p = String(phrase || "").trim().toLowerCase();
      if (p.length >= 4 && lower.includes(p)) {
        hits.push({ category, phrase });
      }
    }
  }
  return hits;
}

/**
 * @param {string} draft
 * @param {{ userContext?: string, forbiddenCategories?: Record<string, string[]> }} [opts]
 */
function applyClinicalGuidanceSafety(draft, opts = {}) {
  const original = String(draft || "").trim();
  let text = original;
  const risks = detectRiskTopics(text);
  const forbiddenHits = scanForbiddenPhrases(text, opts.forbiddenCategories);
  const urgency = URGENCY_PATTERNS.some((re) => re.test(text));
  const pressure = PRESSURE_PATTERNS.some((re) => re.test(text));

  const warnings = [];

  if (risks.diagnosis) warnings.push("definitive_diagnosis_language");
  if (risks.guarantee) warnings.push("guarantee_language");
  if (risks.medication) warnings.push("medication_advice");
  if (risks.emergency) warnings.push("emergency_wording");
  if (urgency) warnings.push("fake_urgency");
  if (pressure) warnings.push("pressure_tactics");
  if (forbiddenHits.length) warnings.push("forbidden_phrase");

  text = applyReplyGuardrails(text, { userMessage: opts.userContext || "" });

  if (risks.diagnosis && !/may (indicate|suggest|require)|doctor evaluation|licensed dentist/i.test(text)) {
    text = `${text}\n\nA doctor evaluation may be required before any treatment plan is confirmed.`;
  }

  if (forbiddenHits.length) {
    for (const hit of forbiddenHits) {
      const re = new RegExp(hit.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      text = text.replace(re, "[removed for safety]");
    }
    text = text.replace(/\s{2,}/g, " ").trim();
  }

  const confidence =
    warnings.length === 0 ? 0.92 : warnings.length <= 2 ? 0.78 : warnings.length <= 4 ? 0.62 : 0.45;

  return {
    patientDraft: text.trim(),
    safetyReport: {
      warnings: [...new Set(warnings)],
      forbiddenHits,
      risks,
      urgencyDetected: urgency,
      pressureDetected: pressure,
      filtered: text.trim() !== original,
    },
    confidence,
  };
}

module.exports = {
  applyClinicalGuidanceSafety,
  scanForbiddenPhrases,
  MEDICAL_GUARDRAIL_PROMPT,
};
