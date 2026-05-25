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
const { metaTrace, tokenHint, graphUrlForLog, redactGraphPayload } = require("./metaDebug");

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
  metaTrace("graph.audit.request", {
    label,
    tokenPhase: label.split(".")[0] || label,
    tokenType: "user_access_token",
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
    body: redactGraphPayload(json),
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
 * Page IDs granted via Meta's per-Page permission picker (granular_scopes).
 * @param {{ granularScopes?: Array<{ scope?: string, target_ids?: string[] }> }} debug
 */
function pageIdsFromGranularScopes(debug) {
  const ids = new Set();
  const pageScopes = new Set([
    "pages_show_list",
    "pages_messaging",
    "pages_manage_metadata",
    "pages_read_engagement",
  ]);
  for (const g of debug?.granularScopes || []) {
    const scope = String(g?.scope || "").trim();
    if (!pageScopes.has(scope)) continue;
    for (const id of g?.target_ids || []) {
      const pid = String(id || "").trim();
      if (pid) ids.add(pid);
    }
  }
  return [...ids];
}

/**
 * Fetch Page records by ID when /me/accounts is empty but OAuth UI listed Pages.
 * @param {string[]} pageIds
 * @param {string} userAccessToken
 * @param {string} auditLabel
 */
async function fetchPagesByGranularIds(pageIds, userAccessToken, auditLabel) {
  const pages = [];
  for (const pageId of pageIds) {
    const audited = await graphRequestAudited(`/${pageId}`, {
      token: userAccessToken,
      query: { fields: "id,name,access_token,category,tasks" },
      auditLabel: `${auditLabel}.granular_page/${pageId}`,
    });
    if (!audited.ok) {
      metaTrace("oauth.granular_page.failed", {
        auditLabel,
        pageId,
        status: audited.status,
        error: audited.error,
      });
      continue;
    }
    const row = audited.json;
    if (row?.id && row?.access_token) {
      pages.push(row);
    } else {
      metaTrace("oauth.granular_page.incomplete", {
        auditLabel,
        pageId,
        hasId: Boolean(row?.id),
        hasPageToken: Boolean(row?.access_token),
        body: redactGraphPayload(row),
      });
    }
  }
  return pages;
}

/**
 * Deep audit: debug_token + /me/accounts + nested /me + granular page fetches.
 * @param {string} phaseLabel e.g. short_lived | long_lived
 * @param {string} userAccessToken
 */
async function auditTokenForPages(phaseLabel, userAccessToken) {
  const token = String(userAccessToken || "").trim();
  const phase = String(phaseLabel || "unknown").trim();

  metaTrace("oauth.page_fetch.start", {
    phase,
    tokenType: "user_access_token",
    token: tokenHint(token),
    graphVersion: metaGraphApiVersion(),
    graphBase: metaGraphBaseUrl(),
  });

  const debug = await debugAccessToken(token, { auditLabel: `${phase}.debug_token` });

  let meAccounts = { pages: [], rawCount: 0, paging: null, httpStatus: null, error: null };
  const accountsAudited = await graphRequestAudited("/me/accounts", {
    token,
    query: { fields: "id,name,access_token,category,tasks", limit: "100" },
    auditLabel: `${phase}.me_accounts`,
  });
  if (accountsAudited.ok) {
    const data = Array.isArray(accountsAudited.json?.data) ? accountsAudited.json.data : [];
    meAccounts = {
      pages: data,
      rawCount: data.length,
      paging: accountsAudited.json?.paging || null,
      httpStatus: accountsAudited.status,
      error: null,
    };
    metaTrace("oauth.me_accounts.raw", {
      phase,
      token: tokenHint(token),
      graphVersion: metaGraphApiVersion(),
      requestUrl: accountsAudited.requestUrl,
      httpStatus: accountsAudited.status,
      dataCount: data.length,
      pageIds: data.map((p) => p.id),
      pageNames: data.map((p) => p.name),
      rawBody: redactGraphPayload(accountsAudited.json),
    });
  } else {
    meAccounts.error = accountsAudited.error;
    meAccounts.httpStatus = accountsAudited.status;
    metaTrace("oauth.me_accounts.error", {
      phase,
      token: tokenHint(token),
      graphVersion: metaGraphApiVersion(),
      requestUrl: accountsAudited.requestUrl,
      httpStatus: accountsAudited.status,
      errorBody: redactGraphPayload(accountsAudited.json),
    });
  }

  let meNested = { pages: [], rawCount: 0, httpStatus: null, error: null };
  if (!meAccounts.pages.length) {
    const nestedAudited = await graphRequestAudited("/me", {
      token,
      query: { fields: "accounts{id,name,access_token,category,tasks}" },
      auditLabel: `${phase}.me_nested_accounts`,
    });
    if (nestedAudited.ok) {
      const accounts = nestedAudited.json?.accounts;
      const data = Array.isArray(accounts?.data) ? accounts.data : [];
      meNested = { pages: data, rawCount: data.length, httpStatus: nestedAudited.status, error: null };
      metaTrace("oauth.me_nested.raw", {
        phase,
        token: tokenHint(token),
        graphVersion: metaGraphApiVersion(),
        requestUrl: nestedAudited.requestUrl,
        dataCount: data.length,
        rawBody: redactGraphPayload(nestedAudited.json),
      });
    } else {
      meNested.error = nestedAudited.error;
      meNested.httpStatus = nestedAudited.status;
      metaTrace("oauth.me_nested.error", {
        phase,
        token: tokenHint(token),
        requestUrl: nestedAudited.requestUrl,
        httpStatus: nestedAudited.status,
        errorBody: redactGraphPayload(nestedAudited.json),
      });
    }
  }

  let userAccounts = { pages: [], rawCount: 0, httpStatus: null, error: null };
  if (!meAccounts.pages.length && !meNested.pages.length && debug.userId) {
    const uid = String(debug.userId).trim();
    const userAccountsAudited = await graphRequestAudited(`/${uid}/accounts`, {
      token,
      query: { fields: "id,name,access_token,category,tasks", limit: "100" },
      auditLabel: `${phase}.user_id_accounts`,
    });
    if (userAccountsAudited.ok) {
      const data = Array.isArray(userAccountsAudited.json?.data) ? userAccountsAudited.json.data : [];
      userAccounts = {
        pages: data,
        rawCount: data.length,
        httpStatus: userAccountsAudited.status,
        error: null,
      };
      metaTrace("oauth.user_accounts.raw", {
        phase,
        userId: uid,
        token: tokenHint(token),
        graphVersion: metaGraphApiVersion(),
        requestUrl: userAccountsAudited.requestUrl,
        dataCount: data.length,
        rawBody: redactGraphPayload(userAccountsAudited.json),
      });
    } else {
      userAccounts.error = userAccountsAudited.error;
      userAccounts.httpStatus = userAccountsAudited.status;
      metaTrace("oauth.user_accounts.error", {
        phase,
        userId: uid,
        token: tokenHint(token),
        requestUrl: userAccountsAudited.requestUrl,
        errorBody: redactGraphPayload(userAccountsAudited.json),
      });
    }
  }

  const granularPageIds = pageIdsFromGranularScopes(debug);
  metaTrace("oauth.granular_scope.page_ids", {
    phase,
    pageIds: granularPageIds,
    granularScopes: debug.granularScopes,
  });

  let granularPages = [];
  const listEndpointsEmpty =
    !meAccounts.pages.length && !meNested.pages.length && !userAccounts.pages.length;
  if (listEndpointsEmpty && granularPageIds.length) {
    granularPages = await fetchPagesByGranularIds(granularPageIds, token, phase);
    metaTrace("oauth.granular_pages.result", {
      phase,
      requested: granularPageIds.length,
      resolved: granularPages.length,
    });
  }

  let pages = [];
  let pageSource = "none";
  if (meAccounts.pages.length) {
    pages = meAccounts.pages;
    pageSource = "me/accounts";
  } else if (meNested.pages.length) {
    pages = meNested.pages;
    pageSource = "me.accounts_nested";
  } else if (userAccounts.pages.length) {
    pages = userAccounts.pages;
    pageSource = "user_id/accounts";
  } else if (granularPages.length) {
    pages = granularPages;
    pageSource = "granular_scopes";
  }

  const audit = {
    phase,
    token: tokenHint(token),
    graphVersion: metaGraphApiVersion(),
    debug,
    meAccounts,
    meNested,
    userAccounts,
    granularPageIds,
    pageCount: pages.length,
    pageSource,
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      hasPageToken: Boolean(p.access_token),
    })),
  };

  metaTrace("oauth.page_fetch_result", audit);
  return { pages, debug, pageSource, audit, granularPageIds, meAccounts, meNested, userAccounts };
}

