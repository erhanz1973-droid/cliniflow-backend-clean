/**
 * Meta Graph API client (Pages, Messenger send, OAuth token exchange).
 */

const {
  metaAppId,
  metaAppSecret,
  metaGraphBaseUrl,
  metaGraphApiVersion,
  metaOAuthRedirectUri,
} = require("./metaConfig");
const {
  metaTrace,
  tokenHint,
  graphUrlForLog,
  redactGraphPayload,
  isMetaDebugVerbose,
  serializeGranularScopes,
} = require("./metaDebug");

/**
 * Messenger OAuth scopes.
 * business_management: required for Pages linked via Business Manager to appear on /me/accounts.
 * (No pages_read_engagement — invalid for this app.)
 */
const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "business_management",
];

/** Minimal fields for Page picker + subscribed_apps (no Page metadata enrichment). */
const ME_ACCOUNTS_FIELDS = "id,name,access_token";

/**
 * @param {unknown} data
 */
function normalizeMeAccountsPages(data) {
  return (Array.isArray(data) ? data : [])
    .filter((p) => p && p.id && p.access_token)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name || p.id),
      access_token: String(p.access_token),
    }));
}

/**
 * Union of Page IDs from debug_token granular_scopes (OAuth picker grants).
 * @param {{ granularScopes?: Array<{ scope?: string, target_ids?: string[] }> }} debug
 */
function collectGranularPageIds(debug) {
  const ids = new Set();
  for (const g of debug?.granularScopes || []) {
    for (const id of g?.target_ids || []) {
      const pid = String(id || "").trim();
      if (pid) ids.add(pid);
    }
  }
  return [...ids];
}

/**
 * GET /me/accounts with paging (still only /me/accounts — no Page node calls).
 * @param {string} userAccessToken
 * @param {string} auditLabel
 */
async function fetchAllMeAccountsAudited(userAccessToken, auditLabel) {
  const token = String(userAccessToken || "").trim();
  const pages = [];
  let path = "/me/accounts";
  let query = { fields: ME_ACCOUNTS_FIELDS, limit: "100" };
  let lastJson = {};
  let lastRequestUrl = "";
  let httpStatus = null;
  let error = null;
  let pageNum = 0;

  while (path && pageNum < 20) {
    pageNum += 1;
    const audited = await graphRequestAudited(path, {
      token,
      query: path.startsWith("http") ? {} : query,
      auditLabel: `${auditLabel}.me_accounts_p${pageNum}`,
    });
    lastRequestUrl = audited.requestUrl;
    httpStatus = audited.status;
    if (!audited.ok) {
      error = audited.error;
      lastJson = audited.json;
      break;
    }
    lastJson = audited.json;
    pages.push(...normalizeMeAccountsPages(audited.json?.data));
    const next = audited.json?.paging?.next;
    if (!next) break;
    path = String(next);
    query = {};
  }

  return {
    pages,
    rawCount: pages.length,
    paging: lastJson?.paging || null,
    httpStatus,
    requestUrl: lastRequestUrl,
    error,
    rawBody: redactGraphPayload(lastJson),
    pagesFetched: pageNum,
  };
}

const PAGE_SUBSCRIBED_FIELDS =
  "messages,messaging_postbacks,message_deliveries,message_reads";

/**
 * @param {string} path
 * @param {{ method?: string, token?: string, body?: Record<string, unknown>, query?: Record<string, string> }} [opts]
 */
async function graphRequest(path, opts = {}) {
  const base = metaGraphBaseUrl();
  const url = new URL(path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && String(v).trim() !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: "application/json" };
  const method = opts.method || "GET";
  let body;
  if (opts.body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.token) {
    url.searchParams.set("access_token", opts.token);
  }
  const res = await fetch(url.toString(), { method, headers, body });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `graph_${res.status}`);
    err.code = json?.error?.code;
    err.error_subcode = json?.error?.error_subcode;
    err.type = json?.error?.type;
    err.fbtrace_id = json?.error?.fbtrace_id;
    err.status = res.status;
    err.payload = json;
    metaTrace("graph.error", {
      path: String(path).slice(0, 120),
      method,
      status: res.status,
      code: err.code,
      error_subcode: err.error_subcode,
      type: err.type,
      fbtrace_id: err.fbtrace_id,
      message: err.message,
      responseBody: redactGraphPayload(json),
    });
    throw err;
  }
  return json;
}

