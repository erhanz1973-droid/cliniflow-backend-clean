/**
 * Canonical clinic pricing for AI orchestration — reads treatment_prices + variants.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  listVariantsByPriceIds,
  formatVariantForAi,
  PRICING_LANGUAGE_GUIDANCE,
} = require("./clinicTreatmentPriceVariants");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} row
 */
function mapPriceRow(row) {
  const treatmentName = row.treatment_code || row.type || row.name || "";
  const price =
    row.price != null
      ? Number(row.price)
      : row.default_price != null
        ? Number(row.default_price)
        : null;

  return {
    id: row.id,
    treatmentCode: String(treatmentName || "").trim().toUpperCase(),
    treatmentName: String(treatmentName || "").trim(),
    defaultPrice: price,
    currency: row.currency || "EUR",
    isActive: row.is_active !== false,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    breakMinutes: row.break_minutes != null ? Number(row.break_minutes) : null,
    variants: [],
  };
}

/**
 * @param {string} clinicId
 * @param {{ activeOnly?: boolean, max?: number }} [opts]
 */
async function listTreatmentPricesForClinic(clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  let qb = supabase.from("treatment_prices").select("*").eq("clinic_id", clinicId);

  if (opts.activeOnly) qb = qb.eq("is_active", true);

  const { data, error } = await qb;
  if (error) {
    console.warn("[clinicPricingForAi] list prices:", error.message);
    return [];
  }

  let items = (data || []).map(mapPriceRow);
  const variantMap = await listVariantsByPriceIds(items.map((i) => i.id));
  items = items.map((item) => ({
    ...item,
    variants: variantMap[item.id] || [],
  }));

  if (opts.max) items = items.slice(0, opts.max);
  return items;
}

/**
 * AI orchestration bundle — single pricing truth.
 * @param {string} clinicId
 */
async function getPricingKnowledgeForAi(clinicId) {
  const prices = await listTreatmentPricesForClinic(clinicId, { activeOnly: true, max: 48 });

  return {
    source: "treatment_prices",
    settingsPath: "/admin-settings.html",
    pricingLanguageGuidance: PRICING_LANGUAGE_GUIDANCE,
    treatments: prices.map((p) => ({
      treatmentCode: p.treatmentCode,
      name: p.treatmentName,
      basePrice: p.defaultPrice,
      currency: p.currency,
      durationMinutes: p.durationMinutes,
      priceRange:
        p.defaultPrice != null ? { min: p.defaultPrice, max: p.defaultPrice, currency: p.currency } : null,
      variants: (p.variants || []).map(formatVariantForAi),
    })),
  };
}

module.exports = {
  listTreatmentPricesForClinic,
  getPricingKnowledgeForAi,
  PRICING_LANGUAGE_GUIDANCE,
};
