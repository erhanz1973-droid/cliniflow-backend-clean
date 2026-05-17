/**
 * Brand/material variants for treatment_prices (canonical clinic price list).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isVariantsTableMissing(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("treatment_price_variants") && (msg.includes("does not exist") || msg.includes("schema cache"));
}

/**
 * @param {Record<string, unknown>} row
 */
function mapVariantRow(row) {
  return {
    id: row.id,
    treatmentPriceId: row.treatment_price_id,
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
  };
}

/**
 * @param {Partial<ReturnType<typeof mapVariantRow>>} body
 * @param {string} priceId
 */
function pickBrandName(v) {
  return String(v?.brandName || v?.brand_name || "").trim();
}

function variantBodyToRow(body, priceId, clinicId) {
  const priceMin = body.priceMin != null ? body.priceMin : body.price_min;
  const priceMax = body.priceMax != null ? body.priceMax : body.price_max;
  const row = {
    treatment_price_id: priceId,
    variant_name: String(body.variantName || body.variant_name || "").trim() || null,
    brand_name: pickBrandName(body),
    origin_country: String(body.originCountry || body.origin_country || "").trim() || null,
    material_type: String(body.materialType || body.material_type || "").trim() || null,
    tier: String(body.tier || "").trim() || null,
    price_min:
      priceMin != null && priceMin !== "" && Number.isFinite(Number(priceMin)) ? Number(priceMin) : null,
    price_max:
      priceMax != null && priceMax !== "" && Number.isFinite(Number(priceMax)) ? Number(priceMax) : null,
    currency: String(body.currency || "EUR").trim().toUpperCase() || "EUR",
    ai_notes: String(body.aiNotes || body.ai_notes || "").trim() || null,
    is_default: body.isDefault === true || body.is_default === true,
    is_active: body.isActive !== false && body.is_active !== false,
    sort_order: Number.isFinite(Number(body.sortOrder ?? body.sort_order))
      ? Number(body.sortOrder ?? body.sort_order)
      : 0,
    updated_at: new Date().toISOString(),
  };
  if (clinicId && UUID_RE.test(clinicId)) row.clinic_id = clinicId;
  return row;
}

async function assertPriceOwnership(clinicId, priceId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId) || !UUID_RE.test(priceId)) return false;
  const { data, error } = await supabase
    .from("treatment_prices")
    .select("id")
    .eq("id", priceId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return !error && !!data;
}

/**
 * @param {string} priceId
 */
async function listVariantsByPriceId(priceId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(priceId)) return [];

  const { data, error } = await supabase
    .from("treatment_price_variants")
    .select("*")
    .eq("treatment_price_id", priceId)
    .order("sort_order", { ascending: true })
    .order("brand_name", { ascending: true });

  if (error) {
    if (isVariantsTableMissing(error)) return [];
    console.warn("[treatmentPriceVariants] list:", error.message);
    return [];
  }
  return (data || []).map(mapVariantRow);
}

/**
 * @param {string[]} priceIds
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function listVariantsByPriceIds(priceIds, opts = {}) {
  const ids = (priceIds || []).filter((id) => UUID_RE.test(id));
  if (!isSupabaseEnabled() || !ids.length) return {};

  let qb = supabase
    .from("treatment_price_variants")
    .select("*")
    .in("treatment_price_id", ids)
    .order("sort_order", { ascending: true });

  if (opts.activeOnly !== false) qb = qb.eq("is_active", true);

  const { data, error } = await qb;

  if (error) {
    if (isVariantsTableMissing(error)) return {};
    console.warn("[treatmentPriceVariants] list batch:", error.message);
    return {};
  }

  /** @type {Record<string, ReturnType<typeof mapVariantRow>[]>} */
  const grouped = {};
  for (const row of data || []) {
    const pid = row.treatment_price_id;
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push(mapVariantRow(row));
  }
  return grouped;
}

/**
 * @param {Array<{ id?: string, variants?: ReturnType<typeof mapVariantRow>[] }>} priceRows
 */
function attachVariantsToPriceRows(priceRows, variantMap) {
  return (priceRows || []).map((row) => ({
    ...row,
    variants: variantMap[row.id] || [],
  }));
}

/**
 * @param {string} clinicId
 * @param {string} priceId
 * @param {Partial<ReturnType<typeof mapVariantRow>>[]} variants
 */
async function syncVariantsForPrice(clinicId, priceId, variants) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!(await assertPriceOwnership(clinicId, priceId))) {
    return { ok: false, error: "price_not_found" };
  }

  const incoming = Array.isArray(variants) ? variants : [];
  const existing = await listVariantsByPriceId(priceId);
  const keepIds = new Set();
  let defaultSet = false;

  for (let i = 0; i < incoming.length; i++) {
    const v = incoming[i];
    if (!pickBrandName(v)) continue;

    const payload = variantBodyToRow(
      {
        ...v,
        sortOrder: v.sortOrder != null ? v.sortOrder : v.sort_order != null ? v.sort_order : i * 10,
        isDefault: (v.isDefault === true || v.is_default === true) && !defaultSet,
      },
      priceId,
      clinicId,
    );
    if (payload.is_default) defaultSet = true;

    if (v.id && UUID_RE.test(String(v.id))) {
      if (payload.is_default) {
        await supabase
          .from("treatment_price_variants")
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq("treatment_price_id", priceId)
          .neq("id", v.id);
      }
      const { error } = await supabase
        .from("treatment_price_variants")
        .update(payload)
        .eq("id", v.id)
        .eq("treatment_price_id", priceId);
      if (error) {
        if (isVariantsTableMissing(error)) return { ok: false, error: "variants_table_missing", message: error.message };
        return { ok: false, error: "update_failed", message: error.message };
      }
      keepIds.add(String(v.id));
    } else {
      payload.created_at = payload.updated_at;
      const { data, error } = await supabase
        .from("treatment_price_variants")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        if (isVariantsTableMissing(error)) return { ok: false, error: "variants_table_missing", message: error.message };
        return { ok: false, error: "insert_failed", message: error.message };
      }
      keepIds.add(data.id);
    }
  }

  for (const ex of existing) {
    if (!keepIds.has(ex.id)) {
      await supabase.from("treatment_price_variants").delete().eq("id", ex.id).eq("treatment_price_id", priceId);
    }
  }

  return { ok: true, variants: await listVariantsByPriceId(priceId) };
}

/**
 * @param {ReturnType<typeof mapVariantRow>} v
 */
function formatVariantForAi(v) {
  const label = v.variantName || [v.brandName, v.originCountry, v.tier].filter(Boolean).join(" — ");
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
  listVariantsByPriceId,
  listVariantsByPriceIds,
  attachVariantsToPriceRows,
  syncVariantsForPrice,
  formatVariantForAi,
  PRICING_LANGUAGE_GUIDANCE,
  isVariantsTableMissing,
};
