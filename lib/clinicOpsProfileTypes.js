/**
 * Clinic Operations Profile — section registry, defaults, orchestration metadata.
 * Source of truth layout for AI responses, offers, travel, coordinator automation.
 */

const OPS_PROFILE_SCHEMA_VERSION = 2;

/** @typedef {'OFF'|'SUGGEST_ONLY'|'AUTO_REPLY'|'FULLY_AUTONOMOUS'} AutonomyLevel */

const AUTONOMY_LEVELS = ["OFF", "SUGGEST_ONLY", "AUTO_REPLY", "FULLY_AUTONOMOUS"];

/** v2 autonomy categories (orchestration reads these keys). */
const AUTONOMY_CATEGORIES = [
  { key: "greetings", label: "Greetings", defaultLevel: "AUTO_REPLY" },
  { key: "logistics", label: "Logistics & travel coordination", defaultLevel: "AUTO_REPLY" },
  { key: "pricing_explanations", label: "Pricing explanations", defaultLevel: "AUTO_REPLY", safetyFloor: true },
  { key: "appointment_coordination", label: "Appointment coordination", defaultLevel: "SUGGEST_ONLY" },
  { key: "treatment_process_explanations", label: "Treatment process explanations", defaultLevel: "SUGGEST_ONLY" },
  { key: "post_op_guidance", label: "Post-op guidance", defaultLevel: "SUGGEST_ONLY" },
];

/** Map legacy autonomy keys → v2 (read-time migration). */
const LEGACY_AUTONOMY_KEY_MAP = {
  travel_questions: "logistics",
  hotel_transport: "logistics",
  document_reminders: "logistics",
  implant_process_explanations: "treatment_process_explanations",
  treatment_recommendations: "pricing_explanations",
};

const AUTONOMY_SAFETY_FLOOR_KEYS = AUTONOMY_CATEGORIES.filter((c) => c.safetyFloor).map((c) => c.key);

const PROFILE_TAGS = [
  { value: "luxury", label: "Luxury" },
  { value: "friendly", label: "Friendly" },
  { value: "premium", label: "Premium" },
  { value: "fast_response", label: "Fast response" },
  { value: "clinical", label: "Clinical" },
];

const TONE_STYLES = [
  { value: "warm_professional", label: "Warm + professional" },
  { value: "clinical_concise", label: "Clinical & concise" },
  { value: "friendly_casual", label: "Friendly & casual" },
  { value: "luxury_premium", label: "Luxury / premium" },
];

const SIGNATURE_STYLES = [
  { value: "name_only", label: "Assistant name only" },
  { value: "name_clinic", label: "Name + clinic" },
  { value: "none", label: "No signature" },
];

const TREATMENT_CATEGORIES = [
  { value: "implant", label: "Implant" },
  { value: "crown", label: "Crown / veneer" },
  { value: "full_mouth", label: "Full mouth" },
  { value: "cosmetic", label: "Cosmetic" },
  { value: "orthodontics", label: "Orthodontics" },
  { value: "general", label: "General" },
  { value: "other", label: "Other" },
];

/** Brand/material segment for pricing variants. */
const VARIANT_TIERS = [
  { value: "premium", label: "Premium" },
  { value: "standard", label: "Standard" },
  { value: "mid_range", label: "Mid-range" },
  { value: "budget", label: "Budget" },
];

/** Common material / system types for variant rows. */
const MATERIAL_TYPE_PRESETS = [
  { value: "implant_system", label: "Implant system" },
  { value: "zirconia", label: "Zirconia" },
  { value: "emax", label: "E.max / lithium disilicate" },
  { value: "porcelain", label: "Porcelain" },
  { value: "composite", label: "Composite" },
  { value: "other", label: "Other" },
];

const HARD_HUMAN_REVIEW_KEYS = [
  { key: "diagnosis", label: "Diagnosis" },
  { key: "surgeryDecisions", label: "Surgery decisions" },
  { key: "medicationAdvice", label: "Medication advice" },
  { key: "emergencies", label: "Emergencies" },
  { key: "complications", label: "Complications" },
];

const HANDOFF_TRIGGERS = [
  { key: "angryPatient", label: "Angry patient" },
  { key: "refundRequest", label: "Refund request" },
  { key: "severePain", label: "Severe pain" },
  { key: "legalLanguage", label: "Legal language" },
  { key: "emergencyWording", label: "Emergency wording" },
];

/**
 * Admin hub section definitions.
 * @type {Array<{ id: string, title: string, subtitle: string, storage: string, managePath?: string }>}
 */