/**
 * @param {string} code
 */
async function exchangeCodeForUserToken(code) {
  const redirectUri = metaOAuthRedirectUri();
  return graphRequest("/oauth/access_token", {
    query: {
      client_id: metaAppId(),
      client_secret: metaAppSecret(),
      redirect_uri: redirectUri,
      code: String(code || "").trim(),
    },
  });
}

/**
 * WhatsApp Embedded Signup — exchange auth code (no redirect_uri).
 * @param {string} code
 */
async function exchangeEmbeddedSignupCode(code) {
  return graphRequest("/oauth/access_token", {
    query: {
      client_id: metaAppId(),
      client_secret: metaAppSecret(),
      code: String(code || "").trim(),
    },
  });
}

/**
 * @param {string} shortLivedUserToken
 */
async function exchangeForLongLivedUserToken(shortLivedUserToken) {
  return graphRequest("/oauth/access_token", {
    query: {
      grant_type: "fb_exchange_token",
      client_id: metaAppId(),
      client_secret: metaAppSecret(),
      fb_exchange_token: String(shortLivedUserToken || "").trim(),
    },
  });
}

/**
 * @param {string} path
 * @param {{ method?: string, token?: string, body?: Record<string, unknown>, query?: Record<string, string>, auditLabel?: string }} [opts]
 */
async function graphRequestAudited(path, opts = {}) {
  const base = metaGraphBaseUrl();
  const url = new URL(path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && String(v).trim() !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: "application/json" };
  const method = opts.method || "GET";
  let body;
  if (opts.body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.token) {
    url.searchParams.set("access_token", opts.token);
  }
  const requestUrl = url.toString();
  const label = opts.auditLabel || String(path).slice(0, 80);
  const tokenTypeMatch = String(label).match(/^(short_lived|long_lived)/);
  metaTrace("graph.audit.request", {
    label,
    tokenPhase: label.split(".")[0] || label,
    tokenType: tokenTypeMatch ? tokenTypeMatch[1] : "user_access_token",
    token: tokenHint(opts.token),
    method,
    graphVersion: metaGraphApiVersion(),
    requestUrl: graphUrlForLog(requestUrl),
  });

  const res = await fetch(requestUrl, { method, headers, body });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    metaTrace("graph.audit.error", {
      label,
      status: res.status,
      graphVersion: metaGraphApiVersion(),
      requestUrl: graphUrlForLog(requestUrl),
      errorBody: redactGraphPayload(json),
    });
    return {
      ok: false,
      status: res.status,
      json,
      requestUrl: graphUrlForLog(requestUrl),
      error: json?.error || { message: `graph_${res.status}` },
    };
  }

  metaTrace("graph.audit.ok", {
    label,
    status: res.status,
    requestUrl: graphUrlForLog(requestUrl),
    ...(isMetaDebugVerbose() ? { body: redactGraphPayload(json) } : { bodyOmitted: true }),
  });
  return { ok: true, status: res.status, json, requestUrl: graphUrlForLog(requestUrl) };
}

/**
 * Inspect granted scopes (explains empty /me/accounts).
 * @param {string} userAccessToken
 * @param {{ auditLabel?: string }} [opts]
 */
