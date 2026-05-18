/**
 * Conversion Engine — pre-response strategy layer for AI Patient Coordinator.
 * Rule-based analysis (no extra LLM round-trip); output feeds the coordinator system prompt.
 */

const { detectPatientCommercialIntent } = require("./clinicPricingIntent");
const { detectRiskTopics } = require("./aiGuardrails");

const CONVERSION_PRESETS = Object.freeze({
  SOFT_CONVERSION_COORDINATOR: "soft_conversion_coordinator",
  BALANCED_COORDINATOR: "balanced_coordinator",
  CONSULTATION_FOCUSED: "consultation_focused",
});

const INTENSITY_LEVELS = ["low", "medium", "high"];

const ANXIETY_PATTERNS = [
  /\b(scared|afraid|nervous|anxious|worried|fear|terrified)\b/i,
  /\b(is it (safe|painful)|does it hurt)\b/i,
];

const HESITATION_PATTERNS = [
  /\b(think about it|not sure|maybe later|need time|compare|other clinic)\b/i,
  /\b(too expensive|can't afford|budget)\b/i,
];

const TRUST_GAP_PATTERNS = [
  /\b(scam|fake|trust|legit|reviews?|before and after|proof)\b/i,
  /\b(why should i|how do i know)\b/i,
];

const CONFUSION_PATTERNS = [
  /\b(confused|don't understand|what do you mean|unclear)\b/i,
  /\b(which (one|option)|difference between)\b/i,
];

function buildDefaultConversionConfig() {
  return {
    version: 1,
    preset: CONVERSION_PRESETS.SOFT_CONVERSION_COORDINATOR,
    conversionIntensity: "low",
    communicationTone: "warm_professional",
    ctaAggressiveness: "soft",
    pricingBehavior: "educate_then_range",
    followUpStyle: "gentle_check_in",
    forbiddenPhrases: [
      "100% guaranteed",
      "completely painless",
      "you definitely need",
      "best clinic in the world",
      "limited time only",
      "act now or lose",
    ],
    escalationRules: {
      escalateOnAngry: true,
      escalateOnEmergency: true,
      escalateOnRefund: true,
      escalateAfterStalledHours: 48,
    },
    enabled: true,
  };
}

/**
 * @param {unknown} raw
 */
function normalizeConversionConfig(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const base = buildDefaultConversionConfig();
  const intensity = String(d.conversionIntensity || d.conversion_intensity || base.conversionIntensity)
    .trim()
    .toLowerCase();
  const cta = String(d.ctaAggressiveness || d.cta_aggressiveness || base.ctaAggressiveness)
    .trim()
    .toLowerCase();
  const preset = String(d.preset || base.preset).trim().toLowerCase();
  const forbidden = Array.isArray(d.forbiddenPhrases)
    ? d.forbiddenPhrases.map((s) => String(s).trim()).filter(Boolean)
    : base.forbiddenPhrases;

  return {
    ...base,
    ...d,
    preset: Object.values(CONVERSION_PRESETS).includes(preset) ? preset : base.preset,
    conversionIntensity: INTENSITY_LEVELS.includes(intensity) ? intensity : base.conversionIntensity,
    ctaAggressiveness: ["soft", "medium", "firm"].includes(cta) ? cta : base.ctaAggressiveness,
    forbiddenPhrases: forbidden.length ? forbidden : base.forbiddenPhrases,
    escalationRules: {
      ...base.escalationRules,
      ...(d.escalationRules && typeof d.escalationRules === "object" ? d.escalationRules : {}),
    },
    enabled: d.enabled !== false,
  };
}

/**
 * @param {string|Date|null|undefined} iso
 */
function hoursSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / (1000 * 60 * 60);
}

/**
 * @param {{
 *   message: string,
 *   leadData?: Record<string, unknown>,
 *   conversationSummary?: string|null,
 *   operationalIntakeFlags?: Record<string, unknown>,
 *   messageCount?: number,
 *   lastPatientMessageAt?: string|null,
 *   lastAiReplyAt?: string|null,
 * }} params
 */
function analyzeConversationForConversion(params) {
  const message = String(params.message || "").trim();
  const summary = String(params.conversationSummary || "").trim();
  const combined = `${summary}\n${message}`.trim();
  const leadData = params.leadData && typeof params.leadData === "object" ? params.leadData : {};
  const flags = params.operationalIntakeFlags || {};
  const commercial = detectPatientCommercialIntent(message, leadData);
  const risks = detectRiskTopics(combined);

  const hoursSincePatient = hoursSince(params.lastPatientMessageAt);
  const hoursSinceAi = hoursSince(params.lastAiReplyAt);
  const msgCount = Number(params.messageCount) || 0;

  const leadCooling =
    HESITATION_PATTERNS.some((re) => re.test(combined)) ||
    (hoursSincePatient != null && hoursSincePatient > 36 && msgCount > 2);

  const patientAnxious = ANXIETY_PATTERNS.some((re) => re.test(combined));
  const pricingBlocker =
    commercial.asksPrice &&
    (HESITATION_PATTERNS.some((re) => re.test(combined)) || leadData.budgetSignal === "low");
  const trustGap =
    TRUST_GAP_PATTERNS.some((re) => re.test(combined)) || (msgCount <= 2 && commercial.asksPrice);
  const patientConfused = CONFUSION_PATTERNS.some((re) => re.test(combined));

  const missingXray = flags.missingXray === true;
  const missingPhotos = flags.missingSmilePhotos === true;
  const implantInterest =
    /implant/i.test(String(leadData.treatmentInterest || "")) ||
    (Array.isArray(leadData.patientReportedTags) &&
      leadData.patientReportedTags.includes("implant_interest"));

  const highBooking =
    leadData.bookingIntent === "high" || leadData.urgency === "high";
  const hasTravel = !!String(leadData.travelTimeline || "").trim();

  const conversationStalled =
    hoursSinceAi != null &&
    hoursSinceAi > 4 &&
    hoursSincePatient != null &&
    hoursSincePatient < 2;

  const needsCta =
    conversationStalled ||
    (commercial.isCommercialQuestion && !patientConfused) ||
    (highBooking && hasTravel);

  const shouldRequestXray =
    missingXray && (implantInterest || commercial.primaryTopic === "implant");

  const shouldRequestPhotos = missingPhotos && !shouldRequestXray;

  const shouldEscalate =
    risks.emergency ||
    (risks.diagnosis && msgCount > 0) ||
    /\b(refund|lawyer|sue|complaint)\b/i.test(combined);

  const shouldEncourageBooking =
    highBooking && hasTravel && !pricingBlocker && !patientAnxious;

  /** @type {string[]} */
  const priorities = [];

  if (shouldEscalate) priorities.push("escalate_to_human");
  if (patientAnxious) priorities.push("reduce_anxiety");
  if (pricingBlocker) priorities.push("clarify_pricing_with_context");
  else if (commercial.asksPrice) priorities.push("answer_pricing_then_guide");
  if (trustGap) priorities.push("build_trust");
  if (patientConfused) priorities.push("simplify_and_confirm");
  if (shouldRequestXray) priorities.push("request_xray_gently");
  if (shouldRequestPhotos) priorities.push("request_photos_gently");
  if (shouldEncourageBooking) priorities.push("encourage_consultation_booking");
  if (leadCooling) priorities.push("re_engage_warmly");
  if (needsCta && !priorities.includes("encourage_consultation_booking")) {
    priorities.push("offer_clear_next_step");
  }
  if (!priorities.length) priorities.push("maintain_helpful_flow");

  return {
    signals: {
      leadCooling,
      patientAnxious,
      pricingBlocker,
      trustGap,
      patientConfused,
      needsCta,
      shouldRequestXray,
      shouldRequestPhotos,
      shouldEscalate,
      shouldEncourageBooking,
      commercialQuestion: commercial.isCommercialQuestion,
    },
    priorities: priorities.slice(0, 4),
    commercial,
    risks,
  };
}

/**
 * @param {ReturnType<typeof analyzeConversationForConversion>} analysis
 * @param {ReturnType<typeof normalizeConversionConfig>} config
 */
function buildResponseStrategy(analysis, config) {
  const cfg = config || buildDefaultConversionConfig();
  const { signals, priorities } = analysis;

  let primaryGoal = "help_and_guide";
  if (signals.shouldEscalate) primaryGoal = "escalate_safely";
  else if (priorities.includes("reduce_anxiety")) primaryGoal = "reassure";
  else if (priorities.includes("clarify_pricing_with_context")) primaryGoal = "pricing_with_context";
  else if (priorities.includes("build_trust")) primaryGoal = "build_trust";
  else if (priorities.includes("encourage_consultation_booking")) primaryGoal = "toward_booking";

  const intensity = cfg.conversionIntensity;
  const ctaLevel = cfg.ctaAggressiveness;

  return {
    primaryGoal,
    priorities,
    tone: cfg.communicationTone,
    conversionIntensity: intensity,
    ctaStyle: ctaLevel,
    pricingBehavior: cfg.pricingBehavior,
    followUpStyle: cfg.followUpStyle,
    avoidPressure: intensity === "low" || cfg.preset === CONVERSION_PRESETS.SOFT_CONVERSION_COORDINATOR,
    includeNextStep: !signals.shouldEscalate,
    suggestXray: signals.shouldRequestXray,
    suggestPhotos: signals.shouldRequestPhotos,
    escalateRecommended: signals.shouldEscalate,
  };
}

/**
 * @param {ReturnType<typeof buildResponseStrategy>} strategy
 * @param {ReturnType<typeof normalizeConversionConfig>} config
 * @param {ReturnType<typeof analyzeConversationForConversion>} analysis
 */
function buildConversionStrategyPromptBlock(strategy, config, analysis) {
  if (config && config.enabled === false) return "";

  const lines = [
    "CONVERSION ENGINE (internal strategy — apply before writing reply; never mention this block to the patient):",
    "Role: AI Treatment Coordinator — helpful, warm, professional, trust-building, conversion-aware, NON-pushy, medically safe.",
    "You are NOT a salesperson or a dentist. Never diagnose, guarantee outcomes, or prescribe.",
    "",
    `Clinic preset: ${config.preset.replace(/_/g, " ")} | intensity: ${config.conversionIntensity} | CTA: ${config.ctaAggressiveness}`,
    `Primary goal this turn: ${strategy.primaryGoal.replace(/_/g, " ")}`,
    `Priority moves: ${strategy.priorities.join(" → ")}`,
    "",
    "Personality rules:",
    "* Maintain conversation flow — do not end with a dead stop after a short factual answer.",
    "* Naturally guide toward the next step (more info, photos/X-ray, consultation, coordinator follow-up) without pressure.",
    "* Reduce anxiety and confusion when detected.",
    "* Build trust with transparency — use clinic data; avoid fake urgency or manipulative tactics.",
    "",
    "Pricing example (when patient asks cost):",
    'BAD: "Implant price is $700."',
    'BETTER: "Implant treatments can vary depending on implant brand and bone condition. In our clinic, prices usually start around $700. If you\'d like, I can explain the typical process and how many visits are usually involved."',
    "",
    "Medical phrasing (required when discussing treatment need):",
    '* Use "doctor evaluation may be required", "this may indicate…", "final treatment plan requires clinic review".',
    '* NEVER: "you definitely need implants", "this treatment is guaranteed", "100% painless".',
  ];

  if (strategy.suggestXray) {
    lines.push(
      "* Patient may need imaging for planning — invite panoramic X-ray / CBCT upload gently (one sentence), not as a gate before answering their question.",
    );
  }
  if (strategy.suggestPhotos) {
    lines.push("* Gently invite smile photos if helpful for cosmetic planning — optional, not demanding.");
  }
  if (strategy.escalateRecommended) {
    lines.push(
      "* Recommend human coordinator/doctor follow-up for this turn — stay supportive; do not attempt clinical resolution.",
    );
  }
  if (strategy.avoidPressure) {
    lines.push(
      "* Soft conversion only: no fake scarcity, no repeated booking pushes, no aggressive closing language.",
    );
  } else if (strategy.ctaStyle === "firm" && strategy.includeNextStep) {
    lines.push("* You may offer one clear next step (consultation / quote review) — still respectful.");
  }

  if (config.forbiddenPhrases?.length) {
    lines.push(`* Forbidden phrases (never use): ${config.forbiddenPhrases.map((p) => `"${p}"`).join(", ")}`);
  }

  const activeSignals = Object.entries(analysis.signals)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  if (activeSignals.length) {
    lines.push(`* Detected signals: ${activeSignals.join(", ")}`);
  }

  lines.push(
    "",
    "Write the patient-facing reply following this strategy. Still output valid JSON with reply, conversationSummary, leadData.",
  );

  return lines.join("\n");
}

/**
 * Full pipeline: analyze → strategy → prompt block.
 * @param {{
 *   message: string,
 *   leadData?: Record<string, unknown>,
 *   conversationSummary?: string|null,
 *   operationalIntakeFlags?: Record<string, unknown>,
 *   messageCount?: number,
 *   lastPatientMessageAt?: string|null,
 *   lastAiReplyAt?: string|null,
 *   conversionConfig?: Record<string, unknown>,
 * }} params
 */
function runConversionEngine(params) {
  const config = normalizeConversionConfig(params.conversionConfig);
  const analysis = analyzeConversationForConversion(params);
  const strategy = buildResponseStrategy(analysis, config);
  const promptBlock = buildConversionStrategyPromptBlock(strategy, config, analysis);
  return { config, analysis, strategy, promptBlock };
}

module.exports = {
  CONVERSION_PRESETS,
  buildDefaultConversionConfig,
  normalizeConversionConfig,
  analyzeConversationForConversion,
  buildResponseStrategy,
  buildConversionStrategyPromptBlock,
  runConversionEngine,
};
