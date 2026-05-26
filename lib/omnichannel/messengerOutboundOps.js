/**
 * Messenger outbound delivery state machine + audit persistence.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { redactGraphPayload } = require("./metaDebug");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @readonly */
const DELIVERY_STATUS = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  ACCEPTED_BY_META: "accepted_by_meta",
  DELIVERED: "delivered",
  FAILED: "failed",
});

/**
 * @param {string} raw
 */
function looksLikeInternalPatientId(raw) {
  const s = String(raw || "").trim();
  if (!s) return { invalid: true, reason: "psid_empty" };
  if (UUID_RE.test(s)) {
    return {
      invalid: true,
      reason: "psid_is_internal_uuid",
      hint: "recipient.id must be Messenger PSID — not Clinifly patient UUID",
    };
  }
  if (/^(MSG_|WA_|PAT_|patient_)/i.test(s)) {
    return {
      invalid: true,
      reason: "psid_is_legacy_patient_code",
      hint: "Use Page-Scoped ID from webhook messaging.sender.id",
    };
  }
  return { invalid: false };
}

/**
 * @param {Record<string, unknown>} params
 */
async function createOutboundDeliveryRow(params) {
  if (!isSupabaseEnabled()) return { id: null, error: null };
  const now = new Date().toISOString();
  const row = {
    clinic_id: params.clinicId,
    patient_id: params.patientId || null,
    profile_id: params.profileId || null,
    channel_message_id: params.channelMessageId || null,
    patient_message_id: params.patientMessageId || null,
    transport: String(params.transport || "messenger"),
    page_id: params.pageId || null,
    recipient_psid: params.recipientPsid || null,
    graph_endpoint: params.graphEndpoint || null,
    graph_api_url: params.graphApiUrl || null,
    http_status: params.httpStatus ?? null,
    graph_response: redactGraphPayload(params.graphResponse || {}),
    external_message_id: params.externalMessageId || null,
    token_source: params.tokenSource || null,
    delivery_status: params.deliveryStatus || DELIVERY_STATUS.QUEUED,
    error_code: params.errorCode ?? null,
    error_subcode: params.errorSubcode ?? null,
    error_message: params.errorMessage ? String(params.errorMessage).slice(0, 2000) : null,
    attempt_count: Number(params.attemptCount) > 0 ? Number(params.attemptCount) : 1,
    last_delivery_attempt_at: params.lastDeliveryAttemptAt || now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from("omnichannel_outbound_deliveries")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    console.warn("[messengerOutboundOps] insert audit:", error.message);
    return { id: null, error };
  }
  return { id: data?.id ? String(data.id) : null, error: null };
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
async function patchOutboundDeliveryRow(id, patch) {
  if (!isSupabaseEnabled() || !id) return;
  const now = new Date().toISOString();
  const row = {
    ...patch,
    updated_at: now,
    last_delivery_attempt_at: patch.lastDeliveryAttemptAt || now,
  };
  if (patch.graphResponse) {
    row.graph_response = redactGraphPayload(patch.graphResponse);
  }
  const { error } = await supabase.from("omnichannel_outbound_deliveries").update(row).eq("id", id);
  if (error) console.warn("[messengerOutboundOps] patch audit:", error.message);
}

/**
 * @param {string} externalMessageId
 * @param {string} status
 */
async function patchOutboundDeliveryByExternalMid(externalMessageId, status) {
  if (!isSupabaseEnabled() || !externalMessageId) return;
  const mid = String(externalMessageId).trim();
  const { data: rows, error } = await supabase
    .from("omnichannel_outbound_deliveries")
    .update({
      delivery_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("external_message_id", mid)
    .select("patient_message_id");
  if (error) {
    console.warn("[messengerOutboundOps] patch by mid:", error.message);
    return;
  }
  const patientMessageId = rows?.[0]?.patient_message_id
    ? String(rows[0].patient_message_id)
    : null;
  if (patientMessageId) {
    void patchPatientMessageTransport(patientMessageId, {
      transport: "messenger",
      externalMessageId: mid,
      deliveryStatus: status,
    });
  }
}

/**
 * @param {string} patientMessageId
 * @param {Record<string, unknown>} transportMeta
 */
async function patchPatientMessageTransport(patientMessageId, transportMeta) {
  if (!isSupabaseEnabled() || !patientMessageId) return;
  const msgId = String(patientMessageId).trim();
  const meta = {
    transport: transportMeta.transport || "messenger",
    external_message_id: transportMeta.externalMessageId || null,
    delivery_status: transportMeta.deliveryStatus || null,
    last_delivery_attempt_at: transportMeta.lastDeliveryAttemptAt || new Date().toISOString(),
    delivery_error: transportMeta.deliveryError || null,
    outbound_delivery_id: transportMeta.outboundDeliveryId || null,
  };
  const { data: rows } = await supabase
    .from("patient_messages")
    .select("id, metadata, message_id")
    .or(`message_id.eq.${msgId},id.eq.${msgId}`)
    .limit(3);
  for (const row of rows || []) {
    const existing =
      row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    const { error } = await supabase
      .from("patient_messages")
      .update({ metadata: { ...existing, omnichannel: { ...existing.omnichannel, ...meta } } })
      .eq("id", row.id);
    if (error && !String(error.message || "").toLowerCase().includes("metadata")) {
      console.warn("[messengerOutboundOps] patient_messages transport patch:", error.message);
    }
  }
}

/**
 * Structured console diagnostics for every outbound attempt.
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
function logMessengerOutbound(event, fields) {
  console.log(
    `[messenger.outbound.${event}]`,
    JSON.stringify({
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

/**
 * @param {unknown} err
 */
function graphErrorFields(err) {
  const payload = err?.payload?.error || err?.payload || {};
  return {
    errorCode: err?.code ?? payload?.code ?? null,
    errorSubcode: err?.error_subcode ?? payload?.error_subcode ?? null,
    errorMessage: err?.message || payload?.message || String(err || ""),
    httpStatus: err?.status ?? null,
    graphResponse: redactGraphPayload(err?.payload || { message: err?.message }),
  };
}

module.exports = {
  DELIVERY_STATUS,
  UUID_RE,
  looksLikeInternalPatientId,
  createOutboundDeliveryRow,
  patchOutboundDeliveryRow,
  patchOutboundDeliveryByExternalMid,
  patchPatientMessageTransport,
  logMessengerOutbound,
  graphErrorFields,
};
