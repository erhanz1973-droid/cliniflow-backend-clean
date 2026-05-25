/**
 * WhatsApp Cloud API webhook (GET verify + POST events).
 */

const express = require("express");
const {
  verifyWebhookChallenge,
  verifyWebhookSignature,
} = require("./metaWebhook");
const {
  parseWhatsAppWebhookBody,
  extractWhatsAppWebhookEvents,
} = require("./whatsappWebhook");
const {
  whatsappWebhookVerifyEnabled,
  whatsappWebhookSignatureEnabled,
  expectedWhatsAppVerifyTokens,
  whatsappHealthSnapshot,
} = require("./whatsappConfig");
const { setupWhatsAppInbound, processWhatsAppWebhookEvent, whatsappLog } = require("./whatsappInbound");
const { metaTrace } = require("./metaDebug");

const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/meta/whatsapp";

/**
 * @param {import('express').Express} app
 * @param {{ afterPatientInboundMessage?: Function }} [deps]
 */
function registerWhatsAppWebhook(app, deps = {}) {
  if (deps.afterPatientInboundMessage) {
    setupWhatsAppInbound({ afterPatientInboundMessage: deps.afterPatientInboundMessage });
  }

  app.get(WHATSAPP_WEBHOOK_PATH, (req, res) => {
    metaTrace("whatsapp.webhook.GET", {
      mode: req.query["hub.mode"] || null,
      hasVerifyToken: Boolean(req.query["hub.verify_token"]),
      hasChallenge: req.query["hub.challenge"] != null,
    });

    const result = verifyWebhookChallenge(req, expectedWhatsAppVerifyTokens());
    if (result.ok) {
      console.log("[whatsappWebhook] verified subscription");
      metaTrace("whatsapp.webhook.GET.verified", {
        challengeLength: String(result.challenge || "").length,
      });
      return res.status(200).send(result.challenge);
    }

    const reason = result.reason || "verification_failed";
    metaTrace("whatsapp.webhook.GET.rejected", {
      reason,
      checks: result.checks || null,
      hint:
        reason === "hub.mode_not_subscribe"
          ? "Browser visit without ?hub.mode=subscribe is expected to fail"
          : reason === "verify_token_mismatch"
            ? "Meta Verify token must match WHATSAPP_VERIFY_TOKEN on Railway"
            : reason === "webhook_verify_token_not_set"
              ? "Set WHATSAPP_VERIFY_TOKEN in Railway and redeploy"
              : null,
    });
    console.warn("[whatsappWebhook] GET verification failed:", reason, result.checks || {});
    return res.status(403).type("text/plain").send(reason);
  });

  app.post(
    WHATSAPP_WEBHOOK_PATH,
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
    (req, res) => {
      const rawBuf = req.rawBody || Buffer.alloc(0);
      const body = parseWhatsAppWebhookBody(rawBuf);
      const events = body.valid ? extractWhatsAppWebhookEvents(body) : [];

      console.log("[whatsappWebhook] POST payload", {
        object: body.object,
        valid: body.valid,
        entryCount: body.entry?.length || 0,
        eventCount: events.length,
        rawBodyBytes: rawBuf.length,
      });

      whatsappLog("whatsapp.webhook.received", {
        object: body.object,
        valid: body.valid,
        entryCount: body.entry?.length || 0,
        messagingEventCount: events.length,
        hasSignature: Boolean(req.headers["x-hub-signature-256"]),
        rawBodyBytes: rawBuf.length,
      });

      res.status(200).json({ ok: true });

      if (!body.valid || String(body.object || "").toLowerCase() !== "whatsapp_business_account") {
        return;
      }

      void (async () => {
        try {
          if (whatsappWebhookSignatureEnabled()) {
            if (!verifyWebhookSignature(rawBuf, req.headers["x-hub-signature-256"])) {
              console.warn("[whatsappWebhook] invalid signature (post-ack)");
              return;
            }
          }

          for (const ev of events) {
            await processWhatsAppWebhookEvent(ev).catch((e) => {
              console.warn("[whatsappWebhook] process:", e?.message || e);
            });
          }
        } catch (e) {
          console.error("[whatsappWebhook] async process:", e?.message || e);
        }
      })();
    },
  );

  console.log("[whatsapp] routes mounted:", {
    webhookVerify: "GET " + WHATSAPP_WEBHOOK_PATH,
    webhookEvents: "POST " + WHATSAPP_WEBHOOK_PATH,
    verifyEnabled: whatsappWebhookVerifyEnabled(),
    expectedCallbackUrl: whatsappHealthSnapshot().expectedCallbackUrl || "(set RAILWAY_PUBLIC_URL)",
  });
}

module.exports = {
  WHATSAPP_WEBHOOK_PATH,
  registerWhatsAppWebhook,
  whatsappHealthSnapshot,
};
