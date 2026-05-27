/**
 * Messenger (Page) Graph API diagnostics — token type, page ownership, send endpoint probes.
 */

const { metaAppId, metaAppSecret, metaGraphApiVersion, metaGraphBaseUrl } = require("./metaConfig");
const { debugAccessToken, ME_ACCOUNTS_FIELDS, graphRequestAudited } = require("./metaGraph");
const { lookupPageClinicMapping } = require("./metaPageConnections");
const { getActivePageConnectionByPageId, pageAccessTokenFromRow } = require("./metaPageConnections");
const { tokenHint, redactGraphPayload } = require("./metaDebug");
const { buildMessengerSendUrls } = require("./metaGraph");

const PAGE_MESSAGING_SCOPES = ["pages_messaging", "pages_manage_metadata", "pages_show_list"];

const RECONNECT_CTA =
  "Sign in to Facebook again: open this page, click «Connect Facebook» or «Retry permissions», complete login, then save your Page.";

/**
 * @param {{
 *   token?: string,
 *   tokenDebug?: { isValid?: boolean, type?: string|null, expiresAt?: number|null }|null,
 *   scopeAnalysis?: { likelyCanSendMessenger?: boolean },
 *   pageGet?: { ok?: boolean, json?: { error?: { code?: number } } },
 * }} ctx
 */
function evaluateFacebookReconnectNeed(ctx) {
  const token = String(ctx.token || "").trim();
  const tokenDebug = ctx.tokenDebug;
  const pageGet = ctx.pageGet;
  const graphCode = pageGet?.json?.error?.code;
  const scopeOk = ctx.scopeAnalysis?.likelyCanSendMessenger !== false;

  if (!token) {
    return { needed: true, reason: "no_page_token", summary: "No Page access token is stored for this connection." };
  }
  if (tokenDebug && tokenDebug.isValid === false) {
    return {
      needed: true,
      reason: "invalid_token",
      summary: "Stored token is no longer valid (revoked, expired, or wrong Meta app).",
    };
  }
  const tokenType = String(tokenDebug?.type || "").toUpperCase();
  if (tokenType === "USER") {
    return {
      needed: true,
      reason: "user_token_not_page",
      summary: "A User token was stored instead of a Page token — Messenger requires a Page token from OAuth.",
    };
  }
  if (graphCode === 190) {
    return { needed: true, reason: "expired_token", summary: "Page access token has expired." };
  }
  if (pageGet?.ok === false && graphCode === 100) {
    return {
      needed: true,
      reason: "page_token_mismatch",
      summary:
        "Stored token cannot access this Facebook Page (wrong page, wrong token type, or outdated after permission changes).",
    };
  }
  if (token && !scopeOk) {
    return {
      needed: true,
      reason: "missing_messenger_scopes",
      summary: "Token is missing pages_messaging (and related) permissions.",
    };
  }
  return { needed: false, reason: null, summary: null };
}

/**
 * @param {string[]} scopes
 */
function analyzePageMessagingScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes.map((s) => String(s)) : [];
  return {
    scopes: list,
    hasPagesMessaging: list.includes("pages_messaging"),
    likelyCanSendMessenger: list.includes("pages_messaging"),
  };
}

/**
 * @param {string} token
 */
function classifyPageTokenShape(token) {
  const t = String(token || "").trim();
  if (!t) return { present: false, likelyKind: "missing" };
  const hint = tokenHint(t);
  let likelyKind = "unknown";
  if (t.startsWith("EAA")) likelyKind = "page_or_user_token";
  if (t.length > 200) likelyKind = "long_lived_user_or_system";
  return { ...hint, likelyKind };
}

/**
 * @param {{ pageId?: string, psid?: string, accessToken?: string, clinicId?: string }} [opts]
 */
