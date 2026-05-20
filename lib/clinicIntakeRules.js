/**
 * Clinic-configurable patient preparation / intake field requirements.
 * Stored on clinic_ai_settings.knowledge_base.patientIntakeRules (merged with defaults).
 */

const { getClinicAiProfile } = require("./clinicAiSettings");

/** @typedef {{ key: string, label: string, priority: 'critical'|'helpful', askWhen?: string }} IntakeFieldRule */

const DEFAULT_RULES_BY_TREATMENT = {
  implant: {
    fields: [
      { key: "missing_teeth", label: "How many teeth are missing or need replacement", priority: "critical" },
      { key: "affected_area", label: "Which area of the mouth is affected", priority: "critical" },
      { key: "prior_implant", label: "Whether implants were done before", priority: "helpful" },
      { key: "panoramic_xray", label: "Whether a panoramic X-ray is available", priority: "critical" },
      { key: "smoking_status", label: "Smoking status", priority: "helpful" },
      { key: "bone_loss_mentioned", label: "Whether bone loss was mentioned", priority: "helpful" },
      { key: "pain_level", label: "Current pain or discomfort", priority: "helpful" },
      { key: "travel_window", label: "When they could travel for treatment", priority: "critical" },
      { key: "stay_duration", label: "How long they can stay locally", priority: "helpful" },
      { key: "expectations", label: "Goals (function, aesthetics, budget sensitivity)", priority: "helpful" },
    ],
    photoHints: [
      "Smile at rest and with teeth slightly apart — good daylight, face the camera.",
      "Open mouth: upper and lower teeth visible; avoid motion blur.",
      "If possible, side angles showing the gap or area of concern.",
    ],
  },
  veneer: {
    fields: [
      { key: "expectations", label: "Smile goals and what they want to improve", priority: "critical" },
      { key: "smile_photos", label: "Clear smile photos (front and side)", priority: "critical" },
      { key: "travel_window", label: "Travel timing", priority: "helpful" },
    ],
    photoHints: [
      "Natural smile, lips relaxed — avoid harsh shadows on teeth.",
      "Close-up front view with teeth visible; repeat with a slight open-mouth view.",
    ],
  },
  default: {
    fields: [
      { key: "treatment_goals", label: "What they hope to achieve", priority: "critical" },
      { key: "affected_area", label: "Which teeth or area bothers them", priority: "helpful" },
      { key: "pain_level", label: "Pain or sensitivity", priority: "helpful" },
      { key: "travel_window", label: "When they might visit the clinic", priority: "helpful" },
    ],
    photoHints: [
      "Well-lit photo, mouth open enough to see teeth clearly.",
      "Hold the phone steady; retake if the image looks blurry.",
    ],
  },
};

function slugForTreatment(treatmentInterest) {
  const t = String(treatmentInterest || "").toLowerCase();
  if (/implant|all[\s-]?on/.test(t)) return "implant";
  if (/veneer|cosmetic|smile/.test(t)) return "veneer";
  if (/crown|bridge/.test(t)) return "veneer";
  return "default";
}

/**
 * @param {unknown} raw
 */
function normalizePatientIntakeRules(raw) {
  const base = {
    version: 1,
    byTreatment: { ...DEFAULT_RULES_BY_TREATMENT },
    globalFields: [],
    customPromptNotes: "",
  };
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.byTreatment && typeof o.byTreatment === "object") {
    for (const [k, v] of Object.entries(o.byTreatment)) {
      if (v && typeof v === "object") {
        base.byTreatment[k] = { ...base.byTreatment[k], ...v };
      }
    }
  }
  if (Array.isArray(o.globalFields)) {
    base.globalFields = o.globalFields.filter((f) => f && typeof f === "object");
  }
  if (typeof o.customPromptNotes === "string") {
    base.customPromptNotes = o.customPromptNotes.trim().slice(0, 2000);
  }
  return base;
}

/**
 * @param {string|null|undefined} clinicId
 */
async function getClinicIntakeRules(clinicId) {
  const id = String(clinicId || "").trim();
  if (!id) return normalizePatientIntakeRules(null);
  try {
    const profile = await getClinicAiProfile(id);
    const kb = profile?.knowledgeBase || profile?.knowledge_base || {};
    const raw = kb.patientIntakeRules ?? kb.patient_intake_rules;
    return normalizePatientIntakeRules(raw);
  } catch {
    return normalizePatientIntakeRules(null);
  }
}

/**
 * @param {string|null|undefined} treatmentInterest
 * @param {Record<string, unknown>} rulesConfig
 */
function resolveRulesForTreatment(treatmentInterest, rulesConfig) {
  const slug = slugForTreatment(treatmentInterest);
  const byTreatment = rulesConfig?.byTreatment || DEFAULT_RULES_BY_TREATMENT;
  const pack = byTreatment[slug] || byTreatment.default || DEFAULT_RULES_BY_TREATMENT.default;
  const globalFields = Array.isArray(rulesConfig?.globalFields) ? rulesConfig.globalFields : [];
  return {
    slug,
    fields: [...(pack.fields || []), ...globalFields],
    photoHints: pack.photoHints || DEFAULT_RULES_BY_TREATMENT.default.photoHints,
  };
}

/**
 * @param {Record<string, unknown>} rulesConfig
 * @param {string|null} treatmentInterest
 */
function buildClinicIntakeRulesPromptBlock(rulesConfig, treatmentInterest) {
  const { fields, photoHints, slug } = resolveRulesForTreatment(treatmentInterest, rulesConfig);
  const lines = [
    "CLINIC PREPARATION RULES (what this clinic commonly needs before evaluation — operational only):",
    `Treatment focus: ${slug}`,
  ];
  const critical = fields.filter((f) => f.priority === "critical");
  const helpful = fields.filter((f) => f.priority !== "critical");
  if (critical.length) {
    lines.push("Try to learn naturally (not as a form): " + critical.map((f) => f.label).join("; ") + ".");
  }
  if (helpful.length) {
    lines.push("If conversation allows, also: " + helpful.map((f) => f.label).join("; ") + ".");
  }
  if (photoHints.length) {
    lines.push("Photo coaching (when uploads are relevant):");
    for (const h of photoHints.slice(0, 4)) lines.push(`* ${h}`);
  }
  const notes = String(rulesConfig?.customPromptNotes || "").trim();
  if (notes) lines.push(`Clinic note: ${notes}`);
  return lines.join("\n");
}

module.exports = {
  DEFAULT_RULES_BY_TREATMENT,
  normalizePatientIntakeRules,
  getClinicIntakeRules,
  resolveRulesForTreatment,
  buildClinicIntakeRulesPromptBlock,
  slugForTreatment,
};
