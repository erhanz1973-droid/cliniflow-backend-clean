/**
 * Clinifly partner clinic directory for Treatment Guide (operational — not rankings).
 * Queries registered active clinics; no hardcoded city lists.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getMergedCityCatalogSet } = require("./cityCatalogLoader.cjs");
const {
  resolveCityCodeWithCatalog,
  clinicCityPayloadFromRow,
  slugifyCatalogCode,
} = require("./cityCodes.cjs");

const SELECT =
  "id, name, city, city_code, country, clinic_code, status";

const INACTIVE_STATUSES = new Set(["suspended", "reject", "rejected", "inactive", "closed"]);

function filterActiveClinicRows(rows) {
  return (rows || []).filter((c) => {
    const s = String(c.status ?? "active").toLowerCase();
    return !INACTIVE_STATUSES.has(s);
  });
}

function dedupeById(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const id = String(r.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/**
 * @param {string} label
 * @param {Record<string, unknown>} row
 */
function formatCityLabel(geo, row) {
  const country = row.country != null ? String(row.country).trim() : "";
  const city =
    geo.city_code != null
      ? String(geo.city_code).replace(/_/g, " ")
      : geo.city != null
        ? String(geo.city).trim()
        : "";
  if (city && country) return `${city}, ${country}`;
  return city || country || "Location pending";
}

/**
 * @param {string} message
 * @param {Set<string>} catalogSet
 * @returns {string[]}
 */
