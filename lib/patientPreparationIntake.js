/**
 * Conversational patient preparation intake — structured CRM fields without form UX.
 * Persisted on operational_intake_flags.conversationalIntake.
 */

const { resolveRulesForTreatment } = require("./clinicIntakeRules");

const PREP_VERSION = 1;

/** @returns {Record<string, unknown>} */
function emptyConversationalIntake() {
  return {
    version: PREP_VERSION,
    symptoms: [],
    goals: [],
    missingTeeth: null,
    affectedArea: null,
    priorImplant: null,
    hasPanoramicXray: null,
    painLevel: null,
    boneLossMentioned: null,
    smokingStatus: null,
    expectations: null,
    treatmentHistory: null,
    travelWindow: null,
    stayDuration: null,
    budgetSensitivity: null,
    country: null,
    preferredLanguage: null,
    uploadedDocuments: {
      panoramic_xray: false,
      smile_photos: false,
      intraoral_photo: false,
      blood_work: false,
    },
    photoQualityNotes: [],
    lastUpdatedAt: null,
  };
}

function pickBool(v) {
  if (v === true || v === false) return v;
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  return null;
}

function pickString(v, max = 500) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function pickStringArray(v, max = 12) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * @param {unknown} raw
 */
function normalizeConversationalIntake(raw) {
  const base = emptyConversationalIntake();
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const docsIn = o.uploadedDocuments && typeof o.uploadedDocuments === "object"
    ? o.uploadedDocuments
    : o.uploaded_documents;
  const docs =
    docsIn && typeof docsIn === "object"
      ? { ...base.uploadedDocuments, ...docsIn }
      : base.uploadedDocuments;

  let missingTeeth = o.missingTeeth ?? o.missing_teeth;
  if (missingTeeth != null && Number.isFinite(Number(missingTeeth))) {
    const n = Number(missingTeeth);
    if (n >= 1 && n <= 32) missingTeeth = n;
    else missingTeeth = null;
  } else {
    missingTeeth = null;
  }

  return {
    ...base,
    version: PREP_VERSION,
    symptoms: pickStringArray(o.symptoms),
    goals: pickStringArray(o.goals),
    missingTeeth,
    affectedArea: pickString(o.affectedArea ?? o.affected_area),
    priorImplant: pickBool(o.priorImplant ?? o.prior_implant),
    hasPanoramicXray: pickBool(o.hasPanoramicXray ?? o.has_panoramic_xray),
    painLevel: pickString(o.painLevel ?? o.pain_level, 80),
    boneLossMentioned: pickBool(o.boneLossMentioned ?? o.bone_loss_mentioned),
    smokingStatus: pickString(o.smokingStatus ?? o.smoking_status, 80),
    expectations: pickString(o.expectations),
    treatmentHistory: pickString(o.treatmentHistory ?? o.treatment_history),
    travelWindow: pickString(o.travelWindow ?? o.travel_window),
    stayDuration: pickString(o.stayDuration ?? o.stay_duration),
    budgetSensitivity: pickString(o.budgetSensitivity ?? o.budget_sensitivity),
    country: pickString(o.country, 120),
    preferredLanguage: pickString(o.preferredLanguage ?? o.preferred_language, 8),
    uploadedDocuments: {
      panoramic_xray: pickBool(docs.panoramic_xray) === true,
      smile_photos: pickBool(docs.smile_photos) === true,
      intraoral_photo: pickBool(docs.intraoral_photo) === true,
      blood_work: pickBool(docs.blood_work) === true,
    },
    photoQualityNotes: pickStringArray(o.photoQualityNotes ?? o.photo_quality_notes, 6),
    lastUpdatedAt: pickString(o.lastUpdatedAt ?? o.last_updated_at, 40),
  };
}

/**
 * Map flat leadData + message into preparation fields (merge-friendly).
 * @param {import('./leadIntelligence').LeadData} leadData
 * @param {string} [patientMessage]
 */
