/**
 * Haversine distance (km) + helpers for clinics rows with lat/lng or latitude/longitude.
 */

"use strict";

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** @returns {{ lat: number, lng: number } | null} */
function clinicLatLng(row) {
  if (!row || typeof row !== "object") return null;
  const rawLat = row.lat != null ? row.lat : row.latitude;
  const rawLng = row.lng != null ? row.lng : row.longitude;
  const lat = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat ?? "").replace(",", "."));
  const lng = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng ?? "").replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function isActiveClinicStatus(status) {
  const s = String(status ?? "active").toLowerCase();
  return !["suspended", "reject", "rejected", "inactive", "closed"].includes(s);
}

/**
 * @param {any[]} rows - clinic rows from Supabase
 * @param {number} userLat
 * @param {number} userLng
 * @param {number} radiusKm
 * @returns {{ row: any, distance_km: number }[]}
 */
function filterClinicsWithinRadiusKm(rows, userLat, userLng, radiusKm) {
  const out = [];
  for (const row of rows || []) {
    if (!isActiveClinicStatus(row.status)) continue;
    const c = clinicLatLng(row);
    if (!c) continue;
    const d = haversineDistanceKm(userLat, userLng, c.lat, c.lng);
    if (d <= radiusKm + 1e-6) {
      out.push({ row, distance_km: d });
    }
  }
  out.sort((a, b) => a.distance_km - b.distance_km);
  return out;
}

module.exports = {
  haversineDistanceKm,
  clinicLatLng,
  filterClinicsWithinRadiusKm,
  isActiveClinicStatus,
};
