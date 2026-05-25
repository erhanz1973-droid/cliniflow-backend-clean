/**
 * Persist and load Meta Page connections per clinic.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");
const { encryptSecret, decryptSecret } = require("./tokenCrypto");
const { subscribePageToApp } = require("./metaGraph");
const { metaTrace } = require("./metaDebug");
const { getClinicLabel } = require("./clinicLookup");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve Meta Page → clinic (any status). Used for webhook logs and admin lookup.
 * @param {string} pageId
 */
async function lookupPageClinicMapping(pageId) {
  const pid = String(pageId || "").trim();
  if (!pid || !isSupabaseEnabled()) {
    return {
      pageId: pid || null,
      found: false,
      matchedClinicId: null,
      matchedClinicName: null,
      matchedClinicCode: null,
    };
  }
  const { data: pageRow, error } = await supabase
    .from("meta_page_connections")
    .select("id, clinic_id, page_id, page_name, status, connected_by, created_at, updated_at")
    .eq("page_id", pid)
    .maybeSingle();
  if (error) {
    console.warn("[metaPageConnections] mapping lookup:", error.message);
    return {
      pageId: pid,
      found: false,
      lookupError: error.message,
      matchedClinicId: null,
      matchedClinicName: null,
      matchedClinicCode: null,
    };
  }
  if (!pageRow?.clinic_id) {
    return {
      pageId: pid,
      found: false,
      matchedClinicId: null,
      matchedClinicName: null,
      matchedClinicCode: null,
    };
  }
  const clinic = await getClinicLabel(String(pageRow.clinic_id));
  return {
    pageId: pid,
    found: true,
    connectionId: pageRow.id ? String(pageRow.id) : null,
    connectionStatus: pageRow.status || null,
    pageName: pageRow.page_name || null,
    connectedBy: pageRow.connected_by || null,
    matchedClinicId: clinic.clinicId,
    matchedClinicName: clinic.clinicName,
    matchedClinicCode: clinic.clinicCode,
  };
}

/**
 * @param {string} pageId
 */
async function getActivePageConnectionByPageId(pageId) {
  if (!isSupabaseEnabled()) return null;
  const pid = String(pageId || "").trim();
  if (!pid) return null;
  const { data, error } = await supabase
    .from("meta_page_connections")
    .select(
      "id, clinic_id, page_id, page_name, page_access_token_enc, token_expires_at, webhook_subscribed, status, metadata",
    )
    .eq("page_id", pid)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.warn("[metaPageConnections] lookup:", error.message);
    return null;
  }
  return data || null;
}

/**
 * @param {string} clinicId
 */
async function listPageConnectionsForClinic(clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];
  const { data, error } = await supabase
    .from("meta_page_connections")
    .select("id, clinic_id, page_id, page_name, webhook_subscribed, status, token_expires_at, created_at, updated_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[metaPageConnections] list:", error.message);
    return [];
  }
  return data || [];
}

/**
 * @param {Record<string, unknown>} row
 */
function pageAccessTokenFromRow(row) {
  if (!row?.page_access_token_enc) return null;
  try {
    return decryptSecret(String(row.page_access_token_enc));
  } catch (e) {
    console.warn("[metaPageConnections] decrypt:", e?.message || e);
    return null;
  }
}

/**
 * @param {{
 *   clinicId: string,
 *   pageId: string,
 *   pageName?: string,
 *   pageAccessToken: string,
 *   connectedBy?: string,
 *   tokenExpiresAt?: string|null,
 *   subscribeWebhook?: boolean,
 * }} params
 */
