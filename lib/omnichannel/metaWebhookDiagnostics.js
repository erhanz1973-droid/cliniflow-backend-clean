/**
 * Meta App + Page webhook subscription diagnostics.
 * Page subscribed_apps alone is not enough — the App must subscribe to Page webhook fields.
 */

const {
  metaAppId,
  metaAppSecret,
  metaGraphApiVersion,
  metaWebhookCallbackUrl,
  metaWebhookVerifyToken,
  metaIntegrationEnabled,
} = require("./metaConfig");
const { graphRequest, PAGE_SUBSCRIBED_FIELDS, getPageSubscribedApps } = require("./metaGraph");
const { metaTrace } = require("./metaDebug");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { pageAccessTokenFromRow } = require("./metaPageConnections");

const REQUIRED_APP_WEBHOOK_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_deliveries",
  "message_reads",
];

function appAccessToken() {
  return `${metaAppId()}|${metaAppSecret()}`;
}

/**
 * GET /{app-id}/subscriptions — App-level webhook configuration.
 */
async function getAppWebhookSubscriptions() {
  const aid = metaAppId();
  if (!aid) return { ok: false, error: "META_APP_ID_missing", data: [] };
  try {
    const json = await graphRequest(`/${aid}/subscriptions`, {
      token: appAccessToken(),
    });
    return { ok: true, data: Array.isArray(json.data) ? json.data : [], raw: json };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      code: e?.code,
      data: [],
      payload: e?.payload,
    };
  }
}

/**
 * @param {Array<Record<string, unknown>>} data
 * @param {string} expectedCallbackUrl
 */
function analyzeAppPageSubscription(data, expectedCallbackUrl) {
  const expected = String(expectedCallbackUrl || "").trim().replace(/\/+$/, "");
  const pageSubs = (Array.isArray(data) ? data : []).filter(
    (row) => String(row?.object || "").toLowerCase() === "page",
  );
  const active = pageSubs.filter((row) => row?.active !== false);
  const primary = active[0] || pageSubs[0] || null;

  const fields = primary
    ? (Array.isArray(primary.fields)
        ? primary.fields
        : String(primary.fields || "")
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean))
    : [];

  const callbackUrl = primary ? String(primary.callback_url || "").trim() : "";
  const normalizedCallback = callbackUrl.replace(/\/+$/, "");
  const missingFields = REQUIRED_APP_WEBHOOK_FIELDS.filter((f) => !fields.includes(f));

  return {
    pageObjectFound: pageSubs.length > 0,
    pageSubscriptionCount: pageSubs.length,
    active: primary ? primary.active !== false : false,
    callbackUrl: callbackUrl || null,
    callbackUrlMatchesExpected:
      Boolean(expected && normalizedCallback) && normalizedCallback === expected,
    expectedCallbackUrl: expected || null,
    fields,
    hasMessagesField: fields.includes("messages"),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
    subscriptions: pageSubs.map((row) => ({
      object: row.object,
      active: row.active,
      callback_url: row.callback_url,
      fields: row.fields,
    })),
  };
}

/**
 * @param {unknown} verifyJson
 * @param {string} [expectedAppId]
 */
function analyzePageSubscribedApps(verifyJson, expectedAppId) {
  const appId = String(expectedAppId || metaAppId() || "").trim();
  const rows = Array.isArray(verifyJson?.data) ? verifyJson.data : [];
  const ours = rows.find((r) => String(r?.id || "") === appId) || rows[0] || null;
  const subscribedFields = ours
    ? (Array.isArray(ours.subscribed_fields)
        ? ours.subscribed_fields
        : String(ours.subscribed_fields || "")
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean))
    : [];
  const missingFields = REQUIRED_APP_WEBHOOK_FIELDS.filter((f) => !subscribedFields.includes(f));

  return {
    pageId: null,
    appListedOnPage: Boolean(ours),
    appId: ours?.id || null,
    appName: ours?.name || null,
    subscribedFields,
    hasMessagesField: subscribedFields.includes("messages"),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
    rawApps: rows.map((r) => ({
      id: r.id,
      name: r.name,
      subscribed_fields: r.subscribed_fields,
    })),
  };
}

/**
 * @param {string} pageId
 * @param {string} pageAccessToken
 */
async function diagnosePageWebhookSubscription(pageId, pageAccessToken) {
  const pid = String(pageId || "").trim();
  let verify = null;
  try {
    verify = await getPageSubscribedApps(pid, pageAccessToken);
  } catch (e) {
    return {
      pageId: pid,
      ok: false,
      error: e?.message || String(e),
      analysis: null,
    };
  }
  const analysis = analyzePageSubscribedApps(verify, metaAppId());
  analysis.pageId = pid;
  return { pageId: pid, ok: true, verify, analysis };
}

/**
 * POST /{app-id}/subscriptions — register App webhook (optional auto-fix).
 */
async function registerAppPageWebhookSubscription() {
  const aid = metaAppId();
  const callbackUrl = metaWebhookCallbackUrl();
  const verifyToken = metaWebhookVerifyToken();
  if (!aid || !callbackUrl || !verifyToken) {
    return { ok: false, error: "missing_app_id_callback_or_verify_token" };
  }
  try {
    const json = await graphRequest(`/${aid}/subscriptions`, {
      method: "POST",
      token: appAccessToken(),
      query: {
        object: "page",
        callback_url: callbackUrl,
        verify_token: verifyToken,
        fields: REQUIRED_APP_WEBHOOK_FIELDS.join(","),
      },
    });
    return { ok: true, result: json };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code, payload: e?.payload };
  }
}