function extractLocationHints(message, catalogSet) {
  const msg = String(message || "").trim();
  if (!msg) return [];

  const hints = new Set();

  const inCityRe =
    /\b(?:in|at|near|around|from)\s+([A-Za-zÀ-ÿİıŞşĞğÖöÜüÇç][A-Za-zÀ-ÿİıŞşĞğÖöÜüÇç\s'-]{1,40})/gi;
  let m;
  while ((m = inCityRe.exec(msg)) !== null) {
    const chunk = String(m[1] || "").trim();
    if (chunk.length >= 2) hints.add(chunk);
  }

  const tokens = msg.split(/[\s,;?!.]+/).filter((t) => t.length >= 3);
  for (const token of tokens) {
    const canon = resolveCityCodeWithCatalog(token, catalogSet);
    if (canon) hints.add(canon);
    const slug = slugifyCatalogCode(token);
    if (slug) hints.add(slug);
    if (token.length >= 4) hints.add(token);
  }

  return [...hints].slice(0, 8);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} text
 */
async function findClinicsMatchingText(client, text) {
  const raw = String(text || "").trim();
  if (raw.length < 2) return [];

  const safe = raw.replace(/[%_\\]/g, "").slice(0, 80);
  const slug = slugifyCatalogCode(raw) || resolveCityCodeWithCatalog(raw, null);

  const parts = [`city.ilike.%${safe}%`, `country.ilike.%${safe}%`];
  if (slug && slug !== safe.toLowerCase()) {
    parts.push(`city_code.ilike.%${slug}%`);
  }

  const { data, error } = await client
    .from("clinics")
    .select(SELECT)
    .or(parts.join(","))
    .limit(50);

  if (error) {
    console.warn("[clinicDirectoryForAi] search:", error.message);
    return [];
  }
  return filterActiveClinicRows(data);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {number} limit
 */
async function fetchActiveClinics(client, limit = 150) {
  const { data, error } = await client.from("clinics").select(SELECT).order("name").limit(limit);
  if (error) {
    console.warn("[clinicDirectoryForAi] list:", error.message);
    return [];
  }
  return filterActiveClinicRows(data);
}

/**
 * @param {Array<Record<string, unknown>>} clinics
 */
function summarizeClinicsByCity(clinics) {
  /** @type {Map<string, { count: number, names: string[] }>} */
  const map = new Map();

  for (const c of clinics) {
    const geo = clinicCityPayloadFromRow(c);
    const label = formatCityLabel(geo, c);
    if (!map.has(label)) map.set(label, { count: 0, names: [] });
    const bucket = map.get(label);
    bucket.count += 1;
    const name = String(c.name || "Clinic").trim();
    if (name && bucket.names.length < 6) bucket.names.push(name);
  }

  const lines = [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([city, { count, names }]) => {
      const sample = names.slice(0, 3).join(", ");
      const extra = count > names.length ? ` (+${count - names.length} more)` : "";
      return `- ${city}: ${count} registered clinic(s)${sample ? ` — e.g. ${sample}${extra}` : ""}`;
    });

  return { lines, cityCount: map.size, total: clinics.length };
}

const NETWORK_QUESTION_RE = /\b(which|what)\s+(cities|city|locations|regions)\b/i;
const AVAILABILITY_RE = /\b(clinic|clinics|klinik|partner|available|have\s+.+\s+in)\b/i;

/**
 * @param {{
 *   message?: string|null,
 *   linkedClinicId?: string|null,
 *   patientCountry?: string|null,
 *   cityQuery?: string|null,
 * }} params
 * @returns {Promise<string|null>}
 */
async function buildClinicDirectoryPromptBlock(params = {}) {
  if (!isSupabaseEnabled()) return null;

  const message = String(params.message || "").trim();
  const catalogSet = await getMergedCityCatalogSet(supabase);
  const hints = extractLocationHints(message, catalogSet);

  if (params.cityQuery) {
    hints.unshift(String(params.cityQuery).trim());
  }
  if (params.patientCountry) {
    hints.push(String(params.patientCountry).trim());
  }

  const wantsNetwork =
    NETWORK_QUESTION_RE.test(message) ||
    AVAILABILITY_RE.test(message) ||
    hints.length > 0;

  if (!wantsNetwork) return null;

  let clinics = [];
  for (const hint of [...new Set(hints)]) {
    const rows = await findClinicsMatchingText(supabase, hint);
    clinics.push(...rows);
  }
  clinics = dedupeById(clinics);

  if (!clinics.length && (NETWORK_QUESTION_RE.test(message) || hints.length > 0)) {
    clinics = await fetchActiveClinics(supabase, 200);
    if (hints.length) {
      const hintLower = hints.map((h) => h.toLowerCase());
      const filtered = clinics.filter((c) => {
        const geo = clinicCityPayloadFromRow(c);
        const blob = [geo.city, geo.city_code, c.country, c.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hintLower.some((h) => blob.includes(h) || h.includes(blob.slice(0, 4)));
      });
      if (filtered.length) clinics = filtered;
    }
  }

  const linkedId = String(params.linkedClinicId || "").trim();

  if (!clinics.length) {
    const asked = hints.length ? hints.join(", ") : "that location";
    return [
      "Clinifly clinic directory (operational platform data):",
      `No registered partner clinics matched: ${asked}.`,
      "Do not invent clinic names or cities. Say we do not currently list a partner clinic there (if asked). Offer to continue intake or use the app's Find Clinic section when listings update.",
    ].join("\n");
  }

  const { lines, cityCount, total } = summarizeClinicsByCity(clinics);
  const out = [
    "Clinifly registered partner clinics (operational directory — not rankings, not medical advice):",
    `Network snapshot: ${total} clinic(s) across ${cityCount} location(s).`,
    ...lines,
    "Instructions:",
    "- Answer city/availability questions using ONLY this directory.",
    "- If a city appears above, confirm partner clinics may be available there (operational wording).",
    "- If the patient's city is not listed, say so honestly — do not claim ignorance of the whole platform.",
    '- Do not use "best clinic", guarantees, or tourism/hotel sales language.',
    "- You may suggest continuing intake or messaging a clinic to connect.",
  ];

  if (linkedId) {
    const linked = clinics.find((c) => String(c.id) === linkedId);
    if (linked) {
      const geo = clinicCityPayloadFromRow(linked);
      out.push(
        `Patient is already linked to: ${linked.name} (${formatCityLabel(geo, linked)}).`,
      );
    }
  }

  return out.join("\n");
}

/**
 * Public search for patient UI (same data rules as AI block).
 * @param {{ city?: string|null, query?: string|null, limit?: number }} params
 */
async function searchClinicDirectory(params = {}) {
  if (!isSupabaseEnabled()) {
    return { clinics: [], cities: [], total: 0 };
  }

  const catalogSet = await getMergedCityCatalogSet(supabase);
  const hints = [];
  if (params.city) hints.push(String(params.city).trim());
  if (params.query) hints.push(...extractLocationHints(String(params.query), catalogSet));

  let clinics = [];
  for (const hint of [...new Set(hints)]) {
    clinics.push(...(await findClinicsMatchingText(supabase, hint)));
  }
  clinics = dedupeById(clinics);

  if (!clinics.length && !hints.length) {
    clinics = await fetchActiveClinics(supabase, params.limit || 30);
  }

  const cap = Math.min(params.limit || 12, clinics.length);
  const slice = clinics.slice(0, cap);
  const summary = summarizeClinicsByCity(clinics);

  return {
    clinics: slice.map((c) => {
      const geo = clinicCityPayloadFromRow(c);
      return {
        id: c.id,
        name: c.name || "Clinic",
        city: geo.city,
        city_code: geo.city_code,
        country: c.country || null,
        clinicCode: c.clinic_code || null,
      };
    }),
    cities: summary.lines.map((line) => line.replace(/^- /, "")),
    total: summary.total,
    cityCount: summary.cityCount,
  };
}

module.exports = {
  buildClinicDirectoryPromptBlock,
  searchClinicDirectory,
  extractLocationHints,
  summarizeClinicsByCity,
};
