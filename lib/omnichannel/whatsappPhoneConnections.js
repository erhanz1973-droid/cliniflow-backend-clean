/**
 * WhatsApp phone_number_id → clinic resolution and admin CRUD.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { getClinicLabel } = require("./clinicLookup");
const { encryptSecret, decryptSecret } = require("./tokenCrypto");
const { logOmnichannelConnectionAudit } = require("./omnichannelAudit");
const {
  whatsappPhoneNumberId,
  whatsappClinicId,
  whatsappAccessToken,
} = require("./whatsappConfig");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SELECT_ROW =
  "id, clinic_id, phone_number_id, phone_number, display_name, waba_id, status, is_enabled, ai_mode, connected_by, last_webhook_at, metadata, access_token_enc, created_at, updated_at";

const {
  isWhatsAppRoutingEnabled,
  resolveWhatsAppOperationalStatus,
} = require("./whatsappRouting");

/**
 * @param {Record<string, unknown>} row
 */
function accessTokenFromConnectionRow(row) {
  if (row?.access_token_enc) {
    try {
      return decryptSecret(String(row.access_token_enc));
    } catch (e) {
      console.warn("[whatsappPhoneConnections] decrypt token:", e?.message || e);
    }
  }
  return whatsappAccessToken() || null;
}

/**
 * Lookup by phone_number_id (active or paused — not disconnected).
 * @param {string} phoneNumberId
 */
async function getWhatsAppConnectionByPhoneNumberId(phoneNumberId) {
  const pid = String(phoneNumberId || "").trim();
  if (!pid || !isSupabaseEnabled()) return null;

  const { data, error } = await supabase
    .from("whatsapp_phone_connections")
    .select(SELECT_ROW)
    .eq("phone_number_id", pid)
    .neq("status", "disconnected")
    .maybeSingle();

  if (error) {
    console.warn("[whatsappPhoneConnections] lookup:", error.message);
    return null;
  }
  if (!data?.clinic_id) return null;

  return {
    ...data,
    accessToken: accessTokenFromConnectionRow(data),
    source: "database",
    operationalStatus: resolveWhatsAppOperationalStatus(data),
    routingEnabled: isWhatsAppRoutingEnabled(data),
  };
}

/**
 * Routing-enabled connection only (active + is_enabled).
 * @param {string} phoneNumberId
 */
async function getActiveWhatsAppConnectionByPhoneNumberId(phoneNumberId) {
  const pid = String(phoneNumberId || "").trim();
  if (!pid) return null;

  const row = await getWhatsAppConnectionByPhoneNumberId(pid);
  if (row) {
    return isWhatsAppRoutingEnabled(row) ? row : null;
  }

  if (!isSupabaseEnabled()) {
    // env fallback when Supabase off
  } else {
    return null;
  }

  const envPhone = whatsappPhoneNumberId();
  const envClinic = whatsappClinicId();
  if (envPhone && pid === envPhone && UUID_RE.test(envClinic)) {
    console.warn(
      "[whatsappPhoneConnections] env fallback for phone_number_id — add a row in whatsapp_phone_connections",
      { phoneNumberId: pid, clinicId: envClinic.slice(0, 8) },
    );
    const envRow = {
      id: null,
      clinic_id: envClinic,
      phone_number_id: pid,
      phone_number: null,
      display_name: null,
      waba_id: null,
      status: "active",
      is_enabled: true,
      ai_mode: "AI_ACTIVE",
      accessToken: whatsappAccessToken() || null,
      source: "env",
    };
    return {
      ...envRow,
      operationalStatus: "active",
      routingEnabled: true,
    };
  }

  return null;
}

/**
 * @param {string} phoneNumberId
 */
async function lookupWhatsAppClinicMapping(phoneNumberId) {
  const pid = String(phoneNumberId || "").trim();
  const row = await getWhatsAppConnectionByPhoneNumberId(pid);
  if (!row?.clinic_id) {
    return {
      phoneNumberId: pid,
      found: false,
      matchedClinicId: null,
      matchedClinicName: null,
      matchedClinicCode: null,
    };
  }
  const clinic = await getClinicLabel(String(row.clinic_id));
  return {
    phoneNumberId: pid,
    found: true,
    connectionSource: row.source || null,
    connectionId: row.id || null,
    matchedClinicId: clinic.clinicId,
    matchedClinicName: clinic.clinicName,
    matchedClinicCode: clinic.clinicCode,
    phoneNumber: row.phone_number || null,
    displayName: row.display_name || null,
    wabaId: row.waba_id || null,
    lastWebhookAt: row.last_webhook_at || null,
  };
}

/**
 * @param {string} clinicId
 */
async function listWhatsAppConnectionsForClinic(clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];
  const { data, error } = await supabase
    .from("whatsapp_phone_connections")
    .select(SELECT_ROW)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[whatsappPhoneConnections] list:", error.message);
    return [];
  }
  const rows = data || [];
  const enriched = [];
  for (const row of rows) {
    const clinic = await getClinicLabel(String(row.clinic_id));
    enriched.push({
      ...row,
      clinicName: clinic.clinicName,
      clinicCode: clinic.clinicCode,
      hasDedicatedToken: Boolean(row.access_token_enc),
      operationalStatus: resolveWhatsAppOperationalStatus(row),
      routingEnabled: isWhatsAppRoutingEnabled(row),
    });
  }
  return enriched;
}