async function debugAccessToken(userAccessToken, opts = {}) {
  const appToken = `${metaAppId()}|${metaAppSecret()}`;
  const input = String(userAccessToken || "").trim();
  const label = opts.auditLabel || "debug_token";
  try {
    const audited = await graphRequestAudited("/debug_token", {
      token: appToken,
      query: {
        input_token: input,
        fields:
          "app_id,user_id,application,type,expires_at,is_valid,scopes,granular_scopes,data_access_expires_at,issued_at",
      },
      auditLabel: `${label}.debug_token`,
    });
    const d =
      audited.ok && audited.json?.data && typeof audited.json.data === "object"
        ? audited.json.data
        : {};
    const summary = {
      isValid: d.is_valid === true,
      userId: d.user_id || null,
      appId: d.app_id || null,
      type: d.type || null,
      scopes: Array.isArray(d.scopes) ? d.scopes : [],
      granularScopes: Array.isArray(d.granular_scopes) ? d.granular_scopes : [],
      expiresAt: d.expires_at || null,
      dataAccessExpiresAt: d.data_access_expires_at || null,
      issuedAt: d.issued_at || null,
    };
    metaTrace("oauth.debug_token.summary", {
      label,
      token: tokenHint(input),
      graphVersion: metaGraphApiVersion(),
      ...summary,
      granularScopes: summary.granularScopes,
      debugTokenRaw: redactGraphPayload(d),
    });
    if (!audited.ok) {
      return {
        ...summary,
        isValid: false,
        error: audited.error?.message || "debug_token_failed",
        debugTokenHttpStatus: audited.status,
      };
    }
    return summary;
  } catch (e) {
    metaTrace("debug_token.failed", { label, message: e?.message || String(e), code: e?.code });
    return { isValid: false, scopes: [], granularScopes: [], error: e?.message || String(e) };
  }
}

/**
 * OAuth diagnostic step: GET /me/accounts then debug_token (exact sequence).
 * @param {"short_lived"|"long_lived"} tokenType
 * @param {string} userAccessToken
 * @param {{ sequenceStep?: number, calledBeforeTokenReplaceInMemory?: boolean, calledAfterTokenReplaceInMemory?: boolean, shortTokenHint?: ReturnType<typeof tokenHint> }} [opts]
 */
async function probeMeAccountsOAuthStep(tokenType, userAccessToken, opts = {}) {
  const token = String(userAccessToken || "").trim();
  const phase = tokenType === "long_lived" ? "long_lived_after_exchange" : "short_lived_before_exchange";

  metaTrace("oauth.sequence.step", {
    sequenceStep: opts.sequenceStep ?? (tokenType === "short_lived" ? 1 : 3),
    action: "GET /me/accounts",
    tokenType,
    token: tokenHint(token),
    graphVersion: metaGraphApiVersion(),
    graphBase: metaGraphBaseUrl(),
    calledBeforeTokenReplaceInMemory: opts.calledBeforeTokenReplaceInMemory === true,
    calledAfterTokenReplaceInMemory: opts.calledAfterTokenReplaceInMemory === true,
    shortTokenStillHeldSeparately: opts.shortTokenHint || null,
  });

  const fetched = await fetchAllMeAccountsAudited(token, phase);

  const meAccounts = {
    pages: fetched.pages,
    rawCount: fetched.rawCount,
    paging: fetched.paging,
    httpStatus: fetched.httpStatus,
    requestUrl: fetched.requestUrl,
    error: fetched.error,
    rawBody: fetched.rawBody,
    pagesFetched: fetched.pagesFetched,
  };

  if (!fetched.error) {
    metaTrace("oauth.sequence.me_accounts", {
      sequenceStep: opts.sequenceStep,
      tokenType,
      pageCount: fetched.rawCount,
      token: tokenHint(token),
      graphVersion: metaGraphApiVersion(),
      requestUrl: fetched.requestUrl,
      httpStatus: fetched.httpStatus,
      pagesFetched: fetched.pagesFetched,
      calledBeforeTokenReplaceInMemory: opts.calledBeforeTokenReplaceInMemory === true,
      calledAfterTokenReplaceInMemory: opts.calledAfterTokenReplaceInMemory === true,
      rawResponse: fetched.rawBody,
    });
  } else {
    metaTrace("oauth.sequence.me_accounts_error", {
      sequenceStep: opts.sequenceStep,
      tokenType,
      pageCount: 0,
      token: tokenHint(token),
      graphVersion: metaGraphApiVersion(),
      requestUrl: fetched.requestUrl,
      httpStatus: fetched.httpStatus,
      errorBody: fetched.rawBody,
    });
  }

  const debug = await debugAccessToken(token, {
    auditLabel: `${phase}.debug_token_after_me_accounts`,
  });

  const granularPageIds = collectGranularPageIds(debug);

  metaTrace("oauth.sequence.debug_token", {
    sequenceStep: opts.sequenceStep,
    tokenType,
    token: tokenHint(token),
    scopes: debug.scopes,
    hasBusinessManagement: (debug.scopes || []).includes("business_management"),
    granularScopes: serializeGranularScopes(debug.granularScopes),
    granularPageIds,
    isValid: debug.isValid,
    userId: debug.userId,
  });

  if (fetched.rawCount === 0 && granularPageIds.length > 0) {
    metaTrace("oauth.sequence.granular_without_me_accounts", {
      tokenType,
      granularPageIds,
      hint:
        "OAuth picker granted Page IDs in granular_scopes but GET /me/accounts returned []. " +
        "Reconnect after granting business_management, or use Facebook Login for Business (META_FB_LOGIN_CONFIG_ID).",
      userId: debug.userId,
    });
  }

  return { tokenType, phase, token: tokenHint(token), meAccounts, debug, granularPageIds };
}

