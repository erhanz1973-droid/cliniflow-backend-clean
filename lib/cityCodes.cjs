/**
 * Canonical city slugs for API + DB; localized labels live in Expo i18n (keys city.<slug>).
 * Aliases normalize user input / legacy display names to canonical codes.
 */
"use strict";

/** Slugs accepted as stored values and in ?city= / ?city_code= */
const KNOWN_CODES = new Set([
  "tbilisi",
  "batumi",
  "kutaisi",
  "istanbul",
  "ankara",
  "antalya",
]);

/**
 * Cyrillic / Georgian exact forms (keyboard entry, copy-paste from maps).
 * Key = exact string match after trim; value = canonical slug.
 */
const EXACT_UNICODE_ALIASES = new Map([
  ["тбилиси", "tbilisi"],
  ["Тбилиси", "tbilisi"],
  ["თბილისი", "tbilisi"],
]);

/**
 * ASCII / latin aliases (often lowercased).
 */
const LOWERCASE_ALIASES = Object.freeze({
  tbilisi: "tbilisi",
  tiflis: "tbilisi",
  tblisi: "tbilisi",
  tiblisi: "tbilisi",
  "тбилиси": "tbilisi",
});

/**
 * Resolve any user or DB-facing city string to canonical slug, or null if unknown.
 * @param {unknown} raw
 * @returns {string|null}
 */
function resolveCityCode(raw) {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  const fromExact = EXACT_UNICODE_ALIASES.get(s0);
  if (fromExact) return fromExact;
  const lower = s0.toLowerCase();
  if (KNOWN_CODES.has(lower)) return lower;
  const fromAlias = LOWERCASE_ALIASES[lower];
  if (fromAlias) return fromAlias;
  return null;
}

/**
 * @returns {readonly string[]}
 */
function listKnownCityCodes() {
  return [...KNOWN_CODES].sort();
}

function resolveCityCodeWithCatalog(raw, catalogSet) {
  const fixed = resolveCityCode(raw);
  if (fixed) return fixed;
  if (!(catalogSet instanceof Set)) return null;
  const t = String(raw || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  return catalogSet.has(lower) ? lower : null;
}

/**
 * Strict ?city=: static alias OR slug in merged catalog Set when provided.
 */
function parseCityQueryParam(raw, catalogSet = null) {
  if (raw == null || String(raw).trim() === "") return { ok: true, canonical: null };
  const c = catalogSet
    ? resolveCityCodeWithCatalog(raw, catalogSet)
    : resolveCityCode(raw);
  if (!c) return { ok: false };
  return { ok: true, canonical: c };
}

/**
 * Dropdown + manual entry.
 */
function normalizeManualCityInput(raw, catalogSet) {
  const canon = resolveCityCodeWithCatalog(raw, catalogSet);
  if (canon) {
    return { city_code: canon, pending_city_raw: null };
  }
  const t = String(raw || "").trim();
  if (!t) return { error: "empty" };
  if (t.length > 160) return { error: "too_long" };
  return { city_code: null, pending_city_raw: t };
}

/**
 * Prefer city_code column; fallback legacy city text.
 * `pending_city_raw` is always null here (optional DB column may be absent).
 */
function clinicCityPayloadFromRow(row) {
  if (!row || typeof row !== "object") {
    return { city: null, city_code: null, pending_city_raw: null };
  }
  const explicit = row.city_code != null ? String(row.city_code).trim() : "";
  if (explicit) {
    const slug = explicit.toLowerCase();
    return { city: slug, city_code: slug, pending_city_raw: null };
  }
  const legacy = resolveCityCode(row.city);
  if (legacy) {
    return { city: legacy, city_code: legacy, pending_city_raw: null };
  }
  const c = typeof row.city === "string" && row.city.trim() ? row.city.trim() : null;
  return { city: c, city_code: null, pending_city_raw: null };
}

/**
 * @deprecated Prefer {@link clinicCityPayloadFromRow} when row columns exist.
 */
function clinicCityPayload(dbCity) {
  const code = resolveCityCode(dbCity);
  if (code) {
    return { city: code, city_code: code };
  }
  const fallback = typeof dbCity === "string" && dbCity.trim() ? dbCity.trim() : null;
  return { city: fallback, city_code: null };
}

function slugifyCatalogCode(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  const out = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return out && out.length <= 64 ? out : null;
}

/**
 * Normalize free-text city for storage as `city_code`: lowercase ASCII slug (underscores for spaces).
 * Empty string when input cannot be slugified (e.g. only non-Latin glyphs with no KNOWN_CODES path).
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeCity(raw) {
  const s = slugifyCatalogCode(raw);
  return s == null ? "" : s;
}

module.exports = {
  resolveCityCode,
  resolveCityCodeWithCatalog,
  listKnownCityCodes,
  clinicCityPayload,
  clinicCityPayloadFromRow,
  parseCityQueryParam,
  normalizeManualCityInput,
  slugifyCatalogCode,
  normalizeCity,
  KNOWN_CODES,
};