const OPS_PROFILE_SECTIONS = [
  {
    id: "ai-profile",
    title: "Clinic AI Profile",
    subtitle: "How the AI communicates — multilingual support, tone, localized patient-facing text.",
    storage: "settings.tone",
  },
  {
    id: "materials",
    title: "Implant Brands & Materials",
    subtitle: "Brands, labs, warranty, sedation for explanatory replies.",
    storage: "settings.materials",
  },
  {
    id: "travel",
    title: "Travel & Accommodation",
    subtitle: "Partner hotels, transfers, nightly rates.",
    storage: "hotels",
    managePath: "/admin-ops-profile.html#travel",
  },
  {
    id: "logistics",
    title: "Clinic Logistics",
    subtitle: "Hours, SLA, emergency contact, same-day availability.",
    storage: "settings.logistics",
  },
  {
    id: "payment",
    title: "Payment & Financial Policies",
    subtitle: "Deposits, financing, refunds — AI uses ranges not guarantees.",
    storage: "settings.payment",
  },
  {
    id: "workflow",
    title: "Treatment Workflow Knowledge",
    subtitle: "Visit timelines, healing, temp teeth — operational not clinical.",
    storage: "protocols",
    managePath: "/admin-settings-journeys.html",
  },
  {
    id: "ai-safety",
    title: "AI Safety & Human Review",
    subtitle: "Autonomy per category + hard human-review topics.",
    storage: "settings.autonomy+safety",
  },
  {
    id: "handoff",
    title: "Human Handoff Rules",
    subtitle: "When AI escalates to coordinator or doctor.",
    storage: "settings.escalation.handoff",
  },
  {
    id: "internal-notes",
    title: "Internal AI Knowledge Notes",
    subtitle: "Positioning and clinic-specific guidance for the AI.",
    storage: "settings.internalNotes",
  },
];

function buildDefaultToneConfig() {
  return {
    version: 3,
    displayName: "Clinic Assistant",
    primaryLanguage: "en",
    supportedLanguages: [
      { code: "en", enabled: true, primary: true, humanSupport: true },
      { code: "tr", enabled: true, primary: false, humanSupport: true },
      { code: "ru", enabled: true, primary: false, humanSupport: true },
      { code: "ka", enabled: true, primary: false, humanSupport: true },
    ],
    displayNameLocalized: { en: "Clinic Assistant" },
    signatureLocalized: {},
    welcomeMessageLocalized: {},
    toneStyle: "warm_professional",
    profileTags: ["friendly", "premium"],
    signatureStyle: "name_clinic",
  };
}

function buildDefaultPricingSalesAuthority() {
  return {
    allowBrandNames: true,
    allowBrandCountry: true,
    allowPriceRanges: true,
    allowMaterialComparison: true,
    allowEstimatedQuotes: true,
    requireHumanForFinalQuote: true,
  };
}

function buildDefaultMaterialsConfig() {
  return {
    version: 1,
    implantBrands: [],
    premiumBrands: [],
    zirconiumTypes: [],
    labPartners: [],
    warrantyInformation: null,
    sedationAvailability: false,
    notes: "",
    salesAuthority: buildDefaultPricingSalesAuthority(),
  };
}

function buildDefaultLogisticsConfig() {
  return {
    version: 1,
    workingHours: { timezone: "Europe/Istanbul", weekdays: { start: "09:00", end: "18:00" } },
    weekendAvailability: false,
    emergencyContact: null,
    averageResponseSlaMinutes: 120,
    languagesSpoken: ["en", "tr"],
    sameDayTreatmentAvailable: false,
    airportTransferAvailable: false,
    vipTransferAvailable: false,
    transportationNotes: null,
  };
}

function buildDefaultPaymentPolicyConfig() {
  return {
    version: 1,
    depositRequired: false,
    depositPercent: null,
    installmentAvailable: false,
    acceptedCurrencies: ["EUR", "USD", "TRY"],
    financingSupport: false,
    refundPolicy: null,
    cancellationPolicy: null,
    notes: "",
  };
}

function buildDefaultInternalNotesConfig() {
  return {
    version: 1,
    positioningNotes: [],
    freeformNotes: "",
  };
}

function buildDefaultAutonomyConfig() {
  const categories = {};
  for (const c of AUTONOMY_CATEGORIES) categories[c.key] = c.defaultLevel;
  return { version: 2, categories };
}

function buildDefaultSafetyRules() {
  const requireHumanReview = {};
  for (const h of HARD_HUMAN_REVIEW_KEYS) requireHumanReview[h.key] = true;
  return { version: 2, requireHumanReview };
}

function buildDefaultEscalationConfig() {
  const handoff = {};
  for (const h of HANDOFF_TRIGGERS) handoff[h.key] = true;
  return {
    version: 2,
    doctorResponseSlaMinutes: 120,
    aiFallbackAfterMinutes: 30,
    coordinatorEscalationAfterMinutes: 60,
    handoff,
  };
}

module.exports = {
  OPS_PROFILE_SCHEMA_VERSION,
  AUTONOMY_LEVELS,
  AUTONOMY_CATEGORIES,
  LEGACY_AUTONOMY_KEY_MAP,
  AUTONOMY_SAFETY_FLOOR_KEYS,
  PROFILE_TAGS,
  TONE_STYLES,
  SIGNATURE_STYLES,
  TREATMENT_CATEGORIES,
  VARIANT_TIERS,
  MATERIAL_TYPE_PRESETS,
  HARD_HUMAN_REVIEW_KEYS,
  HANDOFF_TRIGGERS,
  OPS_PROFILE_SECTIONS,
  buildDefaultToneConfig,
  buildDefaultMaterialsConfig,
  buildDefaultPricingSalesAuthority,
  buildDefaultLogisticsConfig,
  buildDefaultPaymentPolicyConfig,
  buildDefaultInternalNotesConfig,
  buildDefaultAutonomyConfig,
  buildDefaultSafetyRules,
  buildDefaultEscalationConfig,
};
