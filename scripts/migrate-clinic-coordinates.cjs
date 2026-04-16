#!/usr/bin/env node
/**
 * Backfill clinics.latitude / clinics.longitude for nearby search.
 *
 * Flow per row (when coordinates missing):
 *   1) Parse google_maps_url / map_link / settings URLs via parseGoogleMapsCoords
 *   2) Else geocode buildGeocodeQuery (name + city + country) via Google Geocoding API
 *   3) Else log SKIP (no data to resolve)
 *
 * Usage:
 *   node scripts/migrate-clinic-coordinates.cjs
 *   node scripts/migrate-clinic-coordinates.cjs --dry-run
 *   node scripts/migrate-clinic-coordinates.cjs --limit=50
 *   node scripts/migrate-clinic-coordinates.cjs --delay-ms=200
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
 *   GOOGLE_GEOCODING_API_KEY or GOOGLE_MAPS_API_KEY (optional but needed for geocode fallback)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  resolveClinicCoords,
  hasFiniteCoords,
  pickMapUrlFromClinic,
  buildGeocodeQuery,
} = require("../lib/clinicCoords.cjs");

function normalizeUrl(u) {
  if (!u || typeof u !== "string") return "";
  let s = u.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAllClinics(supabase) {
  const out = [];
  const pageSize = 500;
  let from = 0;
  for (;;) {
    let q = supabase.from("clinics").select("*").range(from, from + pageSize - 1);
    let { data, error } = await q;
    if (error) {
      const r2 = await supabase.from("clinics").select("*").range(from, from + pageSize - 1);
      data = r2.data;
      error = r2.error;
    }
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function updateClinicCoords(supabase, id, latitude, longitude) {
  const payload = { latitude, longitude, location_verified: true };
  let { error } = await supabase.from("clinics").update(payload).eq("id", id);
  if (error && /location_verified|column|schema cache/i.test(String(error.message || error))) {
    ({ error } = await supabase
      .from("clinics")
      .update({ latitude, longitude })
      .eq("id", id));
  }
  return error;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const delayArg = process.argv.find((a) => a.startsWith("--delay-ms="));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10)) : Infinity;
  const delayMs = delayArg ? Math.max(0, parseInt(delayArg.split("=")[1], 10)) : 150;

  const url = normalizeUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[migrate] FATAL: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const hasGeoKey = !!(process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
  if (!hasGeoKey) {
    console.warn("[migrate] WARN: GOOGLE_GEOCODING_API_KEY not set — geocoding fallback will be skipped.");
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("[migrate] Fetching clinics…");
  let rows = await fetchAllClinics(supabase);
  console.log("[migrate] Total rows:", rows.length);
  if (Number.isFinite(limit)) {
    rows = rows.slice(0, limit);
    console.log("[migrate] Processing limit:", rows.length);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let already = 0;

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    const label = `${c.name || "?"} (${c.id})`;

    if (hasFiniteCoords(c)) {
      already++;
      console.log(`[migrate] [${i + 1}/${rows.length}] OK already: ${label}`);
      continue;
    }

    const mapUrl = pickMapUrlFromClinic(c);
    const geoQuery = buildGeocodeQuery(c);

    let coords = null;
    try {
      await sleep(delayMs);
      coords = await resolveClinicCoords(mapUrl, geoQuery);
    } catch (e) {
      console.warn(`[migrate] resolve error for ${label}:`, e?.message || e);
    }

    if (!coords) {
      skipped++;
      console.log(
        `[migrate] [${i + 1}/${rows.length}] SKIP (no coords, no parse, no geocode): ${label} | mapUrl=${!!mapUrl} geo="${geoQuery || ""}"`
      );
      continue;
    }

    if (dryRun) {
      ok++;
      console.log(
        `[migrate] [DRY-RUN] would update ${label} → ${coords.latitude}, ${coords.longitude}`
      );
      continue;
    }

    const err = await updateClinicCoords(supabase, c.id, coords.latitude, coords.longitude);
    if (err) {
      failed++;
      console.error(`[migrate] FAIL ${label}:`, err.message || err);
      continue;
    }

    ok++;
    console.log(
      `[migrate] [${i + 1}/${rows.length}] UPDATED ${label} → ${coords.latitude}, ${coords.longitude}`
    );
  }

  console.log("\n[migrate] ─── Summary ───");
  console.log(`  Already had coordinates: ${already}`);
  console.log(`  Updated:                  ${ok}${dryRun ? " (dry-run)" : ""}`);
  console.log(`  Skipped (unresolvable):   ${skipped}`);
  console.log(`  Failed:                   ${failed}`);
  console.log("[migrate] Done.");
}

main().catch((e) => {
  console.error("[migrate] FATAL:", e);
  process.exit(1);
});
