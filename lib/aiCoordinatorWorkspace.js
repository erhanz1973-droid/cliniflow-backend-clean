/**
 * Coordinator workspace — SLA math, queue buckets, enriched lead DTOs.
 */

const { COORDINATION_HUMAN, COORDINATION_AI } = require("./aiCoordinatorCoordination");

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

/**
 * @param {string|Date|null|undefined} iso
 * @returns {number|null}
 */
function toMs(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {number} ms
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const h = Math.floor(ms / MS_HOUR);
  const m = Math.floor((ms % MS_HOUR) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} nowMs
 */
function computeSla(row, nowMs = Date.now()) {
  const lastPatientMs = toMs(row.last_patient_message_at) || toMs(row.last_channel_message_at);
  const lastHumanMs = toMs(row.last_human_reply_at);
  const lastAiMs = toMs(row.last_ai_reply_at);
  const updatedMs = toMs(row.updated_at) || nowMs;

  const waitingMs =
    lastPatientMs && (!lastHumanMs || lastPatientMs > lastHumanMs) ? nowMs - lastPatientMs : null;

  const sinceHumanMs = lastHumanMs ? nowMs - lastHumanMs : null;
  const inactiveMs = nowMs - (lastPatientMs || updatedMs);

  let urgencyLevel = "ok";
  if (waitingMs != null) {
    if (waitingMs >= 4 * MS_HOUR) urgencyLevel = "critical";
    else if (waitingMs >= MS_HOUR) urgencyLevel = "warning";
  }
  if (inactiveMs >= MS_DAY) urgencyLevel = urgencyLevel === "critical" ? "critical" : "stale";

  return {
    lastPatientMessageAt: row.last_patient_message_at || row.last_channel_message_at || null,
    lastHumanReplyAt: row.last_human_reply_at || null,
    lastAiReplyAt: row.last_ai_reply_at || null,
    waitingDurationMs: waitingMs,
    waitingDurationLabel: waitingMs != null ? formatDuration(waitingMs) : null,
    sinceLastHumanReplyMs: sinceHumanMs,
    sinceLastHumanReplyLabel: sinceHumanMs != null ? formatDuration(sinceHumanMs) : null,
    inactiveMs,
    inactiveLabel: formatDuration(inactiveMs),
    urgencyLevel,
    isInactive24h: inactiveMs >= MS_DAY,
    isWaiting1h: waitingMs != null && waitingMs >= MS_HOUR && waitingMs < 4 * MS_HOUR,
    isWaiting4h: waitingMs != null && waitingMs >= 4 * MS_HOUR,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
function computeWorkspaceBucket(row) {
  const mode = String(row.coordination_mode || COORDINATION_AI);
  const lastPatientMs = toMs(row.last_patient_message_at) || toMs(row.last_channel_message_at);
  const lastHumanMs = toMs(row.last_human_reply_at);
  const inactiveMs = Date.now() - (lastPatientMs || toMs(row.updated_at) || Date.now());

  if (inactiveMs >= MS_DAY) return "inactive";
  if (row.ai_unresolved === true) return "ai_unresolved";
  if (mode === COORDINATION_HUMAN) {
    if (lastPatientMs && (!lastHumanMs || lastPatientMs > lastHumanMs)) return "waiting_human";
    return "assigned";
  }
  if (row.is_hot === true) return "hot";
  if (row.assigned_coordinator_id) return "assigned";
  return "recent";
}

/**
 * @param {Record<string, unknown>} row
 * @param {(row: Record<string, unknown>) => object} mapBase
 */
function enrichLeadRow(row, mapBase) {
  const base = mapBase(row);
  const sla = computeSla(row);
  const escalation = row.escalation_flags && typeof row.escalation_flags === "object" ? row.escalation_flags : {};
  return {
    ...base,
    sla,
    workspaceBucket: computeWorkspaceBucket(row),
    escalationFlags: escalation,
    aiUnresolved: row.ai_unresolved === true,
    lastPatientMessageAt: sla.lastPatientMessageAt,
    lastHumanReplyAt: sla.lastHumanReplyAt,
  };
}

/**
 * @param {string} workspace
 * @param {object} lead enriched lead with workspaceBucket
 */
function matchesWorkspaceFilter(workspace, lead) {
  const w = String(workspace || "").trim().toLowerCase();
  if (!w || w === "all" || w === "recent") return true;
  if (w === "assigned") {
    return !!lead.assignedCoordinatorId;
  }
  return lead.workspaceBucket === w;
}

module.exports = {
  computeSla,
  computeWorkspaceBucket,
  enrichLeadRow,
  matchesWorkspaceFilter,
  formatDuration,
};