/**
 * Compare short- (pre-exchange) vs long-lived (post-exchange) tokens.
 * Page discovery always prefers the short-lived audit when it returns Pages.
 * @param {string} shortLivedUserToken
 * @param {string} longLivedUserToken
 * @param {{ shortAuditPreExchange?: Awaited<ReturnType<typeof auditTokenForPages>> }} [opts]
 */
async function resolveOAuthPages(shortLivedUserToken, longLivedUserToken, opts = {}) {
  const shortToken = String(shortLivedUserToken || "").trim();
  const longToken = String(longLivedUserToken || "").trim();
  const sameToken = shortToken && longToken && shortToken === longToken;

  metaTrace("oauth.page_resolution.start", {
    policy: "discover_pages_with_short_lived_before_exchange",
    shortToken: tokenHint(shortToken),
    longToken: tokenHint(longToken),
    sameToken,
    graphVersion: metaGraphApiVersion(),
    hasPreExchangeAudit: Boolean(opts.shortAuditPreExchange),
  });

  const shortAudit =
    opts.shortAuditPreExchange || (await auditTokenForPages("short_lived_before_exchange", shortToken));
  if (opts.shortAuditPreExchange) {
    metaTrace("oauth.page_resolution.short_pre_exchange_reused", {
      pageCount: shortAudit.pages.length,
      pageSource: shortAudit.pageSource,
      meAccountsCount: shortAudit.meAccounts?.rawCount ?? 0,
    });
  }

  let longAudit;
  if (sameToken) {
    metaTrace("oauth.page_resolution.long_skipped", {
      reason: "short_and_long_token_identical",
      note: "Long-lived exchange did not change token; post-exchange audit not re-run",
    });
    longAudit = shortAudit;
  } else {
    longAudit = await auditTokenForPages("long_lived_after_exchange", longToken);
  }

  let pages = [];
  let discoveryToken = shortToken;
  let pageSource = "none";
  let chosenPhase = "none";

  if (shortAudit.pages.length) {
    pages = shortAudit.pages;
    discoveryToken = shortToken;
    pageSource = shortAudit.pageSource;
    chosenPhase = "short_lived_before_exchange";
  } else if (longAudit.pages.length) {
    pages = longAudit.pages;
    discoveryToken = longToken;
    pageSource = longAudit.pageSource;
    chosenPhase = "long_lived_after_exchange_fallback";
  }

  const scopeCompare = {
    shortScopes: shortAudit.debug?.scopes || [],
    longScopes: longAudit.debug?.scopes || [],
    shortGranular: shortAudit.debug?.granularScopes || [],
    longGranular: longAudit.debug?.granularScopes || [],
    shortPageCount: shortAudit.pages.length,
    longPageCount: longAudit.pages.length,
    shortMeAccountsCount: shortAudit.meAccounts?.rawCount ?? 0,
    longMeAccountsCount: longAudit.meAccounts?.rawCount ?? 0,
    shortSource: shortAudit.pageSource,
    longSource: longAudit.pageSource,
    tokensDiffer: !sameToken,
    longLivedLostPages:
      shortAudit.pages.length > 0 && longAudit.pages.length === 0 && !sameToken,
    shortLivedGainedPages:
      shortAudit.pages.length === 0 && longAudit.pages.length > 0 && !sameToken,
  };

  metaTrace("oauth.token_transition.compare", scopeCompare);

  metaTrace("oauth.page_resolution.chosen", {
    chosenPhase,
    pageCount: pages.length,
    pageSource,
    discoveryToken: tokenHint(discoveryToken),
    longLivedUserToken: tokenHint(longToken),
    reason:
      chosenPhase === "short_lived_before_exchange"
        ? "short_lived_page_discovery"
        : chosenPhase === "long_lived_after_exchange_fallback"
          ? "short_empty_long_had_pages"
          : "both_tokens_empty_all_endpoints",
  });

  return {
    pages,
    tokenUsed: discoveryToken,
    longLivedUserToken: longToken,
    shortLivedUserToken: shortToken,
    pageSource,
    chosenPhase,
    shortAudit,
    longAudit,
    scopeCompare,
  };
}