/**
 * List all active connections (platform / diagnostics).
 */
async function listAllActiveWhatsAppConnections() {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase
    .from("whatsapp_phone_connections")
    .select(SELECT_ROW)
    .eq("status", "active")
    .eq("is_enabled", true)
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("[whatsappPhoneConnections] listAll:", error.message);
    return [];
  }
  const rows = data || [];
  const out = [];
  for (const row of rows) {
    const clinic = await getClinicLabel(String(row.clinic_id));
    out.push({
      ...row,
      clinicName: clinic.clinicName,
      clinicCode: clinic.clinicCode,
    });
  }
  return out;
}

/**
 * Embedded Signup / manual connect — upsert by unique phone_number_id.
 * @param {{
 *   clinicId: string,
 *   phoneNumberId: string,
 *   phoneNumber?: string|null,
 *   displayName?: string|null,
 *   wabaId?: string|null,
 *   accessToken?: string|null,
 *   connectedBy?: string|null,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function upsertWhatsAppPhoneConnection(params) {
  if (!isSupabaseEnabled() || !UUID_RE.test(params.clinicId)) {
    return { ok: false, error: "supabase_or_clinic_invalid" };
  }
  const phoneNumberId = String(params.phoneNumberId || "").trim();
  if (!phoneNumberId) return { ok: false, error: "phone_number_id_required" };

  const nowIso = new Date().toISOString();
  const row = {
    clinic_id: params.clinicId,
    phone_number_id: phoneNumberId,
    phone_number: params.phoneNumber || null,
    display_name: params.displayName || null,
    waba_id: params.wabaId || null,
    status: "active",
    is_enabled: params.isEnabled !== false,
    ai_mode: params.aiMode || "AI_ACTIVE",
    connected_by: params.connectedBy || null,
    updated_at: nowIso,
    metadata: {
      source: params.metadata?.embeddedSignup ? "embedded_signup" : "admin_connect",
      ...(params.metadata || {}),
    },
  };

  const { data: existing } = await supabase
    .from("whatsapp_phone_connections")
    .select("id, clinic_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (params.accessToken) {
    row.access_token_enc = encryptSecret(String(params.accessToken).trim());
  }

  let result;
  let eventType = "created";
  if (existing?.id) {
    eventType = existing.clinic_id !== params.clinicId ? "reassigned" : "updated";
    result = await supabase
      .from("whatsapp_phone_connections")
      .update(row)
      .eq("id", existing.id)
      .select("id, phone_number_id, clinic_id")
      .single();
  } else {
    result = await supabase
      .from("whatsapp_phone_connections")
      .insert({ ...row, created_at: nowIso })
      .select("id, phone_number_id, clinic_id")
      .single();
  }

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  if (params.accessToken) {
    await logOmnichannelConnectionAudit({
      channel: "whatsapp",
      eventType: "token_updated",
      connectionId: result.data?.id,
      clinicId: params.clinicId,
      externalId: phoneNumberId,
      actor: params.connectedBy || null,
    });
  }

  await logOmnichannelConnectionAudit({
    channel: "whatsapp",
    eventType: eventType === "created" ? "connected" : eventType,
    connectionId: result.data?.id,
    clinicId: params.clinicId,
    externalId: phoneNumberId,
    actor: params.connectedBy || null,
    metadata: { wabaId: params.wabaId || null, displayName: params.displayName || null },
  });

  if (params.isEnabled !== false) {
    await logOmnichannelConnectionAudit({
      channel: "whatsapp",
      eventType: "enabled",
      connectionId: result.data?.id,
      clinicId: params.clinicId,
      externalId: phoneNumberId,
      actor: params.connectedBy || null,
    });
  }

  return { ok: true, connection: result.data, eventType };
}

/**
 * Pause or resume routing without disconnecting the number.
 * @param {string} connectionId
 * @param {boolean} enabled
 * @param {string} [actor]
 */
