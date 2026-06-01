/**
 * Human-readable lead summaries for coordinator / doctor / admin UI.
 * Machine slugs (leadData) stay internal to AI pipelines — never shown raw in display APIs.
 */

const { normalizeLeadData } = require("./leadIntelligence");
const { normalizeTagList } = require("./treatmentInterestTags");
const { t, normalizeUiLang } = require("./i18n/coordinationLocales");

/** Top-level API fields removed from human-facing lead DTOs. */
const MACHINE_LEAD_KEYS = [
  "treatmentInterest",
  "bookingIntent",
  "budgetSignal",
  "urgency",
  "travelTimeline",
];

/**
 * @typedef {'treatment'|'booking'|'commercial'|'conversation'|'timing'|'travel'} LeadSummarySectionId
 * @typedef {{ id: LeadSummarySectionId, title: string, bullets: string[] }} LeadSummarySection
 */

/**
 * @param {Record<string, unknown>|null|undefined} lead
 * @returns {import('./leadIntelligence').LeadData}
 */
function leadDataFromLeadRecord(lead) {
  const L = lead && typeof lead === "object" ? lead : {};
  const flags =
    L.operationalIntakeFlags && typeof L.operationalIntakeFlags === "object"
      ? L.operationalIntakeFlags
      : {};
  return normalizeLeadData({
    treatmentInterest: L.treatmentInterest ?? L.treatment_interest,
    country: L.country,
    language: L.preferredLanguage ?? L.preferred_language,
    travelTimeline: L.travelTimeline ?? L.travel_timeline,
    urgency: L.urgency,
    bookingIntent: L.bookingIntent ?? L.booking_intent,
    budgetSignal: L.budgetSignal ?? L.budget_signal,
    patientReportedTags: flags.patientReportedTags ?? flags.patient_reported_tags,
  });
}

/**
 * @param {string} slug
 * @param {string} lang
 */
function formatTreatmentLabel(slug, lang) {
  const key = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!key) return "";
  const localized = t(lang, `ops.leadSummary.treatment.${key}`);
  if (!localized.startsWith("ops.leadSummary.treatment.")) return localized;
  return key.replace(/_/g, " ");
}

/**
 * @param {string} tag
 * @param {string} lang
 */
function formatPatientReportedTagLine(tag, lang) {
  const key = String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key) return null;
  const localized = t(lang, `ops.leadSummary.tag.${key}`);
  if (!localized.startsWith("ops.leadSummary.tag.")) return localized;
  return null;
}

/**
 * @param {string} lang
 * @param {LeadSummarySectionId} id
 * @param {string[]} bullets
 * @returns {LeadSummarySection|null}
 */
function buildSection(lang, id, bullets) {
  const clean = bullets.map((b) => String(b || "").trim()).filter(Boolean);
  if (!clean.length) return null;
  const title = t(lang, `ops.leadSummary.section.${id}`);
  if (title.startsWith("ops.leadSummary.section.")) return null;
  return { id, title, bullets: clean };
}

/**
 * @param {import('./leadIntelligence').LeadData|null|undefined} leadData
 * @param {string} [lang]
 */
function formatLeadSummaryForHumans(leadData, lang = "en") {
  const L = normalizeUiLang(lang);
  const ld = normalizeLeadData(leadData);
  /** @type {LeadSummarySection[]} */
  const sections = [];

  if (ld.treatmentInterest) {
    const bullet = t(L, "ops.leadSummary.treatmentInterest", {
      treatment: formatTreatmentLabel(ld.treatmentInterest, L),
    });
    const section = buildSection(L, "treatment", [bullet]);
    if (section) sections.push(section);
  }

  if (ld.bookingIntent) {
    const bk = String(ld.bookingIntent).toLowerCase();
    const bookingLine = t(L, `ops.leadSummary.bookingReadiness.${bk}`);
    if (!bookingLine.startsWith("ops.leadSummary.bookingReadiness.")) {
      const section = buildSection(L, "booking", [bookingLine]);
      if (section) sections.push(section);
    }
  }

  if (ld.budgetSignal) {
    const bg = String(ld.budgetSignal).toLowerCase();
    const commercialLine = t(L, `ops.leadSummary.commercialInterest.${bg}`);
    if (!commercialLine.startsWith("ops.leadSummary.commercialInterest.")) {
      const section = buildSection(L, "commercial", [commercialLine]);
      if (section) sections.push(section);
    }
  }

  /** @type {string[]} */
  const tagSummaries = [];
  const tags = normalizeTagList(ld.patientReportedTags);
  const seen = new Set();
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    const line = formatPatientReportedTagLine(tag, L);
    if (line) tagSummaries.push(line);
  }
  if (tagSummaries.length) {
    const section = buildSection(L, "conversation", tagSummaries);
    if (section) sections.push(section);
  }

  /** @type {string[]} */
  const timingBullets = [];
  if (ld.urgency) {
    const u = String(ld.urgency).toLowerCase();
    const urgencyLine = t(L, `ops.leadSummary.timing.${u}`);
    if (!urgencyLine.startsWith("ops.leadSummary.timing.")) {
      timingBullets.push(urgencyLine);
    }
  }
  if (timingBullets.length) {
    const section = buildSection(L, "timing", timingBullets);
    if (section) sections.push(section);
  }

  if (ld.travelTimeline) {
    const travelLine = t(L, "ops.leadSummary.travelTimeline", {
      timeline: String(ld.travelTimeline).trim(),
    });
    if (!travelLine.startsWith("ops.leadSummary.travelTimeline")) {
      const section = buildSection(L, "travel", [travelLine]);
      if (section) sections.push(section);
    }
  }

  const lines = sections.flatMap((s) => s.bullets);

  return {
    sections,
    lines,
    tagSummaries,
    paragraph: lines.join(" "),
  };
}

/**
 * @param {Record<string, unknown>} lead
 */
function stripMachineLeadFieldsFromDisplay(lead) {
  const out = { ...lead };
  for (const key of MACHINE_LEAD_KEYS) {
    delete out[key];
  }

  if (out.operationalIntakeFlags && typeof out.operationalIntakeFlags === "object") {
    const flags = { ...out.operationalIntakeFlags };
    delete flags.patientReportedTags;
    delete flags.patient_reported_tags;
    if (Array.isArray(out.patientReportedTagSummaries) && out.patientReportedTagSummaries.length) {
      flags.patientReportedTagSummaries = out.patientReportedTagSummaries;
    }
    out.operationalIntakeFlags = flags;
  }

  return out;
}

/**
 * @param {Record<string, unknown>} lead
 * @param {string} [lang]
 */
function attachHumanLeadSummary(lead, lang = "en") {
  if (!lead || typeof lead !== "object") return lead;
  const ld = leadDataFromLeadRecord(lead);
  const summary = formatLeadSummaryForHumans(ld, lang);
  const treatmentSection = summary.sections.find((s) => s.id === "treatment");
  const enriched = {
    ...lead,
    leadSummarySections: summary.sections,
    leadSummaryLines: summary.lines,
    leadSummaryParagraph: summary.paragraph,
    patientReportedTagSummaries: summary.tagSummaries,
    treatmentInterestSummary: treatmentSection?.bullets?.[0] || null,
  };
  return stripMachineLeadFieldsFromDisplay(enriched);
}

module.exports = {
  leadDataFromLeadRecord,
  formatLeadSummaryForHumans,
  attachHumanLeadSummary,
  stripMachineLeadFieldsFromDisplay,
  formatTreatmentLabel,
};
