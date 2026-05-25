/**
 * Meta / Messenger integration configuration.
 */

function metaAppId() {
  return String(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || "").trim();
}

function metaAppSecret() {
  return String(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "").trim();
}

function metaWebhookVerifyToken() {
  return String(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || "").trim();
}

function metaGraphApiVersion() {
  return String(process.env.META_GRAPH_API_VERSION || "v21.0").trim().replace(/^\/+/, "");
}

function metaOAuthRedirectUri() {
  const explicit = String(process.env.META_OAUTH_REDIRECT_URI || "").trim();
  if (explicit) return explicit;
  const base = String(
    process.env.RAILWAY_PUBLIC_URL ||
      process.env.PUBLIC_API_URL ||
      process.env.API_BASE_URL ||
      "",
  ).trim().replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/api/integrations/meta/oauth/callback`;
}

function metaIntegrationEnabled() {
  if (process.env.META_MESSENGER_ENABLED === "false") return false;
  return Boolean(metaAppId() && metaAppSecret());
}

function metaGraphBaseUrl() {
  return `https://graph.facebook.com/${metaGraphApiVersion()}`;
}

/** Optional Facebook Login for Business configuration ID (Meta App Dashboard). */
function metaFbLoginConfigId() {
  return String(process.env.META_FB_LOGIN_CONFIG_ID || process.env.FACEBOOK_LOGIN_CONFIG_ID || "").trim();
}

module.exports = {
  metaAppId,
  metaAppSecret,
  metaWebhookVerifyToken,
  metaGraphApiVersion,
  metaOAuthRedirectUri,
  metaIntegrationEnabled,
  metaGraphBaseUrl,
  metaFbLoginConfigId,
};
