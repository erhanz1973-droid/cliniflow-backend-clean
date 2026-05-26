/**
 * Meta Messenger webhook verification and signature validation.
 */

const crypto = require("crypto");
const { metaAppSecret, metaWebhookVerifyToken } = require("./metaConfig");
const { metaTrace } = require("./metaDebug");

/**
 * Strip BOM, quotes, and whitespace from tokens (Railway / copy-paste).
 * @param {unknown} value
 */
function normalizeVerifyToken(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * @param {string} token
 */
function verifyTokenFingerprint(token) {
  const t = normalizeVerifyToken(token);
  if (!t) return null;
  return crypto.createHash("sha256").update(t, "utf8").digest("hex").slice(0, 12);
}

/**
 * Comma-separated META_WEBHOOK_VERIFY_TOKEN values (rotation / typo recovery).
 */
function expectedVerifyTokens() {
  const raw = metaWebhookVerifyToken();
  if (!raw) return [];
  return [...new Set(raw.split(",").map(normalizeVerifyToken).filter(Boolean))];
}

/**
 * @param {string|string[]|null|undefined} expectedTokens
 */
function normalizeExpectedVerifyTokenList(expectedTokens) {
  if (Array.isArray(expectedTokens)) {
    return [...new Set(expectedTokens.map(normalizeVerifyToken).filter(Boolean))];
  }
  const raw = String(expectedTokens ?? "").trim();
  if (!raw) return [];
  return [...new Set(raw.split(",").map(normalizeVerifyToken).filter(Boolean))];
}

/**
 * Meta webhook verification (GET hub.challenge) with explicit token list.
 * @param {import('express').Request} req
 * @param {string|string[]|null|undefined} [expectedTokens]
 */
function verifyWebhookChallengeForTokens(req, expectedTokens) {
  const mode = String(req.query["hub.mode"] || "").trim();
  const token = normalizeVerifyToken(req.query["hub.verify_token"]);
  const challengeRaw = req.query["hub.challenge"];
  const challenge =
    challengeRaw == null || challengeRaw === ""
      ? ""
      : typeof challengeRaw === "string"
        ? challengeRaw
        : String(challengeRaw);
  const expectedList = normalizeExpectedVerifyTokenList(expectedTokens);
  const expectedPrimary = expectedList[0] || "";

  const verifyTokenMatches =
    Boolean(token) && expectedList.some((exp) => exp.length > 0 && exp === token);

  const checks = {
    modeIsSubscribe: mode === "subscribe",
    verifyTokenConfigured: expectedList.length > 0,
    verifyTokenMatches,
    challengePresent: challenge !== "",
    expectedTokenCount: expectedList.length,
    expectedTokenLength: expectedPrimary.length,
    receivedTokenLength: token.length,
    expectedFingerprint: verifyTokenFingerprint(expectedPrimary),
    receivedFingerprint: verifyTokenFingerprint(token),
  };

  if (
    checks.modeIsSubscribe &&
    checks.verifyTokenConfigured &&
    checks.verifyTokenMatches &&
    checks.challengePresent
  ) {
    return { ok: true, challenge, checks };
  }

  let reason = "verification_failed";
  if (!checks.modeIsSubscribe) {
    reason = "hub.mode_not_subscribe";
  } else if (!checks.verifyTokenConfigured) {
    reason = "webhook_verify_token_not_set";
  } else if (!checks.verifyTokenMatches) {
    reason = "verify_token_mismatch";
  } else if (!checks.challengePresent) {
    reason = "hub.challenge_missing";
  }

  return { ok: false, reason, checks };
}

/**
 * @param {import('express').Request} req
 * @param {string|string[]|null|undefined} [expectedTokens] override (e.g. WHATSAPP_VERIFY_TOKEN)
 */
function verifyWebhookChallenge(req, expectedTokens) {
  const list =
    expectedTokens !== undefined
      ? normalizeExpectedVerifyTokenList(expectedTokens)
      : expectedVerifyTokens();
  return verifyWebhookChallengeForTokens(req, list);
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
 * Meta sometimes sends large ids as unquoted JSON numbers (JS loses precision).
 * @param {Buffer|string} rawBody
 */
function parseMetaWebhookBody(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "{}");
  const quoted = text.replace(/"id"\s*:\s*(\d{11,})/g, '"id":"$1"').replace(/"mid"\s*:\s*(\d{11,})/g, '"mid":"$1"');
  try {
    return JSON.parse(quoted);
  } catch {
    return {};
  }
}

/**
 * @param {unknown} value
 */
function coerceMetaGraphId(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return "";
    return String(value);
  }
  return String(value).trim();
}

/**
 * Inbound user message: psid = sender only (never page id or sender+recipient concat).
 * @param {unknown} senderId
 * @param {unknown} recipientId
 * @param {string} pageId
 */
/**
 * Meta/JSON sometimes yields sender.id = userPsid + recipientId with no separator.
 * @param {string} psid
 * @param {string} pageId
 * @param {string} [recipientId]
 */
function repairConcatenatedPsid(psid, pageId, recipientId) {
  let id = coerceMetaGraphId(psid);
  const page = coerceMetaGraphId(pageId);
  const recipient = coerceMetaGraphId(recipientId);
  if (!id) return "";
  if (page && id === page) return "";
  if (recipient && recipient.length >= 6 && id.endsWith(recipient) && id.length > recipient.length + 4) {
    id = id.slice(0, id.length - recipient.length);
  }
  if (page && page.length >= 10 && id.endsWith(page)) {
    id = id.slice(0, id.length - page.length);
  }
  // Valid Messenger PSIDs are often 15–17 digits — do not guess a shorter prefix.
  return id.trim();
}

function normalizeInboundPsid(senderId, recipientId, pageId) {
  const raw = coerceMetaGraphId(senderId);
  const repaired = repairConcatenatedPsid(raw, pageId, recipientId);
  if (raw && repaired && raw !== repaired) {
    metaTrace("messenger.psid.repaired", {
      rawLength: raw.length,
      repairedLength: repaired.length,
      pageId: pageId ? String(pageId).slice(0, 6) : null,
    });
  }
  return repaired;
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
  const pageId = coerceMetaGraphId(ev.pageId);
  const senderRaw = ev.sender?.id;
  const recipientRaw = ev.recipient?.id;
  const senderId = normalizeInboundPsid(senderRaw, recipientRaw, pageId);
  const recipientId = coerceMetaGraphId(recipientRaw);
  const timestamp = ev.timestamp != null ? Number(ev.timestamp) : null;

  if (ev.delivery) {
    return {
      kind: "delivery",
      pageId,
      psid: normalizeInboundPsid(ev.sender?.id, ev.recipient?.id, pageId),
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
    rawPsid: coerceMetaGraphId(senderRaw),
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
  verifyWebhookChallengeForTokens,
  verifyWebhookSignature,
  verifyTokenFingerprint,
  expectedVerifyTokens,
  parseMetaWebhookBody,
  repairConcatenatedPsid,
  extractMessagingEvents,
  parseInboundMessengerEvent,
  webhookEventId,
};
