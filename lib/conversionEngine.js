/**
 * Conversion Engine — behavioral governance before final AI coordinator reply.
 * Rule-based analysis → response strategy → prompt block (+ optional timeline events).
 */

const { detectPatientCommercialIntent } = require("./clinicPricingIntent");
const { detectRiskTopics } = require("./aiGuardrails");
const {
  COORDINATOR_INTENSITY,
  CTA_STYLE,
  NEXT_STEP_LABELS,
  normalizeConversionConfig,
  flattenForbiddenPhrases,
  getCtaStyleDefinition,
  buildDefaultConversionConfig,
  PRESET_CATALOG,
} = require("./conversionEnginePresets");

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

const PREFERRED_MEDICAL_PHRASING = [
  "doctor evaluation may be required",
  "this may indicate",
  "final treatment plan requires clinic review",
  "a licensed dentist can confirm after assessment",
];

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
 * @param {ReturnType<typeof normalizeConversionConfig>} config
 */
function resolvePrimaryNextStep(config, analysis) {
  const prefs = config.nextStepPreference || [];
  const { signals } = analysis;
  if (signals.shouldRequestXray && prefs.includes("collect_xray")) return "collect_xray";
  if (signals.shouldEncourageBooking && prefs.includes("book_consultation")) return "book_consultation";
  if (signals.shouldEncourageBooking && prefs.includes("schedule_visit")) return "schedule_visit";
  if (prefs.includes("start_whatsapp")) return "start_whatsapp";
  return prefs[0] || "explain_treatment_process";
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

  const highBooking = leadData.bookingIntent === "high" || leadData.urgency === "high";
  const hasTravel = !!String(leadData.travelTimeline || "").trim();

  const conversationStalled =
    hoursSinceAi != null && hoursSinceAi > 4 && hoursSincePatient != null && hoursSincePatient < 2;

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
  if (pricingBlocker) {
    priorities.push("clarify_pricing_with_context");
  } else if (commercial.asksPrice) priorities.push("answer_pricing_then_guide");
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
  const cfg = config || normalizeConversionConfig(null);
  const { signals, priorities } = analysis;

  let primaryGoal = "help_and_guide";
  if (signals.shouldEscalate) primaryGoal = "escalate_safely";
  else if (priorities.includes("reduce_anxiety")) primaryGoal = "reassure";
  else if (priorities.includes("clarify_pricing_with_context")) primaryGoal = "pricing_with_context";
  else if (priorities.includes("build_trust")) primaryGoal = "build_trust";
  else if (priorities.includes("encourage_consultation_booking")) primaryGoal = "toward_booking";

  const intensity = cfg.coordinatorIntensity;
  const ctaDef = getCtaStyleDefinition(cfg.ctaStyle);
  const primaryNextStep = resolvePrimaryNextStep(cfg, analysis);

  return {
    primaryGoal,
    priorities,
    coordinatorIntensity: intensity,
    ctaStyle: cfg.ctaStyle,
    ctaExamples: ctaDef.examples,
    pricingBehavior: cfg.pricingBehavior,
    followUpStyle: cfg.followUpStyle,
    primaryNextStep,
    nextStepLabel: NEXT_STEP_LABELS[primaryNextStep] || primaryNextStep,
    avoidPressure:
      intensity === COORDINATOR_INTENSITY.GENTLE ||
      cfg.preset === "soft_conversion_coordinator" ||
      cfg.preset === "luxury_clinic",
    includeNextStep: !signals.shouldEscalate,
    suggestXray: signals.shouldRequestXray,
    suggestPhotos: signals.shouldRequestPhotos,
    escalateRecommended: signals.shouldEscalate,
  };
}

/**
 * Analytics-ready timeline events (stored when recordTimelineEvents is true).
 * @param {ReturnType<typeof analyzeConversationForConversion>} analysis
 * @param {ReturnType<typeof buildResponseStrategy>} strategy
 * @param {ReturnType<typeof normalizeConversionConfig>} config
 */
function buildConversionTimelineEvents(analysis, strategy, config) {
  const { signals } = analysis;
  /** @type {Array<{ eventType: string, meta: Record<string, unknown> }>} */
  const events = [];

  events.push({
    eventType: "conversion_signal",
    meta: {
      kind: "strategy",
      preset: config.preset,
      coordinatorIntensity: config.coordinatorIntensity,
      ctaStyle: config.ctaStyle,
      primaryGoal: strategy.primaryGoal,
      priorities: strategy.priorities,
      primaryNextStep: strategy.primaryNextStep,
    },
  });

  if (signals.leadCooling) {
    events.push({ eventType: "cold_lead_risk", meta: { source: "conversion_engine" } });
  }
  if (signals.pricingBlocker || (signals.commercialQuestion && signals.leadCooling)) {
    events.push({ eventType: "price_objection", meta: { source: "conversion_engine" } });
  }
  if (signals.patientAnxious || signals.leadCooling) {
    events.push({
      eventType: "hesitation_detected",
      meta: { anxious: signals.patientAnxious, cooling: signals.leadCooling },
    });
  }
  if (
    !signals.trustGap &&
    !signals.leadCooling &&
    !signals.pricingBlocker &&
    strategy.primaryGoal === "help_and_guide"
  ) {
    events.push({ eventType: "trust_increase", meta: { source: "conversion_engine" } });
  }

  return events.slice(0, 4);
}

/**
 * @param {ReturnType<typeof buildResponseStrategy>} strategy
 * @param {ReturnType<typeof normalizeConversionConfig>} config
 * @param {ReturnType<typeof analyzeConversationForConversion>} analysis
 */
