/**
 * Structured intent taxonomy for doctor-supervised AI communication.
 */

const INTENT_TAGS = Object.freeze([
  "reassure_patient",
  "explain_process",
  "request_xray",
  "request_cbct",
  "explain_timeline",
  "discuss_pricing",
  "reduce_anxiety",
  "encourage_consultation",
  "collect_patient_info",
  "schedule_visit",
]);

const INTENT_TAG_SET = new Set(INTENT_TAGS);

const REWRITE_ACTIONS = Object.freeze([
  "shorter",
  "simpler",
  "more_empathetic",
  "more_professional",
  "reassure_patient",
  "more_concise",
]);

const REWRITE_ACTION_SET = new Set(REWRITE_ACTIONS);

const REWRITE_PROMPTS = Object.freeze({
  shorter: "Make the message noticeably shorter while keeping all essential information.",
  simpler: "Use simpler, clearer language suitable for a non-medical reader.",
  more_empathetic: "Add warmth and empathy; acknowledge the patient's situation calmly.",
  more_professional: "Use a polished, professional clinic tone without being cold.",
  reassure_patient: "Emphasize reassurance and reduce anxiety; avoid alarming wording.",
  more_concise: "Tighten wording; remove redundancy; keep one clear next step if any.",
});

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeIntentTags(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((t) => String(t || "").trim()).filter((t) => INTENT_TAG_SET.has(t)))];
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeStringList(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      return raw
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }
  return raw.map((s) => String(s || "").trim()).filter(Boolean);
}

/**
 * @param {unknown} action
 */
function normalizeRewriteAction(action) {
  const a = String(action || "").trim();
  return REWRITE_ACTION_SET.has(a) ? a : null;
}

module.exports = {
  INTENT_TAGS,
  INTENT_TAG_SET,
  REWRITE_ACTIONS,
  REWRITE_ACTION_SET,
  REWRITE_PROMPTS,
  normalizeIntentTags,
  normalizeStringList,
  normalizeRewriteAction,
};
