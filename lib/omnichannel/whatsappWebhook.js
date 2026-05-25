/**
 * WhatsApp Cloud API webhook body parsing.
 */

const { parseMetaWebhookBody } = require("./metaWebhook");

/**
 * @param {Buffer|string} rawBody
 */
function parseWhatsAppWebhookBody(rawBody) {
  const body = parseMetaWebhookBody(rawBody);
  if (String(body?.object || "").toLowerCase() !== "whatsapp_business_account") {
    return { object: body?.object || null, entry: [], valid: false };
  }
  return { object: "whatsapp_business_account", entry: Array.isArray(body.entry) ? body.entry : [], valid: true };
}

/**
 * @param {Record<string, unknown>} value
 */
function extractContactsFromValue(value) {
  const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
  /** @type {Map<string, string>} */
  const byWaId = new Map();
  for (const c of contacts) {
    const waId = String(c?.wa_id || "").trim();
    const name = String(c?.profile?.name || "").trim();
    if (waId && name) byWaId.set(waId, name);
  }
  return byWaId;
}

/**
 * @param {Record<string, unknown>} body
 */
function extractWhatsAppWebhookEvents(body) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  if (!body?.valid) return out;

  for (const entry of body.entry || []) {
    const wabaId = String(entry?.id || "").trim();
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const field = String(change?.field || "").trim();
      const value = change?.value && typeof change.value === "object" ? change.value : {};
      const phoneNumberId = String(value?.metadata?.phone_number_id || "").trim();
      const displayPhone = String(value?.metadata?.display_phone_number || "").trim();
      const contactNames = extractContactsFromValue(value);

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const msg of messages) {
        const waId = String(msg?.from || "").trim();
        const type = String(msg?.type || "text").trim();
        let text = "";
        if (type === "text" && msg?.text && typeof msg.text === "object") {
          text = String(msg.text.body || "").trim();
        } else if (type === "button" && msg?.button) {
          text = String(msg.button.text || msg.button.payload || "").trim();
        } else if (type === "interactive" && msg?.interactive) {
          const interactive = msg.interactive;
          text = String(
            interactive?.button_reply?.title ||
              interactive?.button_reply?.id ||
              interactive?.list_reply?.title ||
              interactive?.list_reply?.id ||
              "",
          ).trim();
        }
        out.push({
          kind: "message",
          field,
          wabaId,
          phoneNumberId,
          displayPhoneNumber: displayPhone,
          waId,
          profileName: contactNames.get(waId) || null,
          messageId: String(msg?.id || "").trim(),
          timestamp: msg?.timestamp != null ? Number(msg.timestamp) : null,
          messageType: type,
          text: text || (type !== "text" ? `[${type}]` : ""),
        });
      }

      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const st of statuses) {
        out.push({
          kind: "status",
          field,
          wabaId,
          phoneNumberId,
          displayPhoneNumber: displayPhone,
          waId: String(st?.recipient_id || "").trim(),
          messageId: String(st?.id || "").trim(),
          timestamp: st?.timestamp != null ? Number(st.timestamp) : null,
          status: String(st?.status || "").trim(),
          statusErrors: Array.isArray(st?.errors) ? st.errors : [],
        });
      }
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} ev
 */
function whatsAppWebhookEventId(ev) {
  const mid = String(ev.messageId || "").trim();
  if (mid) return `wa:${mid}`;
  const status = String(ev.status || "").trim();
  const ts = ev.timestamp != null ? String(ev.timestamp) : "";
  return `wa:status:${ev.phoneNumberId}:${ev.waId}:${status}:${ts}`;
}

module.exports = {
  parseWhatsAppWebhookBody,
  extractWhatsAppWebhookEvents,
  whatsAppWebhookEventId,
};
