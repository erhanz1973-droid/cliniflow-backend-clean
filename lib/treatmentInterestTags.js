/**
 * Patient-reported treatment interest tags (operational — NOT diagnoses).
 */

/** @type {Record<string, { label: string, patterns: RegExp[] }>} */
const TAG_DEFINITIONS = {
  implant_interest: {
    label: "Implant interest (patient-reported)",
    patterns: [/implant/i, /all[\s-]?on[\s-]?4/i, /all[\s-]?on/i, /dental implant/i],
  },
  veneer_interest: {
    label: "Veneer / smile design interest",
    patterns: [/veneer/i, /hollywood smile/i, /smile makeover/i, /laminate/i],
  },
  orthodontic_interest: {
    label: "Orthodontic interest",
    patterns: [/braces/i, /invisalign/i, /aligner/i, /orthodont/i, /clear align/i],
  },
  whitening_interest: {
    label: "Whitening interest",
    patterns: [/whiten/i, /bleach/i, /brighter teeth/i, /teeth whitening/i],
  },
  full_mouth_restoration_interest: {
    label: "Full mouth restoration interest",
    patterns: [/full[\s-]?mouth/i, /all teeth/i, /entire mouth/i, /rehabilitation/i],
  },
  chewing_problem: {
    label: "Chewing difficulty (patient-reported)",
    patterns: [/can.?t chew/i, /difficult(y)? (to )?eat/i, /chewing problem/i, /hard to chew/i],
  },
  cosmetic_goal: {
    label: "Cosmetic / appearance goal",
    patterns: [/cosmetic/i, /aesthetic/i, /look better/i, /smile/i, /appearance/i, /confidence/i],
  },
  pain_signal: {
    label: "Pain / discomfort (patient-reported)",
    patterns: [/pain/i, /toothache/i, /hurt(s|ing)?/i, /aching/i, /sensitive/i],
  },
  broken_tooth: {
    label: "Broken / chipped tooth (patient-reported)",
    patterns: [/broken tooth/i, /chipped/i, /cracked tooth/i, /fractured/i],
  },
  missing_teeth_count: {
    label: "Missing teeth count mentioned (patient-reported)",
    patterns: [/\d+\s*(missing\s+)?teeth/i, /need\s+\d+\s*implants?/i],
  },
};

const ALLOWED_TAGS = Object.keys(TAG_DEFINITIONS);

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeTagList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = new Set();
  for (const item of raw) {
    const s = String(item || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (ALLOWED_TAGS.includes(s)) out.add(s);
  }
  return [...out];
}

/**
 * Rule-based extraction from free text + treatment interest slug.
 * @param {string} [text]
 * @param {import('./leadIntelligence').LeadData|null|undefined} [leadData]
 */
function extractTagsFromText(text, leadData) {
  const combined = [
    String(text || ""),
    String(leadData?.treatmentInterest || ""),
    ...(leadData?.patientReportedTags || []).map(String),
  ].join(" ");
  const t = combined.toLowerCase();
  if (!t.trim()) return [];

  const found = new Set();
  for (const [key, def] of Object.entries(TAG_DEFINITIONS)) {
    if (def.patterns.some((re) => re.test(combined))) found.add(key);
  }

  const countMatch = combined.match(/(\d{1,2})\s*(missing\s+)?teeth|(\d{1,2})\s*implants?/i);
  if (countMatch) {
    found.add("missing_teeth_count");
  }

  return [...found];
}

/**
 * @param {string[]|null|undefined} prev
 * @param {string[]|null|undefined} next
 */
function mergeTagLists(prev, next) {
  return [...new Set([...normalizeTagList(prev), ...normalizeTagList(next)])];
}

/**
 * Resolve tags: AI extraction + rules + prior persisted.
 * @param {import('./leadIntelligence').LeadData} leadData
 * @param {string} [patientMessage]
 * @param {string[]} [persistedTags]
 */
function resolvePatientReportedTags(leadData, patientMessage, persistedTags) {
  const fromAi = normalizeTagList(leadData?.patientReportedTags);
  const fromRules = extractTagsFromText(patientMessage, leadData);
  return mergeTagLists(mergeTagLists(persistedTags, fromAi), fromRules);
}

/**
 * @param {string|null|undefined} text
 */
function extractMissingTeethCount(text) {
  const t = String(text || "");
  const m = t.match(/(\d{1,2})\s*(missing\s+)?teeth|need\s+(\d{1,2})\s*implants?/i);
  if (!m) return null;
  const n = parseInt(m[1] || m[3], 10);
  return Number.isFinite(n) && n >= 1 && n <= 32 ? n : null;
}

/**
 * @param {string[]} tags
 */
function buildTreatmentTagsPromptBlock(tags) {
  const list = normalizeTagList(tags);
  const lines = [
    "PATIENT-REPORTED CONCERNS (operational intake — NOT diagnoses):",
    "* Treat all tags as what the patient said they want or feel — never as confirmed clinical findings.",
    "* Use educational, intake-oriented language: \"Based on what you described…\" / \"Clinics commonly request…\"",
  ];
  if (list.length) {
    const labels = list.map((k) => TAG_DEFINITIONS[k]?.label || k.replace(/_/g, " "));
    lines.push(`* Active patient-reported tags: ${labels.join("; ")}.`);
  } else {
    lines.push("* No structured treatment tags yet — gently ask what they would like to improve or explore.");
  }
  lines.push("* Do not confirm treatment necessity or suitability from tags alone.");
  return lines.join("\n");
}

module.exports = {
  TAG_DEFINITIONS,
  ALLOWED_TAGS,
  normalizeTagList,
  extractTagsFromText,
  mergeTagLists,
  resolvePatientReportedTags,
  extractMissingTeethCount,
  buildTreatmentTagsPromptBlock,
};
