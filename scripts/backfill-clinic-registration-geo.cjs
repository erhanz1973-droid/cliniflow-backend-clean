#!/usr/bin/env node
/**
 * Backfill clinics.country / city_code from phone and address (existing registrations).
 * Usage: node scripts/backfill-clinic-registration-geo.cjs [--dry-run] [--code=MEDSMILE]
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const { enrichClinicRegistrationGeo } = require("../lib/clinicRegistrationGeo.cjs");

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const codeArg = process.argv.find((a) => a.startsWith("--code="));
  const onlyCode = codeArg ? codeArg.split("=")[1].trim().toUpperCase() : null;

  let q = supabase
    .from("clinics")
    .select("id, name, clinic_code, phone, address, city, city_code, country, status")
    .order("created_at", { ascending: false })
    .limit(500);
  if (onlyCode) q = q.eq("clinic_code", onlyCode);

  const { data, error } = await q;
  if (error) throw error;

  let updated = 0;
  for (const row of data || []) {
    const enriched = enrichClinicRegistrationGeo(row);
    const patch = {};
    if (enriched.country && enriched.country !== row.country) patch.country = enriched.country;
    if (enriched.city_code && enriched.city_code !== row.city_code) patch.city_code = enriched.city_code;
    if (enriched.city && enriched.city !== row.city) patch.city = enriched.city;
    if (enriched.status && enriched.status !== row.status) patch.status = enriched.status;

    if (!Object.keys(patch).length) continue;

    console.log(
      dryRun ? "[dry-run]" : "[update]",
      row.clinic_code || row.id,
      "→",
      JSON.stringify(patch),
    );

    if (!dryRun) {
      const { error: upErr } = await supabase.from("clinics").update(patch).eq("id", row.id);
      if (upErr) {
        console.error("  failed:", upErr.message);
        continue;
      }
    }
    updated += 1;
  }

  console.log(`Done. ${updated} clinic(s) ${dryRun ? "would be" : ""} updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
