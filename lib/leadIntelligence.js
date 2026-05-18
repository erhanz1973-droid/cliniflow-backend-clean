/**
 * Lead intelligence — normalize OpenAI-extracted signals for CRM / routing (Phase 3).
 */

const { normalizeTagList, mergeTagLists } = require("./treatmentInterestTags");

const URGENCY_VALUES = new Set(["low", "medium", "high"]);
const INTENT_VALUES = new Set(["low", "medium", "high"]);
const BUDGET_VALUES = new Set(["low", "medium", "high", "not_discussed"]);

const LANG_RE = /^[a-z]{2}$/i;

/**
 * @typedef {Object} LeadData
 * @property {string|null} treatmentInterest
 * @property {string|null} country
 * @property {string|null} language
 * @property {string|null} travelTimeline
 * @property {'low'|'medium'|'high'|null} urgency
 * @property {'low'|'medium'|'high'|null} bookingIntent
 * @property {'low'|'medium'|'high'|'not_discussed'|null} budgetSignal
 * @property {string[]} patientReportedTags
 * @property {number|null} [missingTeethCount]
 */

/** @returns {LeadData} */
function emptyLeadData() {
  return {
    treatmentInterest: null,
    country: null,
    language: null,
    travelTimeline: null,
    urgency: null,
    bookingIntent: null,
    budgetSignal: null,
    patientReportedTags: [],
    missingTeethCount: null,
  };
}

/**
 * @param {unknown} raw
 * @returns {LeadData}
 */
function normalizeLeadData(raw) {
  const base = emptyLeadData();
  if (!raw || typeof raw !== "object") return base;

  const o = /** @type {Record<string, unknown>} */ (raw);

  const treatmentInterest = pickString(o.treatmentInterest ?? o.treatment_interest ?? o.treatmentIntent);
  const country = pickString(o.country ?? o.patientCountry ?? o.patient_country);
  const language = pickLanguage(
    o.language ?? o.lang ?? o.preferredLanguage ?? o.preferred_language,
  );
  const travelTimeline = pickString(
    o.travelTimeline ?? o.travel_timeline ?? o.travelTimelineText ?? o.timeline,
  );

  const urgency = pickEnum(o.urgency, URGENCY_VALUES);
  const bookingIntent = pickEnum(
    o.bookingIntent ?? o.booking_intent ?? o.bookingIntentLevel,
    INTENT_VALUES,
  );
  const budgetSignal = pickEnum(
    o.budgetSignal ?? o.budget_signal ?? o.budget,
    BUDGET_VALUES,
  );

  const patientReportedTags = normalizeTagList(
    o.patientReportedTags ?? o.patient_reported_tags ?? o.treatmentTags,
  );

  let missingTeethCount = null;
  const mtc = o.missingTeethCount ?? o.missing_teeth_count;
  if (mtc != null && Number.isFinite(Number(mtc))) {
    const n = Number(mtc);
    if (n >= 1 && n <= 32) missingTeethCount = n;
  }

  return {
    treatmentInterest,
    country,
    language,
    travelTimeline,
    urgency,
    bookingIntent,
    budgetSignal,
    patientReportedTags,
    missingTeethCount,
  };
}

/**
 * @param {LeadData|null|undefined} prev
 * @param {LeadData|null|undefined} next
 * @returns {LeadData}
 */
function mergeLeadData(prev, next) {
  const p = prev && typeof prev === "object" ? prev : emptyLeadData();
  const n = next && typeof next === "object" ? next : emptyLeadData();
  return {
    treatmentInterest: n.treatmentInterest || p.treatmentInterest || null,
    country: n.country || p.country || null,
    language: p.language || null,
    travelTimeline: n.travelTimeline || p.travelTimeline || null,
    urgency: n.urgency || p.urgency || null,
    bookingIntent: n.bookingIntent || p.bookingIntent || null,
    budgetSignal: n.budgetSignal || p.budgetSignal || null,
    patientReportedTags: mergeTagLists(p.patientReportedTags, n.patientReportedTags),
    missingTeethCount: n.missingTeethCount ?? p.missingTeethCount ?? null,
  };
}

/** @param {LeadData} lead */
function leadDataHasSignals(lead) {
  if (!lead) return false;
  return !!(
    lead.treatmentInterest ||
    lead.country ||
    lead.language ||
    lead.travelTimeline ||
    lead.urgency ||
    lead.bookingIntent ||
    lead.budgetSignal ||
    (lead.patientReportedTags && lead.patientReportedTags.length)
  );
}

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function pickString(v) {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "unknown") return null;
  return s.slice(0, 120);
}

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function pickLanguage(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "null" || s === "unknown") return null;
  const code = s.split(/[-_]/)[0];
  return LANG_RE.test(code) ? code : null;
}

/**
 * @param {unknown} v
 * @param {Set<string>} allowed
 * @returns {string|null}
 */
function pickEnum(v, allowed) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "null" || s === "unknown") return null;
  return allowed.has(s) ? s : null;
}

/**
 * @param {Array<{ role?: string, text?: string, content?: string }>|undefined|null} history
 * @returns {Array<{ role: string, text: string }>}
 */
function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const row of history) {
    if (!row || typeof row !== "object") continue;
    const roleRaw = String(row.role || "").trim().toLowerCase();
    const text = String(row.text ?? row.content ?? "").trim();
    if (!text || text.length > 4000) continue;
    const role =
      roleRaw === "patient" || roleRaw === "user"
        ? "user"
        : roleRaw === "assistant" || roleRaw === "ai"
          ? "assistant"
          : null;
    if (!role) continue;
    out.push({ role, text });
  }
  return out.slice(-20);
}

module.exports = {
  emptyLeadData,
  normalizeLeadData,
  mergeLeadData,
  leadDataHasSignals,
  normalizeChatHistory,
};
