/**
 * WhatsApp Graph API diagnostics — token type, scopes, phone_number_id ownership.
 */

const { metaAppId, metaAppSecret, metaGraphApiVersion, metaGraphBaseUrl } = require("./metaConfig");
const { whatsappAccessToken, whatsappPhoneNumberId } = require("./whatsappConfig");
const { debugAccessToken } = require("./metaGraph");
const { lookupWhatsAppClinicMapping } = require("./whatsappPhoneConnections");
const {
  classifyWhatsAppTokenShape,
  probeWhatsAppPhoneNumberId,
  buildWhatsAppGraphUrl,
} = require("./whatsappGraph");
const { tokenHint, redactGraphPayload } = require("./metaDebug");

const WHATSAPP_MESSAGING_SCOPES = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
  "business_management",
];

/**
 * @param {string[]} scopes
 */
function analyzeWhatsAppScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes.map((s) => String(s)) : [];
  const hasMessaging = list.includes("whatsapp_business_messaging");
  const hasManagement = list.includes("whatsapp_business_management");
  return {
    scopes: list,
    hasWhatsappBusinessMessaging: hasMessaging,
    hasWhatsappBusinessManagement: hasManagement,
    likelyCanSendMessages: hasMessaging,
    likelyCanReadPhoneNumber: hasMessaging || hasManagement,
  };
}

/**
 * @param {{ phoneNumberId?: string, accessToken?: string }} [opts]
 */
async function runWhatsAppGraphDiagnostics(opts = {}) {
  const phoneNumberId = String(opts.phoneNumberId || whatsappPhoneNumberId() || "").trim();
  const token = String(opts.accessToken || whatsappAccessToken() || "").trim();
  const envPhoneNumberId = whatsappPhoneNumberId();
  const mapping = phoneNumberId ? await lookupWhatsAppClinicMapping(phoneNumberId) : null;

  const tokenShape = classifyWhatsAppTokenShape(token);
  const tokenDebug = token ? await debugAccessToken(token, { auditLabel: "whatsapp.diagnostics" }) : null;
  const scopeAnalysis = analyzeWhatsAppScopes(tokenDebug?.scopes || []);

  const phoneProbe = phoneNumberId
    ? await probeWhatsAppPhoneNumberId(phoneNumberId, token)
    : { ok: false, error: "phone_number_id_missing" };

  const messagesProbeUrl = phoneNumberId
    ? buildWhatsAppGraphUrl(`/${phoneNumberId}/messages`).toString()
    : null;

  /** @type {string[]} */
  const findings = [];
  if (!token) findings.push("WHATSAPP_ACCESS_TOKEN not set");
  if (!phoneNumberId) findings.push("phone_number_id missing");
  if (tokenDebug && tokenDebug.isValid === false) findings.push("debug_token: token is not valid");
  if (tokenDebug?.type && !["SYSTEM_USER", "USER"].includes(String(tokenDebug.type))) {
    findings.push(`debug_token type=${tokenDebug.type} — confirm System User or WhatsApp Business token`);
  }
  if (token && !scopeAnalysis.likelyCanSendMessages) {
    findings.push(
      "token missing whatsapp_business_messaging scope — use System User token from Business Manager with WhatsApp permissions",
    );
  }
  if (phoneProbe.ok === false && phoneProbe.code === 100) {
    findings.push(
      "GET phone_number_id failed (code 100): token likely not authorized for this phone_number_id or ID is not a Phone Number ID",
    );
  }
  if (envPhoneNumberId && phoneNumberId && envPhoneNumberId !== phoneNumberId) {
    findings.push(
      `WHATSAPP_PHONE_NUMBER_ID env (${envPhoneNumberId}) differs from probed id (${phoneNumberId})`,
    );
  }
  if (tokenShape.likelyKind === "user_or_page_token") {
    findings.push(
      "token shape looks like a User/Page token (EAA…); WhatsApp send usually needs a System User permanent token from Business Settings",
    );
  }

  return {
    graphApiVersion: metaGraphApiVersion(),
    graphBaseUrl: metaGraphBaseUrl(),
    metaAppId: metaAppId() || null,
    phoneNumberId,
    envPhoneNumberId: envPhoneNumberId || null,
    phoneIdsMatch: !envPhoneNumberId || !phoneNumberId || envPhoneNumberId === phoneNumberId,
    clinicMapping: mapping,
    auth: {
      mode: "Authorization: Bearer WHATSAPP_ACCESS_TOKEN",
      queryParamAccessToken: false,
      tokenShape,
    },
    tokenDebug: tokenDebug
      ? {
          isValid: tokenDebug.isValid,
          type: tokenDebug.type,
          userId: tokenDebug.userId,
          appId: tokenDebug.appId,
          scopes: tokenDebug.scopes,
          granularScopes: tokenDebug.granularScopes,
          expiresAt: tokenDebug.expiresAt,
          dataAccessExpiresAt: tokenDebug.dataAccessExpiresAt,
          issuedAt: tokenDebug.issuedAt,
          error: tokenDebug.error || null,
          ...scopeAnalysis,
        }
      : null,
    endpoints: {
      phoneNumberGet: phoneProbe.requestUrl,
      messagesPost: messagesProbeUrl,
      messagesPostFormat: `POST /${metaGraphApiVersion()}/{PHONE_NUMBER_ID}/messages`,
    },
    phoneNumberProbe: {
      ...phoneProbe,
      data: redactGraphPayload(phoneProbe.data),
      payload: redactGraphPayload(phoneProbe.payload),
    },
    findings,
    recommendations: [
      "Meta Business Settings → System users → Generate token with whatsapp_business_messaging + whatsapp_business_management",
      "WhatsApp Manager → API setup → confirm Phone number ID matches webhook metadata.phone_number_id",
      "Set Railway WHATSAPP_ACCESS_TOKEN to that System User token (not a short-lived user OAuth token)",
      "Set WHATSAPP_PHONE_NUMBER_ID to the same id shown in inbound webhook logs",
    ],
  };
}

module.exports = {
  runWhatsAppGraphDiagnostics,
  analyzeWhatsAppScopes,
};
