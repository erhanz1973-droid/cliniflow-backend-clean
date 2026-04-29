import { getApiBaseUrl } from "./apiConfig.js";

/**
 * Nearby clinics (no auth) — same contract as web GET /api/clinics/nearby
 * @param {string | undefined | null} [apiBase] defaults to {@link getApiBaseUrl}
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusKm]
 */
export async function fetchNearbyClinics(apiBase, lat, lng, radiusKm = 100) {
  const base = String(apiBase ?? getApiBaseUrl()).replace(/\/+$/, "");
  if (!base) {
    console.warn("[findClinicApi] missing api base");
    return { ok: false, clinics: [] };
  }
  const url = `${base}/api/clinics/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=${encodeURIComponent(radiusKm)}`;
  console.log("[fetch]", url);
  const res = await fetch(url);
  const text = await res.text();
  let j = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch (_e) {
    j = { _parseError: true, _raw: text };
  }
  const clinics = Array.isArray(j.clinics) ? j.clinics : [];
  try {
    console.log("[findClinicApi] FULL RESPONSE JSON (nearby):", text);
  } catch (_e) {
    console.log("[findClinicApi] FULL RESPONSE (fallback):", j);
  }
  console.log(
    "[findClinicApi] RESPONSE summary status=",
    res.ok,
    "body.ok=",
    j.ok,
    "count=",
    clinics.length,
  );
  if (!res.ok || !j || j.ok === false) {
    return { ok: false, clinics: [] };
  }
  return { ok: true, clinics };
}

/**
 * Browse clinics (GET /api/clinics): city filter + optional text search. Auth optional — pass JWT when logged in.
 * @param {string | undefined | null} apiBase
 * @param {{ cityCode: string, query?: string }} params
 * @param {string | null | undefined} [bearerToken]
 */
export async function fetchBrowseClinics(apiBase, { cityCode, query = "" }, bearerToken) {
  const base = String(apiBase ?? getApiBaseUrl()).replace(/\/+$/, "");
  if (!base) {
    console.warn("[findClinicApi] missing api base");
    return { ok: false, clinics: [] };
  }

  const qs = new URLSearchParams();
  if (cityCode) qs.set("city_code", String(cityCode).trim().toLowerCase());
  const q = String(query ?? "").trim();
  if (q) qs.set("query", q);

  const url = `${base}/api/clinics?${qs.toString()}`;
  /** @type {Record<string, string>} */
  const headers = { Accept: "application/json" };
  const tok = bearerToken != null ? String(bearerToken).trim() : "";
  if (tok) headers.Authorization = `Bearer ${tok}`;

  console.log("[fetchBrowseClinics]", url);
  const res = await fetch(url, { headers });
  const text = await res.text();
  let j = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch (_e) {
    j = {};
  }
  const clinics = Array.isArray(j.clinics) ? j.clinics : [];
  if (!res.ok || !j || j.ok === false) {
    return { ok: false, clinics: [], error: j.error || j.message || res.status };
  }
  return { ok: true, clinics };
}