function preparationHintsFromLeadData(leadData, patientMessage = "") {
  const ld = leadData || {};
  const text = [patientMessage, ld.treatmentInterest, ...(ld.patientReportedTags || [])].join(" ");
  const hints = emptyConversationalIntake();
  if (ld.country) hints.country = ld.country;
  if (ld.language) hints.preferredLanguage = ld.language;
  if (ld.travelTimeline) hints.travelWindow = ld.travelTimeline;
  if (ld.missingTeethCount != null) hints.missingTeeth = ld.missingTeethCount;
  if (ld.budgetSignal && ld.budgetSignal !== "not_discussed") {
    hints.budgetSensitivity = ld.budgetSignal;
  }
  if (/\bsmok(e|ing|er)\b/i.test(text)) {
    hints.smokingStatus = /\b(no|quit|stopped|non[- ]?smok)/i.test(text) ? "non_smoker" : "smoker";
  }
  if (/\b(implant before|previous implant|had implant)/i.test(text)) hints.priorImplant = true;
  if (/\b(panoramic|x[- ]?ray|cbct|ct scan)/i.test(text) && /\b(have|upload|sent|attached)/i.test(text)) {
    hints.hasPanoramicXray = true;
  }
  if (/\b(bone loss|osteoporosis|graft|sinus lift)/i.test(text)) hints.boneLossMentioned = true;
  if (/\b(pain|ache|hurt|sensitive)/i.test(text)) {
    hints.painLevel = /\b(severe|strong|bad|intense)/i.test(text) ? "moderate_high" : "mild";
  }
  const tags = ld.patientReportedTags || [];
  if (tags.includes("cosmetic_goal")) hints.goals.push("aesthetics");
  if (tags.includes("chewing_problem")) hints.goals.push("function");
  if (tags.includes("implant_interest")) hints.goals.push("implants");
  return hints;
}

/**
 * @param {Record<string, unknown>|null|undefined} prev
 * @param {Record<string, unknown>|null|undefined} fromModel
 * @param {import('./leadIntelligence').LeadData} [leadData]
 * @param {string} [patientMessage]
 */
function mergeConversationalIntake(prev, fromModel, leadData, patientMessage) {
  const a = normalizeConversationalIntake(prev);
  const b = normalizeConversationalIntake(fromModel);
  const c = preparationHintsFromLeadData(leadData, patientMessage);

  const mergeArr = (x, y, z) => [...new Set([...x, ...y, ...z])].slice(0, 16);

  return normalizeConversationalIntake({
    ...a,
    ...b,
    ...c,
    symptoms: mergeArr(a.symptoms, b.symptoms, c.symptoms),
    goals: mergeArr(a.goals, b.goals, c.goals),
    missingTeeth: b.missingTeeth ?? c.missingTeeth ?? a.missingTeeth,
    affectedArea: b.affectedArea || c.affectedArea || a.affectedArea,
    priorImplant: b.priorImplant ?? c.priorImplant ?? a.priorImplant,
    hasPanoramicXray: b.hasPanoramicXray ?? c.hasPanoramicXray ?? a.hasPanoramicXray,
    painLevel: b.painLevel || c.painLevel || a.painLevel,
    boneLossMentioned: b.boneLossMentioned ?? c.boneLossMentioned ?? a.boneLossMentioned,
    smokingStatus: b.smokingStatus || c.smokingStatus || a.smokingStatus,
    expectations: b.expectations || c.expectations || a.expectations,
    treatmentHistory: b.treatmentHistory || c.treatmentHistory || a.treatmentHistory,
    travelWindow: b.travelWindow || c.travelWindow || a.travelWindow,
    stayDuration: b.stayDuration || c.stayDuration || a.stayDuration,
    budgetSensitivity: b.budgetSensitivity || c.budgetSensitivity || a.budgetSensitivity,
    country: b.country || c.country || a.country,
    preferredLanguage: b.preferredLanguage || c.preferredLanguage || a.preferredLanguage,
    uploadedDocuments: {
      ...a.uploadedDocuments,
      ...b.uploadedDocuments,
      ...c.uploadedDocuments,
    },
    photoQualityNotes: mergeArr(a.photoQualityNotes, b.photoQualityNotes, c.photoQualityNotes),
    lastUpdatedAt: new Date().toISOString(),
  });
}

