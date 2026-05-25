/**
 * Meta Graph API client (Pages, Messenger send, OAuth token exchange).
 */

const {
  metaAppId,
  metaAppSecret,
  metaGraphBaseUrl,
  metaOAuthRedirectUri,
} = require("./metaConfig");
const { metaTrace, tokenHint } = require("./metaDebug");

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
 * Inspect granted scopes (explains empty /me/accounts).
 * @param {string} userAccessToken
 */
async function debugAccessToken(userAccessToken) {
  const appToken = `${metaAppId()}|${metaAppSecret()}`;
  try {
    const json = await graphRequest("/debug_token", {
      token: appToken,
      query: {
        input_token: String(userAccessToken || "").trim(),
        fields: "app_id,user_id,application,type,expires_at,is_valid,scopes,granular_scopes",
      },
    });
    const d = json?.data && typeof json.data === "object" ? json.data : {};
    return {
      isValid: d.is_valid === true,
      userId: d.user_id || null,
      scopes: Array.isArray(d.scopes) ? d.scopes : [],
      granularScopes: Array.isArray(d.granular_scopes) ? d.granular_scopes : [],
      expiresAt: d.expires_at || null,
    };
  } catch (e) {
    metaTrace("debug_token.failed", { message: e?.message || String(e), code: e?.code });
    return { isValid: false, scopes: [], granularScopes: [], error: e?.message || String(e) };
  }
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
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  debugAccessToken,
  fetchManagedPages,
  getPageSubscribedApps,
  subscribePageToApp,
  PAGE_SUBSCRIBED_FIELDS,
  sendMessengerText,
  fetchMessengerUserProfile,
};
