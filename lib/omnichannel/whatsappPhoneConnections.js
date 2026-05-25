/**
 * WhatsApp phone_number_id → clinic resolution.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { getClinicLabel } = require("./metaPageConnections");
const {
  whatsappPhoneNumberId,
  whatsappClinicId,
  whatsappAccessToken,
} = require("./whatsappConfig");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} phoneNumberId
 */
async function getActiveWhatsAppConnectionByPhoneNumberId(phoneNumberId) {
  const pid = String(phoneNumberId || "").trim();
  if (!pid) return null;

  if (isSupabaseEnabled()) {
    const { data, error } = await supabase
      .from("whatsapp_phone_connections")
      .select("id, clinic_id, phone_number_id, display_phone_number, status, metadata")
      .eq("phone_number_id", pid)
      .eq("status", "active")
      .maybeSingle();
    if (!error && data?.clinic_id) {
      return {
        ...data,
        accessToken: whatsappAccessToken() || null,
        source: "database",
      };
    }
    if (error) {
      console.warn("[whatsappPhoneConnections] lookup:", error.message);
    }
  }

  const envPhone = whatsappPhoneNumberId();
  const envClinic = whatsappClinicId();
  if (envPhone && pid === envPhone && UUID_RE.test(envClinic)) {
    return {
      id: null,
      clinic_id: envClinic,
      phone_number_id: pid,
      display_phone_number: null,
      status: "active",
      metadata: { source: "env" },
      accessToken: whatsappAccessToken() || null,
      source: "env",
    };
  }

  return null;
}

/**
 * @param {string} phoneNumberId
 */
async function lookupWhatsAppClinicMapping(phoneNumberId) {
  const pid = String(phoneNumberId || "").trim();
  const row = await getActiveWhatsAppConnectionByPhoneNumberId(pid);
  if (!row?.clinic_id) {
    return {
      phoneNumberId: pid,
      found: false,
      matchedClinicId: null,
      matchedClinicName: null,
      matchedClinicCode: null,
    };
  }
  const clinic = await getClinicLabel(String(row.clinic_id));
  return {
    phoneNumberId: pid,
    found: true,
    connectionSource: row.source || null,
    matchedClinicId: clinic.clinicId,
    matchedClinicName: clinic.clinicName,
    matchedClinicCode: clinic.clinicCode,
    displayPhoneNumber: row.display_phone_number || null,
  };
}

module.exports = {
  getActiveWhatsAppConnectionByPhoneNumberId,
  lookupWhatsAppClinicMapping,
};
