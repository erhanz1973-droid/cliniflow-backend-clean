/**
 * Conversion Coordinator presets, CTA catalog, and safety phrase categories.
 * Clinics pick a preset — no manual prompt writing required.
 */

const COORDINATOR_INTENSITY = Object.freeze({
  GENTLE: "gentle",
  BALANCED: "balanced",
  PROACTIVE: "proactive",
});

const CTA_STYLE = Object.freeze({
  SOFT: "soft",
  BALANCED: "balanced",
  PROACTIVE: "proactive",
});

const NEXT_STEP_TARGETS = Object.freeze({
  COLLECT_XRAY: "collect_xray",
  BOOK_CONSULTATION: "book_consultation",
  START_WHATSAPP: "start_whatsapp",
  SCHEDULE_VISIT: "schedule_visit",
  COLLECT_PATIENT_INFO: "collect_patient_info",
  EXPLAIN_TREATMENT_PROCESS: "explain_treatment_process",
});

const CONVERSION_TIMELINE_EVENTS = Object.freeze([
  "conversion_signal",
  "hesitation_detected",
  "trust_increase",
  "price_objection",
  "cold_lead_risk",
]);

/** @type {Record<string, { label: string, examples: string[] }>} */
const CTA_STYLE_CATALOG = {
  soft: {
    label: "Soft",
    examples: [
      "If you'd like, I can also explain the process.",
      "Happy to share more detail whenever it helps.",
    ],
  },
  balanced: {
    label: "Balanced",
    examples: [
      "If it helps, I can outline the usual visit steps and what to prepare.",
      "Would you like a short overview of timing and visits before you decide anything?",
    ],
  },
  proactive: {
    label: "Proactive",
    examples: [
      "You can upload your panoramic X-ray anytime for a more detailed review.",
      "When you're ready, we can look at consultation dates that fit your travel plans.",
    ],
  },
};

function buildDefaultForbiddenCategories() {
  return {
    forbidden_claims: [
      "you definitely need",
      "you must get implants",
      "this treatment is required",
    ],
    forbidden_guarantees: [
      "100% painless",
      "guaranteed result",
      "guaranteed success",
      "will definitely work",
      "completely safe",
      "zero risk",
    ],
    forbidden_diagnosis: [
      "you have an infection",
      "this is definitely a cavity",
      "you need a root canal",
      "i diagnose",
    ],
    forbidden_urgency: [
      "limited time only",
      "act now or lose",
      "last chance",
      "only today",
      "book now or miss out",
    ],
  };
}

function buildDefaultConversionConfig() {
  return {
    version: 2,
    preset: "soft_conversion_coordinator",
    coordinatorIntensity: COORDINATOR_INTENSITY.GENTLE,
    ctaStyle: CTA_STYLE.SOFT,
    pricingBehavior: "educate_then_range",
    followUpStyle: "gentle_check_in",
    nextStepPreference: [NEXT_STEP_TARGETS.EXPLAIN_TREATMENT_PROCESS, NEXT_STEP_TARGETS.COLLECT_XRAY],
    forbiddenCategories: buildDefaultForbiddenCategories(),
    escalationRules: {
      escalateOnAngry: true,
      escalateOnEmergency: true,
      escalateOnRefund: true,
      escalateAfterStalledHours: 48,
    },
    recordTimelineEvents: true,
    enabled: true,
  };
}

