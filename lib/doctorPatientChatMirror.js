/**
 * Mirror doctor ↔ patient chat sends into coordinator channel history
 * so the doctor app unified thread (AI + WhatsApp) shows human replies.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   text: string,
 *   doctorName?: string|null,
 *   channel?: string|null,
 * }} params
 */
async function mirrorDoctorReplyToCoordinatorChannel(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const text = String(params.text || "").trim();
  if (!text || !isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, reason: "invalid_params" };
  }

  try {
    const { data: profile } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id, primary_channel")
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!profile?.id) return { ok: false, reason: "no_profile" };

    const profileId = String(profile.id).trim();
    const channel = String(params.channel || profile.primary_channel || "whatsapp").trim();
    const doctorName = String(params.doctorName || "Doktor").trim() || "Doktor";
    const nowIso = new Date().toISOString();

    const roles = ["staff", "clinic", "coordinator", "assistant"];
    let lastError = null;
    for (const message_role of roles) {
      const row = {
        profile_id: profileId,
        message_role,
        body: text,
        created_at: nowIso,
        channel,
        metadata: {
          source: "doctor_patient_chat",
          doctor_name: doctorName,
          operational_channel: channel,
        },
      };
      const result = await insertChannelMessagesWithChannel(row);
      if (!result.error) {
        return { ok: true, profileId, message_role };
      }
      lastError = result.error;
      const msg = String(result.error?.message || "").toLowerCase();
      if (
        String(result.error?.code || "") === "23514" ||
        msg.includes("enum") ||
        msg.includes("check constraint")
      ) {
        continue;
      }
      break;
    }

    if (lastError) {
      console.warn("[doctorPatientChatMirror] channel insert failed:", lastError.message);
      return { ok: false, reason: "insert_failed", message: lastError.message };
    }
    return { ok: false, reason: "insert_failed" };
  } catch (e) {
    console.warn("[doctorPatientChatMirror]", e?.message || e);
    return { ok: false, reason: "exception", message: e?.message || String(e) };
  }
}

module.exports = {
  mirrorDoctorReplyToCoordinatorChannel,
};
