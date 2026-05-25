/**
 * Canonical coordinator channel taxonomy (profiles, events, channel_messages, follow_ups).
 * Keep in sync with supabase/migrations/*_coordinator_channel_taxonomy.sql
 */

/** @type {readonly string[]} */
const COORDINATOR_CHANNELS = Object.freeze([
  // Legacy external + generic
  "in_app",
  "whatsapp",
  "instagram",
  "messenger",
  "sms",
  "email",
  // Operational (Cliniflow product)
  "offer_chat",
  "patient_chat",
  "treatment_guide",
  "coordinator",
  "ai_continuity",
  "clinic_ai",
]);

/** @type {Record<string, string>} */
const CHANNEL_ALIASES = Object.freeze({
  offer: "offer_chat",
  offer_messages: "offer_chat",
  offer_chat: "offer_chat",
  patient_messages: "patient_chat",
  patient_chat: "patient_chat",
  chat: "patient_chat",
  web: "in_app",
  web_chat: "in_app",
  in_app: "in_app",
  app: "in_app",
  quote_request: "coordinator",
  coordinator_chat: "coordinator",
  continuity: "ai_continuity",
  continuity_fallback: "ai_continuity",
  clinic_inbound: "coordinator",
  clinic_ai: "clinic_ai",
});

/**
 * @param {string|null|undefined} raw
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeCoordinatorChannel(raw, fallback = "in_app") {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!key) return fallback;
  if (CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];
  if (COORDINATOR_CHANNELS.includes(key)) return key;
  return fallback;
}

/**
 * Map inbound orchestration source → timeline channel.
 * @param {string|null|undefined} source
 */
function channelFromInboundSource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "offer_chat") return "offer_chat";
  if (s === "quote_request") return "coordinator";
  if (s === "messenger") return "messenger";
  if (s === "instagram") return "instagram";
  if (s === "whatsapp") return "whatsapp";
  if (s === "chat") return "patient_chat";
  return "in_app";
}

/**
 * @param {string|null|undefined} source
 * @param {string|null|undefined} explicitChannel
 */
function resolveInboundCoordinatorChannel(source, explicitChannel) {
  if (explicitChannel) {
    return normalizeCoordinatorChannel(explicitChannel, channelFromInboundSource(source));
  }
  return channelFromInboundSource(source);
}

module.exports = {
  COORDINATOR_CHANNELS,
  CHANNEL_ALIASES,
  normalizeCoordinatorChannel,
  channelFromInboundSource,
  resolveInboundCoordinatorChannel,
};
