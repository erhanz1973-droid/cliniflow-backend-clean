/**
 * WhatsApp Cloud API Graph calls (Bearer auth, separate from Messenger query-token).
 */

const { metaGraphApiVersion, metaGraphBaseUrl } = require("./metaConfig");
const { whatsappAccessToken } = require("./whatsappConfig");
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
async function probeWhatsAppPhoneNumberId(phoneNumberId, accessToken) {
  const pid = String(phoneNumberId || "").trim();
  const token = String(accessToken || whatsappAccessToken() || "").trim();
  const path = `/${pid}`;
  const query = {
    fields:
      "id,display_phone_number,verified_name,quality_rating,account_mode,code_verification_status,platform_type",
  };
  try {
    const json = await whatsappGraphRequest(path, {
      method: "GET",
      token,
      query,
      auditLabel: "whatsapp.probe_phone_number_id",
    });
    return {
      ok: true,
      requestUrl: buildWhatsAppGraphUrl(path, query).toString(),
      graphApiVersion: metaGraphApiVersion(),
      authMode: "Bearer",
      data: json,
    };
  } catch (e) {
    return {
      ok: false,
      requestUrl: buildWhatsAppGraphUrl(path, query).toString(),
      graphApiVersion: metaGraphApiVersion(),
      authMode: "Bearer",
      error: e?.message || String(e),
      code: e?.code,
      type: e?.type,
      fbtrace_id: e?.fbtrace_id,
      payload: redactGraphPayload(e?.payload),
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
  probeWhatsAppPhoneNumberId,
  sendWhatsAppMessage,
};