/**
 * Steps 4–5: compare probes; picker from /me/accounts only (no granular enrichment).
 * @param {string} shortLivedUserToken
 * @param {string} longLivedUserToken
 * @param {Awaited<ReturnType<typeof probeMeAccountsOAuthStep>>} shortProbe
 * @param {Awaited<ReturnType<typeof probeMeAccountsOAuthStep>>} longProbe
 */
async function finalizeOAuthPageDiscovery(
  shortLivedUserToken,
  longLivedUserToken,
  shortProbe,
  longProbe,
) {
  const shortToken = String(shortLivedUserToken || "").trim();
  const longToken = String(longLivedUserToken || "").trim();
  const shortMeCount = shortProbe.meAccounts.rawCount;
  const longMeCount = longProbe.meAccounts.rawCount;

  const scopeCompare = {
    shortScopes: shortProbe.debug?.scopes || [],
    longScopes: longProbe.debug?.scopes || [],
    shortMeAccountsPageCount: shortMeCount,
    longMeAccountsPageCount: longMeCount,
    tokensDiffer: shortToken !== longToken,
    longLivedLostMeAccountsPages: shortMeCount > 0 && longMeCount === 0 && shortToken !== longToken,
    shortLivedGainedMeAccountsPages: shortMeCount === 0 && longMeCount > 0 && shortToken !== longToken,
    pageDiscoveryPolicy: "me_accounts_only",
  };

  const shortGranularIds = shortProbe.granularPageIds || collectGranularPageIds(shortProbe.debug);
  const longGranularIds = longProbe.granularPageIds || collectGranularPageIds(longProbe.debug);

  metaTrace("oauth.sequence.compare", {
    step: 4,
    ...scopeCompare,
    shortGranularPageIds: shortGranularIds,
    longGranularPageIds: longGranularIds,
    pageVisibilityDifference: {
      shortMeAccounts: shortMeCount,
      longMeAccounts: longMeCount,
      delta: shortMeCount - longMeCount,
    },
    diagnosis:
      shortMeCount === 0 && shortGranularIds.length > 0
        ? "granular_pages_granted_but_me_accounts_empty"
        : shortMeCount === 0
          ? "no_pages_on_me_accounts"
          : "ok",
  });

  let pages = [];
  let pageSource = "none";
  let chosenPhase = "none";
  let usedShortMeAccountsDespiteLongExchange = false;

  if (shortMeCount > 0 && longMeCount === 0) {
    pages = shortProbe.meAccounts.pages;
    pageSource = "me/accounts";
    chosenPhase = "short_lived_me_accounts_long_empty";
    usedShortMeAccountsDespiteLongExchange = true;
    metaTrace("oauth.sequence.fallback", {
      step: 5,
      useShortLivedMeAccountsForPicker: true,
      storeLongLivedTokenForPersistence: true,
      shortPageCount: shortMeCount,
      longPageCount: longMeCount,
      note: "Page picker uses short-lived /me/accounts; long-lived token kept for storage only",
    });
  } else if (shortMeCount > 0) {
    pages = shortProbe.meAccounts.pages;
    pageSource = "me/accounts";
    chosenPhase = "short_lived_me_accounts";
  } else if (longMeCount > 0) {
    pages = longProbe.meAccounts.pages;
    pageSource = "me/accounts";
    chosenPhase = "long_lived_me_accounts";
  }

  metaTrace("oauth.page_resolution.chosen", {
    pageCount: pages.length,
    pageSource,
    chosenPhase,
    usedShortMeAccountsDespiteLongExchange,
    longLivedUserToken: tokenHint(longToken),
    shortLivedUserToken: tokenHint(shortToken),
    scopeCompare,
  });

  return {
    pages,
    pageSource,
    chosenPhase,
    usedShortMeAccountsDespiteLongExchange,
    longLivedUserToken: longToken,
    shortLivedUserToken: shortToken,
    shortProbe,
    longProbe,
    scopeCompare,
    shortAudit: shortProbe,
    longAudit: longProbe,
  };
}

