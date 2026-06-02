/**
 * WhatsApp connection metadata, health, stats, and observability (stored in metadata jsonb).
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { probeWhatsAppPhoneNumberId, logWhatsAppVerify } = require("./whatsappGraph");
const { accessTokenFromConnectionRow } = require("./whatsappPhoneConnections");
const { getClinicLabel } = require("./clinicLookup");
const { getClinicAiProfile } = require("../clinicAiSettings");
const { buildClinicPolicySummary } = require("../aiDelegation");
const { whatsappAccessToken } = require("./whatsappConfig");
const {
  resolveWhatsAppOperationalStatus,
  connectionAiMode,
  connectionAiModeLabel,
  connectionAllowsWhatsAppAutoAi,
  formatRelativeTime,
} = require("./whatsappRouting");

const WEBHOOK_ACTIVE_MS = 24 * 60 * 60 * 1000;
const TOKEN_PROBE_TTL_MS = 6 * 60 * 60 * 1000;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(/** @type {Record<string, unknown>} */ (out[k]), v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function todayUtcKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string} phoneNumberId
 */
async function loadConnectionRowByPhoneNumberId(phoneNumberId) {
  if (!isSupabaseEnabled()) return null;
  const pid = String(phoneNumberId || "").trim();
  if (!pid) return null;
  const { data } = await supabase
    .from("whatsapp_phone_connections")
    .select("id, clinic_id, phone_number_id, phone_number, display_name, waba_id, status, is_enabled, ai_mode, last_webhook_at, metadata, access_token_enc")
    .eq("phone_number_id", pid)
    .maybeSingle();
  return data || null;
}

/**
 * @param {string} phoneNumberId
 * @param {Record<string, unknown>} patch
 */
async function mergeWhatsAppConnectionMetadata(phoneNumberId, patch) {
  const row = await loadConnectionRowByPhoneNumberId(phoneNumberId);
  if (!row?.id) return { ok: false, error: "connection_not_found" };

  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  const nextMeta = deepMerge(prevMeta, patch);
  const nowIso = new Date().toISOString();

  const columnPatch = {
    metadata: nextMeta,
    updated_at: nowIso,
  };

  if (patch.display_name && !row.display_name) {
    columnPatch.display_name = String(patch.display_name);
  }
  if (patch.waba_id && !row.waba_id) {
    columnPatch.waba_id = String(patch.waba_id);
  }
  if (patch.phone_number && !row.phone_number) {
    columnPatch.phone_number = String(patch.phone_number);
  }

  const { error } = await supabase
    .from("whatsapp_phone_connections")
    .update(columnPatch)
    .eq("id", row.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true, metadata: nextMeta };
}

/**
 * Apply webhook field hints (WABA, display phone, verified name).
 * @param {string} phoneNumberId
 * @param {Record<string, unknown>} parsed
 */
async function applyWhatsAppWebhookMetadataHints(phoneNumberId, parsed) {
  const pid = String(phoneNumberId || "").trim();
  if (!pid) return;

  const row = await loadConnectionRowByPhoneNumberId(pid);
  if (!row?.id || String(row.status) !== "active") return;

  const nowIso = new Date().toISOString();
  const columnPatch = {
    last_webhook_at: nowIso,
    updated_at: nowIso,
  };
  if (parsed.wabaId && !row.waba_id) columnPatch.waba_id = String(parsed.wabaId);
  if (parsed.displayPhoneNumber && !row.phone_number) {
    columnPatch.phone_number = String(parsed.displayPhoneNumber);
  }
  if (parsed.profileName && !row.display_name) {
    columnPatch.display_name = String(parsed.profileName).slice(0, 120);
  }

  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  const obs = deepMerge(
    isPlainObject(prevMeta.observability) ? prevMeta.observability : {},
    {
      lastWebhookReceivedAt: nowIso,
      lastWebhookKind: parsed.kind || null,
      lastWebhookLatencyMs:
        parsed.timestamp != null
          ? Math.max(0, Date.now() - Number(parsed.timestamp) * 1000)
          : null,
    },
  );

  await supabase
    .from("whatsapp_phone_connections")
    .update({
      ...columnPatch,
      metadata: { ...prevMeta, observability: obs },
    })
    .eq("id", row.id);
}

