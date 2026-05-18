/**
 * Patient context & communication strategy — travel coordination gating.
 *
 * Default: assume local patient; suppress hotel/transfer/accommodation topics
 * unless explicit travel/international intent is detected.
 */

const { TRAVEL_BOOKING_GUARDRAIL_PROMPT, buildTravelAccommodationPromptBlock } =
  require("./clinicTravelPrompt");

/** @typedef {'local_patient'|'domestic_traveler'|'international_patient'|'unknown_context'} PatientContextClass */

const TRAVEL_SIGNAL_PATTERNS = [
  /\b(i'?m|i am|we are)\s+(coming|traveling|travelling|flying)\s+(from|to)\b/i,
  /\b(coming|travel|travelling|traveling)\s+(from|to)\s+[a-z]/i,
  /\b(from|i live in)\s+(germany|uk|england|france|usa|u\.s\.|netherlands|belgium|saudi|dubai|russia|georgia|turkey|türkiye|iran|iraq|ukraine|poland|italy|spain)\b/i,
  /\b(international\s+patient|dental\s+tourism|medical\s+tourism)\b/i,
  /\b(hotel|accommodation|airport\s+transfer|airport\s+pickup|where\s+to\s+stay|place\s+to\s+stay)\b/i,
  /\b(help\s+with|need)\s+(hotel|accommodation|transfer|flight)\b/i,
  /\bhow\s+many\s+visits\b/i,
  /\bhow\s+many\s+(days|nights|visits)\s+(do\s+i|should\s+i|are)\s+(need|stay|required)\b/i,
  /\b(how\s+long|how\s+many\s+trips).{0,40}(stay|visit|in\s+(turkey|istanbul|tbilisi|georgia))\b/i,
  /\bcan\s+you\s+help\s+with\s+(travel|accommodation|hotel|transfer)\b/i,
  /\bvisit\s+coordination|travel\s+dates|arrival\s+date|departure\s+date\b/i,
];

const EXPLICIT_TRAVEL_QUESTION =
  /\b(hotel|accommodation|airport|transfer|where\s+to\s+stay|travel\s+plan|flight)\b/i;

const CLINIC_HOME_COUNTRY_TOKENS = new Set([
  "tr",
  "turkey",
  "türkiye",
  "turkiye",
  "ge",
  "georgia",
  "geo",
]);

/**
 * @param {string} codeOrName
 */
function normalizeCountryToken(codeOrName) {
  return String(codeOrName || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
}

/**
 * @param {{
 *   message?: string|null,
 *   conversationSummary?: string|null,
 *   leadData?: Record<string, unknown>|null,
 *   profileRow?: Record<string, unknown>|null,
 *   clinicProfile?: Record<string, unknown>|null,
 * }} params
 */
function detectTravelContextSignals(params) {
  const parts = [
    params.message,
    params.conversationSummary,
    params.leadData?.travelTimeline,
    params.leadData?.travel_timeline,
  ].filter(Boolean);
  const combined = parts.join("\n");
  const signals = [];

  for (const re of TRAVEL_SIGNAL_PATTERNS) {
    if (re.test(combined)) signals.push(re.source.slice(0, 48));
  }

  const patientCountry = normalizeCountryToken(
    params.leadData?.country || params.profileRow?.country,
  );
  if (
    patientCountry &&
    patientCountry.length >= 2 &&
    !CLINIC_HOME_COUNTRY_TOKENS.has(patientCountry)
  ) {
    signals.push("patient_country_differs");
  }

  const flags =
    params.profileRow?.operational_intake_flags &&
    typeof params.profileRow.operational_intake_flags === "object"
      ? params.profileRow.operational_intake_flags
      : {};
  if (flags.travelContextDetected === true || flags.internationalInquiry === true) {
    signals.push("persisted_travel_flag");
  }

  const clinicAudience = String(
    params.clinicProfile?.communicationPolicy?.patientAudience ||
      params.clinicProfile?.knowledgeBase?.patientAudience ||
      "",
  )
    .trim()
    .toLowerCase();
  if (clinicAudience === "dental_tourism_focused" && EXPLICIT_TRAVEL_QUESTION.test(combined)) {
    signals.push("clinic_tourism_focused_explicit_travel_question");
  }

  return [...new Set(signals)];
}

/**
 * @param {string[]} signals
 * @param {Record<string, unknown>|null} [leadData]
 */
function classifyPatientContext(signals, leadData) {
  if (!signals.length) return "local_patient";
  const country = normalizeCountryToken(leadData?.country);
  if (country && country.length >= 2 && !CLINIC_HOME_COUNTRY_TOKENS.has(country)) {
    return "international_patient";
  }
  if (signals.some((s) => /country|international|tourism|from|coming|traveling/i.test(s))) {
    return "international_patient";
  }
  return "domestic_traveler";
}

const TRAVEL_SUPPRESSION_PROMPT = `
PATIENT CONTEXT — DEFAULT LOCAL (strategy layer):
* Assume this patient is local or same-city unless travel intent is explicitly established in the conversation.
* Do NOT proactively mention hotels, airport transfers, accommodation, travel planning, tourism logistics, or multi-visit travel coordination.
* If the patient asks only about price, treatment, or clinical steps, answer directly without travel add-ons.
* Only discuss stay/transfer/logistics when the patient clearly indicates they are traveling for treatment or asks about accommodation/transfer.
* Sound like a human coordinator — real staff do not jump to hotel/airport talk on a simple pricing question.`;

/**
 * @param {{
 *   message?: string|null,
 *   conversationSummary?: string|null,
 *   leadData?: Record<string, unknown>|null,
 *   profileRow?: Record<string, unknown>|null,
 *   clinicProfile?: Record<string, unknown>|null,
 * }} params
 */
function resolvePatientContextStrategy(params) {
  const signals = detectTravelContextSignals(params);
  const travel_context_detected = signals.length > 0;
  const avoid_travel_coordination_topics = !travel_context_detected;
  const patient_context_class = travel_context_detected
    ? classifyPatientContext(signals, params.leadData || {})
    : "local_patient";

  return {
    travel_context_detected,
    avoid_travel_coordination_topics,
    patient_context_class,
    signals,
  };
}

/**
 * System-prompt block for coordinator / expand paths.
 * @param {ReturnType<typeof resolvePatientContextStrategy>} strategy
 */
function buildPatientContextStrategyPromptBlock(strategy) {
  const lines = [
    `Patient context class: ${strategy.patient_context_class}`,
    `travel_context_detected: ${strategy.travel_context_detected}`,
    `avoid_travel_coordination_topics: ${strategy.avoid_travel_coordination_topics}`,
  ];
  if (strategy.avoid_travel_coordination_topics) {
    return `${TRAVEL_SUPPRESSION_PROMPT}\n${lines.join("\n")}`;
  }
  return `${TRAVEL_BOOKING_GUARDRAIL_PROMPT}\n${lines.join("\n")}`;
}

/**
 * User-context hotel list — only when travel strategy allows.
 * @param {ReturnType<typeof resolvePatientContextStrategy>} strategy
 * @param {import('./clinicTravelTypes').ClinicPartnerHotelDto[]} hotels
 */
function buildTravelContextForStrategy(strategy, hotels) {
  if (strategy.avoid_travel_coordination_topics) return null;
  return buildTravelAccommodationPromptBlock(hotels);
}

/**
 * Merge strategy snapshot into operational_intake_flags for persistence.
 * @param {Record<string, unknown>} flags
 * @param {ReturnType<typeof resolvePatientContextStrategy>} strategy
 */
function mergePatientContextStrategyFlags(flags, strategy) {
  const base = flags && typeof flags === "object" ? { ...flags } : {};
  return {
    ...base,
    travelContextDetected: strategy.travel_context_detected,
    avoidTravelCoordinationTopics: strategy.avoid_travel_coordination_topics,
    patientContextClass: strategy.patient_context_class,
    travelContextSignals: strategy.signals,
  };
}

module.exports = {
  TRAVEL_SUPPRESSION_PROMPT,
  resolvePatientContextStrategy,
  buildPatientContextStrategyPromptBlock,
  buildTravelContextForStrategy,
  mergePatientContextStrategyFlags,
  detectTravelContextSignals,
};
