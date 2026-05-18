#!/usr/bin/env node
/**
 * Verify Supabase schema required for Treatment Guide + coordinator workspace.
 *
 *   node scripts/verify-supabase-schema.cjs
 *   node scripts/verify-supabase-schema.cjs --strict
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { REQUIRED_MIGRATIONS, SCHEMA_PROBES } = require("./rollout-manifest.cjs");

function parseArgs() {
  return { strict: process.argv.includes("--strict"), listMigrations: process.argv.includes("--list-migrations") };
}

function checkMigrationFilesOnDisk() {
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  const missing = [];
  for (const file of REQUIRED_MIGRATIONS) {
    if (!fs.existsSync(path.join(dir, file))) missing.push(file);
  }
  return missing;
}

async function probeSchema(supabase) {
  const results = [];
  for (const probe of SCHEMA_PROBES) {
    const select = probe.columns.join(",");
    const { error } = await supabase.from(probe.table).select(select).limit(0);
    results.push({
      id: probe.id,
      table: probe.table,
      ok: !error,
      error: error ? error.message : null,
    });
  }
  return results;
}

async function main() {
  const args = parseArgs();

  if (args.listMigrations) {
    console.log("Required migrations (apply in order):\n");
    REQUIRED_MIGRATIONS.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    return;
  }

  const missingFiles = checkMigrationFilesOnDisk();
  if (missingFiles.length) {
    console.error("[schema] Missing migration files in repo:", missingFiles);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[schema] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
    process.exit(1);
  }

  const supabase = createClient(url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, ""), key);
  const results = await probeSchema(supabase);
  const failed = results.filter((r) => !r.ok);

  console.log("\n[schema] Supabase column probes:\n");
  console.table(results);

  if (failed.length) {
    console.error(
      "\n[schema] FAILED — likely migrations not applied or partial state.",
    );
    console.error("Apply migrations in order:\n  node scripts/verify-supabase-schema.cjs --list-migrations\n");
    console.error(
      "In Supabase Dashboard → SQL: run each file under supabase/migrations/ that is missing from your history.",
    );
    process.exit(1);
  }

  console.log("\n[schema] OK — required tables/columns reachable.");

  const variantsProbe = results.find((r) => r.id === "treatment_price_variants");
  if (variantsProbe?.ok) {
    console.log("\n[schema] ✅ treatment_price_variants — variant sync + AI pricing ranges enabled");
  } else {
    console.error(
      "\n[schema] ❌ treatment_price_variants missing — apply 20260518190000_treatment_price_variants.sql",
    );
  }

  console.log(
    "\nNote: This does not prove migration order or constraint definitions.",
  );
  console.log(
    "Manually confirm intake_journey_updated is allowed on ai_coordinator_lead_events (20260517260000).",
  );

  if (args.strict) {
    console.log("\n[schema] --strict: re-check operational_intake_flags jsonb sample…");
    const { data, error } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id, operational_intake_flags")
      .not("operational_intake_flags", "eq", "{}")
      .limit(3);
    if (error) {
      console.warn("[schema] strict sample read failed:", error.message);
    } else {
      console.log(`[schema] profiles with non-empty flags: ${(data || []).length} sampled`);
    }
  }
}

main().catch((e) => {
  console.error("[schema] Fatal:", e.message || e);
  process.exit(1);
});
