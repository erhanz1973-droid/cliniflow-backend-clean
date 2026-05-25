/**
 * Meta Messenger — OAuth, admin APIs, webhook (early raw-body mount).
 */

const crypto = require("crypto");
const express = require("express");
const { supabase, isSupabaseEnabled } = require("../supabase");
const {
  metaAppId,
  metaOAuthRedirectUri,
  metaIntegrationEnabled,
  metaWebhookVerifyToken,
} = require("./metaConfig");
const {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  extractMessagingEvents,
} = require("./metaWebhook");
const {
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  fetchManagedPages,
} = require("./metaGraph");
const {
  listPageConnectionsForClinic,
  upsertPageConnection,
  disconnectPageConnection,
} = require("./metaPageConnections");
const { setupMessengerInbound, processMessagingWebhookEvent } = require("./messengerInbound");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Register webhook BEFORE express.json (raw body for signature).
 * @param {import('express').Express} app
 */
const MESSENGER_WEBHOOK_PATH = "/api/webhooks/meta/messenger";

function registerMetaMessengerWebhook(app) {
  app.get("/api/integrations/meta/health", (_req, res) => {
    res.json({
      ok: true,
      messengerWebhookPath: MESSENGER_WEBHOOK_PATH,
      integrationEnabled: metaIntegrationEnabled(),
      verifyTokenConfigured: Boolean(metaWebhookVerifyToken()),
    });
  });

  app.get(MESSENGER_WEBHOOK_PATH, (req, res) => {
    const result = verifyWebhookChallenge(req);
    if (result.ok) {
      console.log("[metaWebhook] verified subscription");
      return res.status(200).send(result.challenge);
    }
    return res.status(403).send("verification_failed");
  });

  app.post(
    MESSENGER_WEBHOOK_PATH,
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
    async (req, res) => {
      try {
        if (!metaIntegrationEnabled()) {
          return res.status(503).json({ ok: false, error: "meta_not_configured" });
        }
        const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
        if (!verifyWebhookSignature(raw, req.headers["x-hub-signature-256"])) {
          console.warn("[metaWebhook] invalid signature");
          return res.status(403).json({ ok: false, error: "invalid_signature" });
        }

        res.status(200).json({ ok: true });

        const events = extractMessagingEvents(req.body || {});
        for (const ev of events) {
          void processMessagingWebhookEvent(ev).catch((e) =>
            console.warn("[metaWebhook] process:", e?.message || e),
          );
        }
      } catch (e) {
        console.error("[metaWebhook] POST:", e?.message || e);
        if (!res.headersSent) {
          res.status(500).json({ ok: false, error: "webhook_error" });
        }
      }
    },
  );

  console.log("[meta] Messenger routes mounted:", {
    health: "GET /api/integrations/meta/health",
    webhookVerify: "GET " + MESSENGER_WEBHOOK_PATH,
    webhookEvents: "POST " + MESSENGER_WEBHOOK_PATH,
  });
}

/**
 * @param {string} clinicId
 * @param {string} [redirectUri]
 */
async function createOAuthState(clinicId, redirectUri) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
  if (!isSupabaseEnabled()) return { token, expiresAt };
  await supabase.from("meta_oauth_states").insert({
    state_token: token,
    clinic_id: clinicId,
    redirect_uri: redirectUri || null,
    expires_at: expiresAt,
  });
  return { token, expiresAt };
}

/**
 * @param {string} stateToken
 */
async function consumeOAuthState(stateToken) {
  if (!isSupabaseEnabled()) return null;
  const token = String(stateToken || "").trim();
  if (!token) return null;
  const { data, error } = await supabase
    .from("meta_oauth_states")
    .select("clinic_id, redirect_uri, expires_at")
    .eq("state_token", token)
    .maybeSingle();
  if (error || !data?.clinic_id) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from("meta_oauth_states").delete().eq("state_token", token);
    return null;
  }
  await supabase.from("meta_oauth_states").delete().eq("state_token", token);
  return data;
}

function buildFacebookOAuthUrl(state, redirectUri) {
  const appId = metaAppId();
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", [
    "pages_show_list",
    "pages_messaging",
    "pages_manage_metadata",
    "pages_read_engagement",
  ].join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function, afterPatientInboundMessage: Function }} deps
 */