/** @type {Record<string, { label: string, description: string, config: ReturnType<typeof buildDefaultConversionConfig> }>} */
const PRESET_CATALOG = {
  soft_conversion_coordinator: {
    label: "Soft Conversion Coordinator",
    description: "Default — warm, trust-first, gentle next steps. Recommended for most clinics.",
    config: buildDefaultConversionConfig(),
  },
  luxury_clinic: {
    label: "Luxury Clinic",
    description: "Premium tone, consultative pacing, emphasis on personalized care.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "luxury_clinic",
      coordinatorIntensity: COORDINATOR_INTENSITY.GENTLE,
      ctaStyle: CTA_STYLE.SOFT,
      nextStepPreference: [
        NEXT_STEP_TARGETS.BOOK_CONSULTATION,
        NEXT_STEP_TARGETS.EXPLAIN_TREATMENT_PROCESS,
      ],
      followUpStyle: "gentle_check_in",
    },
  },
  budget_clinic: {
    label: "Budget Clinic",
    description: "Clear pricing context, transparent ranges, practical next steps.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "budget_clinic",
      coordinatorIntensity: COORDINATOR_INTENSITY.BALANCED,
      ctaStyle: CTA_STYLE.BALANCED,
      pricingBehavior: "educate_then_range",
      nextStepPreference: [
        NEXT_STEP_TARGETS.COLLECT_XRAY,
        NEXT_STEP_TARGETS.BOOK_CONSULTATION,
      ],
    },
  },
  dental_tourism: {
    label: "Dental Tourism",
    description: "Travel-aware coordination, visit planning, international patient support.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "dental_tourism",
      coordinatorIntensity: COORDINATOR_INTENSITY.BALANCED,
      ctaStyle: CTA_STYLE.BALANCED,
      nextStepPreference: [
        NEXT_STEP_TARGETS.SCHEDULE_VISIT,
        NEXT_STEP_TARGETS.COLLECT_XRAY,
        NEXT_STEP_TARGETS.START_WHATSAPP,
      ],
    },
  },
  implant_focused: {
    label: "Implant Focused",
    description: "Implant journeys — imaging, bone context, visit phases without clinical diagnosis.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "implant_focused",
      coordinatorIntensity: COORDINATOR_INTENSITY.BALANCED,
      ctaStyle: CTA_STYLE.BALANCED,
      nextStepPreference: [
        NEXT_STEP_TARGETS.COLLECT_XRAY,
        NEXT_STEP_TARGETS.EXPLAIN_TREATMENT_PROCESS,
        NEXT_STEP_TARGETS.BOOK_CONSULTATION,
      ],
    },
  },
  cosmetic_dentistry: {
    label: "Cosmetic Dentistry",
    description: "Smile goals, photos, aesthetic consults — low pressure.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "cosmetic_dentistry",
      coordinatorIntensity: COORDINATOR_INTENSITY.GENTLE,
      ctaStyle: CTA_STYLE.SOFT,
      nextStepPreference: [
        NEXT_STEP_TARGETS.COLLECT_PATIENT_INFO,
        NEXT_STEP_TARGETS.BOOK_CONSULTATION,
      ],
    },
  },
  international_patients: {
    label: "International Patients",
    description: "Language-friendly coordination, travel timeline, WhatsApp when appropriate.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "international_patients",
      coordinatorIntensity: COORDINATOR_INTENSITY.BALANCED,
      ctaStyle: CTA_STYLE.BALANCED,
      nextStepPreference: [
        NEXT_STEP_TARGETS.START_WHATSAPP,
        NEXT_STEP_TARGETS.SCHEDULE_VISIT,
        NEXT_STEP_TARGETS.COLLECT_XRAY,
      ],
    },
  },
  balanced_coordinator: {
    label: "Balanced Coordinator",
    description: "Legacy preset — balanced intensity and CTA.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "balanced_coordinator",
      coordinatorIntensity: COORDINATOR_INTENSITY.BALANCED,
      ctaStyle: CTA_STYLE.BALANCED,
    },
  },
  consultation_focused: {
    label: "Consultation Focused",
    description: "Prioritize booking a consultation after trust is established.",
    config: {
      ...buildDefaultConversionConfig(),
      preset: "consultation_focused",
      coordinatorIntensity: COORDINATOR_INTENSITY.PROACTIVE,
      ctaStyle: CTA_STYLE.PROACTIVE,
      nextStepPreference: [NEXT_STEP_TARGETS.BOOK_CONSULTATION, NEXT_STEP_TARGETS.SCHEDULE_VISIT],
      followUpStyle: "proactive_next_step",
    },
  },
};

const INTENSITY_LEGACY_MAP = {
  low: COORDINATOR_INTENSITY.GENTLE,
  medium: COORDINATOR_INTENSITY.BALANCED,
  high: COORDINATOR_INTENSITY.PROACTIVE,
  informational: COORDINATOR_INTENSITY.GENTLE,
  coordinator: COORDINATOR_INTENSITY.BALANCED,
  conversion_focused: COORDINATOR_INTENSITY.PROACTIVE,
};

const CTA_LEGACY_MAP = {
  soft: CTA_STYLE.SOFT,
  medium: CTA_STYLE.BALANCED,
  firm: CTA_STYLE.PROACTIVE,
  high: CTA_STYLE.PROACTIVE,
};