/**
 * @param {Record<string, unknown>} prep
 * @param {Array<{ documentType?: string }>} documents
 * @param {{ missingXray?: boolean, missingSmilePhotos?: boolean }} [flags]
 */
function syncUploadedDocumentsFromFiles(prep, documents, flags = {}) {
  const p = normalizeConversationalIntake(prep);
  const ud = { ...p.uploadedDocuments };
  for (const d of documents || []) {
    const t = String(d.documentType || "").toLowerCase();
    if (t === "panoramic_xray" || t === "ct_scan") ud.panoramic_xray = true;
    if (t === "selfie" || t === "intraoral_photo") {
      ud.smile_photos = true;
      ud.intraoral_photo = true;
    }
  }
  if (flags.missingXray === false) ud.panoramic_xray = true;
  if (flags.missingSmilePhotos === false) {
    ud.smile_photos = true;
    ud.intraoral_photo = true;
  }
  return { ...p, uploadedDocuments: ud };
}

/**
 * @param {Record<string, unknown>} prep
 * @param {Record<string, unknown>} rulesConfig
 * @param {string|null} treatmentInterest
 */
function listMissingCriticalFields(prep, rulesConfig, treatmentInterest) {
  const p = normalizeConversationalIntake(prep);
  const { fields } = resolveRulesForTreatment(treatmentInterest, rulesConfig);
  const missing = [];

  const has = {
    missing_teeth: p.missingTeeth != null,
    affected_area: !!p.affectedArea,
    prior_implant: p.priorImplant != null,
    panoramic_xray: p.hasPanoramicXray === true || p.uploadedDocuments.panoramic_xray,
    smile_photos: p.uploadedDocuments.smile_photos || p.uploadedDocuments.intraoral_photo,
    smoking_status: !!p.smokingStatus,
    bone_loss_mentioned: p.boneLossMentioned != null,
    pain_level: !!p.painLevel,
    travel_window: !!p.travelWindow,
    stay_duration: !!p.stayDuration,
    expectations: !!p.expectations || p.goals.length > 0,
    treatment_goals: p.goals.length > 0 || !!p.expectations,
  };

  for (const f of fields) {
    if (f.priority !== "critical") continue;
    if (!has[f.key]) missing.push(f);
  }
  return missing.slice(0, 6);
}

/**
 * @param {{
 *   conversationalIntake?: Record<string, unknown>|null,
 *   missingCritical?: Array<{ key: string, label: string }>,
 *   clinicRulesBlock?: string,
 *   treatmentInterest?: string|null,
 * }} params
 */
