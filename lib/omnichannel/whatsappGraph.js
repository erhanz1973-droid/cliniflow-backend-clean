/**
 * WhatsApp Cloud API Graph calls (Bearer auth, separate from Messenger query-token).
 */

const { metaGraphApiVersion, metaGraphBaseUrl } = require("./metaConfig");
const { whatsappAccessToken } = require("./whatsappConfig");
const { debugAccessToken } = require("./metaGraph");
const { metaTrace, tokenHint, redactGraphPayload } = require("./metaDebug");

/**
 * @param {string} path
 * @param {Record<string, string>} [query]
 */
function buildWhatsAppGraphUrl(path, query = {}) {
  const base = metaGraphBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && String(v).trim() !== "") url.searchParams.set(k, String(v));
  }
  return url;
}

/**
 * @param {string} token
 */
function classifyWhatsAppTokenShape(token) {
  const t = String(token || "").trim();
  if (!t) return { present: false, shape: "missing" };
  const hint = tokenHint(t);
  let likelyKind = "unknown";
  if (t.startsWith("EAAG")) likelyKind = "system_user_or_long_lived";
  else if (t.startsWith("EAA")) likelyKind = "user_or_page_token";
  else if (t.startsWith("EAB")) likelyKind = "whatsapp_business_token";
  return { ...hint, likelyKind, usesQueryParamAuth: false, usesBearerAuth: true };
}

/**
 * Structured Railway log for WhatsApp phone_number_id verification debugging.
 * @param {Record<string, unknown>} detail
 */
function logWhatsAppVerify(detail) {
  const payload = {
    graphApiVersion: metaGraphApiVersion(),
    graphBaseUrl: metaGraphBaseUrl(),
    authMode: "Authorization: Bearer",
    ...detail,
  };
  console.log("[WHATSAPP_VERIFY]", JSON.stringify(payload));
  metaTrace("whatsapp.verify", payload);
}

/**
 * @param {unknown} tokenDebug
 */
function extractTokenBusinessIds(tokenDebug) {
  /** @type {{ scope: string, id: string }[]} */
  const out = [];
  const granular = tokenDebug?.granularScopes;
  if (!Array.isArray(granular)) return out;
  for (const g of granular) {
    const scope = String(g?.scope || "").trim();
    for (const raw of g?.target_ids || []) {
      const id = String(raw || "").trim();
      if (id) out.push({ scope, id });
    }
  }
  return out;
}

/**
 * Resolve token ownership hints via debug_token (WABA ids in granular scopes).
 * @param {string} token
 */
async function resolveTokenBusinessContext(token) {
  const t = String(token || "").trim();
  const hint = tokenHint(t);
  if (!t) {
    return {
      tokenHint: hint,
      tokenBusinessId: null,
      tokenBusinessIds: [],
      tokenType: null,
      tokenAppId: null,
      tokenUserId: null,
      tokenValid: false,
      tokenScopes: [],
    };
  }
  const tokenDebug = await debugAccessToken(t, { auditLabel: "whatsapp.verify" });
  const tokenBusinessIds = extractTokenBusinessIds(tokenDebug);
  const whatsappTargets = tokenBusinessIds.filter((x) =>
    /whatsapp/i.test(x.scope),
  );
  return {
    tokenHint: hint,
    tokenType: tokenDebug?.type || null,
    tokenAppId: tokenDebug?.appId || null,
    tokenUserId: tokenDebug?.userId || null,
    tokenValid: tokenDebug?.isValid === true,
    tokenScopes: tokenDebug?.scopes || [],
    tokenBusinessIds,
    tokenBusinessId:
      whatsappTargets[0]?.id ||
      tokenBusinessIds[0]?.id ||
      tokenDebug?.userId ||
      null,
    tokenDebugError: tokenDebug?.error || null,
  };
}

/**
 * @param {{ code?: number|string, message?: string, status?: number }} err
 */
