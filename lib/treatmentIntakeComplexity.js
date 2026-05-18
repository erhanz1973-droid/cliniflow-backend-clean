/**
 * Treatment-aware intake complexity — drives conditional imaging/photo requirements.
 */

/** @typedef {'low'|'medium'|'high'} TreatmentComplexityTier */

/** @typedef {{
 *   tier: TreatmentComplexityTier,
 *   category: string,
 *   treatmentSlug: string|null,
 *   matchedPatterns: string[],
 * }} TreatmentIntakeClassification */

const LOW_COMPLEXITY_PATTERNS = [
  { key: "cleaning", re: /\b(teeth\s+)?clean(ing|er)?\b/i },
  { key: "hygiene", re: /\b(hygiene|prophylaxis|scaling|polish)\b/i },
  { key: "checkup", re: /\b(check[- ]?up|routine\s+exam|dental\s+exam)\b/i },
  { key: "consultation", re: /\b(consultation|consult\b|initial\s+visit)\b/i },
  { key: "whitening", re: /\b(whiten(ing)?|bleach(ing)?|brighter\s+teeth)\b/i },
];

const HIGH_IMAGING_PATTERNS = [
  { key: "implant", re: /\b(implant|all[\s-]?on[\s-]?[46]|all[\s-]?on)\b/i },
  { key: "full_mouth", re: /\bfull[\s-]?mouth\b|\bentire\s+mouth\b|\brehabilitation\b/i },
  { key: "surgery", re: /\b(oral\s+)?surgery|surgical|bone\s+graft|sinus\s+lift\b/i },
  { key: "root_canal", re: /\broot[\s-]?canal\b/i },
  { key: "extraction", re: /\b(extraction|extract\s+tooth|wisdom\s+tooth)\b/i },
  { key: "prosthetics", re: /\b(denture|prosthetic|full\s+arch)\b/i },
  { key: "imaging_explicit", re: /\b(panoramic|cbct|ct\s+scan|3d\s+scan)\b/i },
];

const MEDIUM_COMPLEXITY_PATTERNS = [
  { key: "veneer", re: /\b(veneer|laminate|smile\s+makeover)\b/i },
  { key: "crown", re: /\b(crown|cap\b|bridge)\b/i },
  { key: "orthodontic", re: /\b(braces|invisalign|aligner|orthodont)\b/i },
  { key: "cosmetic", re: /\b(cosmetic|aesthetic)\b/i },
  { key: "filling", re: /\b(filling|cavity)\b/i },
];

const IMAGING_TAG_KEYS = new Set([
  "implant_interest",
  "full_mouth_restoration_interest",
  "missing_teeth_count",
]);

const PHOTO_TAG_KEYS_STRICT = new Set(["veneer_interest", "orthodontic_interest"]);

/**
 * @param {string} combinedText
 * @param {string[]} patterns
 */
function matchPatternKeys(combinedText, patterns) {
  const matched = [];
  for (const p of patterns) {
    if (p.re.test(combinedText)) matched.push(p.key);
  }
  return matched;
}

/**
 * @param {string|null|undefined} treatmentInterest
 * @param {string} [patientMessage]
 * @param {string[]} [patientReportedTags]
 * @returns {TreatmentIntakeClassification}
 */
function classifyTreatmentIntake(treatmentInterest, patientMessage = "", patientReportedTags = []) {
  const treatment = String(treatmentInterest || "").trim();
  const text = [treatment, patientMessage, ...(patientReportedTags || []).map(String)].join(" ");
  const treatmentLower = treatment.toLowerCase();

  const highMatches = matchPatternKeys(text, HIGH_IMAGING_PATTERNS);
  const lowMatches = matchPatternKeys(text, LOW_COMPLEXITY_PATTERNS);
  const mediumMatches = matchPatternKeys(text, MEDIUM_COMPLEXITY_PATTERNS);

  const tags = (patientReportedTags || []).map((t) => String(t).trim());
  const hasImagingTags = tags.some((t) => IMAGING_TAG_KEYS.has(t));

  let tier = "medium";
  let category = "general_dental";

  if (hasImagingTags || highMatches.length > 0) {
    tier = "high";
    category = highMatches[0] || "advanced_treatment";
  } else if (
    lowMatches.length > 0 &&
    mediumMatches.length === 0 &&
    !hasImagingTags
  ) {
    tier = "low";
    category = lowMatches[0] || "preventive";
  } else if (mediumMatches.length > 0) {
    tier = "medium";
    category = mediumMatches[0] || "restorative";
  } else if (treatmentLower) {
    tier = "medium";
    category = "general_dental";
  } else {
    tier = "medium";
    category = "unspecified";
  }

  const treatmentSlug =
    treatmentLower ||
    (tier === "low" && lowMatches[0] ? lowMatches[0] : null) ||
    (tier === "high" && highMatches[0] ? highMatches[0] : null) ||
    null;

  return {
    tier,
    category,
    treatmentSlug: treatmentSlug || null,
    matchedPatterns: [...highMatches, ...mediumMatches, ...lowMatches],
  };
}