function registerMetaIntegrationRoutes(app, deps) {
  const { requireAdminAuth, afterPatientInboundMessage } = deps;
  setupMessengerInbound({ afterPatientInboundMessage });

  app.get("/api/integrations/meta/status", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const pages = UUID_RE.test(clinicId) ? await listPageConnectionsForClinic(clinicId) : [];
      return res.json({
        ok: true,
        enabled: metaIntegrationEnabled(),
        configured: Boolean(metaAppId() && metaWebhookVerifyToken()),
        redirectUri: metaOAuthRedirectUri(),
        pages: pages.map((p) => ({
          id: p.id,
          pageId: p.page_id,
          pageName: p.page_name,
          status: p.status,
          webhookSubscribed: p.webhook_subscribed,
          connectedAt: p.created_at,
        })),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "status_failed" });
    }
  });

  app.get("/api/integrations/meta/oauth/start", requireAdminAuth, async (req, res) => {
    try {
      if (!metaIntegrationEnabled()) {
        return res.status(503).json({ ok: false, error: "meta_not_configured" });
      }
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const redirectUri = metaOAuthRedirectUri();
      if (!redirectUri) {
        return res.status(503).json({ ok: false, error: "oauth_redirect_not_configured" });
      }
      const adminReturn = String(req.query.returnUrl || req.query.return_url || "").trim() || null;
      const { token: state } = await createOAuthState(clinicId, adminReturn);
      const authUrl = buildFacebookOAuthUrl(state, redirectUri);
      return res.json({ ok: true, authUrl, state, redirectUri });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "oauth_start_failed" });
    }
  });

  app.get("/api/integrations/meta/oauth/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();
      const oauthErr = String(req.query.error || "").trim();
      const stateRow = await consumeOAuthState(state);
      const returnUrl =
        (stateRow?.redirect_uri && String(stateRow.redirect_uri)) ||
        "/admin.html#integrations-messenger";

      if (oauthErr || !code) {
        return res.redirect(302, `${returnUrl}?meta=error&reason=${encodeURIComponent(oauthErr || "no_code")}`);
      }
      if (!stateRow?.clinic_id) {
        return res.redirect(302, `${returnUrl}?meta=error&reason=invalid_state`);
      }

      const short = await exchangeCodeForUserToken(code);
      const userToken = String(short.access_token || "").trim();
      if (!userToken) {
        return res.redirect(302, `${returnUrl}?meta=error&reason=token_exchange_failed`);
      }

      let longToken = userToken;
      try {
        const long = await exchangeForLongLivedUserToken(userToken);
        if (long?.access_token) longToken = String(long.access_token);
      } catch (e) {
        console.warn("[metaOAuth] long-lived exchange:", e?.message || e);
      }

      const pages = await fetchManagedPages(longToken);
      const payload = Buffer.from(
        JSON.stringify({
          clinicId: stateRow.clinic_id,
          pages: pages.map((p) => ({
            id: p.id,
            name: p.name,
            access_token: p.access_token,
            category: p.category,
          })),
          expires: Date.now() + 10 * 60 * 1000,
        }),
      ).toString("base64url");

      return res.redirect(302, `${returnUrl}?meta=select_pages&payload=${payload}`);
    } catch (e) {
      console.error("[metaOAuth] callback:", e?.message || e);
      return res.redirect(302, `/admin.html?meta=error&reason=${encodeURIComponent("callback_failed")}`);
    }
  });

  app.post("/api/integrations/meta/pages/connect", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      if (!pages.length) {
        return res.status(400).json({ ok: false, error: "pages_required" });
      }

      /** @type {Array<Record<string, unknown>>} */
      const connected = [];
      for (const p of pages) {
        const pageId = String(p.pageId || p.id || "").trim();
        const token = String(p.accessToken || p.access_token || "").trim();
        if (!pageId || !token) continue;
        const result = await upsertPageConnection({
          clinicId,
          pageId,
          pageName: String(p.pageName || p.name || "").trim() || null,
          pageAccessToken: token,
          connectedBy: req.clinicCode || null,
          subscribeWebhook: true,
        });
        if (result.ok) {
          connected.push({ pageId, pageName: p.pageName || p.name, webhookSubscribed: result.webhookSubscribed });
        }
      }

      return res.json({ ok: true, connected });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "connect_failed" });
    }
  });

  app.post("/api/integrations/meta/pages/disconnect", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const pageId = String(req.body?.pageId || req.body?.page_id || "").trim();
      if (!UUID_RE.test(clinicId) || !pageId) {
        return res.status(400).json({ ok: false, error: "invalid_params" });
      }
      const result = await disconnectPageConnection(clinicId, pageId);
      return res.json({ ok: result.ok, error: result.error || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "disconnect_failed" });
    }
  });
}

module.exports = {
  registerMetaMessengerWebhook,
  registerMetaIntegrationRoutes,
};
