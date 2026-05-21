/**
 * Doctor takeover — verbatim patient message (no AI expand / rewrite / translation).
 */

const { supabase } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { projectCoordinationState } = require("./coordinationProjection");
const { touchProfileHumanReply } = require("./clinicalGuidanceSend");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} text
 */
function normalizeDoctorDirectText(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

/**
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   doctorInput: string,
 *   approvedBy: string,
 *   profileId?: string|null,
 *   senderDisplayName?: string,
 *   insertClinicMessage: (params: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>,
 * }} params
 */
async function sendDirectDoctorPatientMessage(params) {
  const doctorInput = normalizeDoctorDirectText(params.doctorInput);
  if (!doctorInput) {
    return { ok: false, status: 400, error: "empty_message" };
  }

  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, status: 400, error: "invalid_id" };
  }

  const provenance = {
    send_mode: "direct",
    message_source: "doctor_direct",
    doctor_draft: doctorInput,
    ai_generated_response: null,
    final_outgoing_message: doctorInput,
    approved_by: params.approvedBy,
    conversion_engine_used: false,
    ai_pipeline_skipped: true,
  };

  const doctorLabel =
    String(params.senderDisplayName || params.doctorName || "Doctor").trim() || "Doctor";

  const insertResult = await params.insertClinicMessage({
    patientId,
    message: doctorInput,
    type: "text",
    contextClinicId: clinicId,
    doctorId: params.approvedBy || null,
    senderName: doctorLabel,
    authorKind: "doctor",
    asDoctor: true,
    sendMode: "direct",
    skipSanitize: true,
    messageProvenance: provenance,
  });

  if (insertResult?.error) {
    return {
      ok: false,
      status: 500,
      error: "message_insert_failed",
      message: String(insertResult.error?.message || insertResult.error),
    };
  }

  const messageRef =
    insertResult.data?.message_id ||
    insertResult.data?.id ||
    null;

  const profileId = String(params.profileId || "").trim();
  if (UUID_RE.test(profileId)) {
    await touchProfileHumanReply(profileId, doctorInput, { skipTimelineEvent: true });
    await insertTimelineEvent({
      profileId,
      eventType: "human_reply",
      aiReply: doctorInput,
      eventMetadata: {
        subtype: "doctor_direct_send",
        send_mode: "direct",
        provenance,
        message_ref: messageRef,
        approved_by: params.approvedBy,
      },
      channel: "in_app",
    });
    void projectCoordinationState(profileId).catch(() => {});
  }

  return {
    ok: true,
    messageRef: messageRef ? String(messageRef) : null,
    provenance,
    finalText: doctorInput,
  };
}

module.exports = {
  sendDirectDoctorPatientMessage,
  normalizeDoctorDirectText,
};
