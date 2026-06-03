/**
 * When an omnichannel lead (Messenger / Instagram) shares a WhatsApp number that
 * already belongs to a registered patient, attach the channel identity and history
 * to that existing patient instead of keeping a duplicate lead row.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { findPatientByWhatsAppPhone } = require("./channelIdentity");
const { ensureLeadWorkspaceForClinic } = require("../patientLeadLifecycle");
const { getCanonicalThread } = require("../canonicalChatThread");
const { persistWhatsappCollection } = require("../whatsappCollection");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LINKABLE_CHANNELS = new Set(["messenger", "instagram"]);

/**
 * @param {{
 *   stubPatientId: string,
 *   clinicId: string,
 *   whatsappNumber: string,
 *   channel?: string|null,
 *   profileId?: string|null,
 *   previousWhatsappNumber?: string|null,
 * }} params
 */
async function tryLinkOmnichannelLeadByPhone(params) {
  if (!isSupabaseEnabled()) return { linked: false, reason: "supabase_disabled" };

  const stubPatientId = String(params.stubPatientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const whatsappNumber = String(params.whatsappNumber || "").trim();
  const channel = String(params.channel || "messenger").trim().toLowerCase();
  const stubProfileId = String(params.profileId || "").trim();

  if (!UUID_RE.test(stubPatientId) || !UUID_RE.test(clinicId) || !whatsappNumber) {
    return { linked: false, reason: "invalid_params" };
  }
  if (!LINKABLE_CHANNELS.has(channel)) {
    return { linked: false, reason: "channel_not_linkable" };
  }

  const existingPatient = await findPatientByWhatsAppPhone(whatsappNumber, clinicId);
  if (!existingPatient?.id) {
    return { linked: false, reason: "no_registered_match" };
  }

  const targetPatientId = String(existingPatient.id);
  if (targetPatientId === stubPatientId) {
    return { linked: false, reason: "already_same_patient", patientId: targetPatientId };
  }

  const workspace = await ensureLeadWorkspaceForClinic(targetPatientId, clinicId, {
    source: channel,
    leadStatus: "inquiry",
  });

  const canonical = await getCanonicalThread(targetPatientId, clinicId, {
    source: `${channel}_phone_link`,
    repairClinic: true,
    ensureProfile: true,
    archiveCrossClinicStale: false,
    mergeDuplicates: true,
  });
  const targetThreadId = canonical.threadId || workspace.threadId || null;

  const { data: targetProfile } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, whatsapp_number, operational_intake_flags")
    .eq("patient_id", targetPatientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const targetProfileId = targetProfile?.id ? String(targetProfile.id) : null;
  const nowIso = new Date().toISOString();

  if (targetProfileId) {
    await persistWhatsappCollection(targetProfileId, {
      number: whatsappNumber,
      previousNumber: params.previousWhatsappNumber || null,
      source: `${channel}_phone_link`,
    });
  }

  const { data: stubIdentities } = await supabase
    .from("channel_identities")
    .select("id, channel, external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("patient_id", stubPatientId);

  for (const identity of stubIdentities || []) {
    const patch = {
      patient_id: targetPatientId,
      profile_id: targetProfileId,
      updated_at: nowIso,
    };
    const { error } = await supabase.from("channel_identities").update(patch).eq("id", identity.id);
    if (error) {
      console.warn("[linkOmnichannelLeadByPhone] identity update:", error.message);
    }
  }

  if (UUID_RE.test(stubProfileId) && targetProfileId && stubProfileId !== targetProfileId) {
    await supabase
      .from("ai_coordinator_channel_messages")
      .update({ profile_id: targetProfileId })
      .eq("profile_id", stubProfileId);

    const stubFlags =
      (await supabase
        .from("ai_coordinator_lead_profiles")
        .select("operational_intake_flags, channel_metadata, primary_channel, source")
        .eq("id", stubProfileId)
        .maybeSingle()
      ).data || {};

    const targetFlags =
      targetProfile?.operational_intake_flags &&
      typeof targetProfile.operational_intake_flags === "object"
        ? { ...targetProfile.operational_intake_flags }
        : {};

    const mergedFlags = {
      ...targetFlags,
      ...(stubFlags.operational_intake_flags && typeof stubFlags.operational_intake_flags === "object"
        ? stubFlags.operational_intake_flags
        : {}),
      linkedFromStubProfileId: stubProfileId,
      linkedFromStubPatientId: stubPatientId,
      linkedAt: nowIso,
      linkedVia: `${channel}_phone_link`,
      ...(channel === "messenger"
        ? { linkedByPhoneNumber: true, linkedByPhoneAt: nowIso, linkedByPhoneChannel: "messenger" }
        : {}),
    };

    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        operational_intake_flags: mergedFlags,
        primary_channel: stubFlags.primary_channel || channel,
        source: stubFlags.source || channel,
        channel_metadata: stubFlags.channel_metadata || null,
        updated_at: nowIso,
      })
      .eq("id", targetProfileId);

    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        operational_intake_flags: {
          ...(stubFlags.operational_intake_flags &&
          typeof stubFlags.operational_intake_flags === "object"
            ? stubFlags.operational_intake_flags
            : {}),
          mergedIntoProfileId: targetProfileId,
          mergedIntoPatientId: targetPatientId,
          mergedAt: nowIso,
        },
        updated_at: nowIso,
      })
      .eq("id", stubProfileId);
  }

  const messagePatch = { patient_id: targetPatientId, updated_at: nowIso };
  if (targetThreadId && UUID_RE.test(targetThreadId)) {
    messagePatch.thread_id = targetThreadId;
  }

  await supabase.from("patient_messages").update(messagePatch).eq("patient_id", stubPatientId).eq("clinic_id", clinicId);

  const messagesPatch = { patient_id: targetPatientId };
  await supabase.from("messages").update(messagesPatch).eq("patient_id", stubPatientId).eq("clinic_id", clinicId);

  await supabase
    .from("patients")
    .update({ phone: whatsappNumber, updated_at: nowIso })
    .eq("id", targetPatientId);

  console.log("[linkOmnichannelLeadByPhone] linked omnichannel lead to registered patient", {
    channel,
    clinicId: clinicId.slice(0, 8),
    fromPatientId: stubPatientId.slice(0, 8),
    toPatientId: targetPatientId.slice(0, 8),
    whatsapp: whatsappNumber.slice(0, 8) + "…",
  });

  let profileRow = null;
  if (targetProfileId) {
    const { data } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select(
        "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, channel_metadata, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, budget_signal, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
      )
      .eq("id", targetProfileId)
      .maybeSingle();
    profileRow = data || null;
  }

  return {
    linked: true,
    patientId: targetPatientId,
    profileId: targetProfileId,
    profileRow,
    threadId: targetThreadId,
    previousPatientId: stubPatientId,
  };
}

module.exports = {
  tryLinkOmnichannelLeadByPhone,
};