/**
 * @param {TreatmentIntakeClassification} classification
 * @param {string[]} patientReportedTags
 * @param {string} combinedText
 */
function imagingRequiredForIntake(classification, patientReportedTags = [], combinedText = "") {
  if (classification.tier === "low") {
    const tags = patientReportedTags || [];
    if (tags.some((t) => IMAGING_TAG_KEYS.has(t))) return true;
    return HIGH_IMAGING_PATTERNS.some((p) => p.re.test(combinedText));
  }
  if (classification.tier === "high") return true;
  if (classification.tier === "medium") {
    const tags = patientReportedTags || [];
    if (tags.some((t) => IMAGING_TAG_KEYS.has(t))) return true;
    return /\b(implant|root[\s-]?canal|extraction|all[\s-]?on|full[\s-]?mouth|cbct|panoramic)\b/i.test(
      combinedText,
    );
  }
  return false;
}

/**
 * @param {TreatmentIntakeClassification} classification
 * @param {string[]} patientReportedTags
 * @param {string} combinedText
 */
function photosRequiredForIntake(classification, patientReportedTags = [], combinedText = "") {
  if (classification.tier === "low") {
    const tags = patientReportedTags || [];
    return tags.some((t) => PHOTO_TAG_KEYS_STRICT.has(t));
  }
  const tags = patientReportedTags || [];
  if (tags.some((t) => PHOTO_TAG_KEYS_STRICT.has(t) || t === "cosmetic_goal")) return true;
  if (classification.tier === "high") return false;
  return /\b(veneer|smile\s+makeover|orthodont|braces|invisalign|aligner)\b/i.test(combinedText);
}

/**
 * Coordinator prompt block for treatment tier.
 * @param {TreatmentIntakeClassification} classification
 */
function buildTreatmentIntakeGuidanceBlock(classification) {
  const tier = classification?.tier || "medium";
  const lines = [
    "TREATMENT-AWARE INTAKE (operational coordinator — not a generic intake bot):",
  ];

  if (tier === "low") {
    lines.push(
      "* This inquiry is routine / low-complexity (e.g. cleaning, hygiene, whitening, consultation).",
    );
    lines.push(
      "* Do NOT ask for panoramic X-rays, CT scans, or extensive diagnostics unless the patient explicitly mentions implants, surgery, extractions, or advanced treatment.",
    );
    lines.push(
      "* Prioritize: friendly coordinator tone, estimated price range when clinic context allows, typical appointment duration, optional booking — keep it lightweight.",
    );
    lines.push(
      "* Mention imaging only if clinically relevant later (e.g. \"if the dentist notices something during the visit\") — not as an upfront requirement.",
    );
    return lines.join("\n");
  }

  if (tier === "high") {
    lines.push(
      "* This inquiry involves advanced treatment (implants, full-mouth work, surgery, root canal planning, etc.).",
    );
    lines.push(
      "* Panoramic X-ray / imaging is commonly requested before planning — encourage upload only if not already provided.",
    );
    lines.push("* Still avoid clinical interpretation of scans — coordination only.");
    return lines.join("\n");
  }

  lines.push(
    "* Standard restorative / cosmetic planning — photos may help; panoramic imaging only when implants, extractions, or surgical planning are in scope.",
  );
  lines.push("* Do not default to X-ray requests for simple questions (cleaning, whitening, check-up).");
  return lines.join("\n");
}

module.exports = {
  IMAGING_TAG_KEYS,
  PHOTO_TAG_KEYS_STRICT,
  classifyTreatmentIntake,
  imagingRequiredForIntake,
  photosRequiredForIntake,
  buildTreatmentIntakeGuidanceBlock,
};
