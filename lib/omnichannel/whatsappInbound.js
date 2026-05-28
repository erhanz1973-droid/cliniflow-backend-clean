/**
 * Process inbound WhatsApp Cloud API webhook events.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { insertChannelMessagesWithChannel } = require("../coordinatorChannelPersistence");
const {
  getWhatsAppConnectionByPhoneNumberId,
  getActiveWhatsAppConnectionByPhoneNumberId,
  lookupWhatsAppClinicMapping,
  setWhatsAppConnectionAiMode,
} = require("./whatsappPhoneConnections");
const { logOmnichannelConnectionAudit } = require("./omnichannelAudit");
const {
  isWhatsAppRoutingEnabled,
  connectionAllowsWhatsAppAutoAi,
  connectionAiMode,
} = require("./whatsappRouting");
const { AI_MODE } = require("../aiDelegation");
const { COORDINATION_AI } = require("../aiCoordinatorCoordination");
const { getClinicAiProfile } = require("../clinicAiSettings");
const { normalizeAiRepliesConfig, REPLY_MODE } = require("../aiReplyOrchestration");
const {
  applyWhatsAppWebhookMetadataHints,
  bumpWhatsAppConnectionStats,
  recordWhatsAppDeliveryStatus,
  recordWhatsAppWebhookError,
} = require("./whatsappConnectionOps");
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
 * Clinic wants omnichannel AI but number may still be AI_DRAFT — promote so Serap gets auto-replies.
 * @param {Record<string, unknown>} connectionRow
 * @param {string} clinicId
 * @param {string} phoneNumberId
 */