function buildPreparationIntakePromptBlock(params) {
  const prep = normalizeConversationalIntake(params.conversationalIntake);
  const missing = params.missingCritical || [];
  const lines = [
    "PATIENT PREPARATION ASSISTANT (Treatment Guide — not a diagnosis bot):",
    "You help the patient get ready for clinic evaluation by gathering operational details in natural conversation.",
    "Never present a numbered questionnaire or say \"fill out the form\". Ask at most ONE focused follow-up per turn when needed.",
    "Use gentle openers such as:",
    '* "Klinik değerlendirmesi için birkaç bilgi daha yardımcı olabilir."',
    '* "Daha doğru yönlendirme için isterseniz birkaç kısa soru sorabilirim."',
    "If the patient only wants general education, answer briefly first — then offer to collect details if they plan treatment.",
    "Do not repeat questions already answered in the summary or recent turns.",
    "Photo coaching: suggest angle, lighting, mouth open, steady phone; if quality may be poor, politely ask for a clearer retake (operational only — do not diagnose from images).",
  ];

  if (params.clinicRulesBlock) {
    lines.push("");
    lines.push(params.clinicRulesBlock);
  }

  const known = [];
  if (prep.missingTeeth != null) known.push(`missing teeth (patient-reported): ${prep.missingTeeth}`);
  if (prep.affectedArea) known.push(`area: ${prep.affectedArea}`);
  if (prep.travelWindow) known.push(`travel: ${prep.travelWindow}`);
  if (prep.smokingStatus) known.push(`smoking: ${prep.smokingStatus}`);
  if (prep.hasPanoramicXray || prep.uploadedDocuments.panoramic_xray) known.push("panoramic imaging: yes");
  if (prep.goals.length) known.push(`goals: ${prep.goals.join(", ")}`);
  if (known.length) {
    lines.push("");
    lines.push("Already captured (do not re-ask unless unclear): " + known.join("; ") + ".");
  }

  if (missing.length) {
    lines.push("");
    lines.push(
      "Still helpful for clinic coordination (pick ONE topic this turn if appropriate): " +
        missing.map((m) => m.label).join("; ") +
        ".",
    );
  }

  lines.push("");
  lines.push(
    "In your JSON, include conversationalIntake with any new facts from this turn (merge with prior values).",
  );

  return lines.join("\n");
}

/**
 * One-line coordinator scan summary from structured intake.
 * @param {unknown} prep
 */
function formatPreparationSummaryForUI(prep) {
  const p = normalizeConversationalIntake(prep);
  const parts = [];
  if (p.missingTeeth != null) parts.push(`${p.missingTeeth} missing teeth`);
  if (p.affectedArea) parts.push(p.affectedArea);
  if (p.goals.length) parts.push(`goals: ${p.goals.join(", ")}`);
  if (p.travelWindow) parts.push(`travel: ${p.travelWindow}`);
  if (p.stayDuration) parts.push(`stay: ${p.stayDuration}`);
  if (p.smokingStatus) parts.push(`smoking: ${p.smokingStatus}`);
  if (p.hasPanoramicXray || p.uploadedDocuments.panoramic_xray) parts.push("panoramic: yes");
  if (p.painLevel) parts.push(`pain: ${p.painLevel}`);
  if (p.country) parts.push(p.country);
  return parts.length ? parts.slice(0, 6).join(" · ") : null;
}

const PREPARATION_JSON_SCHEMA = `
conversationalIntake (merge with prior — patient-reported only, null if unknown):
{
  "symptoms": ["short patient-reported phrases"],
  "goals": ["function", "aesthetics", "budget_sensitive", etc.],
  "missingTeeth": number 1-32 or null,
  "affectedArea": string or null,
  "priorImplant": true|false|null,
  "hasPanoramicXray": true|false|null,
  "painLevel": "none"|"mild"|"moderate_high"|null,
  "boneLossMentioned": true|false|null,
  "smokingStatus": "smoker"|"non_smoker"|"unknown"|null,
  "expectations": string or null,
  "treatmentHistory": string or null,
  "travelWindow": string or null,
  "stayDuration": string or null,
  "budgetSensitivity": "low"|"medium"|"high"|null,
  "country": string or null,
  "preferredLanguage": ISO 639-1 or null,
  "uploadedDocuments": { "panoramic_xray": bool, "smile_photos": bool, "intraoral_photo": bool },
  "photoQualityNotes": ["blur", "too_dark", "needs_side_angle", etc.]
}`;

module.exports = {
  emptyConversationalIntake,
  normalizeConversationalIntake,
  mergeConversationalIntake,
  preparationHintsFromLeadData,
  syncUploadedDocumentsFromFiles,
  listMissingCriticalFields,
  buildPreparationIntakePromptBlock,
  formatPreparationSummaryForUI,
  PREPARATION_JSON_SCHEMA,
};
