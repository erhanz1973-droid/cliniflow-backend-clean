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
const { sendMessengerText, buildMessengerSendUrls } = require("./metaGraph");
const { repairConcatenatedPsid } = require("./metaWebhook");
const { sendWhatsAppMessage } = require("./whatsappGraph");
const {
  getActiveWhatsAppConnectionByPhoneNumberId,
  getWhatsAppConnectionByPhoneNumberId,
} = require("./whatsappPhoneConnections");
const { recordWhatsAppSendResult, bumpWhatsAppConnectionStats } = require("./whatsappConnectionOps");
const { whatsappAccessToken } = require("./whatsappConfig");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXTERNAL_CHANNELS = new Set(["messenger", "instagram", "whatsapp"]);

/**
 * Normalize Messenger PSID — webhook sender.id only (never patient UUID / user_id).
 * @param {string} rawPsid
 * @param {string} pageId
 */
function normalizeMessengerPsid(rawPsid, pageId) {
  const repaired = repairConcatenatedPsid(String(rawPsid || "").trim(), String(pageId || "").trim(), "");
  if (!repaired) return { psid: null, error: "psid_empty" };
  if (!/^\d{6,20}$/.test(repaired)) {
    return {
      psid: null,
      error: "psid_invalid_format",
      hint: "Use Page-Scoped ID (numeric) from webhook messaging.sender.id — not user_id or internal patient id",
      raw: String(rawPsid).slice(0, 32),
    };
  }
  return { psid: repaired, repaired: repaired !== String(rawPsid || "").trim() };
}

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
  const rawPsid = String(identity?.external_user_id || meta.messenger_psid || "").trim() || null;
  const psidNorm = rawPsid && pageId ? normalizeMessengerPsid(rawPsid, pageId) : { psid: rawPsid };
  const psid = psidNorm.psid || null;
  const phoneNumberId =
    String(
      meta.whatsapp_phone_number_id || identity?.metadata?.phone_number_id || "",
    ).trim() || null;
  const waId = String(identity?.external_user_id || meta.whatsapp_wa_id || "").trim() || null;

  let deliverExternal = false;
  if (channel === "messenger") {
    deliverExternal = Boolean(pageId && psid);
  } else if (channel === "whatsapp") {
    deliverExternal = Boolean(phoneNumberId && waId);
  }

  return {
    channel,
    deliverExternal,
    profileId: profile?.id || null,
    pageId,
    psid,
    phoneNumberId,
    waId,
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
  const text = String(params.text || "").trim();
  const psidNorm = normalizeMessengerPsid(params.psid, pageId);
  const psid = psidNorm.psid;

  if (!text || !pageId) {
    return { ok: false, error: "messenger_delivery_incomplete", deliveryStatus: "failed" };
  }
  if (!psid) {
    console.warn("[messenger.send.failed]", JSON.stringify({
      stage: "precheck",
      pageId,
      error: psidNorm.error,
      hint: psidNorm.hint,
      rawPsid: psidNorm.raw,
    }));
    return {
      ok: false,
      error: psidNorm.error || "messenger_psid_invalid",
      detail: psidNorm.hint,
      deliveryStatus: "failed",
    };
  }

  const pageRow = await getActivePageConnectionByPageId(pageId);
  if (!pageRow || String(pageRow.clinic_id) !== clinicId) {
    console.warn("[messenger.send.failed]", JSON.stringify({
      stage: "page_connection",
      pageId,
      clinicId: clinicId.slice(0, 8),
      found: !!pageRow,
      rowClinic: pageRow?.clinic_id ? String(pageRow.clinic_id).slice(0, 8) : null,
    }));
    return {
      ok: false,
      error: "page_not_connected",
      deliveryStatus: "failed",
      hint: "Inbound page_id must match active meta_page_connections for this clinic",
    };
  }

  const token = pageAccessTokenFromRow(pageRow);
  const tokenSource = "meta_page_connections.page_access_token_enc";
  if (!token) {
    return { ok: false, error: "page_token_missing", deliveryStatus: "failed" };
  }

  const sendUrls = buildMessengerSendUrls(pageId);

  let graphResult;
  try {
    graphResult = await sendMessengerText(pageId, psid, token, text, { tokenSource });
  } catch (e) {
    return {
      ok: false,
      error: "messenger_send_failed",
      detail: e?.message || String(e),
      code: e?.code,
      type: e?.type,
      deliveryStatus: "failed",
      graphApiUrl: e?.requestUrl || sendUrls?.pageMessages,
      tokenSource,
      responseBody: e?.payload || null,
      attempts: e?.attempts || null,
      pageId,
      recipientPsid: psid,
      psidRepaired: psidNorm.repaired === true,
    };
  }

  const outboundMid = graphResult?.message_id ? String(graphResult.message_id) : null;

  return {
    ok: true,
    externalMessageId: outboundMid,
    graphResult,
    deliveryStatus: "sent",
    profileId: params.profileId ? String(params.profileId) : null,
    pageId,
    recipientPsid: psid,
    psidRepaired: psidNorm.repaired === true,
    tokenSource,
    graphApiUrl: graphResult?._delivery?.graphApiUrl || null,
    endpoint: graphResult?._delivery?.endpoint || null,
  };
}