function classifyWhatsAppVerifyFailure(err) {
  const code = err?.code != null ? Number(err.code) : null;
  const message = String(err?.message || "").toLowerCase();
  if (code === 100 || /unsupported get request|does not exist|missing permissions/i.test(message)) {
    return [
      "invalid_graph_request_or_permissions",
      "Token may not belong to the same WhatsApp Business Account as phoneNumberId",
      "Confirm ID is Phone number ID (not WABA ID) from WhatsApp Manager → API setup",
      "Use System User token with whatsapp_business_messaging + whatsapp_business_management",
    ].join(" | ");
  }
  if (code === 190 || /invalid oauth|expired/i.test(message)) {
    return "invalid_or_expired_token";
  }
  if (code === 200) {
    return "missing_whatsapp_business_messaging_permission";
  }
  return null;
}

/**
 * @param {string} path
 * @param {{ method?: string, token?: string, body?: Record<string, unknown>, query?: Record<string, string>, auditLabel?: string }} [opts]
 */
async function whatsappGraphRequest(path, opts = {}) {
  const token = String(opts.token || whatsappAccessToken() || "").trim();
  const method = opts.method || "GET";
  const url = buildWhatsAppGraphUrl(path, opts.query);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  let body;
  if (opts.body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const requestUrl = url.toString();
  const label = opts.auditLabel || path.slice(0, 80);

  const requestLog = {
    label,
    method,
    graphApiVersion: metaGraphApiVersion(),
    graphBaseUrl: metaGraphBaseUrl(),
    path,
    requestUrl,
    authMode: "Authorization: Bearer",
    token: tokenHint(token),
  };

  console.log("[whatsappGraph] request", requestLog);
  metaTrace("whatsapp.graph.request", requestLog);

  const res = await fetch(requestUrl, { method, headers, body });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(json?.error?.message || `whatsapp_graph_${res.status}`);
    err.code = json?.error?.code;
    err.type = json?.error?.type;
    err.status = res.status;
    err.payload = json;
    err.fbtrace_id = json?.error?.fbtrace_id;
    err.requestUrl = requestUrl;
    err.graphApiVersion = metaGraphApiVersion();
    console.warn("[whatsappGraph] error", {
      label,
      method,
      requestUrl,
      graphApiVersion: metaGraphApiVersion(),
      status: res.status,
      code: err.code,
      type: err.type,
      message: err.message,
      fbtrace_id: err.fbtrace_id,
      error_subcode: json?.error?.error_subcode,
    });
    metaTrace("whatsapp.graph.error", {
      label,
      method,
      requestUrl,
      graphApiVersion: metaGraphApiVersion(),
      status: res.status,
      code: err.code,
      type: err.type,
      message: err.message,
      fbtrace_id: err.fbtrace_id,
    });
    throw err;
  }

  metaTrace("whatsapp.graph.ok", {
    label,
    method,
    requestUrl,
    graphApiVersion: metaGraphApiVersion(),
    status: res.status,
  });

  return json;
}

/**
 * GET /{PHONE_NUMBER_ID} — self-test token + phone ownership.
 * @param {string} phoneNumberId
 * @param {string} [accessToken]
 */