async function runMessengerGraphDiagnostics(opts = {}) {
  const pageId = String(opts.pageId || "").trim();
  const psid = String(opts.psid || "").trim();
  const clinicId = String(opts.clinicId || "").trim();

  let token = String(opts.accessToken || "").trim();
  let tokenSource = opts.accessToken ? "request_param" : null;
  let pageRow = null;

  if (pageId && !token) {
    pageRow = await getActivePageConnectionByPageId(pageId);
    token = pageRow ? pageAccessTokenFromRow(pageRow) || "" : "";
    tokenSource = pageRow ? "meta_page_connections.page_access_token_enc" : null;
  }

  const mapping = pageId ? await lookupPageClinicMapping(pageId) : null;
  const tokenShape = classifyPageTokenShape(token);
  const tokenDebug = token ? await debugAccessToken(token, { auditLabel: "messenger.diagnostics" }) : null;
  const scopeAnalysis = analyzePageMessagingScopes(tokenDebug?.scopes || []);

  const sendUrls = pageId ? buildMessengerSendUrls(pageId) : null;

  const pageGet = pageId && token
    ? await graphRequestAudited(`/${pageId}`, {
        token,
        query: { fields: "id,name,category" },
        auditLabel: "messenger.diagnostics.page_get",
      })
    : { ok: false, error: { message: "page_id_or_token_missing" } };

  const meAccounts = token
    ? await graphRequestAudited("/me/accounts", {
        token,
        query: { fields: ME_ACCOUNTS_FIELDS, limit: "50" },
        auditLabel: "messenger.diagnostics.me_accounts",
      })
    : { ok: false, error: { message: "token_missing" } };

  const pageInAccounts =
    pageId && meAccounts.ok && Array.isArray(meAccounts.json?.data)
      ? meAccounts.json.data.some((p) => String(p.id) === pageId)
      : null;

  const reconnect = evaluateFacebookReconnectNeed({
    token,
    tokenDebug,
    scopeAnalysis,
    pageGet,
  });

  /** @type {string[]} */
  const findings = [];
  if (!pageId) findings.push("page_id missing — connect a Page first");
  if (!token) {
    findings.push("Page access token missing — no Messenger send until Facebook is connected.");
  }
  if (tokenDebug && tokenDebug.isValid === false) {
    findings.push("Stored Facebook token is not valid — permissions may have been removed in Meta.");
  }
  if (tokenDebug && String(tokenDebug.type || "").toUpperCase() === "USER") {
    findings.push("Wrong token type (USER, not PAGE) — save again after Facebook login.");
  }
  if (token && !scopeAnalysis.likelyCanSendMessenger) {
    findings.push("Missing pages_messaging permission — use «Retry permissions» when signing in.");
  }
  if (pageGet.ok === false && pageGet.json?.error?.code === 190) {
    findings.push("Graph error 190: access token expired.");
  }
  if (pageGet.ok === false && pageGet.json?.error?.code === 100) {
    findings.push(
      "Graph error 100: token does not match this Page (invalid, revoked, or wrong token type).",
    );
  }
  if (reconnect.needed) {
    findings.push(`Action required — ${RECONNECT_CTA}`);
  }
  if (pageRow && clinicId && String(pageRow.clinic_id) !== clinicId) {
    findings.push("active page connection clinic_id does not match session clinic");
  }
  if (mapping?.found && mapping.connectionStatus !== "active") {
    findings.push(`page mapping status=${mapping.connectionStatus} (need active)`);
  }
  if (meAccounts.ok && pageInAccounts === false && pageGet.ok) {
    findings.push(
      "token validates page GET but page not listed in /me/accounts — still OK if using stored Page token from OAuth",
    );
  }
  if (psid && !/^\d{6,20}$/.test(psid)) {
    findings.push("psid format invalid — must be numeric Page-Scoped ID from webhook sender.id");
  }

  return {
    graphApiVersion: metaGraphApiVersion(),
    graphBaseUrl: metaGraphBaseUrl(),
    metaAppId: metaAppId() || null,
    pageId: pageId || null,
    psid: psid || null,
    psidLooksValid: psid ? /^\d{6,20}$/.test(psid) : null,
    clinicMapping: mapping,
    sessionClinicId: clinicId || null,
    pageConnection: pageRow
      ? {
          id: pageRow.id,
          clinicId: pageRow.clinic_id,
          webhookSubscribed: pageRow.webhook_subscribed,
          status: pageRow.status,
        }
      : null,
    auth: {
      tokenSource,
      tokenShape,
      pageTokenRequired: true,
      userTokenCannotSendMessenger: "Messenger send requires Page Access Token from connected Page",
    },
    tokenDebug: tokenDebug
      ? {
          isValid: tokenDebug.isValid,
          type: tokenDebug.type,
          userId: tokenDebug.userId,
          appId: tokenDebug.appId,
          scopes: tokenDebug.scopes,
          granularScopes: tokenDebug.granularScopes,
          ...scopeAnalysis,
          requiredScopesHint: PAGE_MESSAGING_SCOPES,
        }
      : null,
    probes: {
      pageGet: {
        ok: pageGet.ok,
        status: pageGet.status,
        requestUrl: pageGet.requestUrl,
        body: redactGraphPayload(pageGet.json),
        error: pageGet.error || null,
      },
      meAccounts: {
        ok: meAccounts.ok,
        status: meAccounts.status,
        requestUrl: meAccounts.requestUrl,
        pageListed: pageInAccounts,
        pageCount: Array.isArray(meAccounts.json?.data) ? meAccounts.json.data.length : 0,
        error: meAccounts.error || null,
      },
    },
    sendApi: {
      recommended: "POST /me/messages (Page Access Token) or POST /{page-id}/messages",
      urls: sendUrls,
      recipientFormat: { id: "<PSID from webhook messaging.sender.id>" },
      messagingType: "RESPONSE",
    },
    findings,
    needsFacebookReconnect: reconnect.needed,
    reconnectReason: reconnect.reason,
    reconnectSummary: reconnect.summary,
    actionRequired: reconnect.needed
      ? `${reconnect.summary || "Facebook connection must be refreshed."} ${RECONNECT_CTA}`
      : null,
    inboundOutboundConsistency: pageId
      ? {
          hint: "Inbound webhooks and outbound send must use the same page_id from meta_page_connections",
          pageId,
          mappingActive: mapping?.found && mapping.connectionStatus === "active",
        }
      : null,
  };
}

module.exports = {
  runMessengerGraphDiagnostics,
  analyzePageMessagingScopes,
  classifyPageTokenShape,
  evaluateFacebookReconnectNeed,
  RECONNECT_CTA,
};
