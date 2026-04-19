/**
 * Prioritize clinics that match the user's country (handles GE / Georgia, TR / Turkey, etc.)
 */

"use strict";

/** @returns {string} stable bucket for comparison */
function countryBucket(raw) {
  let s = String(raw ?? "").trim().toUpperCase();
  try {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {
    /* ignore */
  }
  if (!s) return "";
  if (s === "GE" || s.startsWith("GEORG")) return "GE";
  if (s === "TR" || s.startsWith("TURK") || s.includes("TURKIYE") || s.includes("TÜRKİYE")) return "TR";
  if (s === "AZ" || s.startsWith("AZER")) return "AZ";
  if (s === "US" || s === "USA" || s.startsWith("UNITED STATES")) return "US";
  return s.length <= 3 ? s : s;
}

/** True if clinic country matches user's country (name or ISO-style). */
function countriesMatch(clinicCountry, userCountry) {
  const u = countryBucket(userCountry);
  const c = countryBucket(clinicCountry);
  if (!u || !c) return false;
  if (u === c) return true;
  // Short codes vs full names
  if (u.length <= 3 && c.length > 3 && c.startsWith(u)) return true;
  if (c.length <= 3 && u.length > 3 && u.startsWith(c)) return true;
  return false;
}

/** @returns {number} higher = better (for sorting clinics) */
function countryPriorityScore(clinicCountry, userCountry) {
  return countriesMatch(clinicCountry, userCountry) ? 1_000_000 : 0;
}

/**
 * @param {any[]} rows - clinic rows with optional .country, .distance_km, etc.
 * @param {string} userCountry
 */
function sortClinicRowsByUserCountry(rows, userCountry) {
  const u = String(userCountry ?? "").trim();
  if (!u || !Array.isArray(rows) || rows.length < 2) return rows;

  return [...rows].sort((a, b) => {
    const pa = countryPriorityScore(a.country, u);
    const pb = countryPriorityScore(b.country, u);
    if (pb !== pa) return pb - pa;

    const da = parseFloat(a.distance_km ?? a.distanceKm ?? a.dist_km ?? "");
    const db = parseFloat(b.distance_km ?? b.distanceKm ?? b.dist_km ?? "");
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
    if (Number.isFinite(da) && !Number.isFinite(db)) return -1;
    if (!Number.isFinite(da) && Number.isFinite(db)) return 1;

    const na = String(a.name ?? "");
    const nb = String(b.name ?? "");
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });
}

/**
 * @param {{ row: any, distance_km: number }[]} matched - from Haversine filter
 * @param {string} userCountry
 */
function sortNearbyMatchesByUserCountry(matched, userCountry) {
  const u = String(userCountry ?? "").trim();
  if (!u || !Array.isArray(matched) || matched.length < 2) return matched;
  return [...matched].sort((a, b) => {
    const pa = countryPriorityScore(a.row?.country, u);
    const pb = countryPriorityScore(b.row?.country, u);
    if (pb !== pa) return pb - pa;
    return (a.distance_km ?? 0) - (b.distance_km ?? 0);
  });
}

module.exports = {
  countryBucket,
  countriesMatch,
  countryPriorityScore,
  sortClinicRowsByUserCountry,
  sortNearbyMatchesByUserCountry,
};
