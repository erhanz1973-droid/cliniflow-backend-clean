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

/**
 * Mirror human doctor replies into offer_messages so the patient app inbox shows them.
 * Doctor app POST /api/messages/:id/reply writes patient_messages only — without this mirror
 * the patient offer chat thread stays empty for human sends.
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   text: string,
 *   doctorId?: string|null,
 *   doctorName?: string|null,
 * }} params
 */
async function mirrorDoctorReplyToOfferThread(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const text = String(params.text || "").trim();
  const doctorId = String(params.doctorId || "").trim();
  if (!text || !isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, reason: "invalid_params" };
  }

  try {
    const { resolveCoordinationOfferIdForPatientClinic } = require("./patientCoordinationChat");
    const { insertClinicReplyToOfferThread } = require("./offerInboundOrchestration");

    let offerId = await resolveCoordinationOfferIdForPatientClinic(patientId, clinicId, {
      createIfMissing: false,
    });
    if (!UUID_RE.test(String(offerId || ""))) {
      const { data: recentPatientOffer } = await supabase
        .from("patient_messages")
        .select("offer_id")
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId)
        .not("offer_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      offerId = recentPatientOffer?.offer_id ? String(recentPatientOffer.offer_id).trim() : null;
    }
    if (!UUID_RE.test(String(offerId || ""))) {
      return { ok: false, reason: "no_offer_thread" };
    }

    const doctorName = String(params.doctorName || "Doctor").trim() || "Doctor";
    const result = await insertClinicReplyToOfferThread({
      offerId,
      message: text,
      senderName: doctorName,
      clinicId,
      doctorId: UUID_RE.test(doctorId) ? doctorId : null,
      patientId,
      authorKind: "doctor",
      asDoctor: true,
      sendMode: "direct",
      skipSanitize: true,
      messageSource: "doctor_direct",
    });

    if (result?.error) {
      console.warn("[doctorPatientChatMirror] offer thread insert failed:", result.error?.message || result.error);
      return { ok: false, reason: "offer_insert_failed", message: result.error?.message || "offer_insert_failed" };
    }

    console.log("[doctorPatientChatMirror] mirrored doctor reply to offer_messages", {
      offerId: String(offerId).slice(0, 8),
      patientId: patientId.slice(0, 8),
      clinicId: clinicId.slice(0, 8),
      messageId: result.data?.id ? String(result.data.id).slice(0, 8) : null,
    });
    return { ok: true, offerId, messageId: result.data?.id || null };
  } catch (e) {
    console.warn("[doctorPatientChatMirror] offer mirror:", e?.message || e);
    return { ok: false, reason: "exception", message: e?.message || String(e) };
  }
}

module.exports = {
  mirrorDoctorReplyToCoordinatorChannel,
  mirrorDoctorReplyToOfferThread,
};
