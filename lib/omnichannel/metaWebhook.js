/**
 * Meta Messenger webhook verification and signature validation.
 */

const crypto = require("crypto");
const { metaAppSecret, metaWebhookVerifyToken } = require("./metaConfig");

/**
 * @param {import('express').Request} req
 */
function verifyWebhookChallenge(req) {
  const mode = String(req.query["hub.mode"] || "").trim();
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = req.query["hub.challenge"];
  const expected = metaWebhookVerifyToken();
  if (mode === "subscribe" && expected && token === expected && challenge != null) {
    return { ok: true, challenge: String(challenge) };
  }
  return { ok: false };
}

/**
 * @param {Buffer|string} rawBody
 * @param {string|undefined} signatureHeader
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = metaAppSecret();
  if (!secret) return false;
  const sig = String(signatureHeader || "").trim();
  if (!sig.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = sig.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, unknown>} body
 */
function extractMessagingEvents(body) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const pageId = String(entry?.id || "").trim();
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const ev of messaging) {
      out.push({ pageId, ...ev });
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} ev
 */
function parseInboundMessengerEvent(ev) {
  const pageId = String(ev.pageId || "").trim();
  const senderId = String(ev.sender?.id || "").trim();
  const recipientId = String(ev.recipient?.id || "").trim();
  const timestamp = ev.timestamp != null ? Number(ev.timestamp) : null;

  if (ev.delivery) {
    return {
      kind: "delivery",
      pageId,
      psid: senderId,
      mids: Array.isArray(ev.delivery?.mids) ? ev.delivery.mids.map(String) : [],
      watermark: ev.delivery?.watermark,
      timestamp,
    };
  }
  if (ev.read) {
    return {
      kind: "read",
      pageId,
      psid: senderId,
      watermark: ev.read?.watermark,
      timestamp,
    };
  }
  if (ev.postback) {
    return {
      kind: "postback",
      pageId,
      psid: senderId,
      payload: String(ev.postback?.payload || ""),
      title: String(ev.postback?.title || ""),
      mid: String(ev.postback?.mid || `pb_${timestamp || Date.now()}`),
      timestamp,
    };
  }

  const msg = ev.message && typeof ev.message === "object" ? ev.message : null;
  if (!msg) return { kind: "ignored", pageId, reason: "no_message" };

  if (msg.is_echo === true) {
    return { kind: "echo", pageId, psid: recipientId, mid: String(msg.mid || "") };
  }

  const mid = String(msg.mid || "").trim();
  const text = String(msg.text || "").trim();
  /** @type {Array<Record<string, unknown>>} */
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];

  let attachmentSummary = "";
  let attachmentType = null;
  let attachmentUrl = null;
  if (attachments.length) {
    const first = attachments[0];
    attachmentType = String(first?.type || "file").toLowerCase();
    const payload = first?.payload && typeof first.payload === "object" ? first.payload : {};
    attachmentUrl = payload.url ? String(payload.url) : null;
    attachmentSummary =
      attachmentType === "image"
        ? "📷 Image"
        : attachmentType === "file"
          ? "📎 Attachment"
          : `📎 ${attachmentType}`;
  }

  const bodyText = text || attachmentSummary || "";
  if (!bodyText && !attachments.length) {
    return { kind: "ignored", pageId, reason: "empty_message", mid };
  }

  return {
    kind: "message",
    pageId,
    psid: senderId,
    recipientId,
    mid,
    text: bodyText,
    rawText: text,
    attachments,
    attachmentType,
    attachmentUrl,
    timestamp,
  };
}

/**
 * Stable idempotency key for a webhook event.
 * @param {Record<string, unknown>} parsed
 */
function webhookEventId(parsed) {
  if (parsed.mid) return String(parsed.mid);
  if (parsed.kind === "delivery" && parsed.mids?.length) {
    return `delivery:${parsed.mids.join(",")}`;
  }
  if (parsed.kind === "read") {
    return `read:${parsed.pageId}:${parsed.psid}:${parsed.watermark || ""}`;
  }
  return `${parsed.kind}:${parsed.pageId}:${parsed.psid}:${parsed.timestamp || Date.now()}`;
}

module.exports = {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  extractMessagingEvents,
  parseInboundMessengerEvent,
  webhookEventId,
};