async function probeWhatsAppPhoneNumberId(phoneNumberId, accessToken, opts = {}) {
  const pid = String(phoneNumberId || "").trim();
  const token = String(accessToken || whatsappAccessToken() || "").trim();
  const path = `/${pid}`;
  const query = {
    fields:
      "id,display_phone_number,verified_name,quality_rating,account_mode,code_verification_status,platform_type",
  };
  const graphUrl = buildWhatsAppGraphUrl(path, query).toString();
  const tokenSource = String(opts.tokenSource || "env_or_argument").trim();

  const tokenCtx = await resolveTokenBusinessContext(token);

  logWhatsAppVerify({
    phase: "request",
    phoneNumberId: pid,
    graphUrl,
    httpMethod: "GET",
    tokenSource,
    tokenBusinessId: tokenCtx.tokenBusinessId,
    tokenBusinessIds: tokenCtx.tokenBusinessIds,
    tokenType: tokenCtx.tokenType,
    tokenAppId: tokenCtx.tokenAppId,
    tokenUserId: tokenCtx.tokenUserId,
    tokenValid: tokenCtx.tokenValid,
    tokenScopes: tokenCtx.tokenScopes,
    tokenHint: tokenCtx.tokenHint,
  });

  try {
    const json = await whatsappGraphRequest(path, {
      method: "GET",
      token,
      query,
      auditLabel: "whatsapp.probe_phone_number_id",
    });

    logWhatsAppVerify({
      phase: "success",
      phoneNumberId: pid,
      graphUrl,
      tokenSource,
      tokenBusinessId: tokenCtx.tokenBusinessId,
      tokenBusinessIds: tokenCtx.tokenBusinessIds,
      responseStatus: 200,
      responseBody: redactGraphPayload(json),
    });

    return {
      ok: true,
      requestUrl: graphUrl,
      graphApiVersion: metaGraphApiVersion(),
      authMode: "Bearer",
      tokenBusinessId: tokenCtx.tokenBusinessId,
      tokenBusinessIds: tokenCtx.tokenBusinessIds,
      data: json,
    };
  } catch (e) {
    const responseStatus = e?.status || null;
    const responseBody = redactGraphPayload(e?.payload) || {
      message: e?.message || String(e),
      code: e?.code,
      type: e?.type,
      fbtrace_id: e?.fbtrace_id,
    };
    const likelyCause = classifyWhatsAppVerifyFailure(e);

    logWhatsAppVerify({
      phase: "error",
      phoneNumberId: pid,
      graphUrl: e?.requestUrl || graphUrl,
      tokenSource,
      tokenBusinessId: tokenCtx.tokenBusinessId,
      tokenBusinessIds: tokenCtx.tokenBusinessIds,
      tokenType: tokenCtx.tokenType,
      tokenValid: tokenCtx.tokenValid,
      responseStatus,
      responseBody,
      metaErrorCode: e?.code ?? null,
      metaErrorType: e?.type ?? null,
      fbtrace_id: e?.fbtrace_id ?? null,
      likelyCause,
    });

    return {
      ok: false,
      requestUrl: e?.requestUrl || graphUrl,
      graphApiVersion: metaGraphApiVersion(),
      authMode: "Bearer",
      responseStatus,
      error: e?.message || String(e),
      code: e?.code,
      type: e?.type,
      fbtrace_id: e?.fbtrace_id,
      payload: responseBody,
      tokenBusinessId: tokenCtx.tokenBusinessId,
      tokenBusinessIds: tokenCtx.tokenBusinessIds,
      likelyCause,
    };
  }
}

/**
 * POST /{PHONE_NUMBER_ID}/messages
 * @param {string} phoneNumberId
 * @param {string} waId
 * @param {string} text
 * @param {string} [accessToken]
 */
async function sendWhatsAppMessage(phoneNumberId, waId, text, accessToken) {
  const pid = String(phoneNumberId || "").trim();
  const to = String(waId || "").trim();
  const bodyText = String(text || "").trim();
  const token = String(accessToken || whatsappAccessToken() || "").trim();
  if (!pid || !to || !bodyText || !token) {
    throw new Error("whatsapp_send_incomplete");
  }

  const path = `/${pid}/messages`;
  const requestUrl = buildWhatsAppGraphUrl(path).toString();

  metaTrace("whatsapp.send.start", {
    phoneNumberId: pid,
    requestUrl,
    graphApiVersion: metaGraphApiVersion(),
    authMode: "Bearer",
    waId: to.length > 8 ? `${to.slice(0, 8)}…` : to,
    textLength: bodyText.length,
    token: tokenHint(token),
  });

  console.log("[whatsappGraph] sendWhatsAppMessage", {
    method: "POST",
    requestUrl,
    graphApiVersion: metaGraphApiVersion(),
    endpointFormat: `POST /${metaGraphApiVersion()}/{PHONE_NUMBER_ID}/messages`,
    phoneNumberId: pid,
    authMode: "Bearer",
    token: tokenHint(token),
  });

  const result = await whatsappGraphRequest(path, {
    method: "POST",
    token,
    auditLabel: "whatsapp.send_message",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: bodyText.slice(0, 4096) },
    },
  });

  metaTrace("whatsapp.send.ok", {
    messageId: result?.messages?.[0]?.id ? String(result.messages[0].id).slice(0, 20) : null,
    requestUrl,
  });

  return result;
}

module.exports = {
  whatsappGraphRequest,
  buildWhatsAppGraphUrl,
  classifyWhatsAppTokenShape,
  logWhatsAppVerify,
  resolveTokenBusinessContext,
  classifyWhatsAppVerifyFailure,
  probeWhatsAppPhoneNumberId,
  sendWhatsAppMessage,
};