/**
 * @param {{
 *   clinicId: string,
 *   phoneNumberId: string,
 *   waId: string,
 *   text: string,
 *   accessToken?: string,
 *   messageRole?: string,
 * }} params
 */
async function deliverWhatsAppOutbound(params) {
  const clinicId = String(params.clinicId || "").trim();
  const phoneNumberId = String(params.phoneNumberId || "").trim();
  const waId = String(params.waId || "").trim();
  const text = String(params.text || "").trim();
  if (!text || !phoneNumberId || !waId) {
    return { ok: false, error: "whatsapp_delivery_incomplete" };
  }

  const row = await getActiveWhatsAppConnectionByPhoneNumberId(phoneNumberId);
  if (!row || String(row.clinic_id) !== clinicId) {
    const paused = await getWhatsAppConnectionByPhoneNumberId(phoneNumberId);
    if (paused?.clinic_id === clinicId) {
      return { ok: false, error: "whatsapp_paused", detail: "WhatsApp is paused for this clinic." };
    }
    return { ok: false, error: "whatsapp_phone_not_connected" };
  }

  const token = String(params.accessToken || row.accessToken || whatsappAccessToken() || "").trim();
  if (!token) {
    return { ok: false, error: "whatsapp_token_missing" };
  }

  let graphResult;
  try {
    graphResult = await sendWhatsAppMessage(phoneNumberId, waId, text, token);
  } catch (e) {
    console.warn("[outboundDelivery] whatsapp send:", e?.message || e, {
      code: e?.code,
      type: e?.type,
      phoneNumberId,
      requestUrl: e?.requestUrl || null,
      graphApiVersion: e?.graphApiVersion || null,
      fbtrace_id: e?.fbtrace_id || null,
    });
    void recordWhatsAppSendResult(phoneNumberId, {
      ok: false,
      error: e?.message || String(e),
    });
    if (e?.code === 100) {
      console.warn(
        "[outboundDelivery] hint: run GET /api/integrations/meta/whatsapp/diagnostics — often wrong token type or phone_number_id not owned by token",
      );
    }
    return {
      ok: false,
      error: "whatsapp_send_failed",
      detail: e?.message || String(e),
      code: e?.code,
      requestUrl: e?.requestUrl,
      graphApiVersion: e?.graphApiVersion,
    };
  }

  const outboundId = graphResult?.messages?.[0]?.id
    ? String(graphResult.messages[0].id)
    : null;

  void recordWhatsAppSendResult(phoneNumberId, { ok: true, messageId: outboundId });
  const role = String(params.messageRole || "").toLowerCase();
  if (role === "assistant" || role === "ai" || role === "coordinator_ai") {
    void bumpWhatsAppConnectionStats(phoneNumberId, { aiReply: 1 });
  }

  console.log("[outboundDelivery] whatsapp sent", {
    clinicId: clinicId.slice(0, 8),
    phoneNumberId: phoneNumberId.slice(0, 8),
    waId: waId.length > 8 ? `${waId.slice(0, 8)}…` : waId,
    messageId: outboundId ? outboundId.slice(0, 20) : null,
  });

  return {
    ok: true,
    externalMessageId: outboundId,
    graphResult,
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
      pageId,
      psid,
      deliveryStatus: result.deliveryStatus || (result.ok ? "sent" : "failed"),
    };
  }

  if (channel === "whatsapp") {
    const phoneNumberId = params.phoneNumberId || ctx.phoneNumberId;
    const waId = params.waId || ctx.waId;
    if (!phoneNumberId || !waId) {
      return { ok: false, delivered: false, channel, error: "whatsapp_identity_missing" };
    }
    const result = await deliverWhatsAppOutbound({
      clinicId,
      phoneNumberId,
      waId,
      text,
      messageRole: params.messageRole,
    });
    return {
      ...result,
      delivered: result.ok === true,
      channel: "whatsapp",
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
        if (ext.channel === "whatsapp") {
          console.log("[outboundDelivery] whatsapp reply attempt", {
            patientId: patientId.slice(0, 8),
            delivered: ext.delivered === true,
            ok: ext.ok === true,
            error: ext.error || null,
            externalMessageId: ext.externalMessageId
              ? String(ext.externalMessageId).slice(0, 20)
              : null,
          });
        }
        if (ext.channel === "messenger") {
          console.log("[outboundDelivery] messenger reply attempt", {
            patientId: patientId.slice(0, 8),
            delivered: ext.delivered === true,
            ok: ext.ok === true,
            error: ext.error || null,
            deliveryStatus: ext.deliveryStatus || (ext.ok ? "sent" : "failed"),
            externalMessageId: ext.externalMessageId
              ? String(ext.externalMessageId).slice(0, 24)
              : null,
            pageId: ext.pageId ? String(ext.pageId).slice(0, 12) : null,
          });
        }
        if (!ext.delivered || !ext.profileId || isAiAutoReply) return;
        const deliveryStatus =
          ext.deliveryStatus || (ext.ok === true ? "sent" : "failed");
        const { error: chErr } = await insertChannelMessagesWithChannel({
          profile_id: ext.profileId,
          channel: ext.channel || "messenger",
          direction: "outbound",
          message_role: role,
          body: message.slice(0, 8000),
          external_message_id: ext.externalMessageId || null,
          metadata: {
            operational_channel: ext.channel,
            delivery_status: deliveryStatus,
            delivery_error: ext.ok ? null : ext.error || ext.detail || null,
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

/**
 * API/UI-friendly delivery summary for clinic reply endpoints.
 * @param {Record<string, unknown>} ext
 */
function formatClinicReplyDelivery(ext) {
  const channel = ext?.channel ? String(ext.channel) : "in_app";
  if (ext?.delivered === false && ext?.reason === "in_app_only") {
    return { channel, status: "skipped", delivered: false, reason: "in_app_only" };
  }
  if (!ext?.deliverExternal && channel === "in_app") {
    return { channel: "in_app", status: "skipped", delivered: false };
  }
  const ok = ext?.ok === true && ext?.delivered === true;
  return {
    channel,
    status: ok ? "sent" : "failed",
    delivered: ok,
    externalMessageId: ext?.externalMessageId || null,
    error: ok ? null : ext?.error || null,
    detail: ok ? null : ext?.detail || null,
    code: ext?.code || null,
    pageId: ext?.pageId || null,
    graphApiUrl: ext?.graphApiUrl || null,
  };
}

/**
 * Await external delivery after in-app message saved (admin/doctor chat).
 * @param {{ patientId: string, clinicId: string, text: string, messageRole?: string }} params
 */
async function deliverClinicReplyToExternalChannel(params) {
  const ext = await deliverOutboundMessage({
    patientId: String(params.patientId || "").trim(),
    clinicId: String(params.clinicId || "").trim(),
    text: String(params.text || "").trim(),
    messageRole: params.messageRole || "coordinator",
  });
  return formatClinicReplyDelivery({ ...ext, deliverExternal: ext.delivered });
}

module.exports = {
  deliverOutboundMessage,
  deliverMessengerOutbound,
  deliverWhatsAppOutbound,
  resolveOutboundChannelContext,
  normalizeMessengerPsid,
  formatClinicReplyDelivery,
  deliverClinicReplyToExternalChannel,
  createChannelAwareClinicMessageInsert,
};
