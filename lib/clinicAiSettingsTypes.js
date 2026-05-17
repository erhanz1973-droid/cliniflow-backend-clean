/**
 * Clinic Operations AI Profile — schema metadata, defaults, and UI/orchestration enums.
 */

/** @typedef {'OFF'|'SUGGEST_ONLY'|'AUTO_REPLY'|'FULLY_AUTONOMOUS'} AutonomyLevel */

const AUTONOMY_LEVELS = ["OFF", "SUGGEST_ONLY", "AUTO_REPLY", "FULLY_AUTONOMOUS"];

/** Per-category autonomy keys consumed by orchestration. */
const AUTONOMY_CATEGORIES = [
  { key: "greetings", label: "Greetings & welcome", defaultLevel: "AUTO_REPLY" },
  { key: "travel_questions", label: "Travel questions", defaultLevel: "AUTO_REPLY" },
  { key: "hotel_transport", label: "Hotel & transport", defaultLevel: "AUTO_REPLY" },
  { key: "appointment_coordination", label: "Appointment coordination", defaultLevel: "SUGGEST_ONLY" },
  { key: "document_reminders", label: "Document reminders", defaultLevel: "AUTO_REPLY" },
  { key: "implant_process_explanations", label: "Implant process explanations", defaultLevel: "SUGGEST_ONLY" },
  { key: "pricing_explanations", label: "Pricing explanations", defaultLevel: "SUGGEST_ONLY", safetyFloor: true },
  { key: "treatment_recommendations", label: "Treatment recommendations", defaultLevel: "SUGGEST_ONLY", safetyFloor: true },
  { key: "post_op_guidance", label: "Post-op guidance", defaultLevel: "SUGGEST_ONLY" },
];

const AUTONOMY_SAFETY_FLOOR_KEYS = AUTONOMY_CATEGORIES.filter((c) => c.safetyFloor).map((c) => c.key);

const TONE_PERSONALITIES = [
  { value: "professional_warm", label: "Professional & warm" },
  { value: "clinical_concise", label: "Clinical & concise" },
  { value: "friendly_casual", label: "Friendly & casual" },
];

const SIGNATURE_STYLES = [
  { value: "name_only", label: "Assistant name only" },
  { value: "name_clinic", label: "Name + clinic" },
  { value: "none", label: "No signature" },
];

const WEEKEND_MODES = [
  { value: "ai_only", label: "AI only (no human SLA)" },
  { value: "reduced_sla", label: "Reduced human SLA" },
  { value: "human_required", label: "Human required" },
];

/** @returns {import('./clinicAiSettingsTypes').ClinicAiSettingsDefaults} */
function buildDefaultAutonomyConfig() {
  /** @type {Record<string, AutonomyLevel>} */
  const categories = {};
  for (const c of AUTONOMY_CATEGORIES) {
    categories[c.key] = c.defaultLevel;
  }
  return { version: 1, categories };
}

/** @returns {Record<string, unknown>} */
function buildDefaultToneConfig() {
  return {
    version: 1,
    displayName: "Clinic Assistant",
    supportedLanguages: ["en", "tr"],
    personality: "professional_warm",
    signatureStyle: "name_clinic",
  };
}

/** @returns {Record<string, unknown>} */
function buildDefaultEscalationConfig() {
  return {
    version: 1,
    doctorResponseSlaMinutes: 120,
    aiFallbackAfterMinutes: 30,
    coordinatorEscalationAfterMinutes: 60,
    businessHours: {
      timezone: "Europe/Istanbul",
      weekdays: { start: "09:00", end: "18:00" },
      weekendMode: "ai_only",
    },
    handoff: {
      angryPatient: true,
      refundRequest: true,
      severePain: true,
      emergencyLanguage: true,
      legalThreat: true,
    },
  };
}

/** @returns {Record<string, unknown>} */
function buildDefaultKnowledgeBaseConfig() {
  return {
    version: 1,
    implantBrands: [],
    transferAvailability: null,
    hotelPartnershipsNote: null,
    treatmentDurationAverages: {},
    averageVisitCount: null,
    sedationAvailability: false,
    warrantyPolicy: null,
    workingLanguages: ["en", "tr"],
    airportPickup: false,
    financingAvailability: false,
    operationalNotes: "",
  };
}

/** @returns {Record<string, unknown>} */
function buildDefaultCommunicationPolicy() {
  return {
    version: 1,
    canDiscussPricing: true,
    canNegotiateDiscounts: false,
    canAutoBookAppointments: false,
    canSendPaymentLinks: false,
    canAnswerMedicalRiskQuestions: false,
  };
}

/** @returns {Record<string, unknown>} */
function buildDefaultSafetyRules() {
  return {
    version: 1,
    requireHumanReview: {
      surgeryAdvice: true,
      diagnosis: true,
      medications: true,
      complications: true,
      emergencies: true,
    },
  };
}

/**
 * Full default profile (no DB row).
 * @returns {import('./clinicAiSettingsTypes').ResolvedClinicAiProfile}
 */
function buildDefaultClinicAiProfile() {
  const now = new Date().toISOString();
  return {
    clinicId: null,
    isConfigured: false,
    autonomy: buildDefaultAutonomyConfig(),
    escalation: buildDefaultEscalationConfig(),
    tone: buildDefaultToneConfig(),
    knowledgeBase: buildDefaultKnowledgeBaseConfig(),
    communicationPolicy: buildDefaultCommunicationPolicy(),
    safetyRules: buildDefaultSafetyRules(),
    createdAt: null,
    updatedAt: now,
  };
}

/**
 * @typedef {object} ResolvedClinicAiProfile
 * @property {string|null} clinicId
 * @property {boolean} isConfigured
 * @property {Record<string, unknown>} autonomy
 * @property {Record<string, unknown>} escalation
 * @property {Record<string, unknown>} tone
 * @property {Record<string, unknown>} knowledgeBase
 * @property {Record<string, unknown>} communicationPolicy
 * @property {Record<string, unknown>} safetyRules
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 */

module.exports = {
  AUTONOMY_LEVELS,
  AUTONOMY_CATEGORIES,
  AUTONOMY_SAFETY_FLOOR_KEYS,
  TONE_PERSONALITIES,
  SIGNATURE_STYLES,
  WEEKEND_MODES,
  buildDefaultAutonomyConfig,
  buildDefaultToneConfig,
  buildDefaultEscalationConfig,
  buildDefaultKnowledgeBaseConfig,
  buildDefaultCommunicationPolicy,
  buildDefaultSafetyRules,
  buildDefaultClinicAiProfile,
};
