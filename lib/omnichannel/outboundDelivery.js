/**
 * Channel-aware outbound delivery — Messenger first; extensible to Instagram / WhatsApp.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { insertChannelMessagesWithChannel } = require("../coordinatorChannelPersistence");
const { normalizeCoordinatorChannel } = require("../coordinatorChannels");
const {
  getActivePageConnectionByPageId,
  pageAccessTokenFromRow,
} = require("./metaPageConnections");
const { sendMessengerText } = require("./metaGraph");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXTERNAL_CHANNELS = new Set(["messenger", "instagram", "whatsapp"]);

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveOutboundChannelContext(patientId, clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { channel: "in_app", deliverExternal: false };
  }

  const { data: profile } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, primary_channel, channel_metadata")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const channel = normalizeCoordinatorChannel(profile?.primary_channel, "in_app");
  if (!EXTERNAL_CHANNELS.has(channel)) {
    return { channel, deliverExternal: false, profileId: profile?.id || null };
  }

  const { data: identity } = await supabase
    .from("channel_identities")
    .select("id, external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("channel", channel)
    .eq("patient_id", patientId)
    .maybeSingle();

  const meta =
    profile?.channel_metadata && typeof profile.channel_metadata === "object"
      ? profile.channel_metadata
      : {};
  const pageId =
    String(meta.messenger_page_id || identity?.metadata?.page_id || "").trim() || null;
  const psid = String(identity?.external_user_id || meta.messenger_psid || "").trim() || null;

  return {
    channel,
    deliverExternal: Boolean(pageId && psid),
    profileId: profile?.id || null,
    pageId,
    psid,
    identityId: identity?.id || null,
  };
}

/**
 * @param {{
 *   channel: string,
 *   clinicId: string,
 *   patientId: string,
 *   profileId?: string|null,
 *   text: string,
 *   pageId?: string,
 *   psid?: string,
 *   messageRole?: string,
 *   externalMessageId?: string|null,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function deliverMessengerOutbound(params) {
  const clinicId = String(params.clinicId || "").trim();
  const pageId = String(params.pageId || "").trim();
  const psid = String(params.psid || "").trim();
  const text = String(params.text || "").trim();
  if (!text || !pageId || !psid) {
    return { ok: false, error: "messenger_delivery_incomplete" };
  }

  const pageRow = await getActivePageConnectionByPageId(pageId);
  if (!pageRow || String(pageRow.clinic_id) !== clinicId) {
    return { ok: false, error: "page_not_connected" };
  }

  const token = pageAccessTokenFromRow(pageRow);
  if (!token) {
    return { ok: false, error: "page_token_missing" };
  }

  let graphResult;
  try {
    graphResult = await sendMessengerText(pageId, psid, token, text);
  } catch (e) {
    console.warn("[outboundDelivery] messenger send:", e?.message || e, {
      code: e?.code,
      pageId: pageId.slice(0, 8),
    });
    return { ok: false, error: "messenger_send_failed", detail: e?.message || String(e) };
  }

  const outboundMid = graphResult?.message_id ? String(graphResult.message_id) : null;

  return {
    ok: true,
    externalMessageId: outboundMid,
    graphResult,
    profileId: params.profileId ? String(params.profileId) : null,
  };
}

/**
 * Deliver to external channel when lead primary_channel requires it.
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   text: string,
 *   messageRole?: string,
 *   channel?: string,
 *   profileId?: string|null,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function deliverOutboundMessage(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const text = String(params.text || "").trim();
  if (!text || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, error: "invalid_params", delivered: false };
  }

  const ctx = await resolveOutboundChannelContext(patientId, clinicId);
  const channel = normalizeCoordinatorChannel(params.channel || ctx.channel, "in_app");

  if (!EXTERNAL_CHANNELS.has(channel)) {
    return { ok: true, delivered: false, channel, reason: "in_app_only" };
  }

  if (channel === "messenger") {
    const pageId = params.pageId || ctx.pageId;
    const psid = params.psid || ctx.psid;
    if (!pageId || !psid) {
      return { ok: false, delivered: false, channel, error: "messenger_identity_missing" };
    }
    const result = await deliverMessengerOutbound({
      channel,
      clinicId,
      patientId,
      profileId: params.profileId || ctx.profileId,
      text,
      pageId,
      psid,
      messageRole: params.messageRole || "assistant",
      metadata: params.metadata,
    });
    return {
      ...result,
      delivered: result.ok === true,
      channel: "messenger",
      profileId: params.profileId || ctx.profileId,
    };
  }

  return { ok: false, delivered: false, channel, error: "channel_not_implemented" };
}

/**
 * Wrap clinic message insert — still writes in-app record, also delivers externally when needed.
 * @param {(params: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>} baseInsert
 */
function createChannelAwareClinicMessageInsert(baseInsert) {
  return async function channelAwareInsert(params) {
    const result = await baseInsert(params);
    if (result?.error) return result;

    const patientId = String(params.patientId || "").trim();
    const clinicId = String(params.contextClinicId || params.clinicId || "").trim();
    const message = String(params.message || "").trim();
    if (!message || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
      return result;
    }

    const role =
      params.asDoctor || params.authorKind === "doctor"
        ? "coordinator"
        : params.senderName === "Care Team"
          ? "assistant"
          : "coordinator";

    void (async () => {
      try {
        const ext = await deliverOutboundMessage({
          patientId,
          clinicId,
          text: message,
          messageRole: role,
          metadata: {
            message_source: params.messageProvenance?.message_source || params.sendMode || "clinic",
          },
        });
        const isAiAutoReply =
          String(params.senderName || "") === "Care Team" && params.asDoctor !== true;
        if (!ext.delivered || !ext.profileId || isAiAutoReply) return;
        const { error: chErr } = await insertChannelMessagesWithChannel({
          profile_id: ext.profileId,
          channel: ext.channel || "messenger",
          direction: "outbound",
          message_role: role,
          body: message.slice(0, 8000),
          external_message_id: ext.externalMessageId || null,
          metadata: {
            operational_channel: ext.channel,
            delivery_status: "sent",
            ...(params.messageProvenance || {}),
          },
        });
        if (chErr) console.warn("[outboundDelivery] channel persist:", chErr.message);
      } catch (e) {
        console.warn("[outboundDelivery] after insert:", e?.message || e);
      }
    })();

    return result;
  };
}

module.exports = {
  deliverOutboundMessage,
  deliverMessengerOutbound,
  resolveOutboundChannelContext,
  createChannelAwareClinicMessageInsert,
};
