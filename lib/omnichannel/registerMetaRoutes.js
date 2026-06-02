/**
 * Meta Messenger — OAuth, admin APIs, webhook (early raw-body mount).
 */

const crypto = require("crypto");
const express = require("express");
const { supabase, isSupabaseEnabled } = require("../supabase");
const {
  metaAppId,
  metaOAuthRedirectUri,
  metaWebhookCallbackUrl,
  metaIntegrationEnabled,
  metaWebhookVerifyToken,
  metaGraphApiVersion,
  metaFbLoginConfigId,
} = require("./metaConfig");
const { scheduleMetaWebhookStartupDiagnostics } = require("./metaWebhookDiagnostics");
const {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  extractMessagingEvents,
  parseMetaWebhookBody,
  verifyTokenFingerprint,
  expectedVerifyTokens,
} = require("./metaWebhook");
const {
  META_OAUTH_SCOPES,
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  probeMeAccountsOAuthStep,
  finalizeOAuthPageDiscovery,
} = require("./metaGraph");
  const {
    listPageConnectionsForClinic,
    lookupPageClinicMapping,
    upsertPageConnection,
    disconnectPageConnection,
    probeStoredPageTokenHealth,
  } = require("./metaPageConnections");
const { setupMessengerInbound, processMessagingWebhookEvent } = require("./messengerInbound");
const { setupWhatsAppInbound } = require("./whatsappInbound");
const { whatsappHealthSnapshot } = require("./whatsappConfig");
const { registerWhatsAppAdminRoutes } = require("./registerWhatsAppAdminRoutes");
const { metaTrace, tokenHint } = require("./metaDebug");

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
    const tokens = expectedVerifyTokens();
    const primary = tokens[0] || "";
    res.json({
      ok: true,
      messengerWebhookPath: MESSENGER_WEBHOOK_PATH,
      expectedCallbackUrl: metaWebhookCallbackUrl() || null,
      integrationEnabled: metaIntegrationEnabled(),
      verifyTokenConfigured: tokens.length > 0,
      verifyTokenLength: primary.length,
      verifyTokenFingerprint: verifyTokenFingerprint(primary),
      whatsapp: whatsappHealthSnapshot(),
      hint:
        "Meta Dashboard → Webhooks → Verify token must match META_WEBHOOK_VERIFY_TOKEN on Railway (compare fingerprint if unsure)",
    });
  });

  app.get(MESSENGER_WEBHOOK_PATH, (req, res) => {
    metaTrace("webhook.GET", {
      mode: req.query["hub.mode"] || null,
      hasVerifyToken: Boolean(req.query["hub.verify_token"]),
      hasChallenge: req.query["hub.challenge"] != null,
    });
    const result = verifyWebhookChallenge(req);
    if (result.ok) {
      console.log("[metaWebhook] verified subscription");
      metaTrace("webhook.GET.verified", { challengeLength: String(result.challenge || "").length });
      return res.status(200).send(result.challenge);
    }
    const reason = result.reason || "verification_failed";
    metaTrace("webhook.GET.rejected", {
      reason,
      checks: result.checks || null,
      hint:
        reason === "hub.mode_not_subscribe"
          ? "Browser visit without ?hub.mode=subscribe is expected to fail; Meta Verify and save sends full query string"
          : reason === "verify_token_mismatch"
            ? "Copy META_WEBHOOK_VERIFY_TOKEN from Railway into Meta Verify token field (see /api/integrations/meta/health verifyTokenFingerprint)"
            : reason === "META_WEBHOOK_VERIFY_TOKEN_not_set"
              ? "Set META_WEBHOOK_VERIFY_TOKEN in Railway and redeploy"
              : null,
    });
    console.warn("[metaWebhook] GET verification failed:", reason, result.checks || {});
    return res.status(403).type("text/plain").send(reason);
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
      const rawBuf = req.rawBody || Buffer.alloc(0);
      const body = parseMetaWebhookBody(rawBuf);
      const entries = Array.isArray(body.entry) ? body.entry : [];
      metaTrace("webhook.POST.received", {
        object: body.object || null,
        entryCount: entries.length,
        entryPageIds: entries.map((e) => String(e?.id || "").trim()).filter(Boolean),
        messagingEventCount: entries.reduce(
          (n, e) => n + (Array.isArray(e?.messaging) ? e.messaging.length : 0),
          0,
        ),
        hasSignature: Boolean(req.headers["x-hub-signature-256"]),
        rawBodyBytes: req.rawBody?.length || 0,
      });

      try {
        if (!metaIntegrationEnabled()) {
          metaTrace("webhook.POST.rejected", { reason: "meta_not_configured" });
          return res.status(503).json({ ok: false, error: "meta_not_configured" });
        }
        if (!verifyWebhookSignature(rawBuf, req.headers["x-hub-signature-256"])) {
          console.warn("[metaWebhook] invalid signature");
          metaTrace("webhook.POST.rejected", { reason: "invalid_signature" });
          return res.status(403).json({ ok: false, error: "invalid_signature" });
        }

        res.status(200).json({ ok: true });

        const events = extractMessagingEvents(body);
        metaTrace("webhook.POST.parsed", { eventCount: events.length });
        for (const ev of events) {
          void processMessagingWebhookEvent(ev).catch((e) => {
            console.warn("[metaWebhook] process:", e?.message || e);
            metaTrace("webhook.POST.process_error", { message: e?.message || String(e) });
          });
        }
      } catch (e) {
        console.error("[metaWebhook] POST:", e?.message || e);
        metaTrace("webhook.POST.exception", { message: e?.message || String(e) });
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
    webhookDiagnostics: "GET /api/integrations/meta/webhook/diagnostics",
    expectedCallbackUrl: metaWebhookCallbackUrl() || "(set RAILWAY_PUBLIC_URL)",
  });

  /* Webhook App subscription diagnostics run from postBootInit (index.cjs) after listen. */
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

function buildFacebookOAuthUrl(state, redirectUri, opts = {}) {
  const appId = metaAppId();
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  const configId = metaFbLoginConfigId();
  if (configId) {
    url.searchParams.set("config_id", configId);
  }
  if (opts.forceReauth) {
    url.searchParams.set("auth_type", "rerequest");
  }
  return url.toString();
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function, afterPatientInboundMessage: Function }} deps
 */
