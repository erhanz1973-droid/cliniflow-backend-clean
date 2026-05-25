/**
 * Process inbound WhatsApp Cloud API webhook events.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { insertChannelMessagesWithChannel } = require("../coordinatorChannelPersistence");
const {
  getActiveWhatsAppConnectionByPhoneNumberId,
  lookupWhatsAppClinicMapping,
} = require("./whatsappPhoneConnections");
const { resolveWhatsAppIdentity } = require("./channelIdentity");
const { whatsAppWebhookEventId } = require("./whatsappWebhook");
const { isMetaTraceEnabled } = require("./metaDebug");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((params: Record<string, unknown>) => Promise<void>)} */
let afterPatientInboundMessageFn = null;

/**
 * @param {string} event
 * @param {Record<string, unknown>} [detail]
 */
function whatsappLog(event, detail = {}) {
  console.log(`[${event}]`, detail);
  if (isMetaTraceEnabled()) {
    console.log("[metaTrace]", event, detail);
  }
}

/**
 * @param {{ afterPatientInboundMessage: typeof afterPatientInboundMessageFn }} deps
 */
function setupWhatsAppInbound(deps) {
  afterPatientInboundMessageFn = deps.afterPatientInboundMessage || null;
}

/**
 * @param {string} eventId
 * @param {Record<string, unknown>} meta
 */
async function recordWhatsAppWebhookEvent(eventId, meta = {}) {
  if (!isSupabaseEnabled() || !eventId) return { duplicate: false };
  const { data: existing } = await supabase
    .from("meta_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing?.event_id) return { duplicate: true };

  const { error } = await supabase.from("meta_webhook_events").insert({
    event_id: eventId,
    page_id: meta.phoneNumberId || null,
    event_type: meta.eventType || "whatsapp",
    payload_hash: meta.payloadHash || null,
    status: meta.status || "processed",
    error: meta.error || null,
    processed_at: new Date().toISOString(),
  });
  if (error?.code === "23505") return { duplicate: true };
  if (error) console.warn("[whatsappInbound] webhook event log:", error.message);
  return { duplicate: false };
}

/**
 * @param {string} messageId
 * @param {string} status
 */
async function patchWhatsAppDeliveryStatus(messageId, status) {
  if (!isSupabaseEnabled() || !messageId) return;
  const { data: rows } = await supabase
    .from("ai_coordinator_channel_messages")
    .select("id, metadata")
    .eq("external_message_id", messageId)
    .limit(3);
  for (const row of rows || []) {
    const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    meta.delivery_status = status;
    await supabase.from("ai_coordinator_channel_messages").update({ metadata: meta }).eq("id", row.id);
  }
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {Record<string, unknown>} connectionRow
 */
async function handleInboundWhatsAppMessage(parsed, connectionRow) {
  const clinicId = String(connectionRow.clinic_id || "").trim();
  const waId = String(parsed.waId || "").trim();
  const phoneNumberId = String(parsed.phoneNumberId || "").trim();
  const messageId = String(parsed.messageId || "").trim();
  const text = String(parsed.text || "").trim();

  const identity = await resolveWhatsAppIdentity({
    clinicId,
    waId,
    phoneNumberId,
    profileName: parsed.profileName ? String(parsed.profileName) : null,
  });
  if (!identity.ok || !identity.patientId) {
    whatsappLog("whatsapp.pipeline.identity_failed", { error: identity.error, clinicId, waId });
    return { ok: false, error: identity.error || "identity_failed" };
  }

  whatsappLog("whatsapp.pipeline.identity_ok", {
    clinicId: clinicId.slice(0, 8),
    patientId: identity.patientId.slice(0, 8),
    profileId: identity.profileId ? String(identity.profileId).slice(0, 8) : null,
    threadId: identity.threadId ? String(identity.threadId).slice(0, 8) : null,
    created: identity.created,
  });

  const metadata = {
    message_id: messageId,
    phone_number_id: phoneNumberId,
    wa_id: waId,
    message_type: parsed.messageType || "text",
    operational_channel: "whatsapp",
    delivery_status: "received",
  };

  if (identity.profileId) {
    const { error: chErr } = await insertChannelMessagesWithChannel({
      profile_id: identity.profileId,
      channel: "whatsapp",
      direction: "inbound",
      message_role: "patient",
      body: text.slice(0, 8000),
      external_message_id: messageId || null,
      metadata,
    });
    if (chErr) {
      console.warn("[whatsappInbound] channel_messages:", chErr.message);
    }
  }

  await touchLeadProfileFromWhatsApp(identity.patientId, clinicId, text, identity.profileId);

  if (afterPatientInboundMessageFn) {
    whatsappLog("whatsapp.pipeline.ai_dispatch", {
      clinicId: clinicId.slice(0, 8),
      patientId: identity.patientId.slice(0, 8),
      textLength: text.length,
    });
    void afterPatientInboundMessageFn({
      patientId: identity.patientId,
      clinicId,
      patientMessage: text,
      source: "whatsapp",
      channel: "whatsapp",
      contextMode: "coordinator",
    })
      .then(() => {
        whatsappLog("whatsapp.pipeline.ai_dispatch_done", {
          patientId: identity.patientId.slice(0, 8),
        });
      })
      .catch((e) => {
        console.warn("[whatsappInbound] ai hook:", e?.message || e);
        whatsappLog("whatsapp.pipeline.ai_dispatch_error", { message: e?.message || String(e) });
      });
  } else {
    console.warn("[whatsappInbound] AI hook not configured — no outbound reply");
  }

  console.log("[whatsappInbound] processed", {
    clinicId: clinicId.slice(0, 8),
    patientId: identity.patientId.slice(0, 8),
    messageId: messageId ? messageId.slice(0, 16) : null,
  });

  return { ok: true, patientId: identity.patientId, profileId: identity.profileId };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} message
 * @param {string|null} profileId
 */
async function touchLeadProfileFromWhatsApp(patientId, clinicId, message, profileId) {
  const { touchLeadProfileFromInbound } = require("../aiSlaContinuity");
  const id = await touchLeadProfileFromInbound(patientId, clinicId, message);
  const pid = profileId || id;
  if (!pid || !isSupabaseEnabled()) return pid;

  const nowIso = new Date().toISOString();
  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      primary_channel: "whatsapp",
      source: "whatsapp",
      updated_at: nowIso,
    })
    .eq("id", pid);

  return pid;
}

