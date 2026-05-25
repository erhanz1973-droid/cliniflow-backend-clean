/**
 * WhatsApp Cloud API Graph calls.
 */

const { graphRequest } = require("./metaGraph");
const { whatsappAccessToken } = require("./whatsappConfig");
const { metaTrace } = require("./metaDebug");

/**
 * POST /{PHONE_NUMBER_ID}/messages
 * @param {string} phoneNumberId
 * @param {string} waId
 * @param {string} text
 * @param {string} [accessToken]
 */
async function sendWhatsAppMessage(phoneNumberId, waId, text, accessToken) {
  const pid = String(phoneNumberId || "").trim();
  const to = String(waId || "").trim();
  const bodyText = String(text || "").trim();
  const token = String(accessToken || whatsappAccessToken() || "").trim();
  if (!pid || !to || !bodyText || !token) {
    throw new Error("whatsapp_send_incomplete");
  }

  metaTrace("whatsapp.send.start", {
    phoneNumberId: pid.slice(0, 8),
    waId: to.length > 8 ? `${to.slice(0, 8)}…` : to,
    textLength: bodyText.length,
  });

  const result = await graphRequest(`/${pid}/messages`, {
    method: "POST",
    token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: bodyText.slice(0, 4096) },
    },
  });

  metaTrace("whatsapp.send.ok", {
    messageId: result?.messages?.[0]?.id ? String(result.messages[0].id).slice(0, 20) : null,
  });

  return result;
}

module.exports = {
  sendWhatsAppMessage,
};