async function setWhatsAppConnectionEnabled(connectionId, enabled, actor) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  const id = String(connectionId || "").trim();
  const { data: existing } = await supabase
    .from("whatsapp_phone_connections")
    .select("id, clinic_id, phone_number_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "connection_not_found" };
  if (String(existing.status) === "disconnected") {
    return { ok: false, error: "connection_disconnected" };
  }

  const { error } = await supabase
    .from("whatsapp_phone_connections")
    .update({
      is_enabled: enabled === true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await logOmnichannelConnectionAudit({
    channel: "whatsapp",
    eventType: enabled ? "enabled" : "disabled",
    connectionId: id,
    clinicId: existing.clinic_id,
    externalId: existing.phone_number_id,
    actor: actor || null,
  });

  return { ok: true, is_enabled: enabled === true };
}

/**
 * @param {string} connectionId
 * @param {string} aiMode
 * @param {string} [actor]
 */
/**
 * When clinic enables instant AI replies, promote WhatsApp numbers stuck on AI_DRAFT.
 * @param {string} clinicId
 * @param {string} [actor]
 */
async function syncWhatsAppConnectionsForInstantClinicAi(clinicId, actor = "clinic_instant_ai") {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return { updated: 0 };
  const rows = await listWhatsAppConnectionsForClinic(clinicId);
  let updated = 0;
  for (const row of rows) {
    const mode = String(row.ai_mode || "AI_ACTIVE").toUpperCase();
    if (mode !== "AI_DRAFT" || row.is_enabled === false) continue;
    const r = await setWhatsAppConnectionAiMode(String(row.id), "AI_ACTIVE", actor);
    if (r.ok) updated += 1;
  }
  if (updated > 0) {
    console.log("[whatsappPhoneConnections] synced AI_DRAFT → AI_ACTIVE for instant clinic AI", {
      clinicId: clinicId.slice(0, 8),
      updated,
    });
  }
  return { updated };
}

async function setWhatsAppConnectionAiMode(connectionId, aiMode, actor) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  const id = String(connectionId || "").trim();
  const mode = String(aiMode || "AI_ACTIVE")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  const allowed = new Set([
    "AI_ACTIVE",
    "HUMAN_ONLY",
    "AI_DRAFT",
    "AI_ASSISTED",
    "ESCALATION_REQUIRED",
  ]);
  if (!allowed.has(mode)) return { ok: false, error: "invalid_ai_mode" };

  const { data: existing } = await supabase
    .from("whatsapp_phone_connections")
    .select("id, clinic_id, phone_number_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "connection_not_found" };

  const { error } = await supabase
    .from("whatsapp_phone_connections")
    .update({ ai_mode: mode, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await logOmnichannelConnectionAudit({
    channel: "whatsapp",
    eventType: "ai_mode_updated",
    connectionId: id,
    clinicId: existing.clinic_id,
    externalId: existing.phone_number_id,
    actor: actor || null,
    metadata: { aiMode: mode },
  });

  return { ok: true, ai_mode: mode };
}

/**
 * @param {string} connectionId
 * @param {string} targetClinicId
 * @param {string} [actor]
 */
async function reassignWhatsAppConnection(connectionId, targetClinicId, actor) {
  if (!isSupabaseEnabled() || !UUID_RE.test(targetClinicId)) {
    return { ok: false, error: "invalid_params" };
  }
  const id = String(connectionId || "").trim();
  const { data: existing, error: fetchErr } = await supabase
    .from("whatsapp_phone_connections")
    .select("id, clinic_id, phone_number_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !existing) return { ok: false, error: "connection_not_found" };

  const fromClinicId = String(existing.clinic_id);
  const { error } = await supabase
    .from("whatsapp_phone_connections")
    .update({
      clinic_id: targetClinicId,
      updated_at: new Date().toISOString(),
      connected_by: actor || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await logOmnichannelConnectionAudit({
    channel: "whatsapp",
    eventType: "reassigned",
    connectionId: id,
    clinicId: targetClinicId,
    externalId: existing.phone_number_id,
    actor: actor || null,
    metadata: { fromClinicId, toClinicId: targetClinicId },
  });

  return { ok: true, phoneNumberId: existing.phone_number_id };
}

/**
 * @param {string} connectionId
 * @param {string} [actor]
 */
async function disconnectWhatsAppConnection(connectionId, actor) {
  if (!isSupabaseEnabled()) return { ok: false };
  const id = String(connectionId || "").trim();
  const { data: existing } = await supabase
    .from("whatsapp_phone_connections")
    .select("id, clinic_id, phone_number_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "connection_not_found" };

  const { error } = await supabase
    .from("whatsapp_phone_connections")
    .update({ status: "disconnected", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await logOmnichannelConnectionAudit({
    channel: "whatsapp",
    eventType: "disconnected",
    connectionId: id,
    clinicId: existing.clinic_id,
    externalId: existing.phone_number_id,
    actor: actor || null,
  });

  return { ok: true };
}

/**
 * @param {string} phoneNumberId
 */
async function touchWhatsAppConnectionWebhookAt(phoneNumberId) {
  if (!isSupabaseEnabled()) return;
  const pid = String(phoneNumberId || "").trim();
  if (!pid) return;
  await supabase
    .from("whatsapp_phone_connections")
    .update({ last_webhook_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("phone_number_id", pid)
    .eq("status", "active");
}

module.exports = {
  getWhatsAppConnectionByPhoneNumberId,
  getActiveWhatsAppConnectionByPhoneNumberId,
  lookupWhatsAppClinicMapping,
  listWhatsAppConnectionsForClinic,
  listAllActiveWhatsAppConnections,
  upsertWhatsAppPhoneConnection,
  reassignWhatsAppConnection,
  disconnectWhatsAppConnection,
  setWhatsAppConnectionEnabled,
  setWhatsAppConnectionAiMode,
  syncWhatsAppConnectionsForInstantClinicAi,
  touchWhatsAppConnectionWebhookAt,
  accessTokenFromConnectionRow,
  SELECT_ROW,
};
