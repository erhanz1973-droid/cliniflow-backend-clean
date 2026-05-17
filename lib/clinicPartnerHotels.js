/**
 * Clinic partner hotels — CRUD + AI context (top 3 active).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} row
 * @returns {import('./clinicTravelTypes').ClinicPartnerHotelDto}
 */
function mapHotelRow(row) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    mapsUrl: row.maps_url || null,
    address: row.address || null,
    priceRange: row.price_range || null,
    distanceMinutes:
      row.distance_minutes != null && row.distance_minutes !== ""
        ? Number(row.distance_minutes)
        : null,
    transferIncluded: row.transfer_included === true,
    breakfastIncluded: row.breakfast_included === true,
    clinicDiscountNotes: row.clinic_discount_notes || null,
    bookingUrl: row.booking_url || null,
    supportedLanguages: row.supported_languages || null,
    notes: row.notes || null,
    isPreferred: row.is_preferred === true,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {import('./clinicTravelTypes').ClinicPartnerHotelDto} body
 */
function hotelBodyToRow(body, clinicId) {
  const dist = body.distanceMinutes;
  return {
    clinic_id: clinicId,
    name: String(body.name || "").trim(),
    maps_url: String(body.mapsUrl || "").trim() || null,
    address: String(body.address || "").trim() || null,
    price_range: String(body.priceRange || "").trim() || null,
    distance_minutes:
      dist != null && dist !== "" && Number.isFinite(Number(dist)) ? Math.max(0, Number(dist)) : null,
    transfer_included: body.transferIncluded === true,
    breakfast_included: body.breakfastIncluded === true,
    clinic_discount_notes: String(body.clinicDiscountNotes || "").trim() || null,
    booking_url: String(body.bookingUrl || "").trim() || null,
    supported_languages: String(body.supportedLanguages || "").trim() || null,
    notes: String(body.notes || "").trim() || null,
    is_preferred: body.isPreferred === true,
    is_active: body.isActive !== false,
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

/**
 * @param {string} clinicId
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function listHotelsByClinic(clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  let qb = supabase
    .from("clinic_partner_hotels")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("is_preferred", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("distance_minutes", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (opts.activeOnly) {
    qb = qb.eq("is_active", true);
  }

  const { data, error } = await qb;
  if (error) {
    console.warn("[clinicPartnerHotels] list:", error.message);
    return [];
  }
  return (data || []).map(mapHotelRow);
}

/**
 * Top hotels for AI prompt (preferred first, then nearest).
 * @param {string} clinicId
 * @param {number} [limit]
 */
async function getTopHotelsForAi(clinicId, limit = 3) {
  const all = await listHotelsByClinic(clinicId, { activeOnly: true });
  return all.slice(0, Math.max(1, Math.min(5, limit)));
}

/**
 * @param {string} clinicId
 * @param {string} hotelId
 */
async function getHotelById(clinicId, hotelId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId) || !UUID_RE.test(hotelId)) return null;

  const { data, error } = await supabase
    .from("clinic_partner_hotels")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", hotelId)
    .maybeSingle();

  if (error || !data) return null;
  return mapHotelRow(data);
}

/**
 * @param {string} clinicId
 * @param {Partial<import('./clinicTravelTypes').ClinicPartnerHotelDto>} body
 */
async function createHotel(clinicId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  const name = String(body.name || "").trim();
  if (!name) return { ok: false, error: "name_required" };

  const row = hotelBodyToRow({ ...body, name }, clinicId);
  row.created_at = row.updated_at;

  const { data, error } = await supabase
    .from("clinic_partner_hotels")
    .insert(row)
    .select("*")
    .single();

  if (error) return { ok: false, error: "insert_failed", message: error.message };
  return { ok: true, hotel: mapHotelRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} hotelId
 * @param {Partial<import('./clinicTravelTypes').ClinicPartnerHotelDto>} body
 */
async function updateHotel(clinicId, hotelId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const existing = await getHotelById(clinicId, hotelId);
  if (!existing) return { ok: false, error: "not_found" };

  const merged = {
    ...existing,
    ...body,
    name: body.name != null ? String(body.name).trim() : existing.name,
  };
  if (!merged.name) return { ok: false, error: "name_required" };

  const row = hotelBodyToRow(merged, clinicId);
  const { data, error } = await supabase
    .from("clinic_partner_hotels")
    .update(row)
    .eq("id", hotelId)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error) return { ok: false, error: "update_failed", message: error.message };
  return { ok: true, hotel: mapHotelRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} hotelId
 */
async function deleteHotel(clinicId, hotelId) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const { error } = await supabase
    .from("clinic_partner_hotels")
    .delete()
    .eq("id", hotelId)
    .eq("clinic_id", clinicId);

  if (error) return { ok: false, error: "delete_failed", message: error.message };
  return { ok: true };
}

module.exports = {
  mapHotelRow,
  listHotelsByClinic,
  getTopHotelsForAi,
  getHotelById,
  createHotel,
  updateHotel,
  deleteHotel,
};