/**
 * @param {string} userAccessToken
 */
async function fetchManagedPagesFromAccountsEndpoint(userAccessToken) {
  const json = await graphRequest("/me/accounts", {
    token: userAccessToken,
    query: {
      fields: "id,name,access_token,category,tasks",
      limit: "100",
    },
  });
  return {
    pages: Array.isArray(json.data) ? json.data : [],
    paging: json.paging || null,
    rawCount: Array.isArray(json.data) ? json.data.length : 0,
  };
}

/**
 * Alternate Graph shape when /me/accounts returns empty.
 * @param {string} userAccessToken
 */
async function fetchManagedPagesFromMeNested(userAccessToken) {
  const json = await graphRequest("/me", {
    token: userAccessToken,
    query: {
      fields: "accounts{id,name,access_token,category,tasks}",
    },
  });
  const accounts = json?.accounts;
  const pages = Array.isArray(accounts?.data) ? accounts.data : [];
  return { pages, rawCount: pages.length };
}

/**
 * List Facebook Pages the user can manage (Page access tokens for Messenger).
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

  let primary = { pages: [], rawCount: 0, paging: null };
  try {
    primary = await fetchManagedPagesFromAccountsEndpoint(token);
    metaTrace("fetchManagedPages.me_accounts", { count: primary.rawCount, paging: primary.paging });
  } catch (e) {
    metaTrace("fetchManagedPages.me_accounts_error", { message: e?.message || String(e), code: e?.code });
  }

  if (primary.pages.length) {
    return { pages: primary.pages, debug, source: "me/accounts" };
  }

  let nested = { pages: [], rawCount: 0 };
  try {
    nested = await fetchManagedPagesFromMeNested(token);
    metaTrace("fetchManagedPages.me_nested", { count: nested.rawCount });
  } catch (e) {
    metaTrace("fetchManagedPages.me_nested_error", { message: e?.message || String(e), code: e?.code });
  }

  if (nested.pages.length) {
    return { pages: nested.pages, debug, source: "me.accounts_nested" };
  }

  metaTrace("fetchManagedPages.empty", {
    hint:
      "Facebook returned zero Pages for this user. Use a profile that is Admin on a Facebook Page, grant pages_show_list, or create a Page at facebook.com/pages/create",
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
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  debugAccessToken,
  auditTokenForPages,
  resolveOAuthPages,
  fetchManagedPages,
  getPageSubscribedApps,
  subscribePageToApp,
  PAGE_SUBSCRIBED_FIELDS,
  sendMessengerText,
  fetchMessengerUserProfile,
};
