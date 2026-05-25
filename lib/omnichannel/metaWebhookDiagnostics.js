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

let startupDiagnosticsPromise = null;

function appAccessToken() {
  return `${metaAppId()}|${metaAppSecret()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Meta returns fields as string[] or { name, version }[].
 * @param {unknown} fields
 */
function normalizeSubscriptionFields(fields) {
  if (Array.isArray(fields)) {
    return fields
      .map((f) => (typeof f === "string" ? f : f && typeof f === "object" ? f.name : null))
      .filter(Boolean)
      .map((s) => String(s).trim());
  }
  if (typeof fields === "string") {
    return fields
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * GET /{app-id}/subscriptions — App-level webhook configuration.
 */
async function getAppWebhookSubscriptions() {
  const aid = metaAppId();
  if (!aid) return { ok: false, error: "META_APP_ID_missing", data: [], raw: null };
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
      raw: e?.payload || null,
    };
  }
}

/**
 * Poll GET /subscriptions after POST (Meta can lag; verify callback must succeed).
 * @param {number} [attempts]
 */
async function getAppWebhookSubscriptionsWithRetry(attempts = 4) {
  const delays = [0, 800, 2000, 5000];
  let last = null;
  for (let i = 0; i < attempts; i++) {
    if (delays[i]) await sleep(delays[i]);
    last = await getAppWebhookSubscriptions();
    if (last.ok && last.data.length > 0) {
      last.attempt = i + 1;
      return last;
    }
  }
  if (last) last.attempt = attempts;
  return last || { ok: false, error: "no_attempt", data: [], raw: null };
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

  const fields = primary ? normalizeSubscriptionFields(primary.fields) : [];

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
      fields: normalizeSubscriptionFields(row.fields),
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
  const subscribedFields = ours ? normalizeSubscriptionFields(ours.subscribed_fields) : [];
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
      subscribed_fields: normalizeSubscriptionFields(r.subscribed_fields),
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
 * DELETE /{app-id}/subscriptions?object=page
 */
async function deleteAppPageWebhookSubscription() {
  const aid = metaAppId();
  if (!aid) return { ok: false, error: "META_APP_ID_missing" };
  try {
    const json = await graphRequest(`/${aid}/subscriptions`, {
      method: "DELETE",
      token: appAccessToken(),
      query: { object: "page" },
    });
    return { ok: true, result: json };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code };
  }
}

/**
 * POST /{app-id}/subscriptions — register App webhook.
 * Meta sends GET hub.mode=subscribe to callback_url; must return hub.challenge.
 */
async function registerAppPageWebhookSubscription() {
  const aid = metaAppId();
  const callbackUrl = metaWebhookCallbackUrl();
  const { expectedVerifyTokens } = require("./metaWebhook");
  const tokens = expectedVerifyTokens();
  const verifyToken = tokens[0] || "";
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
    const success = json?.success === true || json?.success === "true";
    return {
      ok: success,
      result: json,
      callbackUrl,
      verifyTokenLength: verifyToken.length,
      verifyTokenFingerprint: require("./metaWebhook").verifyTokenFingerprint(verifyToken),
    };
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
 * @param {Awaited<ReturnType<typeof analyzeAppPageSubscription>>} appAnalysis
 * @param {boolean} autoRegisterOk
 * @param {Array<{ analysis?: { hasMessagesField?: boolean } }>} pageReports
 */
function computeInboundWebhookReady(appAnalysis, autoRegisterOk, pageReports) {
  const pageOk = pageReports.some((p) => p.analysis?.hasMessagesField);
  const appFromGet =
    appAnalysis.pageObjectFound &&
    appAnalysis.hasMessagesField &&
    appAnalysis.callbackUrlMatchesExpected;
  const appFromRegister = autoRegisterOk && pageOk;
  return {
    inboundWebhookReady: pageOk && (appFromGet || appFromRegister),
    appLevelOk: appFromGet || autoRegisterOk,
    appVerifiedViaGet: appFromGet,
    appAcceptedViaRegisterOnly: autoRegisterOk && !appFromGet,
  };
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
    autoRegisterEnabled: process.env.META_AUTO_REGISTER_APP_WEBHOOK === "true",
    pageSubscribedFieldsOnConnect: PAGE_SUBSCRIBED_FIELDS,
    requiredAppWebhookFields: REQUIRED_APP_WEBHOOK_FIELDS,
  });

  let subs = await getAppWebhookSubscriptionsWithRetry(2);
  let appAnalysis = subs.ok
    ? analyzeAppPageSubscription(subs.data, callbackUrl)
    : {
        pageObjectFound: false,
        error: subs.error,
        fields: [],
        missingFields: REQUIRED_APP_WEBHOOK_FIELDS,
        hasMessagesField: false,
        allRequiredFieldsPresent: false,
        subscriptions: [],
      };

  metaTrace("webhook.startup.app_subscriptions", {
    graphRequest: `GET /${appId}/subscriptions`,
    fetchOk: subs.ok,
    fetchAttempt: subs.attempt,
    fetchError: subs.error || null,
    rawDataLength: subs.data?.length ?? 0,
    rawResponse: subs.raw,
    ...appAnalysis,
  });

  console.log("[metaWebhook] App subscriptions (GET /{app-id}/subscriptions)", {
    ...appAnalysis,
    rawDataLength: subs.data?.length ?? 0,
  });

  let autoRegisterOk = false;
  let autoRegisterMeta = null;

  const needsRegister =
    !appAnalysis.pageObjectFound ||
    !appAnalysis.allRequiredFieldsPresent ||
    !appAnalysis.callbackUrlMatchesExpected;

  if (process.env.META_AUTO_REGISTER_APP_WEBHOOK === "true" && needsRegister) {
    const del = await deleteAppPageWebhookSubscription();
    metaTrace("webhook.startup.delete_subscription", del);

    autoRegisterMeta = await registerAppPageWebhookSubscription();
    autoRegisterOk = Boolean(autoRegisterMeta.ok);
    metaTrace("webhook.startup.auto_register", {
      ...autoRegisterMeta,
      note: "Meta should call GET " + callbackUrl + "?hub.mode=subscribe — look for webhook.GET.verified in logs",
    });
    console.log("[metaWebhook] auto-register App subscription", autoRegisterMeta);

    if (autoRegisterOk) {
      subs = await getAppWebhookSubscriptionsWithRetry(4);
      if (subs.ok) {
        appAnalysis = analyzeAppPageSubscription(subs.data, callbackUrl);
        appAnalysis.autoRegisterConfirmed = true;
        appAnalysis.getAfterRegisterRawLength = subs.data?.length ?? 0;
      }
      metaTrace("webhook.startup.app_subscriptions_after_register", {
        fetchOk: subs.ok,
        fetchAttempt: subs.attempt,
        rawDataLength: subs.data?.length ?? 0,
        rawResponse: subs.raw,
        ...appAnalysis,
        getStillEmpty: (subs.data?.length ?? 0) === 0,
        hint:
          (subs.data?.length ?? 0) === 0
            ? "POST returned success but GET still empty — Meta may have failed callback verify (check webhook.GET.rejected) or use App Dashboard Webhooks → Verify and save"
            : null,
      });
      console.log("[metaWebhook] App subscriptions after auto-register", appAnalysis);
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

  const ready = computeInboundWebhookReady(appAnalysis, autoRegisterOk, pageReports);

  metaTrace("webhook.startup.summary", {
    ...ready,
    pageLevelOk: pageReports.every((p) => !p.ok || p.analysis?.allRequiredFieldsPresent),
    autoRegisterOk,
  });

  console.log("[metaWebhook] startup diagnostics end", {
    ...ready,
    note: ready.inboundWebhookReady
      ? ready.appAcceptedViaRegisterOnly
        ? "App POST /subscriptions succeeded; GET lag empty but inbound may work — send a test Messenger message"
        : "App + Page subscriptions OK — expect webhook.POST.received on inbound messages"
      : "Configure App Dashboard → Webhooks (Page object, messages) or fix callback verify (webhook.GET.verified)",
  });

  return {
    appId,
    callbackUrl,
    appSubscriptions: appAnalysis,
    appSubscriptionsRaw: subs.ok ? subs.data : null,
    autoRegister: autoRegisterMeta,
    connectedPages: pageReports,
    ...ready,
  };
}

/**
 * Single-flight startup diagnostics (avoid duplicate runs when webhook mounted twice).
 */
function scheduleMetaWebhookStartupDiagnostics() {
  if (startupDiagnosticsPromise) return startupDiagnosticsPromise;
  startupDiagnosticsPromise = runMetaWebhookStartupDiagnostics().catch((e) => {
    startupDiagnosticsPromise = null;
    throw e;
  });
  return startupDiagnosticsPromise;
}

module.exports = {
  REQUIRED_APP_WEBHOOK_FIELDS,
  getAppWebhookSubscriptions,
  getAppWebhookSubscriptionsWithRetry,
  analyzeAppPageSubscription,
  analyzePageSubscribedApps,
  diagnosePageWebhookSubscription,
  deleteAppPageWebhookSubscription,
  registerAppPageWebhookSubscription,
  runMetaWebhookStartupDiagnostics,
  scheduleMetaWebhookStartupDiagnostics,
};
