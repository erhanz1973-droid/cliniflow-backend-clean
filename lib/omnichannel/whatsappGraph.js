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
 * List phone numbers under a WhatsApp Business Account.
 * @param {string} wabaId
 * @param {string} token
 */
async function listPhoneNumbersForWaba(wabaId, token) {
  const waba = String(wabaId || "").trim();
  if (!waba) return [];
  try {
    const json = await whatsappGraphRequest(`/${waba}/phone_numbers`, {
      method: "GET",
      token,
      query: {
        fields: "id,display_phone_number,verified_name,quality_rating,account_mode",
      },
      auditLabel: "whatsapp.list_waba_phone_numbers",
    });
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.map((row) => ({
      phoneNumberId: String(row.id || ""),
      displayPhoneNumber: row.display_phone_number || null,
      verifiedName: row.verified_name || null,
      wabaId: waba,
    }));
  } catch (e) {
    return {
      wabaId: waba,
      error: e?.message || String(e),
      code: e?.code ?? null,
    };
  }
}

/**
 * When direct GET /{phone_number_id} fails, discover numbers the token can access.
 * Also detects if the entered ID is a WABA ID (common mistake).
 * @param {string} token
 * @param {{ probeId?: string, matchPhone?: string|null }} [opts]
 */
async function discoverWhatsAppPhoneNumbersForToken(token, opts = {}) {
  const probeId = String(opts.probeId || "").trim();
  const matchPhone = String(opts.matchPhone || "").trim();
  const tokenCtx = await resolveTokenBusinessContext(token);

  /** @type {Set<string>} */
  const wabaIds = new Set();
  for (const entry of tokenCtx.tokenBusinessIds || []) {
    if (/whatsapp/i.test(entry.scope) && entry.id) wabaIds.add(String(entry.id));
  }
  if (probeId) wabaIds.add(probeId);

  /** @type {{ phoneNumberId: string, displayPhoneNumber: string|null, verifiedName: string|null, wabaId: string }[]} */
  const collected = [];
  /** @type {{ wabaId: string, error: string, code?: number|string|null }[]} */
  const wabaErrors = [];
  let probeIdWasWaba = false;

  for (const wabaId of wabaIds) {
    const result = await listPhoneNumbersForWaba(wabaId, token);
    if (Array.isArray(result)) {
      if (wabaId === probeId && result.length > 0) probeIdWasWaba = true;
      collected.push(...result);
    } else if (result && result.error) {
      wabaErrors.push({
        wabaId: result.wabaId || wabaId,
        error: result.error,
        code: result.code ?? null,
      });
    }
  }

  const byId = new Map();
  for (const row of collected) {
    if (row.phoneNumberId) byId.set(row.phoneNumberId, row);
  }
  const accessiblePhoneNumbers = [...byId.values()];

  let matchedByPhone = null;
  if (matchPhone) {
    const want = matchPhone.replace(/\D/g, "");
    matchedByPhone =
      accessiblePhoneNumbers.find((row) => {
        const got = String(row.displayPhoneNumber || "").replace(/\D/g, "");
        return got && (got === want || got.endsWith(want) || want.endsWith(got));
      }) || null;
  }

  let diagnosis = null;
  if (probeIdWasWaba) {
    diagnosis =
      "The ID you entered is a WhatsApp Business Account (WABA) ID, not a Phone Number ID. Pick a Phone Number ID from the list below.";
  } else if (!tokenCtx.tokenValid) {
    diagnosis = "WHATSAPP_ACCESS_TOKEN on Railway is invalid or expired. Regenerate a System User token.";
  } else if (
    tokenCtx.tokenScopes?.length &&
    !tokenCtx.tokenScopes.some((s) => /whatsapp_business/i.test(String(s)))
  ) {
    diagnosis =
      "Token is missing whatsapp_business_messaging / whatsapp_business_management scopes.";
  } else if (accessiblePhoneNumbers.length === 0) {
    diagnosis =
      "This token cannot list any WhatsApp numbers. It likely belongs to a different Meta Business than the phone number.";
  } else if (probeId && !byId.has(probeId)) {
    diagnosis = `Phone Number ID ${probeId} is not accessible with the current server token. Use one of the IDs below, or update WHATSAPP_ACCESS_TOKEN on Railway.`;
  }

  return {
    tokenValid: tokenCtx.tokenValid,
    tokenType: tokenCtx.tokenType,
    tokenScopes: tokenCtx.tokenScopes,
    tokenBusinessIds: tokenCtx.tokenBusinessIds,
    wabaIds: [...wabaIds],
    accessiblePhoneNumbers,
    wabaErrors,
    probeIdWasWaba,
    probeId: probeId || null,
    matchedByPhone,
    diagnosis,
  };
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

    /** @type {Record<string, unknown>|null} */
    let discovery = null;
    if (Number(e?.code) === 100) {
      discovery = await discoverWhatsAppPhoneNumbersForToken(token, {
        probeId: pid,
        matchPhone: opts.matchPhone || null,
      });
      logWhatsAppVerify({
        phase: "discovery",
        phoneNumberId: pid,
        probeIdWasWaba: discovery.probeIdWasWaba,
        accessibleCount: discovery.accessiblePhoneNumbers?.length || 0,
        matchedByPhone: discovery.matchedByPhone?.phoneNumberId || null,
        diagnosis: discovery.diagnosis,
      });
    }

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
      discovery,
      message:
        discovery?.diagnosis ||
        (discovery?.matchedByPhone
          ? `Use Phone Number ID ${discovery.matchedByPhone.phoneNumberId} for ${discovery.matchedByPhone.displayPhoneNumber || "this line"}.`
          : null),
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
  discoverWhatsAppPhoneNumbersForToken,
  listPhoneNumbersForWaba,
  probeWhatsAppPhoneNumberId,
  sendWhatsAppMessage,
};
