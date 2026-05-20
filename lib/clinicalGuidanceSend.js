/**
 * Approve and send doctor-supervised clinical communication drafts to patients.
 */

const { supabase } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");
const { projectCoordinationState } = require("./coordinationProjection");
const { getDraftById, updateDraft } = require("./clinicalGuidanceStore");

/**
 * @param {string} profileId
 * @param {string} humanReply
 */
async function touchProfileHumanReply(profileId, humanReply) {
  const now = new Date().toISOString();
  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      last_human_reply_at: now,
      coordination_mode: "human_active",
      updated_at: now,
    })
    .eq("id", profileId);
  await insertTimelineEvent({
    profileId,
    eventType: "human_reply",
    aiReply: humanReply,
    eventMetadata: { source: "clinical_guidance_send" },
    channel: "in_app",
  });
}

/**
 * @param {{
 *   draftId: string,
 *   finalText: string,
 *   approvedBy: string,
 *   provenance?: Record<string, unknown>,
 *   insertClinicMessage: (params: {
 *     patientId: string,
 *     message: string,
 *     type?: string,
 *     contextClinicId?: string,
 *   }) => Promise<{ data?: unknown, error?: unknown }>,
 * }} params
 */
async function sendClinicalDraft(params) {
  const draft = await getDraftById(params.draftId);
  if (!draft) {
    return { ok: false, status: 404, error: "draft_not_found" };
  }
  if (draft.status === "sent") {
    return {
      ok: true,
      alreadySent: true,
      draft,
      messageRef: draft.patientMessageRef || null,
      provenance: draft.messageProvenance || {},
    };
  }

  const text = String(params.finalText || draft.draftText || "").trim();
  if (!text) {
    return { ok: false, status: 400, error: "empty_message" };
  }

  const provenance = {
    message_source: "ai_expanded",
    generated_from_guidance_id: draft.guidanceId,
    draft_id: draft.id,
    approved_by: params.approvedBy,
    rewrite_actions: draft.rewriteActions || [],
    conversion_engine_used:
      draft.messageProvenance?.conversion_engine_used === true ||
      params.provenance?.conversion_engine_used === true,
    ...(params.provenance || {}),
    ...(draft.messageProvenance || {}),
  };

  const patientId = String(draft.patientId || "").trim();
  const clinicId = String(draft.clinicId || "").trim();

  const insertResult = await params.insertClinicMessage({
    patientId,
    message: text,
    type: "text",
    contextClinicId: clinicId,
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

  const now = new Date().toISOString();
  const updated = await updateDraft(params.draftId, {
    draft_text: text,
    status: "sent",
    approved_by: params.approvedBy,
    approved_at: now,
    sent_at: now,
    patient_message_ref: messageRef ? String(messageRef) : null,
    message_provenance: provenance,
  });

  if (draft.profileId) {
    await touchProfileHumanReply(draft.profileId, text);
    await insertTimelineEvent({
      profileId: draft.profileId,
      eventType: "system",
      aiReply: text,
      eventMetadata: {
        subtype: "approved_by_doctor",
        draft_id: params.draftId,
        guidance_id: draft.guidanceId,
        approved_by: params.approvedBy,
        provenance,
      },
    });
    await insertChannelMessagesWithChannel({
      profile_id: draft.profileId,
      channel: "in_app",
      direction: "outbound",
      message_role: "human",
      body: text,
    }).catch(() => {});
    void projectCoordinationState(draft.profileId).catch(() => {});
  }

  return {
    ok: true,
    draft: updated,
    messageRef,
    provenance,
  };
}

module.exports = { sendClinicalDraft, touchProfileHumanReply };
