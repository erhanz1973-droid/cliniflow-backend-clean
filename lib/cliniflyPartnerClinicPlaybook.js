/**
 * Clinifly Partner Clinic Playbook — loader for Sales AI retrieval.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getPartnerClinicPlaybookData } = require("./cliniflyPartnerClinicPlaybookData");

const PLAYBOOK_NAME = "Clinifly Partner Clinic Playbook";
const CACHE_TTL_MS = Math.max(
  30_000,
  parseInt(process.env.CLINIFLY_PLAYBOOK_CACHE_TTL_MS || "300000", 10) || 300_000,
);

/** @type {{ loadedAt: number, rows: Array<Record<string, unknown>> } | null} */
let playbookCache = null;

/** @type {Record<string, string>} */
const SECTION_LABELS = {
  patient_acquisition: "Patient Acquisition",
  international_dental_tourism: "International Patients & Dental Tourism",
  ai_assistant: "AI Assistant",
  clinic_profile_marketplace: "Clinic Profile & Marketplace",
  referral_system: "Referral System",
  pricing_membership: "Pricing & Membership",
  objection_handling: "Objection Handling",
};

/**
 * @param {string} raw
 */
function normalizeLocale(raw) {
  const base = String(raw || "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return base || "en";
}

/**
 * @param {Record<string, unknown>} row
 */
function mapPlaybookDbRow(row) {
  return {
    id: String(row.id || ""),
    section: String(row.section || ""),
    intent: String(row.intent || ""),
    question: String(row.question || ""),
    questionAliases: Array.isArray(row.question_aliases)
      ? row.question_aliases.map((q) => String(q))
      : [],
    shortAnswer: String(row.short_answer || ""),
    detailedAnswer: row.detailed_answer ? String(row.detailed_answer) : null,
    language: normalizeLocale(row.language),
    priority: Number(row.priority) || 50,
    sortOrder: Number(row.sort_order) || 0,
    tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t)) : [],
  };
}

/**
 * Map playbook row → unified sales KB entry for retrieval scoring.
 * @param {ReturnType<mapPlaybookDbRow>} row
 */
function mapPlaybookToSalesKbEntry(row) {
  const questions = [row.question, ...row.questionAliases].filter(Boolean);
  return {
    id: row.id,
    topicId: row.intent,
    priority: row.priority,
    locales: [row.language],
    questions,
    answerShort: row.shortAnswer,
    answerLong: row.detailedAnswer,
    proofPoints: [SECTION_LABELS[row.section] || row.section].filter(Boolean),
    cta: null,
    tags: [...row.tags, row.section, "partner_playbook"],
    forbiddenPhrases: [],
    playbookSection: row.section,
  };
}

function invalidatePartnerClinicPlaybookCache() {
  playbookCache = null;
}

/**
 * @param {{ force?: boolean, language?: string|null }} [opts]
 */
async function loadPartnerClinicPlaybookEntries(opts = {}) {
  const locale = normalizeLocale(opts.language);
  const bundled = getPartnerClinicPlaybookData().filter(
    (r) => !opts.language || normalizeLocale(r.language) === locale,
  );

  if (!isSupabaseEnabled()) {
    playbookCache = { loadedAt: Date.now(), rows: bundled };
    return bundled;
  }

  const now = Date.now();
  if (!opts.force && playbookCache && now - playbookCache.loadedAt < CACHE_TTL_MS) {
    return playbookCache.rows;
  }

  let query = supabase
    .from("clinifly_partner_clinic_playbook_entries")
    .select(
      "id, section, intent, question, question_aliases, short_answer, detailed_answer, language, priority, sort_order, tags",
    )
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .order("sort_order", { ascending: true });

  if (opts.language) {
    query = query.eq("language", locale);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("[cliniflyPartnerClinicPlaybook] load:", error.message, "— using bundled playbook");
    playbookCache = { loadedAt: now, rows: bundled };
    return bundled;
  }

  let rows = (data || []).map(mapPlaybookDbRow).filter((r) => r.id && r.shortAnswer);
  if (!rows.length) {
    console.warn("[cliniflyPartnerClinicPlaybook] empty DB — using bundled playbook");
    rows = bundled;
  }
  playbookCache = { loadedAt: now, rows };
  return rows;
}

/**
 * @param {{ force?: boolean, language?: string|null }} [opts]
 */
async function loadPartnerClinicPlaybookAsSalesEntries(opts = {}) {
  const rows = await loadPartnerClinicPlaybookEntries(opts);
  return rows.map(mapPlaybookToSalesKbEntry);
}

module.exports = {
  PLAYBOOK_NAME,
  SECTION_LABELS,
  loadPartnerClinicPlaybookEntries,
  loadPartnerClinicPlaybookAsSalesEntries,
  mapPlaybookToSalesKbEntry,
  invalidatePartnerClinicPlaybookCache,
  normalizeLocale,
};