async function upsertPageConnection(params) {
  if (!isSupabaseEnabled() || !UUID_RE.test(params.clinicId)) {
    return { ok: false, error: "supabase_or_clinic_invalid" };
  }
  const pageId = String(params.pageId || "").trim();
  const token = String(params.pageAccessToken || "").trim();
  if (!pageId || !token) {
    return { ok: false, error: "page_or_token_missing" };
  }

  let webhookSubscribed = false;
  /** @type {Record<string, unknown>} */
  let subscribeMeta = {};
  if (params.subscribeWebhook !== false) {
    try {
      const sub = await subscribePageToApp(pageId, token);
      webhookSubscribed = sub?.subscribeResult?.success === true;
      subscribeMeta = {
        subscribed_apps: sub?.subscribeResult || null,
        subscribed_apps_verify: sub?.verifyResult?.data || null,
        webhook_subscribed_at: new Date().toISOString(),
      };
      metaTrace("page_connection.subscribe_ok", {
        clinicId: String(params.clinicId).slice(0, 8),
        pageId,
        webhookSubscribed,
        verifyCount: Array.isArray(sub?.verifyResult?.data) ? sub.verifyResult.data.length : 0,
      });
    } catch (e) {
      subscribeMeta = {
        subscribe_error: String(e?.message || e).slice(0, 500),
        subscribe_code: e?.code || null,
        subscribe_type: e?.type || null,
      };
      console.warn("[metaPageConnections] subscribe:", e?.message || e, {
        code: e?.code,
        type: e?.type,
        pageId,
      });
      metaTrace("page_connection.subscribe_failed", {
        clinicId: String(params.clinicId).slice(0, 8),
        pageId,
        ...subscribeMeta,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const enc = encryptSecret(token);
  const row = {
    clinic_id: params.clinicId,
    page_id: pageId,
    page_name: params.pageName || null,
    page_access_token_enc: enc,
    token_expires_at: params.tokenExpiresAt || null,
    webhook_subscribed: webhookSubscribed,
    status: "active",
    connected_by: params.connectedBy || null,
    updated_at: nowIso,
    metadata: { source: "oauth_connect", ...subscribeMeta },
  };

  const { data: existing } = await supabase
    .from("meta_page_connections")
    .select("id, clinic_id, status")
    .eq("page_id", pageId)
    .maybeSingle();

  if (
    existing?.id &&
    existing.clinic_id &&
    String(existing.clinic_id) !== String(params.clinicId) &&
    String(existing.status || "active") === "active"
  ) {
    const [previous, next] = await Promise.all([
      getClinicLabel(String(existing.clinic_id)),
      getClinicLabel(params.clinicId),
    ]);
    metaTrace("page_connection.clinic_reassign", {
      pageId,
      pageName: params.pageName || null,
      fromClinicId: previous.clinicId ? String(previous.clinicId).slice(0, 8) : null,
      fromClinicName: previous.clinicName,
      fromClinicCode: previous.clinicCode,
      toClinicId: next.clinicId ? String(next.clinicId).slice(0, 8) : null,
      toClinicName: next.clinicName,
      toClinicCode: next.clinicCode,
    });
    console.warn("[metaPageConnections] page reassigned to new clinic", {
      pageId,
      fromClinicId: previous.clinicId,
      fromClinicName: previous.clinicName,
      toClinicId: next.clinicId,
      toClinicName: next.clinicName,
    });
  }

  let result;
  if (existing?.id) {
    result = await supabase.from("meta_page_connections").update(row).eq("id", existing.id).select("id, page_id").single();
  } else {
    result = await supabase
      .from("meta_page_connections")
      .insert({ ...row, created_at: nowIso })
      .select("id, page_id")
      .single();
  }

  if (result.error) {
    console.warn("[metaPageConnections] upsert:", result.error.message);
    return { ok: false, error: result.error.message };
  }

  metaTrace("page_connection.saved", {
    clinicId: String(params.clinicId).slice(0, 8),
    pageId,
    webhookSubscribed,
    connectionId: result.data?.id ? String(result.data.id).slice(0, 8) : null,
  });

  return {
    ok: true,
    connection: result.data,
    webhookSubscribed,
    subscribeMeta,
  };
}

/**
 * @param {string} clinicId
 * @param {string} pageId
 */
async function disconnectPageConnection(clinicId, pageId) {
  if (!isSupabaseEnabled()) return { ok: false };
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("meta_page_connections")
    .update({ status: "disconnected", updated_at: nowIso, webhook_subscribed: false })
    .eq("clinic_id", clinicId)
    .eq("page_id", pageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

module.exports = {
  getActivePageConnectionByPageId,
  lookupPageClinicMapping,
  getClinicLabel,
  listPageConnectionsForClinic,
  pageAccessTokenFromRow,
  upsertPageConnection,
  disconnectPageConnection,
};
