/**
 * Clinic geolocation helpers — URL parsing, geocoding, normalization.
 * Used by index.cjs, lib/supabase.js, and scripts/migrate-clinic-coordinates.cjs
 */

/**
 * Simple q=lat,lng extractor (e.g. https://maps.google.com/?q=41.7151,44.8271)
 * @returns {{ lat: number, lng: number } | null}
 */
function extractLatLng(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/[?&]q=([0-9.-]+),([0-9.-]+)/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function coordsFromLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * @-style pin segment (works without a valid URL / protocol).
 */
function parseAtSymbolCoords(s) {
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const r = coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));
      if (r) return r;
    }
  }
  return null;
}

/**
 * Extracts { latitude, longitude } from a Google Maps URL.
 * Returns null if no coords are found.
 *
 * Supported patterns (in priority order):
 *  1. ?q=lat,lng  — simple query with coords
 *  2. /@lat,lng  — standard place/directions URLs (before URL parsing)
 *  3. !3dlat!4dlng — embed/data fragment
 *  4. decoded URL retry — for percent-encoded copies
 *  5. ?q= / ?ll= / ?center= from search params
 */
function parseGoogleMapsCoords(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const simple = extractLatLng(trimmed);
  if (simple) return coordsFromLatLng(simple.lat, simple.lng);

  let fromAt = parseAtSymbolCoords(trimmed);
  if (fromAt) return fromAt;

  let m = trimmed.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) {
    const r = coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));
    if (r) return r;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed.replace(/\+/g, " "));
  } catch {
    /* ignore */
  }
  if (decoded !== trimmed) {
    const s2 = extractLatLng(decoded);
    if (s2) return coordsFromLatLng(s2.lat, s2.lng);
    fromAt = parseAtSymbolCoords(decoded);
    if (fromAt) return fromAt;
    m = decoded.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    if (m) {
      const r = coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));
      if (r) return r;
    }
  }

  try {
    let abs = trimmed;
    if (!/^https?:\/\//i.test(abs)) abs = `https://${abs}`;
    const qs = new URL(abs).searchParams;

    const q = (qs.get("q") || "").replace(/\s/g, "");
    m = q.match(/^(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)$/);
    if (m) return coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));

    m = q.match(/loc:(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i);
    if (m) return coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));

    const ll = (qs.get("ll") || "").trim();
    m = ll.match(/^(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
    if (m) return coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));

    const center = (qs.get("center") || "").replace(/\s/g, "");
    m = center.match(/^(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
    if (m) return coordsFromLatLng(parseFloat(m[1]), parseFloat(m[2]));

    return null;
  } catch {
    return null;
  }
}

/**
 * Geocodes an address using Google Geocoding API.
 * @returns {{ latitude: number, longitude: number } | null}
 */
async function geocodeAddressWithGoogle(address, apiKey) {
  if (!address || !apiKey) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return null;
    }
    const loc = data?.results?.[0]?.geometry?.location;
    if (!loc) return null;
    return { latitude: loc.lat, longitude: loc.lng };
  } catch {
    return null;
  }
}

/**
 * Master resolver: parse URL first, fall back to geocoding address.
 * @param {string} googleMapsUrl
 * @param {string} address free-text address or "name, city, country"
 */
async function resolveClinicCoords(googleMapsUrl, address) {
  const fromUrl = parseGoogleMapsCoords(googleMapsUrl);
  if (fromUrl) return fromUrl;

  const geocodeKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
  if (geocodeKey && address && String(address).trim()) {
    const fromGeocode = await geocodeAddressWithGoogle(String(address).trim(), geocodeKey);
    if (fromGeocode) return fromGeocode;
  }
  return null;
}

function parseCoord(v) {
  if (v == null || v === "") return NaN;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}

/** True if clinic row has usable latitude/longitude (snake or legacy lat/lng columns). */
function hasFiniteCoords(clinic) {
  let lat = parseCoord(clinic.latitude ?? clinic.lat);
  let lng = parseCoord(clinic.longitude ?? clinic.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

/** Normalize legacy lat/lng into latitude/longitude on a plain object (mutates). */
function normalizeClinicCoordinateFields(row) {
  const out = { ...row };
  const lat = parseCoord(out.latitude ?? out.lat);
  const lng = parseCoord(out.longitude ?? out.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    out.latitude = lat;
    out.longitude = lng;
  }
  delete out.lat;
  delete out.lng;
  return out;
}

function parseSettingsMaybe(settings) {
  if (!settings) return {};
  if (typeof settings === "object") return settings;
  if (typeof settings === "string") {
    try {
      return JSON.parse(settings);
    } catch {
      return {};
    }
  }
  return {};
}

/** First non-empty map URL from row + settings JSON. */
function pickMapUrlFromClinic(clinic) {
  const s = parseSettingsMaybe(clinic.settings);
  const branding = s.branding && typeof s.branding === "object" ? s.branding : {};
  const candidates = [
    clinic.google_maps_url,
    clinic.googleMapsUrl,
    clinic.map_link,
    s.googleMapsUrl,
    s.googleMapLink,
    s.google_maps_url,
    branding.googleMapsUrl,
    branding.googleMapLink,
  ];
  for (const u of candidates) {
    if (u && typeof u === "string" && u.trim()) return u.trim();
  }
  return "";
}

/** Build a geocoding query: prefer full address, then name + city + country. */
function buildGeocodeQuery(clinic) {
  const parts = [
    clinic.address,
    clinic.city,
    clinic.country,
  ]
    .filter((x) => x != null && String(x).trim())
    .map((x) => String(x).trim());
  if (parts.length) return parts.join(", ");

  const name = clinic.name ? String(clinic.name).trim() : "";
  const city = clinic.city ? String(clinic.city).trim() : "";
  const country = clinic.country ? String(clinic.country).trim() : "";
  if (name && city) return [name, city, country].filter(Boolean).join(", ");
  if (name) return name;
  return "";
}

module.exports = {
  extractLatLng,
  parseGoogleMapsCoords,
  geocodeAddressWithGoogle,
  resolveClinicCoords,
  hasFiniteCoords,
  normalizeClinicCoordinateFields,
  pickMapUrlFromClinic,
  buildGeocodeQuery,
};
