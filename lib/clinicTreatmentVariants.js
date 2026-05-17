/**
 * Brand / material pricing variants for clinic_treatment_catalog items.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} row
 */
function mapVariantRow(row) {
  return {
    id: row.id,
    treatmentCatalogId: row.treatment_catalog_id,
    variantName: row.variant_name || null,
    brandName: row.brand_name,
    originCountry: row.origin_country || null,
    materialType: row.material_type || null,
    tier: row.tier || null,
    priceMin: row.price_min != null ? Number(row.price_min) : null,
    priceMax: row.price_max != null ? Number(row.price_max) : null,
    currency: row.currency || "EUR",
    aiNotes: row.ai_notes || null,
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {Partial<ReturnType<typeof mapVariantRow>>} body
 * @param {string} catalogId
 */
function variantBodyToRow(body, catalogId) {
  const priceMin = body.priceMin;
  const priceMax = body.priceMax;
  return {
    treatment_catalog_id: catalogId,
    variant_name: String(body.variantName || "").trim() || null,
    brand_name: String(body.brandName || "").trim(),
    origin_country: String(body.originCountry || "").trim() || null,
    material_type: String(body.materialType || "").trim() || null,
    tier: String(body.tier || "").trim() || null,
    price_min:
      priceMin != null && priceMin !== "" && Number.isFinite(Number(priceMin)) ? Number(priceMin) : null,
    price_max:
      priceMax != null && priceMax !== "" && Number.isFinite(Number(priceMax)) ? Number(priceMax) : null,
    currency: String(body.currency || "EUR").trim().toUpperCase() || "EUR",
    ai_notes: String(body.aiNotes || "").trim() || null,
    is_default: body.isDefault === true,
    is_active: body.isActive !== false,
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

function isVariantsTableMissing(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("clinic_treatment_variants") && (msg.includes("does not exist") || msg.includes("schema cache"));
}

/**
 * @param {string} clinicId
 * @param {string} catalogId
 */
async function assertCatalogOwnership(clinicId, catalogId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId) || !UUID_RE.test(catalogId)) return false;
  const { data, error } = await supabase
    .from("clinic_treatment_catalog")
    .select("id")
    .eq("id", catalogId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return !error && !!data;
}

/**
 * @param {string} catalogId
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function listVariantsByCatalogId(catalogId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(catalogId)) return [];

  let qb = supabase
    .from("clinic_treatment_variants")
    .select("*")
    .eq("treatment_catalog_id", catalogId)
    .order("sort_order", { ascending: true })
    .order("brand_name", { ascending: true });

  if (opts.activeOnly) qb = qb.eq("is_active", true);

  const { data, error } = await qb;
  if (error) {
    if (isVariantsTableMissing(error)) return [];
    console.warn("[clinicTreatmentVariants] list:", error.message);
    return [];
  }
  return (data || []).map(mapVariantRow);
}

/**
 * @param {string} clinicId
 * @param {string[]} catalogIds
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function listVariantsByCatalogIds(clinicId, catalogIds, opts = {}) {
  const ids = (catalogIds || []).filter((id) => UUID_RE.test(id));
  if (!isSupabaseEnabled() || !ids.length) return {};

  let qb = supabase
    .from("clinic_treatment_variants")
    .select("*")
    .in("treatment_catalog_id", ids)
    .order("sort_order", { ascending: true })
    .order("brand_name", { ascending: true });

  if (opts.activeOnly) qb = qb.eq("is_active", true);

  const { data, error } = await qb;
  if (error) {
    if (isVariantsTableMissing(error)) return {};
    console.warn("[clinicTreatmentVariants] list batch:", error.message);
    return {};
  }

  /** @type {Record<string, ReturnType<typeof mapVariantRow>[]>} */
  const grouped = {};
  for (const row of data || []) {
    const cid = row.treatment_catalog_id;
    if (!grouped[cid]) grouped[cid] = [];
    grouped[cid].push(mapVariantRow(row));
  }
  return grouped;
}

/**
 * @param {ReturnType<typeof mapVariantRow>[]} items
 * @param {string} clinicId
 */
async function attachVariantsToCatalogItems(clinicId, items, opts = {}) {
  if (!items.length) return items;
  const grouped = await listVariantsByCatalogIds(
    clinicId,
    items.map((i) => i.id),
    opts,
  );
  return items.map((item) => ({
    ...item,
    variants: grouped[item.id] || [],
  }));
}

/**
 * @param {string} clinicId
 * @param {string} catalogId
 * @param {Partial<ReturnType<typeof mapVariantRow>>} body
 */
async function createVariant(clinicId, catalogId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!(await assertCatalogOwnership(clinicId, catalogId))) {
    return { ok: false, error: "catalog_not_found" };
  }
  if (!String(body.brandName || "").trim()) return { ok: false, error: "brand_required" };

  const row = variantBodyToRow(body, catalogId);
  row.created_at = row.updated_at;

  if (row.is_default) {
    await supabase
      .from("clinic_treatment_variants")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("treatment_catalog_id", catalogId);
  }

  const { data, error } = await supabase
    .from("clinic_treatment_variants")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (isVariantsTableMissing(error)) return { ok: false, error: "variants_table_missing", message: error.message };
    return { ok: false, error: "insert_failed", message: error.message };
  }
  return { ok: true, variant: mapVariantRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} catalogId
 * @param {string} variantId
 * @param {Partial<ReturnType<typeof mapVariantRow>>} body
 */
async function updateVariant(clinicId, catalogId, variantId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!(await assertCatalogOwnership(clinicId, catalogId))) {
    return { ok: false, error: "catalog_not_found" };
  }

  const existing = await getVariantById(clinicId, catalogId, variantId);
  if (!existing) return { ok: false, error: "not_found" };

  const merged = { ...existing, ...body };
  if (!String(merged.brandName || "").trim()) return { ok: false, error: "brand_required" };

  const row = variantBodyToRow(merged, catalogId);

  if (row.is_default) {
    await supabase
      .from("clinic_treatment_variants")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("treatment_catalog_id", catalogId)
      .neq("id", variantId);
  }

  const { data, error } = await supabase
    .from("clinic_treatment_variants")
    .update(row)
    .eq("id", variantId)
    .eq("treatment_catalog_id", catalogId)
    .select("*")
    .single();

  if (error) return { ok: false, error: "update_failed", message: error.message };
  return { ok: true, variant: mapVariantRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} catalogId
 * @param {string} variantId
 */
async function getVariantById(clinicId, catalogId, variantId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(catalogId) || !UUID_RE.test(variantId)) return null;
  if (!(await assertCatalogOwnership(clinicId, catalogId))) return null;

  const { data, error } = await supabase
    .from("clinic_treatment_variants")
    .select("*")
    .eq("id", variantId)
    .eq("treatment_catalog_id", catalogId)
    .maybeSingle();

  if (error || !data) return null;
  return mapVariantRow(data);
}

