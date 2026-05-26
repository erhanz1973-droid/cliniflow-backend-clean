/**
 * WhatsApp operational status — Active / Paused / Disconnected.
 */

const { normalizeAiMode, AI_MODE } = require("../aiDelegation");

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {'active'|'paused'|'disconnected'}
 */
function resolveWhatsAppOperationalStatus(row) {
  if (!row) return "disconnected";
  if (String(row.status || "").toLowerCase() === "disconnected") return "disconnected";
  if (row.is_enabled === false) return "paused";
  return "active";
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function isWhatsAppRoutingEnabled(row) {
  return resolveWhatsAppOperationalStatus(row) === "active";
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function connectionAiMode(row) {
  const meta =
    row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return normalizeAiMode(row?.ai_mode || meta.connectionAiMode || AI_MODE.AI_ACTIVE);
}

/**
 * Whether inbound should trigger AI auto-reply for this connection.
 * @param {Record<string, unknown>|null|undefined} row
 */
function connectionAllowsWhatsAppAutoAi(row) {
  if (!isWhatsAppRoutingEnabled(row)) return false;
  const mode = connectionAiMode(row);
  return mode === AI_MODE.AI_ACTIVE || mode === AI_MODE.AI_ASSISTED;
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function connectionAiModeLabel(row) {
  const mode = connectionAiMode(row);
  const labels = {
    AI_ACTIVE: "AI active",
    HUMAN_ONLY: "Human only",
    AI_DRAFT: "AI draft suggestions",
    AI_ASSISTED: "Require human approval",
    ESCALATION_REQUIRED: "Escalation required",
  };
  return labels[mode] || mode;
}

/**
 * @param {string|null|undefined} iso
 */
function formatRelativeTime(iso) {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  if (!Number.isFinite(ms)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  return `${Math.floor(sec / 86400)} d ago`;
}

module.exports = {
  resolveWhatsAppOperationalStatus,
  isWhatsAppRoutingEnabled,
  connectionAiMode,
  connectionAllowsWhatsAppAutoAi,
  connectionAiModeLabel,
  formatRelativeTime,
};
