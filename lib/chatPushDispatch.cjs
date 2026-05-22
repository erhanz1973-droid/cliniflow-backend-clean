/**
 * Push notification dedupe: one delivery per recipient × logical message × type.
 */

/** Minimum 1h so a low env TTL cannot re-send the same inbound push every few seconds. */
const CHAT_PUSH_MEMORY_DEDUPE_MS = Math.max(
  3_600_000,
  parseInt(String(process.env.CHAT_PUSH_MEMORY_DEDUPE_MS || "86400000"), 10) || 86400000,
);

/** One doctor push per patient inbound message (clinic thread + offer mirror share this). */
const PATIENT_INBOUND_DOCTOR_PUSH_TYPE = "patient_inbound";

/** @type {Map<string, number>} */
const memoryClaims = new Map();

/**
 * @param {object} p
 * @param {string} p.recipientKind patient|doctor
 * @param {string} p.recipientId uuid
 * @param {string} p.messageStableId canonical message id
 * @param {string} [p.notificationType] chat_message | offer_message | new_offer | ...
 * @returns {string}
 */
function buildChatPushDedupeKey({ recipientKind, recipientId, messageStableId, notificationType }) {
  const kind = String(recipientKind || "").trim().toLowerCase();
  const rid = String(recipientId || "").trim().toLowerCase();
  const mid = String(messageStableId || "").trim();
  const ntype = String(notificationType || "chat_message").trim().toLowerCase();
  if (!kind || !rid || !mid) return "";
  return `${kind}:${rid}:${ntype}:${mid}`.slice(0, 512);
}

function rememberMemoryClaim(dedupeKey) {
  if (!CHAT_PUSH_MEMORY_DEDUPE_MS || !dedupeKey) return;
  const now = Date.now();
  memoryClaims.set(dedupeKey, now);
  if (memoryClaims.size > 20000) {
    for (const [k, ts] of memoryClaims) {
      if (now - ts > CHAT_PUSH_MEMORY_DEDUPE_MS) memoryClaims.delete(k);
    }
  }
}

function hasMemoryClaim(dedupeKey) {
  if (!CHAT_PUSH_MEMORY_DEDUPE_MS || !dedupeKey) return false;
  const prev = memoryClaims.get(dedupeKey);
  if (prev == null) return false;
  if (Date.now() - prev >= CHAT_PUSH_MEMORY_DEDUPE_MS) {
    memoryClaims.delete(dedupeKey);
    return false;
  }
  return true;
}

/**
 * @param {object} ctx
 * @param {import('@supabase/supabase-js').SupabaseClient|null} ctx.supabase
 * @param {() => boolean} ctx.isSupabaseEnabled
 * @param {() => Promise<boolean>} ctx.probeChatPushDispatchesDbAvailable
 * @param {object} ctx.pushLog
 * @param {object} [ctx.pushMetrics]
 * @param {string} ctx.dedupeKey
 * @param {string} [ctx.messageRowId]
 * @param {string} [ctx.recipientKind]
 * @param {string} [ctx.recipientId]
 * @param {string} [ctx.notificationType]
 * @returns {Promise<boolean>}
 */
async function tryClaimChatPushDispatchV2(ctx, claim) {
  const dedupeKey = String(claim?.dedupeKey || "").trim();
  if (!dedupeKey) {
    ctx.pushLog?.warn?.("chat_push.dedupe_skip_empty_key", claim);
    return false;
  }

  if (hasMemoryClaim(dedupeKey)) {
    ctx.pushLog?.warn?.("chat_push.memory_dedupe", {
      dedupeKey: dedupeKey.length > 96 ? `${dedupeKey.slice(0, 96)}…` : dedupeKey,
    });
    ctx.pushMetrics?.recordChatDedupeMemory?.();
    return false;
  }

  const dbAvail = await ctx.probeChatPushDispatchesDbAvailable();
  if (!dbAvail) {
    rememberMemoryClaim(dedupeKey);
    return true;
  }

  try {
    const row = {
      dedupe_key: dedupeKey,
      message_row_id: String(claim.messageRowId || claim.messageStableId || dedupeKey).slice(0, 512),
      recipient_kind: claim.recipientKind || null,
      recipient_id: claim.recipientId || null,
      notification_type: claim.notificationType || "chat_message",
    };
    const { error } = await ctx.supabase.from("chat_push_dispatches").insert(row);
    if (!error) {
      rememberMemoryClaim(dedupeKey);
      return true;
    }
    const c = String(error.code || "");
    const m = String(error.message || "").toLowerCase();
    if (c === "23505" || m.includes("duplicate") || m.includes("unique")) {
      ctx.pushMetrics?.recordChatDedupeDbDuplicate?.();
      return false;
    }
    ctx.pushLog?.warn?.("chat_push.db_claim_failed", {
      dedupeKey: dedupeKey.slice(0, 96),
      message: String(error.message || error),
    });
    return false;
  } catch (e) {
    const m = String(e?.message || e || "").toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      ctx.pushMetrics?.recordChatDedupeDbDuplicate?.();
      return false;
    }
    ctx.pushLog?.warn?.("chat_push.db_claim_throw", {
      dedupeKey: dedupeKey.slice(0, 96),
      message: String(e?.message || e),
    });
    return false;
  }
}

/**
 * Build Expo `data` payload for message notifications (string values only).
 * @param {object} fields
 * @returns {Record<string, string>}
 */
function buildMessagePushDataPayload(fields) {
  const out = { type: String(fields.type || "new_message").trim() };
  const copy = [
    ["messageId", fields.messageId],
    ["message_id", fields.messageId],
    ["conversationId", fields.conversationId || fields.threadId],
    ["conversation_id", fields.conversationId || fields.threadId],
    ["threadId", fields.threadId],
    ["thread_id", fields.threadId],
    ["requestId", fields.requestId],
    ["request_id", fields.requestId],
    ["offerId", fields.offerId],
    ["offer_id", fields.offerId],
    ["patientId", fields.patientId],
    ["patient_id", fields.patientId],
    ["patientName", fields.patientName],
    ["patient_name", fields.patientName],
    ["clinicId", fields.clinicId],
    ["clinic_id", fields.clinicId],
    ["senderRole", fields.senderRole],
    ["senderName", fields.senderName],
    ["preview", fields.preview],
    ["route", fields.route],
    ["enrolled", fields.enrolled != null ? String(fields.enrolled) : ""],
    ["lead_thread_is_lead", fields.leadThreadIsLead != null ? String(fields.leadThreadIsLead) : ""],
    ["url", fields.url],
  ];
  for (const [k, v] of copy) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) out[k] = s.slice(0, 500);
  }
  return out;
}

module.exports = {
  PATIENT_INBOUND_DOCTOR_PUSH_TYPE,
  buildChatPushDedupeKey,
  buildMessagePushDataPayload,
  tryClaimChatPushDispatchV2,
};
