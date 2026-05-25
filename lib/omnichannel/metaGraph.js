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
 * @param {string} userAccessToken
 */
async function fetchManagedPages(userAccessToken) {
  const json = await graphRequest("/me/accounts", {
    token: userAccessToken,
    query: {
      fields: "id,name,access_token,category,tasks",
      limit: "100",
    },
  });
  return Array.isArray(json.data) ? json.data : [];
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
  fetchManagedPages,
  getPageSubscribedApps,
  subscribePageToApp,
  PAGE_SUBSCRIBED_FIELDS,
  sendMessengerText,
  fetchMessengerUserProfile,
};