/**
 * /me/accounts only (no granular Page node calls).
 * @param {string} phaseLabel
 * @param {string} userAccessToken
 */
async function auditTokenForPages(phaseLabel, userAccessToken) {
  const probe = await probeMeAccountsOAuthStep(
    phaseLabel.includes("long") ? "long_lived" : "short_lived",
    userAccessToken,
    { sequenceStep: 0 },
  );
  return {
    pages: probe.meAccounts.pages,
    debug: probe.debug,
    pageSource: probe.meAccounts.rawCount ? "me/accounts" : "none",
    meAccounts: probe.meAccounts,
  };
}

/** @deprecated Use probeMeAccountsOAuthStep + finalizeOAuthPageDiscovery in OAuth callback */
async function resolveOAuthPages(shortLivedUserToken, longLivedUserToken) {
  const shortProbe = await probeMeAccountsOAuthStep("short_lived", shortLivedUserToken, { sequenceStep: 1 });
  const longProbe = await probeMeAccountsOAuthStep("long_lived", longLivedUserToken, { sequenceStep: 3 });
  return finalizeOAuthPageDiscovery(shortLivedUserToken, longLivedUserToken, shortProbe, longProbe);
}

/**
 * @param {string} userAccessToken
 */
async function fetchManagedPagesFromAccountsEndpoint(userAccessToken) {
  const fetched = await fetchAllMeAccountsAudited(
    userAccessToken,
    "fetchManagedPages",
  );
  if (fetched.error) {
    const err = new Error(fetched.error?.message || "me_accounts_failed");
    err.payload = fetched.rawBody;
    throw err;
  }
  return {
    pages: fetched.pages,
    paging: fetched.paging,
    rawCount: fetched.rawCount,
  };
}

/**
 * List Facebook Pages via GET /me/accounts only.
 * @param {string} userAccessToken
 */
async function fetchManagedPages(userAccessToken) {
  const token = String(userAccessToken || "").trim();
  const debug = await debugAccessToken(token);
  metaTrace("fetchManagedPages.debug_token", {
    isValid: debug.isValid,
    userId: debug.userId,
    scopes: debug.scopes,
    hasPagesShowList: debug.scopes.includes("pages_show_list"),
    hasPagesMessaging: debug.scopes.includes("pages_messaging"),
    hasPagesManageMetadata: debug.scopes.includes("pages_manage_metadata"),
  });

  try {
    const primary = await fetchManagedPagesFromAccountsEndpoint(token);
    metaTrace("fetchManagedPages.me_accounts", { count: primary.rawCount, paging: primary.paging });
    if (primary.pages.length) {
      return { pages: primary.pages, debug, source: "me/accounts" };
    }
  } catch (e) {
    metaTrace("fetchManagedPages.me_accounts_error", { message: e?.message || String(e), code: e?.code });
  }

  metaTrace("fetchManagedPages.empty", {
    hint: "GET /me/accounts returned no Pages. Re-run OAuth with pages_show_list; ensure Page Admin role.",
    scopes: debug.scopes,
  });

  return { pages: [], debug, source: "none" };
}

/**
 * GET /{page-id}/subscribed_apps — verify Page is subscribed to this app.
 * @param {string} pageId
 * @param {string} pageAccessToken
 */
async function getPageSubscribedApps(pageId, pageAccessToken) {
  return graphRequest(`/${pageId}/subscribed_apps`, {
    token: pageAccessToken,
  });
}