function registerMetaIntegrationRoutes(app, deps) {
  const { requireAdminAuth, afterPatientInboundMessage } = deps;
  setupMessengerInbound({ afterPatientInboundMessage });
  setupWhatsAppInbound({ afterPatientInboundMessage });
  registerWhatsAppAdminRoutes(app, { requireAdminAuth });

  app.get("/api/integrations/meta/webhook/diagnostics", requireAdminAuth, async (_req, res) => {
    try {
      const report = await scheduleMetaWebhookStartupDiagnostics();
      return res.json({ ok: true, report });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "diagnostics_failed" });
    }
  });

  app.get("/api/integrations/meta/messenger/diagnostics", requireAdminAuth, async (req, res) => {
    try {
      const { runMessengerGraphDiagnostics } = require("./messengerGraphDiagnostics");
      let pageId = String(req.query?.pageId || req.query?.page_id || "").trim();
      const psid = String(req.query?.psid || req.query?.recipient_id || "").trim();
      const clinicId = String(req.clinicId || "").trim();
      if (!pageId && UUID_RE.test(clinicId)) {
        const clinicPages = (await listPageConnectionsForClinic(clinicId)).filter(
          (p) => String(p.status || "active") === "active",
        );
        if (clinicPages[0]?.page_id) pageId = String(clinicPages[0].page_id);
      }
      const report = await runMessengerGraphDiagnostics({
        pageId: pageId || undefined,
        psid: psid || undefined,
        clinicId: clinicId || undefined,
      });
      return res.json({ ok: true, report });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "messenger_diagnostics_failed" });
    }
  });

  app.get("/api/integrations/meta/whatsapp/diagnostics", requireAdminAuth, async (req, res) => {
    try {
      const { runWhatsAppGraphDiagnostics } = require("./whatsappGraphDiagnostics");
      const phoneNumberId = String(
        req.query?.phoneNumberId || req.query?.phone_number_id || "",
      ).trim();
      const report = await runWhatsAppGraphDiagnostics({
        phoneNumberId: phoneNumberId || undefined,
      });
      return res.json({ ok: true, report });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "whatsapp_diagnostics_failed" });
    }
  });

  app.get("/api/integrations/meta/whatsapp/lookup", requireAdminAuth, async (req, res) => {
    try {
      const phoneNumberId = String(
        req.query?.phoneNumberId || req.query?.phone_number_id || "",
      ).trim();
      if (!phoneNumberId) {
        return res.status(400).json({ ok: false, error: "phone_number_id_required" });
      }
      const { lookupWhatsAppClinicMapping } = require("./whatsappPhoneConnections");
      const mapping = await lookupWhatsAppClinicMapping(phoneNumberId);
      const sessionClinicId = String(req.clinicId || "").trim();
      return res.json({
        ok: true,
        phoneNumberId,
        mapping,
        sessionClinicId: UUID_RE.test(sessionClinicId) ? sessionClinicId : null,
        matchesSessionClinic:
          UUID_RE.test(sessionClinicId) &&
          mapping.matchedClinicId &&
          String(mapping.matchedClinicId) === sessionClinicId,
        envFallback:
          phoneNumberId === String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "lookup_failed" });
    }
  });

  app.get("/api/integrations/meta/pages/lookup", requireAdminAuth, async (req, res) => {
    try {
      const pageId = String(req.query?.pageId || req.query?.page_id || "").trim();
      if (!pageId) {
        return res.status(400).json({ ok: false, error: "page_id_required" });
      }
      const mapping = await lookupPageClinicMapping(pageId);
      const sessionClinicId = String(req.clinicId || "").trim();
      return res.json({
        ok: true,
        pageId,
        mapping,
        sessionClinicId: UUID_RE.test(sessionClinicId) ? sessionClinicId : null,
        matchesSessionClinic:
          UUID_RE.test(sessionClinicId) &&
          mapping.matchedClinicId &&
          String(mapping.matchedClinicId) === sessionClinicId,
        hint:
          mapping.found && mapping.connectionStatus === "active"
            ? "Inbound webhooks use meta_page_connections (unique page_id → clinic_id)."
            : "No active row for this page_id — connect from admin-messenger while logged into the target clinic.",
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "lookup_failed" });
    }
  });

  app.get("/api/integrations/meta/status", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const allPages = UUID_RE.test(clinicId) ? await listPageConnectionsForClinic(clinicId) : [];
      const pages = allPages.filter((p) => String(p.status || "active") === "active");
      const pagesWithHealth = await Promise.all(
        pages.map(async (p) => {
          const health = await probeStoredPageTokenHealth(String(p.page_id || ""));
          return {
            id: p.id,
            pageId: p.page_id,
            pageName: p.page_name,
            status: p.status,
            webhookSubscribed: p.webhook_subscribed,
            connectedAt: p.created_at,
            tokenHealthy: health.tokenHealthy,
            needsFacebookReconnect: health.needsFacebookReconnect,
            tokenIssue: health.reconnectSummary || null,
          };
        }),
      );
      const anyUnhealthy = pagesWithHealth.some((p) => p.needsFacebookReconnect);
      return res.json({
        ok: true,
        enabled: metaIntegrationEnabled(),
        configured: Boolean(metaAppId() && metaWebhookVerifyToken()),
        redirectUri: metaOAuthRedirectUri(),
        messengerTokenHealthy: pagesWithHealth.length ? !anyUnhealthy : null,
        pages: pagesWithHealth,
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
      const forceReauth =
        req.query.force === "1" ||
        String(req.query.forceReauth || "").trim() === "1";
      const { token: state } = await createOAuthState(clinicId, adminReturn);
      const authUrl = buildFacebookOAuthUrl(state, redirectUri, { forceReauth });
      metaTrace("oauth.start", { clinicId: clinicId.slice(0, 8), forceReauth });
      return res.json({ ok: true, authUrl, state, redirectUri, forceReauth });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "oauth_start_failed" });
    }
  });

  app.get("/api/integrations/meta/oauth/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();
      const oauthErr = String(req.query.error || "").trim();
      metaTrace("oauth.callback.start", {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        oauthErr: oauthErr || null,
        appId: metaAppId() || null,
      });

      const stateRow = await consumeOAuthState(state);
      const returnUrl =
        (stateRow?.redirect_uri && String(stateRow.redirect_uri)) ||
        "/admin.html#integrations-messenger";

      if (oauthErr || !code) {
        metaTrace("oauth.callback.reject", { reason: oauthErr || "no_code" });
        return res.redirect(302, `${returnUrl}?meta=error&reason=${encodeURIComponent(oauthErr || "no_code")}`);
      }
      if (!stateRow?.clinic_id) {
        metaTrace("oauth.callback.reject", { reason: "invalid_state" });
        return res.redirect(302, `${returnUrl}?meta=error&reason=invalid_state`);
      }

      const short = await exchangeCodeForUserToken(code);
      const userToken = String(short.access_token || "").trim();
      if (!userToken) {
        metaTrace("oauth.callback.reject", { reason: "token_exchange_failed" });
        return res.redirect(302, `${returnUrl}?meta=error&reason=token_exchange_failed`);
      }

      metaTrace("oauth.callback.sequence_start", {
        graphVersion: metaGraphApiVersion(),
        policy: "me_accounts_before_then_after_long_lived_exchange",
      });

      // Step 1: GET /me/accounts on SHORT-LIVED token (before exchange; short still in memory)
      const shortProbe = await probeMeAccountsOAuthStep("short_lived", userToken, {
        sequenceStep: 1,
        calledBeforeTokenReplaceInMemory: true,
      });

      // Step 2: exchange short → long (userToken variable unchanged; longToken is new)
      metaTrace("oauth.callback.token_flow", {
        step: 2,
        action: "exchange_for_long_lived",
        shortToken: tokenHint(userToken),
        note: "userToken still holds short-lived; longToken assigned separately",
      });

      let longToken = userToken;
      try {
        const long = await exchangeForLongLivedUserToken(userToken);
        if (long?.access_token) longToken = String(long.access_token);
        metaTrace("oauth.callback.long_lived_ok", {
          step: 2,
          shortToken: tokenHint(userToken),
          longToken: tokenHint(longToken),
          tokensDiffer: userToken !== longToken,
          expiresIn: long?.expires_in ?? null,
        });
      } catch (e) {
        console.warn("[metaOAuth] long-lived exchange:", e?.message || e);
        metaTrace("oauth.callback.long_lived_skip", { message: e?.message || String(e) });
      }

      // Step 3: GET /me/accounts on LONG-LIVED token (after exchange; not using userToken for this call)
      const longProbe = await probeMeAccountsOAuthStep("long_lived", longToken, {
        sequenceStep: 3,
        calledAfterTokenReplaceInMemory: true,
        shortTokenHint: tokenHint(userToken),
      });

      // Steps 4–5: compare probes; page picker from /me/accounts only
      const pageResult = await finalizeOAuthPageDiscovery(userToken, longToken, shortProbe, longProbe);
      const pages = pageResult.pages || [];
      metaTrace("oauth.callback.pages", {
        clinicId: String(stateRow.clinic_id).slice(0, 8),
        pageCount: pages.length,
        source: pageResult.pageSource,
        chosenPhase: pageResult.chosenPhase,
        usedShortMeAccountsDespiteLongExchange: pageResult.usedShortMeAccountsDespiteLongExchange,
        scopeCompare: pageResult.scopeCompare,
        scopes: pageResult.shortProbe?.debug?.scopes || [],
        pages: pages.map((p) => ({
          id: p.id,
          name: p.name,
          hasPageToken: Boolean(p.access_token),
        })),
      });

      if (!pages.length) {
        const scopeHint =
          (pageResult.longAudit?.debug?.scopes || pageResult.shortAudit?.debug?.scopes || []).join(",") ||
          "unknown";
        metaTrace("oauth.callback.no_pages", {
          shortMeAccountsPageCount: pageResult.shortProbe?.meAccounts?.rawCount ?? 0,
          longMeAccountsPageCount: pageResult.longProbe?.meAccounts?.rawCount ?? 0,
          scopeCompare: pageResult.scopeCompare,
          scopes: pageResult.longProbe?.debug?.scopes || pageResult.shortProbe?.debug?.scopes,
          hasPagesShowList: (pageResult.shortProbe?.debug?.scopes || []).includes("pages_show_list"),
        });
        return res.redirect(
          302,
          `${returnUrl}?meta=no_pages&scopes=${encodeURIComponent(scopeHint)}`,
        );
      }

      const payload = Buffer.from(
        JSON.stringify({
          clinicId: stateRow.clinic_id,
          pages: pages.map((p) => ({
            id: p.id,
            name: p.name,
            access_token: p.access_token,
          })),
          pageDiscoveryPhase: pageResult.chosenPhase,
          pageDiscoverySource: pageResult.pageSource,
          longLivedUserToken: pageResult.longLivedUserToken,
          expires: Date.now() + 10 * 60 * 1000,
        }),
      ).toString("base64url");

      metaTrace("oauth.callback.redirect_select_pages", { pageCount: pages.length });
      return res.redirect(302, `${returnUrl}?meta=select_pages&payload=${payload}`);
    } catch (e) {
      console.error("[metaOAuth] callback:", e?.message || e);
      metaTrace("oauth.callback.exception", { message: e?.message || String(e) });
      return res.redirect(302, `/admin.html?meta=error&reason=${encodeURIComponent("callback_failed")}`);
    }
  });

  app.post("/api/integrations/meta/pages/connect", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
      metaTrace("page_connect.start", {
        clinicId: clinicId.slice(0, 8),
        clinicCode: req.clinicCode || null,
        pageCount: pages.length,
      });
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      if (!pages.length) {
        return res.status(400).json({ ok: false, error: "pages_required" });
      }

      /** @type {Array<Record<string, unknown>>} */
      const connected = [];
      const failed = [];
      for (const p of pages) {
        const pageId = String(p.pageId || p.id || "").trim();
        const token = String(p.accessToken || p.access_token || "").trim();
        if (!pageId || !token) {
          failed.push({ pageId: pageId || null, error: "missing_page_id_or_token" });
          continue;
        }
        const result = await upsertPageConnection({
          clinicId,
          pageId,
          pageName: String(p.pageName || p.name || "").trim() || null,
          pageAccessToken: token,
          connectedBy: req.clinicCode || null,
          subscribeWebhook: true,
        });
        if (result.ok) {
          connected.push({
            pageId,
            pageName: p.pageName || p.name,
            webhookSubscribed: result.webhookSubscribed,
            subscribeMeta: result.subscribeMeta || null,
          });
        } else {
          failed.push({
            pageId,
            error: result.error || "connect_failed",
            message: result.message || null,
            graphCode: result.graphCode || null,
          });
        }
      }

      metaTrace("page_connect.done", { connected: connected.length, failed: failed.length });
      return res.json({ ok: true, connected, failed });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "connect_failed" });
    }
  });

  app.post("/api/integrations/meta/pages/resubscribe", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const pageId = String(req.body?.pageId || req.body?.page_id || "").trim();
      if (!UUID_RE.test(clinicId) || !pageId) {
        return res.status(400).json({ ok: false, error: "invalid_params" });
      }
      const { getActivePageConnectionByPageId, pageAccessTokenFromRow } = require("./metaPageConnections");
      const { subscribePageToApp } = require("./metaGraph");
      const row = await getActivePageConnectionByPageId(pageId);
      if (!row || String(row.clinic_id) !== clinicId) {
        return res.status(404).json({ ok: false, error: "page_not_connected" });
      }
      const token = pageAccessTokenFromRow(row);
      if (!token) {
        return res.status(500).json({ ok: false, error: "page_token_missing" });
      }
      const sub = await subscribePageToApp(pageId, token);
      const webhookSubscribed = sub?.subscribeResult?.success === true;
      if (isSupabaseEnabled()) {
        await supabase
          .from("meta_page_connections")
          .update({
            webhook_subscribed: webhookSubscribed,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
              resubscribe_at: new Date().toISOString(),
              subscribed_apps: sub?.subscribeResult || null,
              subscribed_apps_verify: sub?.verifyResult?.data || null,
            },
          })
          .eq("page_id", pageId)
          .eq("clinic_id", clinicId);
      }
      return res.json({ ok: true, pageId, webhookSubscribed, subscribeMeta: sub });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "resubscribe_failed" });
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