/**
 * @param {string} phoneNumberId
 * @param {string} message
 */
async function recordWhatsAppWebhookError(phoneNumberId, message) {
  const nowIso = new Date().toISOString();
  await mergeWhatsAppConnectionMetadata(phoneNumberId, {
    observability: {
      lastWebhookErrorAt: nowIso,
      lastWebhookError: String(message || "").slice(0, 500),
    },
  });
}

/**
 * @param {string} phoneNumberId
 * @param {{ ok: boolean, error?: string, messageId?: string|null }} result
 */
async function recordWhatsAppSendResult(phoneNumberId, result) {
  const nowIso = new Date().toISOString();
  const obs = result.ok
    ? {
        lastOutboundSuccessAt: nowIso,
        lastSendErrorAt: null,
        lastSendError: null,
      }
    : {
        lastSendErrorAt: nowIso,
        lastSendError: String(result.error || "send_failed").slice(0, 500),
      };
  await mergeWhatsAppConnectionMetadata(phoneNumberId, { observability: obs });

  if (result.ok) {
    await bumpWhatsAppConnectionStats(phoneNumberId, { outbound: 1, outboundSuccess: 1 });
  } else {
    await bumpWhatsAppConnectionStats(phoneNumberId, { outbound: 1, outboundFailed: 1 });
  }
}

/**
 * @param {string} phoneNumberId
 * @param {Record<string, unknown>} testResult
 */
async function recordWhatsAppTestSend(phoneNumberId, testResult) {
  const nowIso = new Date().toISOString();
  await mergeWhatsAppConnectionMetadata(phoneNumberId, {
    lastTest: {
      ...testResult,
      at: nowIso,
    },
    observability: {
      lastTestAt: nowIso,
      lastTestStatus: testResult.deliveryStatus || (testResult.ok ? "sent" : "failed"),
      lastTestMessageId: testResult.messageId || null,
      lastTestLatencyMs: testResult.latencyMs ?? null,
    },
  });
}

/**
 * @param {string} phoneNumberId
 * @param {{ inbound?: number, outbound?: number, outboundSuccess?: number, outboundFailed?: number, aiReply?: number, delivered?: number, deliveryTotal?: number }} delta
 */