/**
 * @param {Record<string, unknown>} parsed
 */
async function processWhatsAppWebhookEvent(parsed) {
  const eventId = whatsAppWebhookEventId(parsed);
  const phoneNumberId = String(parsed.phoneNumberId || "").trim();

  if (parsed.kind === "status") {
    whatsappLog("whatsapp.status.received", {
      phoneNumberId,
      waId: parsed.waId ? String(parsed.waId).slice(0, 8) : null,
      messageId: parsed.messageId ? String(parsed.messageId).slice(0, 20) : null,
      status: parsed.status || null,
      timestamp: parsed.timestamp || null,
    });
    await recordWhatsAppWebhookEvent(eventId, {
      phoneNumberId,
      eventType: `status:${parsed.status || "unknown"}`,
      status: "processed",
    });
    if (parsed.messageId && parsed.status) {
      await patchWhatsAppDeliveryStatus(String(parsed.messageId), String(parsed.status));
    }
    return { ok: true, kind: "status" };
  }

  if (parsed.kind !== "message") {
    return { ok: true, skipped: true, reason: parsed.kind || "ignored" };
  }

  whatsappLog("whatsapp.message.received", {
    phoneNumberId,
    waId: parsed.waId ? String(parsed.waId).slice(0, 12) : null,
    profileName: parsed.profileName || null,
    messageId: parsed.messageId ? String(parsed.messageId).slice(0, 20) : null,
    messageType: parsed.messageType || "text",
    textLength: String(parsed.text || "").length,
    timestamp: parsed.timestamp || null,
  });

  const dup = await recordWhatsAppWebhookEvent(eventId, {
    phoneNumberId,
    eventType: "message",
    payloadHash: crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("hex").slice(0, 32),
  });
  if (dup.duplicate) {
    return { ok: true, skipped: true, reason: "duplicate" };
  }

  const mapping = await lookupWhatsAppClinicMapping(phoneNumberId);
  const connectionRow = await getActiveWhatsAppConnectionByPhoneNumberId(phoneNumberId);

  console.log({
    pageId: phoneNumberId,
    phoneNumberId,
    matchedClinicId: connectionRow?.clinic_id || mapping.matchedClinicId || null,
    matchedClinicName: mapping.matchedClinicName || null,
    matchedClinicCode: mapping.matchedClinicCode || null,
    connectionSource: connectionRow?.source || mapping.connectionSource || null,
  });

  if (!connectionRow?.clinic_id) {
    console.warn("[whatsappInbound] unknown phone_number_id", {
      phoneNumberId,
      mapping,
      hint: "Set WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_CLINIC_ID or insert whatsapp_phone_connections row",
    });
    return { ok: false, error: "phone_not_connected" };
  }

  if (!String(parsed.text || "").trim()) {
    return { ok: true, skipped: true, reason: "empty_body" };
  }

  try {
    return await handleInboundWhatsAppMessage(parsed, connectionRow);
  } catch (e) {
    await supabase
      .from("meta_webhook_events")
      .update({ status: "failed", error: String(e?.message || e).slice(0, 500) })
      .eq("event_id", eventId)
      .catch(() => {});
    throw e;
  }
}

module.exports = {
  setupWhatsAppInbound,
  processWhatsAppWebhookEvent,
  touchLeadProfileFromWhatsApp,
  whatsappLog,
};
