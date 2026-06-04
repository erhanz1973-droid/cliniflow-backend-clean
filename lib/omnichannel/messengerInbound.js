/**
 * Process inbound Messenger webhook events into Clinifly conversation + AI pipeline.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { insertChannelMessagesWithChannel } = require("../coordinatorChannelPersistence");
const { getActivePageConnectionByPageId, lookupPageClinicMapping } = require("./metaPageConnections");
const { normalizePageAiMode, PAGE_AI_MODE, conversationTypeForPageAiMode } = require("../pageAiMode");
const { resolveMessengerIdentity } = require("./channelIdentity");
const { parseInboundMessengerEvent, webhookEventId } = require("./metaWebhook");
const { metaTrace } = require("./metaDebug");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((params: Record<string, unknown>) => Promise<void>)} */
let afterPatientInboundMessageFn = null;

/**
 * @param {{ afterPatientInboundMessage: typeof afterPatientInboundMessageFn }} deps
 */
function setupMessengerInbound(deps) {
  afterPatientInboundMessageFn = deps.afterPatientInboundMessage || null;
}

/**
 * @param {string} eventId
 * @param {Record<string, unknown>} meta
 */
async function recordWebhookEvent(eventId, meta = {}) {
  if (!isSupabaseEnabled() || !eventId) return { duplicate: false };
  const { data: existing } = await supabase
    .from("meta_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing?.event_id) return { duplicate: true };

  const { error } = await supabase.from("meta_webhook_events").insert({
    event_id: eventId,
    page_id: meta.pageId || null,
    event_type: meta.eventType || "message",
    payload_hash: meta.payloadHash || null,
    status: meta.status || "processed",
    error: meta.error || null,
    processed_at: new Date().toISOString(),
  });
  if (error?.code === "23505") return { duplicate: true };
  if (error) console.warn("[messengerInbound] webhook event log:", error.message);
  return { duplicate: false };
}

/**
 * @param {string[]} mids
 * @param {string} status
 */
async function patchDeliveryStatusForMids(mids, status) {
  if (!isSupabaseEnabled() || !mids?.length) return;
  const { patchOutboundDeliveryByExternalMid, DELIVERY_STATUS } = require("./messengerOutboundOps");
  const normalizedStatus =
    status === "delivered" ? DELIVERY_STATUS.DELIVERED : String(status || "").trim();

  for (const mid of mids) {
    const midStr = String(mid || "").trim();
    if (!midStr) continue;

    void patchOutboundDeliveryByExternalMid(midStr, DELIVERY_STATUS.DELIVERED);

    const { data: rows } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("id, metadata")
      .eq("external_message_id", midStr)
      .limit(3);
    for (const row of rows || []) {
      const meta =
        row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
      meta.delivery_status = normalizedStatus;
      meta.last_delivery_attempt_at = new Date().toISOString();
      await supabase
        .from("ai_coordinator_channel_messages")
        .update({ metadata: meta })
        .eq("id", row.id);
    }
  }
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {Record<string, unknown>} pageRow
 */
async function handleInboundMessage(parsed, pageRow) {
  const clinicId = String(pageRow.clinic_id || "").trim();
  const pageAiMode = normalizePageAiMode(pageRow.ai_mode);
  const psid = String(parsed.psid || "").trim();
  const pageId = String(parsed.pageId || "").trim();
  const mid = String(parsed.mid || "").trim();
  let text = String(parsed.text || "").trim();
  if (!text && parsed.attachmentType) {
    text = `[${String(parsed.attachmentType)}]`;
  }
  if (!text) {
    text = "[message]";
  }

  const identity = await resolveMessengerIdentity({
    clinicId,
    psid,
    rawPsid: parsed.rawPsid || null,
    pageId,
    pageConnectionRow: pageRow,
  });
  if (!identity.ok || !identity.patientId) {
    return { ok: false, error: identity.error || "identity_failed" };
  }

  const { ensureMessengerPatientNameFromGraph } = require("./channelIdentity");
  void ensureMessengerPatientNameFromGraph({
    clinicId,
    patientId: identity.patientId,
    psid,
    pageId,
    pageConnectionRow: pageRow,
    identityId: identity.identityId,
  }).catch((e) => console.warn("[messengerInbound] name sync:", e?.message || e));

  const metadata = {
    mid,
    page_id: pageId,
    psid,
    ...(parsed.rawPsid && String(parsed.rawPsid) !== psid
      ? { psid_raw: String(parsed.rawPsid) }
      : {}),
    attachment_type: parsed.attachmentType || null,
    attachment_url: parsed.attachmentUrl || null,
    operational_channel: "messenger",
    delivery_status: "received",
  };

  if (identity.profileId) {
    const { error: chErr } = await insertChannelMessagesWithChannel({
      profile_id: identity.profileId,
      channel: "messenger",
      direction: "inbound",
      message_role: "patient",
      body: text.slice(0, 8000),
      external_message_id: mid || null,
      metadata,
    });
    if (chErr) {
      console.warn("[messengerInbound] channel_messages:", chErr.message);
    }
  }

  await touchLeadProfileFromMessenger(identity.patientId, clinicId, text, identity.profileId, {
    pageAiMode,
  });

  const { mirrorOmnichannelInboundToPatientMessages } = require("../mirrorOmnichannelPatientMessage");
  const mirror = await mirrorOmnichannelInboundToPatientMessages({
    patientId: identity.patientId,
    clinicId,
    text,
    channel: "messenger",
    externalMessageId: mid || null,
  });
  if (!mirror.ok && !mirror.skipped) {
    console.warn("[messengerInbound] patient_messages mirror:", mirror.error || mirror.reason);
  }

  if (afterPatientInboundMessageFn) {
    void afterPatientInboundMessageFn({
      patientId: identity.patientId,
      clinicId,
      patientMessage: text,
      source: "messenger",
      channel: "messenger",
      contextMode: pageAiMode === PAGE_AI_MODE.CLINIFLY_SALES ? "clinifly_sales" : "coordinator",
      externalMessageId: mid || null,
      pageAiMode,
      pageId,
    }).catch((e) => console.warn("[messengerInbound] ai hook:", e?.message || e));
  }

  console.log("[messengerInbound] processed", {
    clinicId: clinicId.slice(0, 8),
    patientId: identity.patientId.slice(0, 8),
    pageAiMode,
    mid: mid ? mid.slice(0, 12) : null,
  });

  return { ok: true, patientId: identity.patientId, profileId: identity.profileId };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} message
 * @param {string|null} profileId
 */
async function touchLeadProfileFromMessenger(patientId, clinicId, message, profileId, opts = {}) {
  const { touchLeadProfileFromInbound } = require("../aiSlaContinuity");
  const pageAiMode = normalizePageAiMode(opts.pageAiMode);
  const conversationType = conversationTypeForPageAiMode(pageAiMode);
  const id = await touchLeadProfileFromInbound(patientId, clinicId, message);
  const pid = profileId || id;
  if (!pid || !isSupabaseEnabled()) return pid;

  const nowIso = new Date().toISOString();
  const patch = {
    primary_channel: "messenger",
    source:
      pageAiMode === PAGE_AI_MODE.CLINIFLY_SALES ? "clinifly_sales_messenger" : "messenger",
    conversation_type: conversationType,
    updated_at: nowIso,
  };
  await supabase.from("ai_coordinator_lead_profiles").update(patch).eq("id", pid);

  return pid;
}

/**
 * @param {Record<string, unknown>} rawEvent
 */
async function processMessagingWebhookEvent(rawEvent) {
  const parsed = parseInboundMessengerEvent(rawEvent);
  const eventId = webhookEventId(parsed);

  metaTrace("webhook.event", {
    kind: parsed.kind,
    pageId: parsed.pageId || null,
    psid: parsed.psid ? String(parsed.psid) : null,
    mid: parsed.mid ? String(parsed.mid).slice(0, 16) : null,
    reason: parsed.reason || null,
  });

  if (parsed.kind === "echo" || parsed.kind === "ignored") {
    await recordWebhookEvent(eventId, {
      pageId: parsed.pageId,
      eventType: parsed.kind,
      status: "skipped",
    });
    return { ok: true, skipped: true, reason: parsed.kind };
  }

  const dup = await recordWebhookEvent(eventId, {
    pageId: parsed.pageId,
    eventType: parsed.kind,
    payloadHash: crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("hex").slice(0, 32),
  });
  if (dup.duplicate) {
    return { ok: true, skipped: true, reason: "duplicate" };
  }

  const pageId = String(parsed.pageId || "").trim();
  const mapping = await lookupPageClinicMapping(pageId);
  const pageRow = await getActivePageConnectionByPageId(pageId);

  console.log({
    pageId,
    matchedClinicId: pageRow?.clinic_id || mapping.matchedClinicId || null,
    matchedClinicName: mapping.matchedClinicName || null,
    matchedClinicCode: mapping.matchedClinicCode || null,
    connectionStatus: mapping.connectionStatus || (pageRow ? "active" : null),
    pageName: mapping.pageName || pageRow?.page_name || null,
    activeConnectionFound: Boolean(pageRow?.clinic_id),
  });

  metaTrace("webhook.clinic_resolved", {
    pageId,
    matchedClinicId: pageRow?.clinic_id
      ? String(pageRow.clinic_id).slice(0, 8)
      : mapping.matchedClinicId
        ? String(mapping.matchedClinicId).slice(0, 8)
        : null,
    matchedClinicName: mapping.matchedClinicName,
    matchedClinicCode: mapping.matchedClinicCode,
    connectionStatus: mapping.connectionStatus,
    activeConnectionFound: Boolean(pageRow?.clinic_id),
  });

  if (!pageRow?.clinic_id) {
    console.warn("[messengerInbound] unknown or inactive page", {
      pageId,
      dbMapping: mapping.found ? mapping : null,
    });
    metaTrace("webhook.event.page_not_connected", {
      pageId,
      mappingFound: mapping.found,
      connectionStatus: mapping.connectionStatus,
      hint: "Reconnect Page in admin-messenger while logged into the correct clinic, or fix meta_page_connections.page_id → clinic_id",
    });
    return { ok: false, error: "page_not_connected" };
  }

  if (parsed.kind === "delivery") {
    await patchDeliveryStatusForMids(parsed.mids || [], "delivered");
    return { ok: true, kind: "delivery" };
  }
  if (parsed.kind === "read") {
    return { ok: true, kind: "read" };
  }
  if (parsed.kind === "postback") {
    parsed.text = parsed.title || parsed.payload || "Menu";
    parsed.mid = parsed.mid || eventId;
    parsed.kind = "message";
  }
  if (parsed.kind !== "message") {
    return { ok: true, skipped: true, reason: parsed.kind };
  }

  try {
    return await handleInboundMessage(parsed, pageRow);
  } catch (e) {
    try {
      await supabase
        .from("meta_webhook_events")
        .update({ status: "failed", error: String(e?.message || e).slice(0, 500) })
        .eq("event_id", eventId);
    } catch (_) {
      /* best-effort */
    }
    throw e;
  }
}

module.exports = {
  setupMessengerInbound,
  processMessagingWebhookEvent,
  touchLeadProfileFromMessenger,
  recordWebhookEvent,
};