/**
 * @param {string} clinicId
 * @param {string} catalogId
 * @param {string} variantId
 */
async function deleteVariant(clinicId, catalogId, variantId) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!(await assertCatalogOwnership(clinicId, catalogId))) {
    return { ok: false, error: "catalog_not_found" };
  }

  const { error } = await supabase
    .from("clinic_treatment_variants")
    .delete()
    .eq("id", variantId)
    .eq("treatment_catalog_id", catalogId);

  if (error) return { ok: false, error: "delete_failed", message: error.message };
  return { ok: true };
}

/**
 * Replace all variants for a catalog item (admin batch save).
 * @param {string} clinicId
 * @param {string} catalogId
 * @param {Partial<ReturnType<typeof mapVariantRow>>[]} variants
 */
async function syncVariantsForCatalogItem(clinicId, catalogId, variants) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!(await assertCatalogOwnership(clinicId, catalogId))) {
    return { ok: false, error: "catalog_not_found" };
  }

  const incoming = Array.isArray(variants) ? variants : [];
  const existing = await listVariantsByCatalogId(catalogId, { activeOnly: false });
  const keepIds = new Set();

  let defaultSet = false;
  for (let i = 0; i < incoming.length; i++) {
    const v = incoming[i];
    const payload = {
      ...v,
      sortOrder: v.sortOrder != null ? v.sortOrder : i * 10,
      isDefault: v.isDefault === true && !defaultSet,
    };
    if (payload.isDefault) defaultSet = true;

    if (v.id && UUID_RE.test(String(v.id))) {
      const result = await updateVariant(clinicId, catalogId, String(v.id), payload);
      if (!result.ok) return result;
      keepIds.add(String(v.id));
    } else {
      const result = await createVariant(clinicId, catalogId, payload);
      if (!result.ok) return result;
      keepIds.add(result.variant.id);
    }
  }

  for (const ex of existing) {
    if (!keepIds.has(ex.id)) {
      const del = await deleteVariant(clinicId, catalogId, ex.id);
      if (!del.ok) return del;
    }
  }

  const list = await listVariantsByCatalogId(catalogId, { activeOnly: false });
  return { ok: true, variants: list };
}

/**
 * Format variant for AI orchestration (non-binding language).
 * @param {ReturnType<typeof mapVariantRow>} v
 */
function formatVariantForAi(v) {
  const parts = [v.brandName];
  if (v.originCountry) parts.push(v.originCountry);
  if (v.materialType) parts.push(v.materialType);
  if (v.tier) parts.push(v.tier);
  const label = v.variantName || parts.join(" — ");
  return {
    id: v.id,
    label,
    brandName: v.brandName,
    originCountry: v.originCountry,
    materialType: v.materialType,
    tier: v.tier,
    priceMin: v.priceMin,
    priceMax: v.priceMax,
    currency: v.currency,
    typicallyFrom:
      v.priceMin != null
        ? `typically starts from approximately ${v.priceMin} ${v.currency}`
        : null,
    aiNotes: v.aiNotes,
    isDefault: v.isDefault,
  };
}

const PRICING_LANGUAGE_GUIDANCE = {
  mustUseNonBindingLanguage: true,
  phrases: [
    "typically starts from",
    "approximately",
    "depending on case complexity",
    "final price confirmed after clinical assessment",
  ],
  avoid: ["guaranteed price", "exact final cost", "always includes"],
};

module.exports = {
  mapVariantRow,
  listVariantsByCatalogId,
  listVariantsByCatalogIds,
  attachVariantsToCatalogItems,
  createVariant,
  updateVariant,
  deleteVariant,
  syncVariantsForCatalogItem,
  formatVariantForAi,
  PRICING_LANGUAGE_GUIDANCE,
};
