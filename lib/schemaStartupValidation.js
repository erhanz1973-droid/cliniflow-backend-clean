/**
 * Startup + health probes for pricing / variant tables (PostgREST schema cache aware).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const VARIANTS_TABLE = "treatment_price_variants";
const VARIANTS_CREATE_MIGRATION = "20260518190000_treatment_price_variants.sql";
const VARIANTS_ENSURE_MIGRATION = "20260518280000_treatment_price_variants_ensure.sql";
const VARIANTS_CLINIC_ID_MIGRATION = "20260518210000_treatment_price_variants_clinic_id.sql";
const CATALOG_VARIANTS_TABLE = "clinic_treatment_variants";
const CATALOG_VARIANTS_MIGRATION = "20260518180000_clinic_treatment_variants.sql";

/** @type {null | Record<string, unknown>} */
let lastStartupStatus = null;

/**
 * @param {unknown} error
 * @param {string} [tableName]
 */
function isTableOrSchemaCacheError(error, tableName = "") {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  const code = String(error.code || "");
  const t = String(tableName || "").toLowerCase();
  const mentionsTable = !t || msg.includes(t);
  return (
    mentionsTable &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find the table") ||
      msg.includes("not found") ||
      code === "PGRST205" ||
      code === "42P01")
  );
}

/**
 * @param {string} table
 * @param {string[]} columns
 */
async function probeTable(table, columns) {
  if (!isSupabaseEnabled()) {
    return { ok: false, table, error: "supabase_disabled", latencyMs: 0 };
  }
  const t0 = Date.now();
  const { error } = await supabase.from(table).select(columns.join(",")).limit(0);
  return {
    ok: !error,
    table,
    error: error ? error.message : null,
    code: error ? error.code : null,
    schemaCacheStale: error ? isTableOrSchemaCacheError(error, table) : false,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Run pricing/variant schema probes (best-effort; never throws).
 * @returns {Promise<Record<string, unknown>>}
 */
async function validatePricingSchemaAtStartup() {
  const startedAt = new Date().toISOString();

  if (!isSupabaseEnabled()) {
    const status = {
      checkedAt: startedAt,
      supabaseEnabled: false,
      treatmentPricesTable: { ok: false, error: "supabase_disabled" },
      treatmentPriceVariantsTable: { ok: false, error: "supabase_disabled" },
      variantsClinicIdColumn: false,
      catalogVariantsTable: { ok: false, error: "supabase_disabled" },
      pricingVariantsEnabled: false,
      variantSyncReady: false,
      migrationsRequired: [VARIANTS_CREATE_MIGRATION],
    };
    lastStartupStatus = status;
    return status;
  }

  const treatmentPricesTable = await probeTable("treatment_prices", [
    "id",
    "clinic_id",
    "type",
    "price",
    "currency",
  ]);
  const treatmentPriceVariantsTable = await probeTable(VARIANTS_TABLE, [
    "id",
    "treatment_price_id",
    "brand_name",
    "price_min",
    "price_max",
    "currency",
  ]);

  let variantsClinicIdColumn = false;
  if (treatmentPriceVariantsTable.ok) {
    const clinicCol = await probeTable(VARIANTS_TABLE, ["clinic_id"]);
    variantsClinicIdColumn = clinicCol.ok;
  }

  const catalogVariantsTable = await probeTable(CATALOG_VARIANTS_TABLE, [
    "id",
    "treatment_catalog_id",
    "brand_name",
  ]);

  const pricingVariantsEnabled = treatmentPriceVariantsTable.ok === true;
  const variantSyncReady = treatmentPricesTable.ok && treatmentPriceVariantsTable.ok;

  /** @type {string[]} */
  const migrationsRequired = [];
  if (!treatmentPriceVariantsTable.ok) {
    migrationsRequired.push(VARIANTS_ENSURE_MIGRATION, VARIANTS_CREATE_MIGRATION);
  }
  if (treatmentPriceVariantsTable.ok && !variantsClinicIdColumn) {
    migrationsRequired.push(VARIANTS_CLINIC_ID_MIGRATION);
  }
  if (!catalogVariantsTable.ok) {
    migrationsRequired.push(CATALOG_VARIANTS_MIGRATION);
  }

  const status = {
    checkedAt: startedAt,
    supabaseEnabled: true,
    treatmentPricesTable,
    treatmentPriceVariantsTable,
    variantsClinicIdColumn,
    catalogVariantsTable,
    pricingVariantsEnabled,
    variantSyncReady,
    migrationsRequired,
    schemaCacheHint:
      treatmentPriceVariantsTable.schemaCacheStale ||
      treatmentPricesTable.schemaCacheStale
        ? "Migration may be applied but PostgREST cache stale — wait ~60s, run NOTIFY pgrst reload schema, or restart API."
        : null,
  };

  lastStartupStatus = status;
  return status;
}

/**
 * Console banners for Railway logs.
 * @param {Record<string, unknown>} status
 */
function logPricingSchemaStartup(status) {
  const v = status.treatmentPriceVariantsTable;
  const prices = status.treatmentPricesTable;

  if (status.variantSyncReady) {
    console.log("[schema-startup] ✅ variant sync ready — treatment_price_variants detected");
    console.log(
      "[schema-startup] ✅ pricing variants enabled — AI can load implant brand / price ranges",
    );
    if (status.variantsClinicIdColumn) {
      console.log("[schema-startup] ✅ treatment_price_variants.clinic_id column present");
    } else {
      console.warn(
        "[schema-startup] ⚠️  treatment_price_variants.clinic_id missing — apply",
        VARIANTS_CLINIC_ID_MIGRATION,
      );
    }
    return;
  }

  console.error("[schema-startup] ❌ variant sync NOT ready — admin variant save + AI pricing will degrade");
  if (!prices?.ok) {
    console.error("[schema-startup]    missing/unreachable: treatment_prices", prices?.error || "");
  }
  if (!v?.ok) {
    console.error("[schema-startup]    missing/unreachable: treatment_price_variants", v?.error || "");
    console.error(
      "[schema-startup]    → Supabase SQL: supabase/migrations/" + VARIANTS_CREATE_MIGRATION,
    );
  }
  if (status.schemaCacheHint) {
    console.error("[schema-startup]    →", status.schemaCacheHint);
  }
  if (Array.isArray(status.migrationsRequired) && status.migrationsRequired.length) {
    console.error("[schema-startup]    migrations:", status.migrationsRequired.join(", "));
  }
}

function getLastPricingSchemaStatus() {
  return lastStartupStatus;
}

module.exports = {
  VARIANTS_TABLE,
  VARIANTS_CREATE_MIGRATION,
  VARIANTS_ENSURE_MIGRATION,
  VARIANTS_CLINIC_ID_MIGRATION,
  isTableOrSchemaCacheError,
  validatePricingSchemaAtStartup,
  logPricingSchemaStartup,
  getLastPricingSchemaStatus,
};