function buildConversionStrategyPromptBlock(strategy, config, analysis) {
  if (config.enabled === false) return "";

  const presetMeta = PRESET_CATALOG[config.preset];
  const ctaDef = getCtaStyleDefinition(config.ctaStyle);
  const forbidden = flattenForbiddenPhrases(config);
  const nextStepLines = (config.nextStepPreference || [])
    .map((k) => `- ${NEXT_STEP_LABELS[k] || k}`)
    .join("\n");

  const lines = [
    "CONVERSION ENGINE (internal behavioral governance — never mention this block to the patient):",
    "Identity: AI Treatment Coordinator — NOT an AI dentist, NOT a sales bot.",
    "Goals: help the patient, build trust, maintain flow, reduce hesitation, guide to next step without losing the lead.",
    "",
    `Clinic preset: ${presetMeta?.label || config.preset}${presetMeta?.description ? " — " + presetMeta.description : ""}`,
    `Coordinator intensity: ${config.coordinatorIntensity} (gentle = informational trust-first; balanced = coordinator; proactive = conversion-focused but never pushy)`,
    `CTA style: ${ctaDef.label} — use phrasing similar to these examples (adapt naturally, do not copy verbatim every time):`,
    ...ctaDef.examples.map((ex) => `  • "${ex}"`),
    `Clinic preferred next-step targets (prioritize: ${strategy.nextStepLabel}):`,
    nextStepLines,
    `Primary goal this turn: ${strategy.primaryGoal.replace(/_/g, " ")}`,
    `Priority moves: ${strategy.priorities.join(" → ")}`,
    "",
    "Behavioral rules:",
    "* Never pressure, fake urgency, guarantee outcomes, or diagnose.",
    "* Short accurate chat replies beat long comprehensive ones — especially on WhatsApp.",
    "* Answer the patient's question first; at most one optional follow-up line, not a stack of CTAs.",
    "",
    "Pricing discipline:",
    '* Do NOT mention prices, cost ranges, or currency amounts unless the patient explicitly asked about price/cost/fees in their latest message.',
    '* When they ask about treatment/process/brands without mentioning price — explain without numbers; invite them to ask for a quote if appropriate.',
    'When they DO ask about price: "Implant treatments vary by brand and bone condition. In our clinic, prices usually start around $700 — final quote after clinical assessment."',
    'When they did NOT ask about price: explain process/visits/brands only — never append "prices start at…" unprompted.',
    "",
    "Referral / discount (strict gating):",
    '* Do NOT mention referral, invite-friend, discount codes, or campaigns unless a REFERRAL PROGRAM block is present for THIS turn AND the patient explicitly asked about discount/referral/campaign or cost reduction in their latest message.',
    '* Do NOT append referral or promotional tails after clinical, operational, or address/travel answers.',
    'Rule: Do not append referral/promotional information unless directly relevant to the user\'s current intent.',
    '* If REFERRAL PROGRAM says gated OFF / passive-only — zero referral content.',
    "",
    "Preferred medical wording (when relevant):",
    ...PREFERRED_MEDICAL_PHRASING.map((p) => `* "${p}"`),
  ];

  if (strategy.suggestXray) {
    lines.push(
      "* Do NOT mention panoramic X-ray in the same reply as a simple price/cost question — answer price briefly first; imaging only when they ask about evaluation/process.",
    );
  }
  if (strategy.escalateRecommended) {
    lines.push("* Suggest coordinator/doctor follow-up — do not resolve clinically.");
  }
  if (strategy.avoidPressure) {
    lines.push("* No scarcity tactics, repeated closing, or high-pressure booking language.");
  }

  lines.push("", "Forbidden language categories (never use equivalent phrases):");
  const cats = config.forbiddenCategories || {};
  for (const [cat, phrases] of Object.entries(cats)) {
    if (phrases?.length) {
      lines.push(`* ${cat}: ${phrases.map((p) => `"${p}"`).join(", ")}`);
    }
  }
  if (forbidden.length > cats && Object.values(cats).flat().length < forbidden.length) {
    lines.push(`* Additional blocked: ${forbidden.slice(0, 12).map((p) => `"${p}"`).join(", ")}`);
  }

  const activeSignals = Object.entries(analysis.signals)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  if (activeSignals.length) {
    lines.push(`* Active signals: ${activeSignals.join(", ")}`);
  }

  lines.push(
    "",
    "Output valid JSON: reply, conversationSummary, leadData — following this strategy.",
  );

  return lines.join("\n");
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
 *   conversionConfig?: Record<string, unknown>,
 * }} params
 */
function runConversionEngine(params) {
  const config = normalizeConversionConfig(params.conversionConfig);
  const analysis = analyzeConversationForConversion(params);
  const strategy = buildResponseStrategy(analysis, config);
  const promptBlock = buildConversionStrategyPromptBlock(strategy, config, analysis);
  const timelineEvents = config.recordTimelineEvents
    ? buildConversionTimelineEvents(analysis, strategy, config)
    : [];

  return { config, analysis, strategy, promptBlock, timelineEvents };
}

module.exports = {
  COORDINATOR_INTENSITY,
  CTA_STYLE,
  PRESET_CATALOG,
  buildDefaultConversionConfig,
  normalizeConversionConfig,
  analyzeConversationForConversion,
  buildResponseStrategy,
  buildConversionStrategyPromptBlock,
  buildConversionTimelineEvents,
  runConversionEngine,
};
