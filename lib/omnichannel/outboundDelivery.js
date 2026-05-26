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
const { resolveMessengerPsidForPatient } = require("./channelIdentity");
const { logAiReplyLatency } = require("../aiReplyOrchestration");
const { sendMessengerText, buildMessengerSendUrls, debugAccessToken } = require("./metaGraph");
const { repairConcatenatedPsid } = require("./metaWebhook");
const { sendWhatsAppMessage } = require("./whatsappGraph");
const {
  DELIVERY_STATUS,
  looksLikeInternalPatientId,
  createOutboundDeliveryRow,
  patchOutboundDeliveryRow,
  patchPatientMessageTransport,
  logMessengerOutbound,
  graphErrorFields,
} = require("./messengerOutboundOps");
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
  const internalCheck = looksLikeInternalPatientId(rawPsid);
  if (internalCheck.invalid) {
    return {
      psid: null,
      error: internalCheck.reason,
      hint: internalCheck.hint,
      raw: String(rawPsid).slice(0, 32),
    };
  }
  const repaired = repairConcatenatedPsid(String(rawPsid || "").trim(), String(pageId || "").trim(), "");
  if (!repaired) return { psid: null, error: "psid_empty" };
  const internalRepaired = looksLikeInternalPatientId(repaired);
  if (internalRepaired.invalid) {
    return {
      psid: null,
      error: internalRepaired.reason,
      hint: internalRepaired.hint,
      raw: String(repaired).slice(0, 32),
    };
  }
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
  let psid = null;
  let psidResolveError = null;
  if (channel === "messenger") {
    const resolved = await resolveMessengerPsidForPatient({
      clinicId,
      patientId,
      pageId,
      profileId: profile?.id || null,
    });
    psid = resolved.psid || null;
    psidResolveError = resolved.error || null;
    if (resolved.hint) {
      console.warn("[outboundDelivery] messenger psid resolve:", resolved.error, resolved.hint);
    }
  }
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
    psidResolveError,
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
  const patientId = String(params.patientId || "").trim();
  const pageId = String(params.pageId || "").trim();
  const text = String(params.text || "").trim();
  const psidNorm = normalizeMessengerPsid(params.psid, pageId);
  const psid = psidNorm.psid;
  const sendUrls = buildMessengerSendUrls(pageId);
  const attemptCount = Number(params.attemptCount) > 0 ? Number(params.attemptCount) : 1;

  const auditBase = {
    clinicId,
    patientId: UUID_RE.test(patientId) ? patientId : null,
    profileId: params.profileId || null,
    patientMessageId: params.patientMessageId || null,
    transport: "messenger",
    pageId,
    recipientPsid: psid,
    tokenSource: "meta_page_connections.page_access_token_enc",
    attemptCount,
  };

  let auditId = params.outboundDeliveryId || null;
  if (!auditId) {
    const created = await createOutboundDeliveryRow({
      ...auditBase,
      deliveryStatus: DELIVERY_STATUS.QUEUED,
    });
    auditId = created.id;
  }

  await patchOutboundDeliveryRow(auditId, { deliveryStatus: DELIVERY_STATUS.SENDING });

  logMessengerOutbound("attempt", {
    stage: "start",
    clinicId: clinicId.slice(0, 8),
    patientId: patientId ? patientId.slice(0, 8) : null,
    pageId,
    recipientPsid: psid ? (psid.length > 12 ? `${psid.slice(0, 8)}…` : psid) : null,
    graphEndpoint: sendUrls?.pageMessagesFormat,
    outboundDeliveryId: auditId,
    attemptCount,
  });

  if (!text || !pageId) {
    const fail = {
      ok: false,
      error: "messenger_delivery_incomplete",
      deliveryStatus: DELIVERY_STATUS.FAILED,
    };
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      errorMessage: fail.error,
    });
    return { ...fail, outboundDeliveryId: auditId };
  }
  if (!psid) {
    logMessengerOutbound("precheck_failed", {
      pageId,
      error: psidNorm.error,
      hint: psidNorm.hint,
      rawPsid: psidNorm.raw,
    });
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      errorMessage: psidNorm.error || "messenger_psid_invalid",
    });
    return {
      ok: false,
      error: psidNorm.error || "messenger_psid_invalid",
      detail: psidNorm.hint,
      deliveryStatus: DELIVERY_STATUS.FAILED,
      outboundDeliveryId: auditId,
    };
  }

  const pageRow = await getActivePageConnectionByPageId(pageId);
  if (!pageRow || String(pageRow.clinic_id) !== clinicId) {
    logMessengerOutbound("page_connection_failed", {
      pageId,
      clinicId: clinicId.slice(0, 8),
      found: !!pageRow,
    });
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      errorMessage: "page_not_connected",
    });
    return {
      ok: false,
      error: "page_not_connected",
      deliveryStatus: DELIVERY_STATUS.FAILED,
      hint: "Inbound page_id must match active meta_page_connections for this clinic",
      outboundDeliveryId: auditId,
    };
  }

  const token = pageAccessTokenFromRow(pageRow);
  const tokenSource = auditBase.tokenSource;
  if (!token) {
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      errorMessage: "page_token_missing",
    });
    return {
      ok: false,
      error: "page_token_missing",
      deliveryStatus: DELIVERY_STATUS.FAILED,
      outboundDeliveryId: auditId,
    };
  }

  let tokenDebug = null;
  try {
    tokenDebug = await debugAccessToken(token, { auditLabel: "messenger.outbound.send" });
  } catch (e) {
    logMessengerOutbound("token_debug_skip", { message: e?.message || String(e) });
  }
  if (tokenDebug && tokenDebug.is_valid === false) {
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      errorMessage: "page_token_invalid",
      graphResponse: tokenDebug,
    });
    return {
      ok: false,
      error: "page_token_invalid",
      deliveryStatus: DELIVERY_STATUS.FAILED,
      detail: "Page access token failed debug_token validation",
      outboundDeliveryId: auditId,
    };
  }

  let graphResult;
  try {
    graphResult = await sendMessengerText(pageId, psid, token, text, { tokenSource });
  } catch (e) {
    const gErr = graphErrorFields(e);
    logMessengerOutbound("graph_failed", {
      pageId,
      patientId: patientId ? patientId.slice(0, 8) : null,
      recipientPsid: psid.length > 12 ? `${psid.slice(0, 8)}…` : psid,
      graphApiUrl: e?.requestUrl || sendUrls?.pageMessages,
      httpStatus: gErr.httpStatus,
      errorCode: gErr.errorCode,
      errorSubcode: gErr.errorSubcode,
      errorMessage: gErr.errorMessage,
      tokenSource,
      tokenScopes: tokenDebug?.scopes || null,
      responseBody: gErr.graphResponse,
    });
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      graphEndpoint: e?.endpoint || null,
      graphApiUrl: e?.requestUrl || sendUrls?.pageMessages,
      httpStatus: gErr.httpStatus,
      graphResponse: gErr.graphResponse,
      errorCode: gErr.errorCode,
      errorSubcode: gErr.errorSubcode,
      errorMessage: gErr.errorMessage,
    });
    if (params.patientMessageId) {
      void patchPatientMessageTransport(params.patientMessageId, {
        transport: "messenger",
        deliveryStatus: DELIVERY_STATUS.FAILED,
        deliveryError: gErr.errorMessage,
        outboundDeliveryId: auditId,
      });
    }
    return {
      ok: false,
      error: "messenger_send_failed",
      detail: gErr.errorMessage,
      code: gErr.errorCode,
      errorSubcode: gErr.errorSubcode,
      type: e?.type,
      deliveryStatus: DELIVERY_STATUS.FAILED,
      graphApiUrl: e?.requestUrl || sendUrls?.pageMessages,
      tokenSource,
      responseBody: gErr.graphResponse,
      attempts: e?.attempts || null,
      pageId,
      recipientPsid: psid,
      patientId: UUID_RE.test(patientId) ? patientId : null,
      psidRepaired: psidNorm.repaired === true,
      outboundDeliveryId: auditId,
    };
  }

  const outboundMid = graphResult?.message_id ? String(graphResult.message_id) : null;
  if (!outboundMid) {
    await patchOutboundDeliveryRow(auditId, {
      deliveryStatus: DELIVERY_STATUS.FAILED,
      graphResponse: graphResult || {},
      errorMessage: "meta_accepted_without_message_id",
    });
    return {
      ok: false,
      error: "meta_no_message_id",
      deliveryStatus: DELIVERY_STATUS.FAILED,
      detail: "Graph API returned 200 without message_id — treat as failed",
      outboundDeliveryId: auditId,
    };
  }

  const endpoint = graphResult?._delivery?.endpoint || "page";
  const graphApiUrl = graphResult?._delivery?.graphApiUrl || sendUrls?.pageMessages;

  await patchOutboundDeliveryRow(auditId, {
    deliveryStatus: DELIVERY_STATUS.ACCEPTED_BY_META,
    externalMessageId: outboundMid,
    graphEndpoint: endpoint,
    graphApiUrl,
    httpStatus: 200,
    graphResponse: graphResult,
  });

  logMessengerOutbound("accepted", {
    pageId,
    patientId: patientId ? patientId.slice(0, 8) : null,
    recipientPsid: psid.length > 12 ? `${psid.slice(0, 8)}…` : psid,
    externalMessageId: outboundMid,
    graphApiUrl,
    endpoint,
    tokenSource,
    tokenScopes: tokenDebug?.scopes || null,
  });

  if (params.patientMessageId) {
    void patchPatientMessageTransport(params.patientMessageId, {
      transport: "messenger",
      externalMessageId: outboundMid,
      deliveryStatus: DELIVERY_STATUS.ACCEPTED_BY_META,
      outboundDeliveryId: auditId,
    });
  }

  return {
    ok: true,
    externalMessageId: outboundMid,
    graphResult,
    deliveryStatus: DELIVERY_STATUS.ACCEPTED_BY_META,
    profileId: params.profileId ? String(params.profileId) : null,
    pageId,
    recipientPsid: psid,
    patientId: UUID_RE.test(patientId) ? patientId : null,
    psidRepaired: psidNorm.repaired === true,
    tokenSource,
    graphApiUrl,
    endpoint,
    outboundDeliveryId: auditId,
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
      return {
        ok: false,
        delivered: false,
        channel,
        error: ctx.psidResolveError || "messenger_identity_missing",
        detail:
          ctx.psidResolveError === "messenger_psid_truncated"
            ? "Patient must send a new Messenger message to refresh PSID, then retry send."
            : null,
      };
    }
    const result = await deliverMessengerOutbound({
      channel,
      clinicId,
      patientId,
      profileId: params.profileId || ctx.profileId,
      text,
      pageId,
      psid,
      patientMessageId: params.patientMessageId || null,
      messageRole: params.messageRole || "assistant",
      metadata: params.metadata,
      attemptCount: params.attemptCount || 1,
      outboundDeliveryId: params.outboundDeliveryId || null,
    });
    const accepted =
      result.ok === true &&
      result.deliveryStatus === DELIVERY_STATUS.ACCEPTED_BY_META &&
      Boolean(result.externalMessageId);
    return {
      ...result,
      delivered: accepted,
      channel: "messenger",
      profileId: params.profileId || ctx.profileId,
      pageId,
      psid,
      deliveryStatus: result.deliveryStatus || (accepted ? DELIVERY_STATUS.ACCEPTED_BY_META : DELIVERY_STATUS.FAILED),
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

    const traceId =
      params.messageProvenance?.latency_trace_id ||
      params.messageProvenance?.latencyTraceId ||
      null;

    /** @type {Record<string, unknown>|null} */
    let lastExternalDelivery = null;

    const runExternalDelivery = async () => {
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
        lastExternalDelivery = ext;
        if (traceId) {
          logAiReplyLatency(traceId, "outbound_complete", {
            channel: ext.channel,
            delivered: ext.delivered === true,
            deliveryStatus: ext.deliveryStatus,
            externalMessageId: ext.externalMessageId
              ? String(ext.externalMessageId).slice(0, 20)
              : null,
          });
        }
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
        if (!ext.profileId) return;
        const deliveryStatus =
          ext.deliveryStatus ||
          (ext.delivered ? DELIVERY_STATUS.ACCEPTED_BY_META : DELIVERY_STATUS.FAILED);
        const { error: chErr } = await insertChannelMessagesWithChannel({
          profile_id: ext.profileId,
          channel: ext.channel || "messenger",
          direction: "outbound",
          message_role: role,
          body: message.slice(0, 8000),
          external_message_id: ext.externalMessageId || null,
          metadata: {
            transport: ext.channel || "messenger",
            operational_channel: ext.channel,
            delivery_status: deliveryStatus,
            external_message_id: ext.externalMessageId || null,
            last_delivery_attempt_at: new Date().toISOString(),
            delivery_error: ext.delivered ? null : ext.error || ext.detail || null,
            outbound_delivery_id: ext.outboundDeliveryId || null,
            page_id: ext.pageId || null,
            recipient_psid: ext.psid || ext.recipientPsid || null,
            ...(params.messageProvenance || {}),
          },
        });
        if (chErr) console.warn("[outboundDelivery] channel persist:", chErr.message);
      } catch (e) {
        console.warn("[outboundDelivery] after insert:", e?.message || e);
        if (traceId) {
          logAiReplyLatency(traceId, "outbound_error", { message: e?.message || String(e) });
        }
      }
    };

    let deliverExternal = false;
    try {
      const ctx = await resolveOutboundChannelContext(patientId, clinicId);
      deliverExternal = EXTERNAL_CHANNELS.has(ctx.channel) && ctx.deliverExternal;
    } catch (_) {
      /* optional */
    }

    if (deliverExternal) {
      await runExternalDelivery();
    } else {
      void runExternalDelivery();
    }

    if (lastExternalDelivery) {
      return { ...result, outboundDelivery: lastExternalDelivery };
    }
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
  const deliveryStatus = String(ext?.deliveryStatus || "").trim() || DELIVERY_STATUS.FAILED;
  const accepted =
    ext?.ok === true &&
    ext?.delivered === true &&
    (deliveryStatus === DELIVERY_STATUS.ACCEPTED_BY_META ||
      deliveryStatus === DELIVERY_STATUS.DELIVERED) &&
    Boolean(ext?.externalMessageId);
  const failed = deliveryStatus === DELIVERY_STATUS.FAILED || ext?.ok === false;
  return {
    channel,
    status: accepted
      ? deliveryStatus === DELIVERY_STATUS.DELIVERED
        ? DELIVERY_STATUS.DELIVERED
        : DELIVERY_STATUS.ACCEPTED_BY_META
      : failed
        ? DELIVERY_STATUS.FAILED
        : deliveryStatus,
    deliveryStatus,
    delivered: accepted,
    /** @deprecated use deliveryStatus — only true when Meta accepted (message_id present) */
    sent: accepted,
    externalMessageId: ext?.externalMessageId || null,
    outboundDeliveryId: ext?.outboundDeliveryId || null,
    error: accepted ? null : ext?.error || null,
    detail: accepted ? null : ext?.detail || null,
    code: ext?.code || null,
    errorSubcode: ext?.errorSubcode || null,
    pageId: ext?.pageId || null,
    recipientPsid: ext?.psid || ext?.recipientPsid || null,
    graphApiUrl: ext?.graphApiUrl || null,
    canRetry: failed && channel === "messenger",
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
    profileId: params.profileId || null,
    patientMessageId: params.patientMessageId || null,
    attemptCount: params.attemptCount || 1,
    outboundDeliveryId: params.outboundDeliveryId || null,
  });
  return formatClinicReplyDelivery({ ...ext, deliverExternal: ext.delivered });
}