async function resolveWhatsAppInboundAiDispatch(connectionRow, clinicId, phoneNumberId) {
  if (connectionAllowsWhatsAppAutoAi(connectionRow)) {
    return { dispatch: true, connectionRow, reason: "connection_ai_ready" };
  }

  const mode = connectionAiMode(connectionRow);
  if (mode === AI_MODE.HUMAN_ONLY || mode === AI_MODE.ESCALATION_REQUIRED) {
    return { dispatch: false, connectionRow, reason: mode };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const cfg = normalizeAiRepliesConfig(clinicProfile.communicationPolicy);
  if (cfg.replyMode === REPLY_MODE.HUMAN_ONLY || cfg.instantEnabled === false) {
    return { dispatch: false, connectionRow, reason: "clinic_ai_disabled" };
  }

  if (connectionRow.id && mode === AI_MODE.AI_DRAFT) {
    const healed = await setWhatsAppConnectionAiMode(
      String(connectionRow.id),
      "AI_ACTIVE",
      "inbound_whatsapp_clinic_ai_heal",
    );
    if (healed.ok) {
      const fresh =
        (await getActiveWhatsAppConnectionByPhoneNumberId(phoneNumberId)) ||
        (await getWhatsAppConnectionByPhoneNumberId(phoneNumberId));
      whatsappLog("whatsapp.pipeline.ai_mode_healed", {
        connectionId: String(connectionRow.id).slice(0, 8),
        from: "AI_DRAFT",
        to: "AI_ACTIVE",
        clinicReplyMode: cfg.replyMode,
      });
      return {
        dispatch: true,
        connectionRow: fresh || { ...connectionRow, ai_mode: "AI_ACTIVE" },
        reason: "healed_ai_draft",
      };
    }
  }

  return { dispatch: false, connectionRow, reason: "connection_ai_mode", aiMode: mode };
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
async function handleInboundWhatsAppMessage(parsed, connectionRowIn) {
  let connectionRow = connectionRowIn;
  const clinicId = String(connectionRow.clinic_id || "").trim();
  const waId = String(parsed.waId || "").trim();
  const phoneNumberId = String(parsed.phoneNumberId || "").trim();
  const messageId = String(parsed.messageId || "").trim();
  let text = String(parsed.text || "").trim();
  if (!text) {
    const mt = String(parsed.messageType || "attachment").trim();
    text = mt && mt !== "text" ? `[${mt}]` : "[message]";
  }

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

  await touchLeadProfileFromWhatsApp(identity.patientId, clinicId, text, identity.profileId, {
    phoneNumberId,
    waId,
  });

  const { mirrorOmnichannelInboundToPatientMessages } = require("../mirrorOmnichannelPatientMessage");
  const mirror = await mirrorOmnichannelInboundToPatientMessages({
    patientId: identity.patientId,
    clinicId,
    text,
    channel: "whatsapp",
    externalMessageId: messageId || null,
  });
  if (!mirror.ok && !mirror.skipped) {
    console.warn("[whatsappInbound] patient_messages mirror:", mirror.error || mirror.reason);
  }

  const aiDispatch = await resolveWhatsAppInboundAiDispatch(
    connectionRow,
    clinicId,
    phoneNumberId,
  );
  connectionRow = aiDispatch.connectionRow;

  if (afterPatientInboundMessageFn && aiDispatch.dispatch) {
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
      externalMessageId: messageId || null,
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
  } else if (!aiDispatch.dispatch) {
    whatsappLog("whatsapp.pipeline.ai_skipped", {
      reason: aiDispatch.reason || "connection_ai_mode",
      aiMode: connectionRow.ai_mode || aiDispatch.aiMode || null,
      hint:
        aiDispatch.reason === "clinic_ai_disabled"
          ? "Settings → AI Communication: enable instant AI and not human-only mode"
          : "WhatsApp → Communication Channels: set AI mode to «AI active»; or release human takeover on the lead",
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
async function touchLeadProfileFromWhatsApp(patientId, clinicId, message, profileId, channelHints = {}) {
  const { touchLeadProfileFromInbound } = require("../aiSlaContinuity");
  const {
    isRoutineDentalChiefComplaint,
    detectMedicalEmergency,
  } = require("../aiDelegation");
  const id = await touchLeadProfileFromInbound(patientId, clinicId, message);
  const pid = profileId || id;
  if (!pid || !isSupabaseEnabled()) return pid;

  const phoneNumberId = String(channelHints.phoneNumberId || "").trim();
  const waId = String(channelHints.waId || "").trim().replace(/\D/g, "");
  const channelMetadata = {};
  if (phoneNumberId) channelMetadata.whatsapp_phone_number_id = phoneNumberId;
  if (waId) channelMetadata.whatsapp_wa_id = waId;

  const nowIso = new Date().toISOString();
  const patch = {
    primary_channel: "whatsapp",
    source: "whatsapp",
    updated_at: nowIso,
  };

  const msg = String(message || "").trim();
  const emergency = msg ? detectMedicalEmergency(msg) : false;
  const { data: leadRow } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("ai_mode, ai_paused, ai_escalation_required, human_takeover_at")
    .eq("id", pid)
    .maybeSingle();
  const takeoverMs = leadRow?.human_takeover_at
    ? new Date(String(leadRow.human_takeover_at)).getTime()
    : 0;
  const recentHumanTakeover =
    leadRow?.ai_paused === true &&
    Number.isFinite(takeoverMs) &&
    takeoverMs > 0 &&
    Date.now() - takeoverMs < 30 * 60 * 1000;
  if (
    !emergency &&
    !recentHumanTakeover &&
    (isRoutineDentalChiefComplaint(msg) || msg.length > 0)
  ) {
    patch.ai_mode = "AI_ACTIVE";
    patch.ai_paused = false;
    patch.ai_escalation_required = false;
    patch.coordination_mode = COORDINATION_AI;
  }
  if (Object.keys(channelMetadata).length > 0) {
    const { data: row } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("channel_metadata, whatsapp_number")
      .eq("id", pid)
      .maybeSingle();
    const prev =
      row?.channel_metadata && typeof row.channel_metadata === "object"
        ? row.channel_metadata
        : {};
    patch.channel_metadata = { ...prev, ...channelMetadata };

    if (waId && !row?.whatsapp_number) {
      const { normalizeWhatsappNumber, persistWhatsappCollection } = require("../whatsappCollection");
      const normalized = normalizeWhatsappNumber(waId);
      if (normalized) {
        await persistWhatsappCollection(pid, {
          number: normalized,
          source: "whatsapp_inbound_wa_id",
        });
      }
    }
  }

  await supabase.from("ai_coordinator_lead_profiles").update(patch).eq("id", pid);

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
    if (phoneNumberId) {
      void applyWhatsAppWebhookMetadataHints(phoneNumberId, parsed);
      if (parsed.status) {
        void recordWhatsAppDeliveryStatus(phoneNumberId, String(parsed.status));
      }
    }
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
  const connectionRow = await getWhatsAppConnectionByPhoneNumberId(phoneNumberId);

  console.log({
    pageId: phoneNumberId,
    phoneNumberId,
    matchedClinicId: connectionRow?.clinic_id || mapping.matchedClinicId || null,
    matchedClinicName: mapping.matchedClinicName || null,
    matchedClinicCode: mapping.matchedClinicCode || null,
    connectionSource: connectionRow?.source || mapping.connectionSource || null,
    routingEnabled: connectionRow ? isWhatsAppRoutingEnabled(connectionRow) : false,
  });

  if (!connectionRow?.clinic_id) {
    console.warn("[whatsappInbound] unknown phone_number_id", {
      phoneNumberId,
      mapping,
      hint: "Add row in whatsapp_phone_connections (Settings → Communication Channels → WhatsApp)",
    });
    return { ok: false, error: "phone_not_connected" };
  }

  void applyWhatsAppWebhookMetadataHints(phoneNumberId, parsed);

  if (!isWhatsAppRoutingEnabled(connectionRow)) {
    await logOmnichannelConnectionAudit({
      channel: "whatsapp",
      eventType: "inbound_paused",
      connectionId: connectionRow.id,
      clinicId: connectionRow.clinic_id,
      externalId: phoneNumberId,
      metadata: {
        messageId: parsed.messageId || null,
        waId: parsed.waId ? String(parsed.waId).slice(0, 12) : null,
      },
    });
    whatsappLog("whatsapp.pipeline.paused", { phoneNumberId });
    return { ok: true, skipped: true, reason: "whatsapp_paused" };
  }

  void bumpWhatsAppConnectionStats(phoneNumberId, { inbound: 1 });

  if (!String(parsed.text || "").trim()) {
    const mt = String(parsed.messageType || "attachment").trim();
    parsed.text = mt && mt !== "text" ? `[${mt}]` : "[message]";
  }

  try {
    return await handleInboundWhatsAppMessage(parsed, connectionRow);
  } catch (e) {
    void recordWhatsAppWebhookError(phoneNumberId, e?.message || String(e));
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
  setupWhatsAppInbound,
  processWhatsAppWebhookEvent,
  touchLeadProfileFromWhatsApp,
  whatsappLog,
};
