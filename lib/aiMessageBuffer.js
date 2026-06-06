/**
 * Inbound patient message buffering — aggregate rapid bursts into one AI turn.
 */

const { patientMessagesNearDuplicate } = require("./patientInboundDedup");
const { shouldMergeWithLastPatientMessage } = require("./aiInboundRouter");

/** @readonly */
const MESSAGE_BUFFER_PRESETS = Object.freeze({
  instant: 0,
  "0": 0,
  "3s": 3000,
  "5s": 5000,
  "10s": 10000,
});

const DEFAULT_MESSAGE_BUFFER_MS = 5000;

/**
 * @param {unknown} raw
 * @returns {keyof typeof MESSAGE_BUFFER_PRESETS | string}
 */
function normalizeMessageBufferPreset(raw) {
  const s = String(raw || "5s")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (s === "instant" || s === "0" || s === "0s") return "instant";
  if (s in MESSAGE_BUFFER_PRESETS) return s;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n === 0) return "instant";
    if (n === 3) return "3s";
    if (n === 5) return "5s";
    if (n === 10) return "10s";
  }
  return "5s";
}

/**
 * @param {unknown} preset
 */
function messageBufferMsFromPreset(preset) {
  const key = normalizeMessageBufferPreset(preset);
  return MESSAGE_BUFFER_PRESETS[key] ?? DEFAULT_MESSAGE_BUFFER_MS;
}

/**
 * Resolve buffer window from aiReplies config (preset, explicit ms, or legacy omnichannel delay).
 * @param {Record<string, unknown>|null|undefined} ai
 */
function resolveMessageBufferDelayMs(ai) {
  const cfg = ai && typeof ai === "object" ? ai : {};
  const explicit = Number(cfg.messageBufferDelayMs);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return Math.min(15000, Math.round(explicit));
  }
  if (cfg.messageBufferPreset != null || cfg.messageBufferDelay != null) {
    return messageBufferMsFromPreset(cfg.messageBufferPreset ?? cfg.messageBufferDelay);
  }
  const legacyOmni = Number(cfg.omnichannelInstantDelayMs);
  if (Number.isFinite(legacyOmni) && legacyOmni >= 0) {
    return Math.min(15000, Math.round(legacyOmni));
  }
  const envMs = parseInt(process.env.AI_MESSAGE_BUFFER_DELAY_MS || "", 10);
  if (Number.isFinite(envMs) && envMs >= 0) {
    return Math.min(15000, envMs);
  }
  return DEFAULT_MESSAGE_BUFFER_MS;
}

/**
 * @param {number} ms
 */
function messageBufferPresetFromMs(ms) {
  const n = Math.round(Number(ms) || 0);
  if (n <= 0) return "instant";
  if (n <= 3000) return "3s";
  if (n <= 5000) return "5s";
  return "10s";
}

/**
 * @param {string[]} messages
 */
function formatBufferedPatientMessages(messages) {
  const clean = (messages || []).map((m) => String(m || "").trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  return clean.map((m, i) => `${i + 1}. ${m}`).join("\n");
}

/**
 * @param {Record<string, unknown>|null|undefined} prevPayload
 * @param {Record<string, unknown>} nextPayload
 */
function mergeBufferedInboundPayload(prevPayload, nextPayload) {
  const nextMsg = String(nextPayload.patientMessage || "").trim();
  if (!nextMsg) return prevPayload ? { ...prevPayload } : { ...nextPayload };

  if (!prevPayload) {
    return {
      ...nextPayload,
      bufferedMessages: [nextMsg],
      patientMessage: nextMsg,
    };
  }

  const prevMessages = Array.isArray(prevPayload.bufferedMessages)
    ? prevPayload.bufferedMessages.map((m) => String(m).trim()).filter(Boolean)
    : String(prevPayload.patientMessage || "")
        .split(/\n/)
        .map((line) => line.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean);

  const lastPrev = prevMessages[prevMessages.length - 1] || "";
  if (patientMessagesNearDuplicate(lastPrev, nextMsg)) {
    return { ...prevPayload };
  }

  let mergedMessages;
  if (
    prevMessages.length &&
    shouldMergeWithLastPatientMessage(nextMsg, lastPrev)
  ) {
    mergedMessages = [...prevMessages.slice(0, -1), `${lastPrev} ${nextMsg}`.trim()];
  } else if (prevMessages.some((m) => patientMessagesNearDuplicate(m, nextMsg))) {
    mergedMessages = prevMessages;
  } else {
    mergedMessages = [...prevMessages, nextMsg];
  }

  return {
    ...prevPayload,
    ...nextPayload,
    bufferedMessages: mergedMessages,
    patientMessage: formatBufferedPatientMessages(mergedMessages),
    externalMessageId: nextPayload.externalMessageId || prevPayload.externalMessageId,
    scheduledForPatientAt:
      nextPayload.scheduledForPatientAt || prevPayload.scheduledForPatientAt,
  };
}

/**
 * @param {string} message
 */
function isAggregatedPatientMessage(message) {
  const lines = String(message || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length >= 2 && lines.every((l) => /^\d+\.\s/.test(l));
}

/**
 * @param {string} message
 */
function buildAggregatedPatientMessageHint(message) {
  if (!isAggregatedPatientMessage(message)) return "";
  return (
    "AGGREGATED PATIENT MESSAGES: The visitor sent several messages in quick succession (numbered below). " +
    "Reply once, naturally, addressing all points together — do not send separate answers per line."
  );
}

module.exports = {
  MESSAGE_BUFFER_PRESETS,
  DEFAULT_MESSAGE_BUFFER_MS,
  normalizeMessageBufferPreset,
  messageBufferMsFromPreset,
  messageBufferPresetFromMs,
  resolveMessageBufferDelayMs,
  formatBufferedPatientMessages,
  mergeBufferedInboundPayload,
  isAggregatedPatientMessage,
  buildAggregatedPatientMessageHint,
};