/**
 * POST /{page-id}/subscribed_apps — Meta expects subscribed_fields as query param.
 * @param {string} pageId
 * @param {string} pageAccessToken
 */
async function subscribePageToApp(pageId, pageAccessToken) {
  const pid = String(pageId || "").trim();
  metaTrace("subscribed_apps.request", {
    pageId: pid,
    fields: PAGE_SUBSCRIBED_FIELDS,
    pageToken: tokenHint(pageAccessToken),
    appId: metaAppId() || null,
  });

  const result = await graphRequest(`/${pid}/subscribed_apps`, {
    method: "POST",
    token: pageAccessToken,
    query: { subscribed_fields: PAGE_SUBSCRIBED_FIELDS },
  });

  metaTrace("subscribed_apps.response", {
    pageId: pid,
    success: result?.success,
    result: result,
  });

  let verify = null;
  let pageAnalysis = null;
  try {
    verify = await getPageSubscribedApps(pid, pageAccessToken);
    const { analyzePageSubscribedApps } = require("./metaWebhookDiagnostics");
    pageAnalysis = analyzePageSubscribedApps(verify, metaAppId());
    pageAnalysis.pageId = pid;
    metaTrace("subscribed_apps.verify", {
      pageId: pid,
      data: verify?.data,
      analysis: pageAnalysis,
    });
  } catch (e) {
    metaTrace("subscribed_apps.verify_failed", {
      pageId: pid,
      message: e?.message || String(e),
      code: e?.code,
    });
  }

  return { subscribeResult: result, verifyResult: verify, pageAnalysis };
}

/**
 * @param {string} pageId
 */
function buildMessengerSendUrls(pageId) {
  const base = metaGraphBaseUrl();
  const pid = String(pageId || "").trim();
  return {
    pageMessages: `${base}/${pid}/messages`,
    meMessages: `${base}/me/messages`,
    pageMessagesFormat: `POST /${metaGraphApiVersion()}/{PAGE_ID}/messages`,
    meMessagesFormat: `POST /${metaGraphApiVersion()}/me/messages`,
  };
}

/**
 * Send Messenger message via Graph API (Page Access Token).
 * Uses recipient.id = PSID only (never user_id / internal ids).
 *
 * @param {string} pageId
 * @param {string} psid
 * @param {string} pageAccessToken
 * @param {string} text
 * @param {{ tokenSource?: string, preferEndpoint?: "page" | "me" }} [opts]
 */
