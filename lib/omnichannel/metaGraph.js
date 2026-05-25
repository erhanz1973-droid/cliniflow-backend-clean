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

/** Messenger OAuth scopes only (no pages_read_engagement — invalid for this app). */
const META_OAUTH_SCOPES = ["pages_show_list", "pages_messaging", "pages_manage_metadata"];

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
    err.type = json?.error?.type;
    err.status = res.status;
    err.payload = json;
    metaTrace("graph.error", {
      path: String(path).slice(0, 120),
      method,
      status: res.status,
      code: err.code,
      type: err.type,
      message: err.message,
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

  const accountsAudited = await graphRequestAudited("/me/accounts", {
    token,
    query: { fields: ME_ACCOUNTS_FIELDS, limit: "100" },
    auditLabel: `${phase}.me_accounts_only`,
  });

  let meAccounts = {
    pages: [],
    rawCount: 0,
    paging: null,
    httpStatus: accountsAudited.status,
    requestUrl: accountsAudited.requestUrl,
    error: accountsAudited.ok ? null : accountsAudited.error,
    rawBody: redactGraphPayload(accountsAudited.json),
  };

  if (accountsAudited.ok) {
    const data = normalizeMeAccountsPages(accountsAudited.json?.data);
    meAccounts.pages = data;
    meAccounts.rawCount = data.length;
    meAccounts.paging = accountsAudited.json?.paging || null;
    metaTrace("oauth.sequence.me_accounts", {
      sequenceStep: opts.sequenceStep,
      tokenType,
      pageCount: data.length,
      token: tokenHint(token),
      graphVersion: metaGraphApiVersion(),
      requestUrl: accountsAudited.requestUrl,
      httpStatus: accountsAudited.status,
      calledBeforeTokenReplaceInMemory: opts.calledBeforeTokenReplaceInMemory === true,
      calledAfterTokenReplaceInMemory: opts.calledAfterTokenReplaceInMemory === true,
      rawResponse: redactGraphPayload(accountsAudited.json),
    });
  } else {
    metaTrace("oauth.sequence.me_accounts_error", {
      sequenceStep: opts.sequenceStep,
      tokenType,
      pageCount: 0,
      token: tokenHint(token),
      graphVersion: metaGraphApiVersion(),
      requestUrl: accountsAudited.requestUrl,
      httpStatus: accountsAudited.status,
      errorBody: redactGraphPayload(accountsAudited.json),
    });
  }

  const debug = await debugAccessToken(token, {
    auditLabel: `${phase}.debug_token_after_me_accounts`,
  });

  metaTrace("oauth.sequence.debug_token", {
    sequenceStep: opts.sequenceStep,
    tokenType,
    token: tokenHint(token),
    scopes: debug.scopes,
    granularScopesNote: "logged_only_not_used_for_page_fetch",
    granularScopes: serializeGranularScopes(debug.granularScopes),
    isValid: debug.isValid,
    userId: debug.userId,
  });

  return { tokenType, phase, token: tokenHint(token), meAccounts, debug };
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

  metaTrace("oauth.sequence.compare", {
    step: 4,
    ...scopeCompare,
    pageVisibilityDifference: {
      shortMeAccounts: shortMeCount,
      longMeAccounts: longMeCount,
      delta: shortMeCount - longMeCount,
    },
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
  const json = await graphRequest("/me/accounts", {
    token: userAccessToken,
    query: {
      fields: ME_ACCOUNTS_FIELDS,
      limit: "100",
    },
  });
  const pages = normalizeMeAccountsPages(json.data);
  return {
    pages,
    paging: json.paging || null,
    rawCount: pages.length,
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
  try {
    verify = await getPageSubscribedApps(pid, pageAccessToken);
    metaTrace("subscribed_apps.verify", {
      pageId: pid,
      data: verify?.data,
    });
  } catch (e) {
    metaTrace("subscribed_apps.verify_failed", {
      pageId: pid,
      message: e?.message || String(e),
      code: e?.code,
    });
  }

  return { subscribeResult: result, verifyResult: verify };
}

/**
 * @param {string} pageId
 * @param {string} psid
 * @param {string} pageAccessToken
 * @param {string} text
 */
async function sendMessengerText(pageId, psid, pageAccessToken, text) {
  return graphRequest(`/${pageId}/messages`, {
    method: "POST",
    token: pageAccessToken,
    body: {
      recipient: { id: String(psid) },
      messaging_type: "RESPONSE",
      message: { text: String(text).slice(0, 2000) },
    },
  });
}

/**
 * @param {string} psid
 * @param {string} pageAccessToken
 */
async function fetchMessengerUserProfile(psid, pageAccessToken) {
  try {
    return await graphRequest(`/${psid}`, {
      token: pageAccessToken,
      query: { fields: "first_name,last_name,profile_pic" },
    });
  } catch (e) {
    console.warn("[metaGraph] profile fetch:", e?.message || e);
    return null;
  }
}

module.exports = {
  graphRequest,
  graphRequestAudited,
  META_OAUTH_SCOPES,
  exchangeCodeForUserToken,
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
  sendMessengerText,
  fetchMessengerUserProfile,
};