/**
 * In-app insert + external channel delivery (lead inbox / explicit send — avoids double-send from channel-aware wrapper).
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   profileId?: string|null,
 *   text: string,
 *   messageRole?: string,
 *   senderName?: string,
 *   insertFn: (params: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>,
 * }} params
 */
async function sendClinicReplyWithExternalDelivery(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const text = String(params.text || "").trim();
  const profileId = params.profileId ? String(params.profileId).trim() : null;
  const isRetry = params.retry === true || Boolean(params.outboundDeliveryId);
  if (!text || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, error: "invalid_params" };
  }
  if (typeof params.insertFn !== "function" && !isRetry) {
    return { ok: false, error: "insert_not_configured" };
  }

  let insertResult = { data: params.existingMessage || null, error: null };
  if (!isRetry) {
    insertResult = await params.insertFn({
      patientId,
      message: text,
      type: "text",
      contextClinicId: clinicId,
      senderName: params.senderName || "Care Team",
      messageRole: params.messageRole || "coordinator",
      messageProvenance: {
        message_source: "coordinator_lead_inbox",
        send_mode: "lead_inbox",
        transport: "messenger",
        delivery_status: DELIVERY_STATUS.QUEUED,
      },
    });
    if (insertResult?.error) {
      return {
        ok: false,
        error: "message_insert_failed",
        detail: String(insertResult.error?.message || insertResult.error),
      };
    }
  }

  const patientMessageId =
    insertResult.data?.message_id || insertResult.data?.id || params.patientMessageId || null;

  const ext = await deliverOutboundMessage({
    patientId,
    clinicId,
    text,
    messageRole: params.messageRole || "coordinator",
    profileId,
    patientMessageId,
    attemptCount: params.attemptCount || 1,
    outboundDeliveryId: params.outboundDeliveryId || null,
  });
  const delivery = formatClinicReplyDelivery({ ...ext, deliverExternal: ext.delivered });

  if (profileId && ext.channel === "messenger") {
    const { error: chErr } = await insertChannelMessagesWithChannel({
      profile_id: profileId,
      channel: "messenger",
      direction: "outbound",
      message_role: params.messageRole || "coordinator",
      body: text.slice(0, 8000),
      external_message_id: ext.externalMessageId || null,
      metadata: {
        transport: "messenger",
        delivery_status: delivery.deliveryStatus,
        external_message_id: ext.externalMessageId || null,
        last_delivery_attempt_at: new Date().toISOString(),
        delivery_error: delivery.delivered ? null : delivery.error || delivery.detail,
        outbound_delivery_id: ext.outboundDeliveryId || null,
        page_id: ext.pageId || null,
        recipient_psid: ext.psid || ext.recipientPsid || null,
        patient_message_id: patientMessageId,
      },
    });
    if (chErr) console.warn("[outboundDelivery] lead reply channel persist:", chErr.message);
  }

  const httpOk = delivery.status !== DELIVERY_STATUS.FAILED;
  return {
    ok: httpOk,
    message: insertResult.data || null,
    delivery,
    patientMessageId,
  };
}

/**
 * Retry a failed Messenger outbound for an existing in-app message.
 * @param {{ patientId: string, clinicId: string, text: string, patientMessageId?: string, outboundDeliveryId?: string }} params
 */
async function resendMessengerClinicReply(params) {
  return sendClinicReplyWithExternalDelivery({
    ...params,
    retry: true,
    attemptCount: Number(params.attemptCount || 0) + 1,
    insertFn: null,
  });
}

module.exports = {
  DELIVERY_STATUS,
  deliverOutboundMessage,
  deliverMessengerOutbound,
  deliverWhatsAppOutbound,
  resolveOutboundChannelContext,
  normalizeMessengerPsid,
  formatClinicReplyDelivery,
  deliverClinicReplyToExternalChannel,
  sendClinicReplyWithExternalDelivery,
  resendMessengerClinicReply,
  createChannelAwareClinicMessageInsert,
};