async function bumpWhatsAppConnectionStats(phoneNumberId, delta) {
  const row = await loadConnectionRowByPhoneNumberId(phoneNumberId);
  if (!row?.id) return;

  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  const day = todayUtcKey();
  const statsRoot = isPlainObject(prevMeta.stats) ? { ...prevMeta.stats } : {};
  const dayStats = isPlainObject(statsRoot[day]) ? { ...statsRoot[day] } : {};

  if (delta.inbound) dayStats.inbound = (Number(dayStats.inbound) || 0) + delta.inbound;
  if (delta.outbound) dayStats.outbound = (Number(dayStats.outbound) || 0) + delta.outbound;
  if (delta.outboundSuccess) {
    dayStats.outboundSuccess = (Number(dayStats.outboundSuccess) || 0) + delta.outboundSuccess;
  }
  if (delta.outboundFailed) {
    dayStats.outboundFailed = (Number(dayStats.outboundFailed) || 0) + delta.outboundFailed;
  }
  if (delta.aiReply) dayStats.aiReply = (Number(dayStats.aiReply) || 0) + delta.aiReply;
  if (delta.delivered) dayStats.delivered = (Number(dayStats.delivered) || 0) + delta.delivered;
  if (delta.deliveryTotal) {
    dayStats.deliveryTotal = (Number(dayStats.deliveryTotal) || 0) + delta.deliveryTotal;
  }

  statsRoot[day] = dayStats;
  statsRoot.lastInboundAt = delta.inbound
    ? new Date().toISOString()
    : statsRoot.lastInboundAt || null;

  await supabase
    .from("whatsapp_phone_connections")
    .update({
      metadata: { ...prevMeta, stats: statsRoot },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

/**
 * @param {string} phoneNumberId
 * @param {string} status
 */
async function recordWhatsAppDeliveryStatus(phoneNumberId, status) {
  const s = String(status || "").toLowerCase();
  if (!["delivered", "read", "sent"].includes(s)) return;
  const delivered = s === "delivered" || s === "read";
  await bumpWhatsAppConnectionStats(phoneNumberId, {
    deliveryTotal: 1,
    delivered: delivered ? 1 : 0,
  });
}

/**
 * Graph API backfill for display name / phone / quality.
 * @param {string} phoneNumberId
 * @param {string} [accessToken]
 */
async function enrichWhatsAppConnectionFromGraph(phoneNumberId, accessToken) {
  const row = await loadConnectionRowByPhoneNumberId(phoneNumberId);
  if (!row) return { ok: false, error: "connection_not_found" };

  const token =
    String(accessToken || "").trim() ||
    accessTokenFromConnectionRow(row) ||
    whatsappAccessToken() ||
    "";

  const probe = await probeWhatsAppPhoneNumberId(phoneNumberId, token);
  const nowIso = new Date().toISOString();
  const observability = {
    lastTokenProbeAt: nowIso,
    tokenValid: probe.ok === true,
    tokenProbeError: probe.ok ? null : String(probe.error || "probe_failed").slice(0, 300),
    tokenProbeCode: probe.code || null,
  };

  const columnPatch = { updated_at: nowIso };
  const data = probe.data || {};
  if (probe.ok) {
    if (data.verified_name && !row.display_name) {
      columnPatch.display_name = String(data.verified_name).slice(0, 120);
    }
    if (data.display_phone_number && !row.phone_number) {
      columnPatch.phone_number = String(data.display_phone_number);
    }
  }

  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  const nextMeta = {
    ...prevMeta,
    observability: deepMerge(
      isPlainObject(prevMeta.observability) ? prevMeta.observability : {},
      observability,
    ),
    graphProfile: probe.ok
      ? {
          id: data.id || null,
          verified_name: data.verified_name || null,
          display_phone_number: data.display_phone_number || null,
          quality_rating: data.quality_rating || null,
          fetchedAt: nowIso,
        }
      : prevMeta.graphProfile || null,
  };

  await supabase
    .from("whatsapp_phone_connections")
    .update({ ...columnPatch, metadata: nextMeta })
    .eq("id", row.id);

  return { ok: probe.ok, probe, displayName: columnPatch.display_name || row.display_name };
}

/**
 * Query channel messages for today's stats (supplements metadata counters).
 * @param {string} clinicId
 * @param {string} phoneNumberId
 */
async function queryWhatsAppMessageStats(clinicId, phoneNumberId) {
  if (!isSupabaseEnabled()) {
    return {
      messagesToday: 0,
      inbound: 0,
      outbound: 0,
      deliverySuccessRate: null,
      aiReplyCount: 0,
    };
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const sinceIso = startOfDay.toISOString();

  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id")
    .eq("clinic_id", clinicId);

  const profileIds = (profiles || []).map((p) => p.id).filter(Boolean);
  if (!profileIds.length) {
    return {
      messagesToday: 0,
      inbound: 0,
      outbound: 0,
      deliverySuccessRate: null,
      aiReplyCount: 0,
    };
  }

  const { data: rows, error } = await supabase
    .from("ai_coordinator_channel_messages")
    .select("direction, message_role, metadata, created_at")
    .eq("channel", "whatsapp")
    .in("profile_id", profileIds)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn("[whatsappConnectionOps] stats query:", error.message);
    return null;
  }

  const pid = String(phoneNumberId || "").trim();
  let inbound = 0;
  let outbound = 0;
  let delivered = 0;
  let deliveryTotal = 0;
  let aiReply = 0;

  for (const row of rows || []) {
    const meta =
      row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    if (pid && meta.phone_number_id && String(meta.phone_number_id) !== pid) continue;

    if (row.direction === "inbound") inbound += 1;
    if (row.direction === "outbound") outbound += 1;
    if (
      row.direction === "outbound" &&
      ["assistant", "ai", "coordinator_ai"].includes(String(row.message_role || ""))
    ) {
      aiReply += 1;
    }
    const ds = String(meta.delivery_status || "").toLowerCase();
    if (ds) {
      deliveryTotal += 1;
      if (ds === "delivered" || ds === "read") delivered += 1;
    }
  }

  const messagesToday = inbound + outbound;
  const deliverySuccessRate =
    deliveryTotal > 0 ? Math.round((delivered / deliveryTotal) * 100) : null;

  return {
    messagesToday,
    inbound,
    outbound,
    deliverySuccessRate,
    aiReplyCount: aiReply,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ clinicPolicy?: Record<string, unknown>, stats?: Record<string, unknown>|null, tokenProbe?: { ok?: boolean } }} [ctx]
 */
function buildWhatsAppConnectionDashboard(row, ctx = {}) {
  const meta =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const obs = isPlainObject(meta.observability) ? meta.observability : {};
  const statsRoot = isPlainObject(meta.stats) ? meta.stats : {};
  const day = todayUtcKey();
  const dayStats = isPlainObject(statsRoot[day]) ? statsRoot[day] : {};

  const now = Date.now();
  const webhookAt = row.last_webhook_at
    ? Date.parse(String(row.last_webhook_at))
    : obs.lastWebhookReceivedAt
      ? Date.parse(String(obs.lastWebhookReceivedAt))
      : 0;
  const webhookActive = Number.isFinite(webhookAt) && now - webhookAt < WEBHOOK_ACTIVE_MS;

  const tokenProbeAt = obs.lastTokenProbeAt ? Date.parse(String(obs.lastTokenProbeAt)) : 0;
  const tokenStale =
    !tokenProbeAt || now - tokenProbeAt > TOKEN_PROBE_TTL_MS;
  const tokenValid =
    ctx.tokenProbe?.ok !== undefined
      ? ctx.tokenProbe.ok === true
      : obs.tokenValid === true && !tokenStale;

  const operationalStatus = resolveWhatsAppOperationalStatus(row);
  const routingEnabled = operationalStatus === "active";
  const connMode = connectionAiMode(row);
  const connAutoAi = connectionAllowsWhatsAppAutoAi(row);
  const ceiling = ctx.clinicPolicy?.ceilingMode || "AI_ACTIVE";
  const clinicAiOk = ceiling !== "HUMAN_ONLY" && ceiling !== "ESCALATION_REQUIRED";
  const aiEnabled = routingEnabled && clinicAiOk && connAutoAi;

  const metaStats = {
    messagesToday:
      (Number(dayStats.inbound) || 0) + (Number(dayStats.outbound) || 0),
    inbound: Number(dayStats.inbound) || 0,
    outbound: Number(dayStats.outbound) || 0,
    outboundSuccess: Number(dayStats.outboundSuccess) || 0,
    failedSends: Number(dayStats.outboundFailed) || 0,
    aiReplyCount: Number(dayStats.aiReply) || 0,
    deliverySuccessRate:
      Number(dayStats.deliveryTotal) > 0
        ? Math.round(
            ((Number(dayStats.delivered) || 0) / Number(dayStats.deliveryTotal)) * 100,
          )
        : null,
  };

  const dbStats = ctx.stats || null;
  const stats = dbStats
    ? {
        messagesToday: Math.max(metaStats.messagesToday, dbStats.messagesToday || 0),
        inbound: Math.max(metaStats.inbound, dbStats.inbound || 0),
        outbound: Math.max(metaStats.outbound, dbStats.outbound || 0),
        aiReplyCount: Math.max(metaStats.aiReplyCount, dbStats.aiReplyCount || 0),
        deliverySuccessRate:
          dbStats.deliverySuccessRate != null
            ? dbStats.deliverySuccessRate
            : metaStats.deliverySuccessRate,
      }
    : metaStats;

  const lastInboundAt = statsRoot.lastInboundAt || obs.lastInboundMessageAt || null;
  const lastTest = isPlainObject(meta.lastTest) ? meta.lastTest : null;

  return {
    operationalStatus,
    routingEnabled,
    is_enabled: row.is_enabled !== false,
    ai_mode: connMode,
    aiModeLabel: connectionAiModeLabel(row),
    displayName: row.display_name || meta.graphProfile?.verified_name || null,
    wabaId: row.waba_id || null,
    phoneNumber: row.phone_number || meta.graphProfile?.display_phone_number || null,
    lastWebhookAt: row.last_webhook_at || obs.lastWebhookReceivedAt || null,
    health: {
      webhookActive,
      webhookStatusLabel: webhookActive ? "Webhook active" : "No recent webhook",
      lastMessageAgo: formatRelativeTime(lastInboundAt),
      tokenValid: tokenValid && !tokenStale,
      tokenStale,
      aiEnabled,
      aiStatusLabel: aiEnabled
        ? "AI replies enabled"
        : operationalStatus === "paused"
          ? "Paused — no AI or routing"
          : connectionAiModeLabel(row),
      lastInboundMessageAt: lastInboundAt,
      lastOutboundSuccessAt: obs.lastOutboundSuccessAt || null,
      lastOutboundAgo: formatRelativeTime(obs.lastOutboundSuccessAt),
    },
    lastTest,
    observability: {
      lastWebhookError: obs.lastWebhookError || null,
      lastWebhookErrorAt: obs.lastWebhookErrorAt || null,
      lastSendError: obs.lastSendError || null,
      lastSendErrorAt: obs.lastSendErrorAt || null,
      lastWebhookLatencyMs: obs.lastWebhookLatencyMs ?? null,
      tokenExpiryWarning: tokenStale && obs.tokenValid !== true,
      lastTokenProbeAt: obs.lastTokenProbeAt || null,
    },
    stats,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
async function enrichConnectionForAdminList(row) {
  const clinicId = String(row.clinic_id || "").trim();
  const phoneNumberId = String(row.phone_number_id || "").trim();
  const clinicProfile = clinicId ? await getClinicAiProfile(clinicId) : null;
  const clinicPolicy = clinicProfile
    ? buildClinicPolicySummary(clinicProfile)
    : { ceilingMode: "AI_ACTIVE" };

  let tokenProbe = null;
  const meta =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const obs = isPlainObject(meta.observability) ? meta.observability : {};
  const probeAt = obs.lastTokenProbeAt ? Date.parse(String(obs.lastTokenProbeAt)) : 0;
  if (!probeAt || Date.now() - probeAt > TOKEN_PROBE_TTL_MS) {
    tokenProbe = await enrichWhatsAppConnectionFromGraph(
      phoneNumberId,
      accessTokenFromConnectionRow(row),
    );
  }

  const freshRow = (await loadConnectionRowByPhoneNumberId(phoneNumberId)) || row;
  const dbStats = await queryWhatsAppMessageStats(clinicId, phoneNumberId);

  const dashboard = buildWhatsAppConnectionDashboard(freshRow, {
    clinicPolicy,
    stats: dbStats,
    tokenProbe: tokenProbe ? { ok: tokenProbe.ok } : { ok: obs.tokenValid === true },
  });

  return {
    ...freshRow,
    ...dashboard,
    clinicPolicy,
  };
}

const PHONE_NUMBER_ID_RE = /^\d{10,20}$/;

/**
 * Validate a Meta phone_number_id and return a clinic-friendly preview (no DB write).
 * @param {string} phoneNumberId
 * @param {{ accessToken?: string, wabaId?: string|null, clinicId?: string }} [opts]
 */
async function previewWhatsAppConnectionForAdmin(phoneNumberId, opts = {}) {
  const pid = String(phoneNumberId || "").trim();
  if (!PHONE_NUMBER_ID_RE.test(pid)) {
    return {
      ok: false,
      error: "invalid_format",
      message:
        "That does not look like a valid WhatsApp Business Number ID. In Meta WhatsApp Manager, open API setup and copy the numeric Phone number ID (digits only, often 15 characters).",
    };
  }

  const token = String(opts.accessToken || whatsappAccessToken() || "").trim();
  const tokenSource = opts.accessToken
    ? "request_body"
    : whatsappAccessToken()
      ? "WHATSAPP_ACCESS_TOKEN_env"
      : "missing";

  logWhatsAppVerify({
    phase: "admin_preview_start",
    phoneNumberId: pid,
    tokenSource,
    clinicId: opts.clinicId || null,
    wabaId: opts.wabaId || null,
  });

  if (!token) {
    return {
      ok: false,
      error: "token_missing",
      message:
        "Clinifly cannot reach Meta yet — ask support to configure the clinic WhatsApp access token on the server.",
    };
  }

  const probe = await probeWhatsAppPhoneNumberId(pid, token, { tokenSource });
  if (!probe.ok) {
    return {
      ok: false,
      error: "graph_validation_failed",
      message:
        probe.error ||
        "Meta could not verify this number with your access token. Check that the ID is correct and that your Meta app owns this WhatsApp number.",
      code: probe.code,
      fbtrace_id: probe.fbtrace_id,
      likelyCause: probe.likelyCause || null,
      verify: {
        phoneNumberId: pid,
        graphUrl: probe.requestUrl,
        graphApiVersion: probe.graphApiVersion,
        tokenSource,
        tokenBusinessId: probe.tokenBusinessId || null,
        tokenBusinessIds: probe.tokenBusinessIds || [],
        responseStatus: probe.responseStatus ?? null,
        responseBody: probe.payload || { error: probe.error, code: probe.code },
      },
    };
  }

  const data = probe.data || {};
  const wabaFromRequest = String(opts.wabaId || "").trim() || null;

  /** @type {Record<string, unknown>|null} */
  let conflict = null;
  if (isSupabaseEnabled()) {
    const { data: existing } = await supabase
      .from("whatsapp_phone_connections")
      .select("id, clinic_id, status, is_enabled")
      .eq("phone_number_id", pid)
      .maybeSingle();
    if (existing?.clinic_id) {
      const clinic = await getClinicLabel(String(existing.clinic_id));
      const sameClinic =
        opts.clinicId && String(existing.clinic_id) === String(opts.clinicId);
      conflict = {
        connectionId: existing.id,
        clinicId: existing.clinic_id,
        clinicName: clinic.clinicName,
        status: existing.status,
        isEnabled: existing.is_enabled !== false,
        sameClinic,
      };
    }
  }

  return {
    ok: true,
    preview: {
      phoneNumberId: pid,
      displayName: data.verified_name || null,
      phoneNumber: data.display_phone_number || null,
      wabaId: wabaFromRequest,
      wabaAutoDetected: !wabaFromRequest,
      tokenValid: true,
      qualityRating: data.quality_rating || null,
      platformType: data.platform_type || null,
      conflict,
      technical: {
        phoneNumberId: pid,
        wabaId: wabaFromRequest,
        graphId: data.id || pid,
      },
    },
  };
}

module.exports = {
  applyWhatsAppWebhookMetadataHints,
  enrichWhatsAppConnectionFromGraph,
  mergeWhatsAppConnectionMetadata,
  recordWhatsAppWebhookError,
  recordWhatsAppSendResult,
  recordWhatsAppTestSend,
  bumpWhatsAppConnectionStats,
  recordWhatsAppDeliveryStatus,
  buildWhatsAppConnectionDashboard,
  enrichConnectionForAdminList,
  queryWhatsAppMessageStats,
  previewWhatsAppConnectionForAdmin,
};