async function listActivePagesForDiagnostics() {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase
    .from("meta_page_connections")
    .select("page_id, page_name, webhook_subscribed, status, page_access_token_enc")
    .eq("status", "active");
  if (error) {
    console.warn("[metaWebhook] list pages:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Startup + on-demand: App GET /subscriptions and each connected Page subscribed_apps.
 */
async function runMetaWebhookStartupDiagnostics() {
  if (!metaIntegrationEnabled()) {
    console.log("[metaWebhook] startup diagnostics skipped (Meta not configured)");
    return { skipped: true, reason: "meta_not_configured" };
  }

  const appId = metaAppId();
  const callbackUrl = metaWebhookCallbackUrl();
  const verifyTokenSet = Boolean(metaWebhookVerifyToken());

  console.log("[metaWebhook] startup diagnostics begin", {
    appId,
    graphVersion: metaGraphApiVersion(),
    expectedCallbackUrl: callbackUrl || "(unset — set RAILWAY_PUBLIC_URL)",
    verifyTokenConfigured: verifyTokenSet,
    pageSubscribedFieldsOnConnect: PAGE_SUBSCRIBED_FIELDS,
    requiredAppWebhookFields: REQUIRED_APP_WEBHOOK_FIELDS,
  });

  const subs = await getAppWebhookSubscriptions();
  const appAnalysis = subs.ok
    ? analyzeAppPageSubscription(subs.data, callbackUrl)
    : {
        pageObjectFound: false,
        error: subs.error,
        fields: [],
        missingFields: REQUIRED_APP_WEBHOOK_FIELDS,
        hasMessagesField: false,
        allRequiredFieldsPresent: false,
      };

  metaTrace("webhook.startup.app_subscriptions", {
    graphRequest: `GET /${appId}/subscriptions`,
    fetchOk: subs.ok,
    fetchError: subs.error || null,
    ...appAnalysis,
    hint: !appAnalysis.pageObjectFound
      ? "No App-level Page webhook in GET /{app-id}/subscriptions. Meta will NOT POST to your callback. Add in App Dashboard → Webhooks (object: page, field: messages) or META_AUTO_REGISTER_APP_WEBHOOK=true"
      : !appAnalysis.hasMessagesField
        ? "App subscription exists but messages field missing"
        : !appAnalysis.callbackUrlMatchesExpected
          ? "App callback_url does not match expected Railway URL"
          : null,
  });

  console.log("[metaWebhook] App subscriptions (GET /{app-id}/subscriptions)", appAnalysis);

  if (
    process.env.META_AUTO_REGISTER_APP_WEBHOOK === "true" &&
    (!appAnalysis.pageObjectFound ||
      !appAnalysis.allRequiredFieldsPresent ||
      !appAnalysis.callbackUrlMatchesExpected)
  ) {
    const reg = await registerAppPageWebhookSubscription();
    metaTrace("webhook.startup.auto_register", reg);
    console.log("[metaWebhook] auto-register App subscription", reg);
    if (reg.ok) {
      const subs2 = await getAppWebhookSubscriptions();
      if (subs2.ok) {
        Object.assign(appAnalysis, analyzeAppPageSubscription(subs2.data, callbackUrl));
      }
    }
  }

  const pages = await listActivePagesForDiagnostics();
  const pageReports = [];
  for (const row of pages) {
    const token = pageAccessTokenFromRow(row);
    if (!token) {
      pageReports.push({ pageId: row.page_id, ok: false, error: "page_token_decrypt_failed" });
      continue;
    }
    const diag = await diagnosePageWebhookSubscription(row.page_id, token);
    pageReports.push({
      pageName: row.page_name,
      webhookSubscribedDb: row.webhook_subscribed,
      ...diag,
    });
    metaTrace("webhook.startup.page_subscribed_apps", {
      pageId: row.page_id,
      pageName: row.page_name,
      analysis: diag.analysis,
    });
  }

  console.log("[metaWebhook] Page subscribed_apps (per connected Page)", {
    count: pageReports.length,
    pages: pageReports.map((p) => ({
      pageId: p.pageId,
      ok: p.ok,
      appListedOnPage: p.analysis?.appListedOnPage,
      subscribedFields: p.analysis?.subscribedFields,
      hasMessagesField: p.analysis?.hasMessagesField,
      missingFields: p.analysis?.missingFields,
    })),
  });

  const inboundReady =
    appAnalysis.pageObjectFound &&
    appAnalysis.hasMessagesField &&
    appAnalysis.callbackUrlMatchesExpected &&
    pageReports.some((p) => p.analysis?.hasMessagesField);

  metaTrace("webhook.startup.summary", {
    inboundWebhookReady: inboundReady,
    appLevelOk: appAnalysis.allRequiredFieldsPresent && appAnalysis.callbackUrlMatchesExpected,
    pageLevelOk: pageReports.every((p) => !p.ok || p.analysis?.allRequiredFieldsPresent),
  });

  console.log("[metaWebhook] startup diagnostics end", {
    inboundWebhookReady: inboundReady,
    note: inboundReady
      ? "App + Page subscriptions look correct; if POST still missing, check Meta App Dashboard test webhook or firewall"
      : "Fix App-level Webhooks product (object=page, messages) before expecting webhook.POST.received",
  });

  return {
    appId,
    callbackUrl,
    appSubscriptions: appAnalysis,
    appSubscriptionsRaw: subs.ok ? subs.data : null,
    connectedPages: pageReports,
    inboundWebhookReady: inboundReady,
  };
}

module.exports = {
  REQUIRED_APP_WEBHOOK_FIELDS,
  getAppWebhookSubscriptions,
  analyzeAppPageSubscription,
  analyzePageSubscribedApps,
  diagnosePageWebhookSubscription,
  registerAppPageWebhookSubscription,
  runMetaWebhookStartupDiagnostics,
};