async function sendMessengerText(pageId, psid, pageAccessToken, text, opts = {}) {
  const pid = String(pageId || "").trim();
  const recipientPsid = String(psid || "").trim();
  const token = String(pageAccessToken || "").trim();
  const bodyText = String(text || "").trim().slice(0, 2000);
  const tokenSource = String(opts.tokenSource || "page_connection").trim();
  const urls = buildMessengerSendUrls(pid);

  const payload = {
    recipient: { id: recipientPsid },
    messaging_type: "RESPONSE",
    message: { text: bodyText },
  };

  const attemptOrder =
    opts.preferEndpoint === "me" ? ["me", "page"] : ["page", "me"];

  /** @type {Record<string, unknown>[]} */
  const attempts = [];

  console.log(
    "[messenger.send.start]",
    JSON.stringify({
      pageId: pid,
      recipientPsid:
        recipientPsid.length > 12 ? `${recipientPsid.slice(0, 8)}…` : recipientPsid,
      messageLength: bodyText.length,
      tokenSource,
      token: tokenHint(token),
      endpoints: urls,
    }),
  );

  for (const kind of attemptOrder) {
    const path = kind === "me" ? "/me/messages" : `/${pid}/messages`;
    const requestUrl = graphUrlForLog(
      `${metaGraphBaseUrl()}${path}?access_token=[REDACTED]`,
    );
    try {
      const json = await graphRequest(path, {
        method: "POST",
        token,
        body: payload,
      });
      const externalMessageId = json?.message_id ? String(json.message_id) : null;
      attempts.push({ endpoint: kind, ok: true, requestUrl, responseBody: json });
      console.log(
        "[messenger.send.success]",
        JSON.stringify({
          pageId: pid,
          recipientPsid:
            recipientPsid.length > 12 ? `${recipientPsid.slice(0, 8)}…` : recipientPsid,
          endpoint: kind,
          graphApiUrl: requestUrl,
          tokenSource,
          externalMessageId,
          messageLength: bodyText.length,
        }),
      );
      return {
        ...json,
        message_id: externalMessageId,
        _delivery: {
          endpoint: kind,
          graphApiUrl: requestUrl,
          tokenSource,
          externalMessageId,
          attempts,
        },
      };
    } catch (e) {
      const errBody = e?.payload || {
        message: e?.message,
        code: e?.code,
        error_subcode: e?.error_subcode,
        type: e?.type,
        fbtrace_id: e?.fbtrace_id,
      };
      attempts.push({
        endpoint: kind,
        ok: false,
        requestUrl,
        httpStatus: e?.status,
        errorCode: e?.code,
        errorSubcode: e?.error_subcode,
        errorType: e?.type,
        fbtrace_id: e?.fbtrace_id,
        errorMessage: e?.message,
        responseBody: redactGraphPayload(errBody),
      });
      console.warn(
        "[messenger.send.failed]",
        JSON.stringify({
          pageId: pid,
          recipientPsid:
            recipientPsid.length > 12 ? `${recipientPsid.slice(0, 8)}…` : recipientPsid,
          endpoint: kind,
          graphApiUrl: requestUrl,
          tokenSource,
          messageLength: bodyText.length,
          httpStatus: e?.status,
          errorCode: e?.code,
          errorSubcode: e?.error_subcode,
          errorType: e?.type,
          fbtrace_id: e?.fbtrace_id,
          errorMessage: e?.message || String(e),
          responseBody: redactGraphPayload(errBody),
        }),
      );
      if (kind === attemptOrder[attemptOrder.length - 1]) {
        const err = new Error(e?.message || "messenger_send_failed");
        err.code = e?.code;
        err.error_subcode = e?.error_subcode;
        err.type = e?.type;
        err.fbtrace_id = e?.fbtrace_id;
        err.status = e?.status;
        err.payload = errBody;
        err.attempts = attempts;
        err.endpoint = kind;
        err.requestUrl = requestUrl;
        throw err;
      }
    }
  }

  throw new Error("messenger_send_no_attempt");
}

/**
 * @param {string} psid
 * @param {string} pageAccessToken
 */
async function fetchMessengerUserProfile(psid, pageAccessToken, pageId) {
  const { repairConcatenatedPsid } = require("./metaWebhook");
  const id = repairConcatenatedPsid(String(psid || "").trim(), String(pageId || ""), "");
  // Page-scoped IDs are numeric; Meta often sends 15–17 digits (legacy cap at 16 was too strict).
  if (!id || !/^\d{6,20}$/.test(id)) return null;
  try {
    return await graphRequest(`/${id}`, {
      token: pageAccessToken,
      query: { fields: "first_name,last_name,name" },
    });
  } catch (e) {
    console.warn("[metaGraph] messenger profile fetch failed", {
      psid: id.length > 12 ? `${id.slice(0, 8)}…` : id,
      code: e?.code,
      subcode: e?.error_subcode,
      message: e?.message || String(e),
    });
    metaTrace("messenger.profile_fetch.skip", {
      psid: id.length > 12 ? `${id.slice(0, 8)}…` : id,
      code: e?.code,
      message: e?.message || String(e),
    });
    return null;
  }
}

module.exports = {
  graphRequest,
  graphRequestAudited,
  META_OAUTH_SCOPES,
  exchangeCodeForUserToken,
  exchangeEmbeddedSignupCode,
  exchangeForLongLivedUserToken,
  debugAccessToken,
  ME_ACCOUNTS_FIELDS,
  probeMeAccountsOAuthStep,
  finalizeOAuthPageDiscovery,
  auditTokenForPages,
  resolveOAuthPages,
  fetchManagedPages,
  getPageSubscribedApps,
  subscribePageToApp,
  PAGE_SUBSCRIBED_FIELDS,
  buildMessengerSendUrls,
  sendMessengerText,
  fetchMessengerUserProfile,
};
