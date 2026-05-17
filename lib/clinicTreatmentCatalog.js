/**
 * Clinic treatment & pricing catalog — structured ranges for AI offers.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  attachVariantsToCatalogItems,
  syncVariantsForCatalogItem,
  listVariantsByCatalogId,
} = require("./clinicTreatmentVariants");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asStringArray(val) {
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  return [];
}

/**
 * @param {Record<string, unknown>} row
 */
function mapCatalogRow(row) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    category: row.category || null,
    priceMin: row.price_min != null ? Number(row.price_min) : null,
    priceMax: row.price_max != null ? Number(row.price_max) : null,
    currency: row.currency || "EUR",
    durationLabel: row.duration_label || null,
    visitCount: row.visit_count != null ? Number(row.visit_count) : null,
    includedServices: asStringArray(row.included_services),
    excludedServices: asStringArray(row.excluded_services),
    aiNotes: row.ai_notes || null,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    variants: [],
  };
}

/**
 * @param {Partial<ReturnType<typeof mapCatalogRow>>} body
 * @param {string} clinicId
 */
function catalogBodyToRow(body, clinicId) {
  const priceMin = body.priceMin;
  const priceMax = body.priceMax;
  return {
    clinic_id: clinicId,
    name: String(body.name || "").trim(),
    category: String(body.category || "").trim() || null,
    price_min:
      priceMin != null && priceMin !== "" && Number.isFinite(Number(priceMin)) ? Number(priceMin) : null,
    price_max:
      priceMax != null && priceMax !== "" && Number.isFinite(Number(priceMax)) ? Number(priceMax) : null,
    currency: String(body.currency || "EUR").trim().toUpperCase() || "EUR",
    duration_label: String(body.durationLabel || "").trim() || null,
    visit_count:
      body.visitCount != null && Number.isFinite(Number(body.visitCount))
        ? Math.max(1, Number(body.visitCount))
        : null,
    included_services: asStringArray(body.includedServices),
    excluded_services: asStringArray(body.excludedServices),
    ai_notes: String(body.aiNotes || "").trim() || null,
    is_active: body.isActive !== false,
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

/**
 * @param {string} clinicId
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function listCatalogByClinic(clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  let qb = supabase
    .from("clinic_treatment_catalog")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (opts.activeOnly) qb = qb.eq("is_active", true);

  const { data, error } = await qb;
  if (error) {
    console.warn("[clinicTreatmentCatalog] list:", error.message);
    return [];
  }
  const items = (data || []).map(mapCatalogRow);
  if (opts.includeVariants === false) return items;
  return attachVariantsToCatalogItems(clinicId, items, { activeOnly: opts.activeOnly });
}

/**
 * @param {string} clinicId
 * @param {{ max?: number }} [opts]
 */
async function getActiveCatalogForAi(clinicId, opts = {}) {
  const max = Math.min(24, Math.max(1, opts.max || 12));
  const all = await listCatalogByClinic(clinicId, { activeOnly: true });
  return all.slice(0, max);
}

/**
 * @param {string} clinicId
 * @param {string} itemId
 */
async function getCatalogItemById(clinicId, itemId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId) || !UUID_RE.test(itemId)) return null;

  const { data, error } = await supabase
    .from("clinic_treatment_catalog")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", itemId)
    .maybeSingle();

  if (error || !data) return null;
  const item = mapCatalogRow(data);
  item.variants = await listVariantsByCatalogId(itemId, { activeOnly: false });
  return item;
}

/**
 * @param {string} clinicId
 * @param {Partial<ReturnType<typeof mapCatalogRow>>} body
 */
async function createCatalogItem(clinicId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!String(body.name || "").trim()) return { ok: false, error: "name_required" };

  const row = catalogBodyToRow(body, clinicId);
  row.created_at = row.updated_at;

  const { data, error } = await supabase.from("clinic_treatment_catalog").insert(row).select("*").single();
  if (error) return { ok: false, error: "insert_failed", message: error.message };
  const item = mapCatalogRow(data);
  if (Array.isArray(body.variants) && body.variants.length) {
    const sync = await syncVariantsForCatalogItem(clinicId, item.id, body.variants);
    if (!sync.ok) return sync;
    item.variants = sync.variants;
  }
  return { ok: true, item };
}

/**
 * @param {string} clinicId
 * @param {string} itemId
 * @param {Partial<ReturnType<typeof mapCatalogRow>>} body
 */
async function updateCatalogItem(clinicId, itemId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const existing = await getCatalogItemById(clinicId, itemId);
  if (!existing) return { ok: false, error: "not_found" };

  const merged = { ...existing, ...body };
  if (!String(merged.name || "").trim()) return { ok: false, error: "name_required" };

  const row = catalogBodyToRow(merged, clinicId);
  const { data, error } = await supabase
    .from("clinic_treatment_catalog")
    .update(row)
    .eq("id", itemId)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error) return { ok: false, error: "update_failed", message: error.message };
  const item = mapCatalogRow(data);
  if (Array.isArray(body.variants)) {
    const sync = await syncVariantsForCatalogItem(clinicId, itemId, body.variants);
    if (!sync.ok) return sync;
    item.variants = sync.variants;
  } else {
    item.variants = await listVariantsByCatalogId(itemId, { activeOnly: false });
  }
  return { ok: true, item };
}

/**
 * @param {string} clinicId
 * @param {string} itemId
 */
async function deleteCatalogItem(clinicId, itemId) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const { error } = await supabase
    .from("clinic_treatment_catalog")
    .delete()
    .eq("id", itemId)
    .eq("clinic_id", clinicId);

  if (error) return { ok: false, error: "delete_failed", message: error.message };
  return { ok: true };
}

module.exports = {
  mapCatalogRow,
  listCatalogByClinic,
  getActiveCatalogForAi,
  getCatalogItemById,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
};
