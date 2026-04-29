/**
 * Merges static aliases (cityCodes) with public.city_catalog rows.
 */
"use strict";

const {
  resolveCityCode,
  KNOWN_CODES,
} = require("./cityCodes.cjs");

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, merged: null };

function mergeStaticAndDbRows(dbCodes) {
  const merged = new Set(KNOWN_CODES);
  for (const row of dbCodes || []) {
    const code = String(row.code || "")
      .trim()
      .toLowerCase();
    if (code) merged.add(code);
  }
  return merged;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<Set<string>>}
 */
async function getMergedCityCatalogSet(supabase) {
  const now = Date.now();
  if (cache.merged && now - cache.at < CACHE_TTL_MS) {
    return cache.merged;
  }
  let dbRows = [];
  try {
    const { data, error } = await supabase.from("city_catalog").select("code");
    if (!error && data?.length) dbRows = data;
  } catch (_) {
    /* non-fatal */
  }
  const merged = mergeStaticAndDbRows(dbRows);
  cache = { at: now, merged };
  return merged;
}

function invalidateCityCatalogCache() {
  cache = { at: 0, merged: null };
}

module.exports = {
  getMergedCityCatalogSet,
  invalidateCityCatalogCache,
  mergeStaticAndDbRows,
};