const NEXT_STEP_LABELS = {
  collect_xray: "Collect panoramic X-ray / imaging",
  book_consultation: "Book consultation",
  start_whatsapp: "Start WhatsApp conversation",
  schedule_visit: "Schedule clinic visit",
  collect_patient_info: "Collect patient information",
  explain_treatment_process: "Explain treatment process",
};

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

/**
 * @param {unknown} raw
 */
function normalizeForbiddenCategories(raw) {
  const defaults = buildDefaultForbiddenCategories();
  const d = raw && typeof raw === "object" ? raw : {};
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const src = d[key];
    if (Array.isArray(src)) {
      out[key] = src.map((s) => String(s).trim()).filter(Boolean);
    }
  }
  return out;
}

/**
 * Flatten categories + legacy forbiddenPhrases array.
 * @param {{ forbiddenCategories?: Record<string, string[]>, forbiddenPhrases?: string[] }} cfg
 */
function flattenForbiddenPhrases(cfg) {
  const cats = normalizeForbiddenCategories(cfg.forbiddenCategories);
  const legacy = Array.isArray(cfg.forbiddenPhrases)
    ? cfg.forbiddenPhrases.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return [...Object.values(cats).flat(), ...legacy];
}

/**
 * @param {unknown} raw
 */
function normalizeConversionConfig(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const presetKey = String(d.preset || "soft_conversion_coordinator").trim().toLowerCase();
  const presetDef = PRESET_CATALOG[presetKey] || PRESET_CATALOG.soft_conversion_coordinator;
  const base = presetDef.config;

  let intensity = String(
    d.coordinatorIntensity ||
      d.coordinator_intensity ||
      d.conversionIntensity ||
      d.conversion_intensity ||
      base.coordinatorIntensity,
  )
    .trim()
    .toLowerCase();
  intensity = INTENSITY_LEGACY_MAP[intensity] || intensity;
  if (!Object.values(COORDINATOR_INTENSITY).includes(intensity)) {
    intensity = COORDINATOR_INTENSITY.GENTLE;
  }

  let cta = String(d.ctaStyle || d.cta_style || d.ctaAggressiveness || d.cta_aggressiveness || base.ctaStyle)
    .trim()
    .toLowerCase();
  cta = CTA_LEGACY_MAP[cta] || cta;
  if (!Object.values(CTA_STYLE).includes(cta)) cta = CTA_STYLE.SOFT;

  let nextSteps = d.nextStepPreference || d.next_step_preference || base.nextStepPreference;
  if (!Array.isArray(nextSteps)) nextSteps = [nextSteps].filter(Boolean);
  nextSteps = nextSteps
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => Object.values(NEXT_STEP_TARGETS).includes(s));
  if (!nextSteps.length) nextSteps = base.nextStepPreference;

  const merged = deepMerge(base, {
    ...d,
    version: Math.max(Number(d.version) || 0, 2),
    preset: presetDef.config.preset,
    coordinatorIntensity: intensity,
    ctaStyle: cta,
    nextStepPreference: nextSteps,
    forbiddenCategories: normalizeForbiddenCategories(d.forbiddenCategories || d.forbidden_categories),
    escalationRules: {
      ...base.escalationRules,
      ...(isPlainObject(d.escalationRules) ? d.escalationRules : {}),
    },
    recordTimelineEvents: d.recordTimelineEvents !== false,
    enabled: d.enabled !== false,
  });

  return merged;
}

/**
 * @param {string} ctaStyle
 */
function getCtaStyleDefinition(ctaStyle) {
  return CTA_STYLE_CATALOG[ctaStyle] || CTA_STYLE_CATALOG.soft;
}

module.exports = {
  COORDINATOR_INTENSITY,
  CTA_STYLE,
  NEXT_STEP_TARGETS,
  NEXT_STEP_LABELS,
  CONVERSION_TIMELINE_EVENTS,
  CTA_STYLE_CATALOG,
  PRESET_CATALOG,
  buildDefaultConversionConfig,
  buildDefaultForbiddenCategories,
  normalizeConversionConfig,
  normalizeForbiddenCategories,
  flattenForbiddenPhrases,
  getCtaStyleDefinition,
};
