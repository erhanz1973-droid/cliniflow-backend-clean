/**
 * Shared clinic id → name/code lookup (avoids circular deps between channel modules).
 */

const { supabase, isSupabaseEnabled } = require("../supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} clinicId
 */
async function getClinicLabel(clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(String(clinicId || ""))) {
    return { clinicId: clinicId || null, clinicName: null, clinicCode: null };
  }
  const { data } = await supabase
    .from("clinics")
    .select("id, name, clinic_code")
    .eq("id", clinicId)
    .maybeSingle();
  return {
    clinicId: data?.id ? String(data.id) : clinicId,
    clinicName: data?.name ? String(data.name) : null,
    clinicCode: data?.clinic_code ? String(data.clinic_code) : null,
  };
}

module.exports = {
  getClinicLabel,
};
