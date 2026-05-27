/**
 * WhatsApp Cloud API configuration.
 */

const { metaAppId, metaAppSecret, metaPublicApiBaseUrl, metaGraphApiVersion } = require("./metaConfig");

function whatsappAccessToken() {
  return String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
}

function whatsappPhoneNumberId() {
  return String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
}

function whatsappVerifyToken() {
  return String(process.env.WHATSAPP_VERIFY_TOKEN || "").trim();
}

function whatsappWebhookVerifyEnabled() {
  return expectedWhatsAppVerifyTokens().length > 0;
}

function whatsappClinicId() {
  return String(process.env.WHATSAPP_CLINIC_ID || "").trim();
}

function whatsappWebhookCallbackUrl() {
  const explicit = String(process.env.WHATSAPP_WEBHOOK_CALLBACK_URL || "").trim();
  if (explicit) return explicit;
  const base = metaPublicApiBaseUrl();
  if (!base) return "";
  return `${base}/api/webhooks/meta/whatsapp`;
}

function whatsappIntegrationEnabled() {
  if (process.env.WHATSAPP_ENABLED === "false") return false;
  return Boolean(whatsappAccessToken() && whatsappPhoneNumberId());
}

/** Meta App Dashboard → WhatsApp → Embedded Signup configuration ID. */
function whatsappEmbeddedSignupConfigId() {
  return String(
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
      process.env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
      "",
  ).trim();
}

function whatsappEmbeddedSignupAvailable() {
  if (process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED === "false") return false;
  return Boolean(metaAppId() && metaAppSecret() && whatsappEmbeddedSignupConfigId());
}

function whatsappWebhookSignatureEnabled() {
  return Boolean(metaAppSecret());
}

function expectedWhatsAppVerifyTokens() {
  const raw = whatsappVerifyToken();
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];
}

function whatsappHealthSnapshot() {
  const { verifyTokenFingerprint } = require("./metaWebhook");
  const { metaGraphApiVersion, metaGraphBaseUrl } = require("./metaConfig");
  const { classifyWhatsAppTokenShape } = require("./whatsappGraph");
  const token = whatsappAccessToken();
  const phoneId = whatsappPhoneNumberId();
  const clinicId = whatsappClinicId();
  const verifyRaw = whatsappVerifyToken();
  const verifyPrimary = expectedWhatsAppVerifyTokens()[0] || "";
  return {
    graphApiVersion: metaGraphApiVersion(),
    graphBaseUrl: metaGraphBaseUrl(),
    sendEndpointFormat: `POST /${metaGraphApiVersion()}/{PHONE_NUMBER_ID}/messages`,
    authMode: "Authorization: Bearer WHATSAPP_ACCESS_TOKEN",
    accessTokenShape: classifyWhatsAppTokenShape(token),
    diagnosticsPath: "/api/integrations/meta/whatsapp/diagnostics",
    webhookVerifyEnabled: whatsappWebhookVerifyEnabled(),
    messagingEnabled: whatsappIntegrationEnabled(),
    webhookPath: "/api/webhooks/meta/whatsapp",
    expectedCallbackUrl: whatsappWebhookCallbackUrl() || null,
    accessTokenConfigured: Boolean(token),
    phoneNumberIdConfigured: Boolean(phoneId),
    phoneNumberId: phoneId || null,
    clinicIdConfigured: Boolean(clinicId),
    clinicId: clinicId || null,
    verifyTokenConfigured: Boolean(verifyRaw),
    verifyTokenLength: verifyPrimary.length,
    verifyTokenFingerprint: verifyTokenFingerprint(verifyPrimary),
    signatureVerificationUsesMetaAppSecret: whatsappWebhookSignatureEnabled(),
    hint:
      "Meta WhatsApp webhook → Callback URL above; Verify token = WHATSAPP_VERIFY_TOKEN on Railway",
  };
}

module.exports = {
  whatsappAccessToken,
  whatsappPhoneNumberId,
  whatsappVerifyToken,
  whatsappClinicId,
  whatsappWebhookCallbackUrl,
  whatsappIntegrationEnabled,
  whatsappEmbeddedSignupConfigId,
  whatsappEmbeddedSignupAvailable,
  whatsappWebhookVerifyEnabled,
  whatsappWebhookSignatureEnabled,
  expectedWhatsAppVerifyTokens,
  whatsappHealthSnapshot,
  metaGraphApiVersion,
};
