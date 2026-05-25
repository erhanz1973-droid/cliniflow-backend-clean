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

/** Scopes for Page list + Page tokens + Business Manager–linked Pages. */
const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "business_management",
];

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
/**
 * Page IDs from granular_scopes (OAuth picker) — requires pages_read_engagement on Page node.
 * @param {string[]} pageIds
 * @param {string} userAccessToken
 * @param {string} auditLabel
 */
async function fetchPagesByGranularIds(pageIds, userAccessToken, auditLabel) {
  const pages = [];
  const fieldAttempts = [
    "access_token,id,name",
    "access_token",
  ];

  for (const pageId of pageIds) {
    let row = null;
    for (const fields of fieldAttempts) {
      const audited = await graphRequestAudited(`/${pageId}`, {
        token: userAccessToken,
        query: { fields },
        auditLabel: `${auditLabel}.granular_page/${pageId}`,
      });
      if (audited.ok && audited.json?.access_token) {
        row = audited.json;
        metaTrace("oauth.granular_page.ok", {
          auditLabel,
          pageId,
          fields,
          hasPageToken: true,
        });
        break;
      }
      if (!audited.ok) {
        metaTrace("oauth.granular_page.failed", {
          auditLabel,
          pageId,
          fields,
          status: audited.status,
          graphVersion: metaGraphApiVersion(),
          requestUrl: audited.requestUrl,
          error: audited.error,
          errorBody: redactGraphPayload(audited.json),
          hint:
            "Grant pages_read_engagement in OAuth and re-connect; required for Page access_token on granular Page IDs",
        });
      }
    }
    if (row?.id && row?.access_token) {
      pages.push({
        id: row.id,
        name: row.name || pageId,
        access_token: row.access_token,
        category: row.category,
        tasks: row.tasks,
      });
    }
  }
  return pages;
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
    query: { fields: "id,name,access_token,category,tasks", limit: "100" },
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
    const data = Array.isArray(accountsAudited.json?.data) ? accountsAudited.json.data : [];
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
    granularScopes: serializeGranularScopes(debug.granularScopes),
    granularPageIds: pageIdsFromGranularScopes(debug),
    isValid: debug.isValid,
    userId: debug.userId,
    hasPagesReadEngagement: (debug.scopes || []).includes("pages_read_engagement"),
    hasBusinessManagement: (debug.scopes || []).includes("business_management"),
  });

  return { tokenType, phase, token: tokenHint(token), meAccounts, debug };
}

/**
 * Extended discovery when /me/accounts is empty (nested /me, user id, granular).
 * @param {string} phaseLabel
 * @param {string} userAccessToken
 * @param {Awaited<ReturnType<typeof debugAccessToken>>} debug
 */
async function discoverPagesWithFallbacks(phaseLabel, userAccessToken, debug) {
  const token = String(userAccessToken || "").trim();
  const phase = String(phaseLabel || "unknown").trim();

  let meNested = { pages: [], rawCount: 0 };
  const nestedAudited = await graphRequestAudited("/me", {
    token,
    query: { fields: "accounts{id,name,access_token,category,tasks}" },
    auditLabel: `${phase}.me_nested_accounts`,
  });
  if (nestedAudited.ok) {
    const accounts = nestedAudited.json?.accounts;
    const data = Array.isArray(accounts?.data) ? accounts.data : [];
    meNested = { pages: data, rawCount: data.length };
    metaTrace("oauth.fallback.me_nested.raw", {
      phase,
      dataCount: data.length,
      rawBody: redactGraphPayload(nestedAudited.json),
    });
  }

  let userAccounts = { pages: [], rawCount: 0 };
  if (!meNested.pages.length && debug.userId) {
    const uid = String(debug.userId).trim();
    const userAccountsAudited = await graphRequestAudited(`/${uid}/accounts`, {
      token,
      query: { fields: "id,name,access_token,category,tasks", limit: "100" },
      auditLabel: `${phase}.user_id_accounts`,
    });
    if (userAccountsAudited.ok) {
      const data = Array.isArray(userAccountsAudited.json?.data) ? userAccountsAudited.json.data : [];
      userAccounts = { pages: data, rawCount: data.length };
      metaTrace("oauth.fallback.user_accounts.raw", {
        phase,
        userId: uid,
        dataCount: data.length,
        rawBody: redactGraphPayload(userAccountsAudited.json),
      });
    }
  }

  const granularPageIds = pageIdsFromGranularScopes(debug);
  metaTrace("oauth.fallback.granular_page_ids", {
    phase,
    pageIds: granularPageIds,
    granularScopes: serializeGranularScopes(debug.granularScopes),
  });

  let granularPages = [];
  if (!meNested.pages.length && !userAccounts.pages.length && granularPageIds.length) {
    granularPages = await fetchPagesByGranularIds(granularPageIds, token, phase);
    metaTrace("oauth.fallback.granular_pages", {
      phase,
      requested: granularPageIds.length,
      resolved: granularPages.length,
    });
  }

  let pages = [];
  let pageSource = "none";
  if (meNested.pages.length) {
    pages = meNested.pages;
    pageSource = "me.accounts_nested";
  } else if (userAccounts.pages.length) {
    pages = userAccounts.pages;
    pageSource = "user_id/accounts";
  } else if (granularPages.length) {
    pages = granularPages;
    pageSource = "granular_scopes";
  }

  return { pages, pageSource, granularPageIds };
}

/**
 * Steps 4–6: compare probes, short-/me/accounts fallback, then extended fallbacks.
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
    shortGranular: shortProbe.debug?.granularScopes || [],
    longGranular: longProbe.debug?.granularScopes || [],
    shortMeAccountsPageCount: shortMeCount,
    longMeAccountsPageCount: longMeCount,
    tokensDiffer: shortToken !== longToken,
    longLivedLostMeAccountsPages: shortMeCount > 0 && longMeCount === 0 && shortToken !== longToken,
    shortLivedGainedMeAccountsPages: shortMeCount === 0 && longMeCount > 0 && shortToken !== longToken,
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

  if (!pages.length) {
    metaTrace("oauth.sequence.extended_fallbacks", {
      step: 6,
      reason: "me_accounts_empty_both_tokens",
      shortGranularIds: pageIdsFromGranularScopes(shortProbe.debug),
      longGranularIds: pageIdsFromGranularScopes(longProbe.debug),
    });
    const shortExt = await discoverPagesWithFallbacks("short_lived_before_exchange", shortToken, shortProbe.debug);
    if (shortExt.pages.length) {
      pages = shortExt.pages;
      pageSource = shortExt.pageSource;
      chosenPhase = "short_lived_extended_fallback";
    } else {
      const longExt = await discoverPagesWithFallbacks("long_lived_after_exchange", longToken, longProbe.debug);
      if (longExt.pages.length) {
        pages = longExt.pages;
        pageSource = longExt.pageSource;
        chosenPhase = "long_lived_extended_fallback";
      }
    }
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
  META_OAUTH_SCOPES,
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  debugAccessToken,
  probeMeAccountsOAuthStep,
  finalizeOAuthPageDiscovery,
  discoverPagesWithFallbacks,
  auditTokenForPages,
  resolveOAuthPages,
  fetchManagedPages,
  getPageSubscribedApps,
  subscribePageToApp,
  PAGE_SUBSCRIBED_FIELDS,
  sendMessengerText,
  fetchMessengerUserProfile,
};
