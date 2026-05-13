/**
 * In-process push delivery counters for observability (resets on deploy).
 * Scrape via GET /api/ops/push-observability or grep Railway logs for PUSH_METRICS_SNAPSHOT.
 */

const startedAt = Date.now();

const state = {
  expoSendBatches: 0,
  expoSendHttpOk: 0,
  expoSendHttpFail: 0,
  expoTicketsOk: 0,
  expoTicketsError: 0,
  receiptErrorBuckets: Object.create(null),
  invalidTokensPruned: 0,
  chatDedupeMemoryHits: 0,
  chatDedupeDbDuplicateHits: 0,
  /** experience key -> { batches, ticketsOk, ticketsErr } */
  byExperience: Object.create(null),
  pushTokenCrossOwnerAudits: 0,
};

function bucketReceiptError(err) {
  const s = String(err || "").trim();
  if (!s) return "unknown";
  const u = s.toUpperCase();
  if (u.includes("DEVICE") && u.includes("REGISTER")) return "device_not_registered";
  if (u.includes("MESSAGE") && u.includes("BIG")) return "message_too_big";
  if (u.includes("PAYLOAD")) return "payload_error";
  if (u.includes("TOKEN") || u.includes("CREDENTIAL")) return "token_invalid";
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function touchExperience(expKey) {
  const k = String(expKey || "").trim() || "_legacy_null_";
  if (!state.byExperience[k]) {
    state.byExperience[k] = { batches: 0, ticketsOk: 0, ticketsErr: 0 };
  }
  return state.byExperience[k];
}

function recordExpoSendBatch({ httpOk, httpStatus, chunkSize, kind, experienceKey, expoBody }) {
  state.expoSendBatches += 1;
  if (httpOk) state.expoSendHttpOk += 1;
  else state.expoSendHttpFail += 1;

  const exp = touchExperience(experienceKey);
  exp.batches += 1;

  const tickets = Array.isArray(expoBody?.data) ? expoBody.data : null;
  if (!tickets) return;

  for (const t of tickets) {
    const st = String(t?.status || "").toLowerCase();
    if (st === "ok") {
      state.expoTicketsOk += 1;
      exp.ticketsOk += 1;
    } else if (st === "error") {
      state.expoTicketsError += 1;
      exp.ticketsErr += 1;
      const d = t?.details;
      let err = "";
      if (d && typeof d === "object") {
        if (d.error != null) err = String(d.error);
        else if (d.apns && typeof d.apns === "object" && d.apns.reason != null) err = String(d.apns.reason);
      }
      const b = bucketReceiptError(err || t?.message);
      state.receiptErrorBuckets[b] = (state.receiptErrorBuckets[b] || 0) + 1;
    }
  }
}

function recordReceiptRowError(detailsError) {
  const b = bucketReceiptError(detailsError);
  state.receiptErrorBuckets[b] = (state.receiptErrorBuckets[b] || 0) + 1;
}

function recordInvalidPrune(n) {
  const x = Math.max(0, Number(n) || 0);
  state.invalidTokensPruned += x;
}

function recordChatDedupeMemory() {
  state.chatDedupeMemoryHits += 1;
}

function recordChatDedupeDbDuplicate() {
  state.chatDedupeDbDuplicateHits += 1;
}

function recordPushTokenCrossOwnerAudit() {
  state.pushTokenCrossOwnerAudits += 1;
}

function getSnapshot() {
  const uptimeMs = Date.now() - startedAt;
  const ticketTotal = state.expoTicketsOk + state.expoTicketsError;
  const ticketSuccessRate = ticketTotal > 0 ? state.expoTicketsOk / ticketTotal : null;
  const httpBatchRate =
    state.expoSendBatches > 0 ? state.expoSendHttpOk / state.expoSendBatches : null;

  return {
    tag: "PUSH_METRICS_SNAPSHOT",
    ts: new Date().toISOString(),
    uptimeMs,
    expoSendBatches: state.expoSendBatches,
    expoSendHttpOk: state.expoSendHttpOk,
    expoSendHttpFail: state.expoSendHttpFail,
    httpBatchSuccessRate: httpBatchRate,
    expoTicketsOk: state.expoTicketsOk,
    expoTicketsError: state.expoTicketsError,
    ticketSuccessRate,
    receiptErrorBuckets: { ...state.receiptErrorBuckets },
    invalidTokensPruned: state.invalidTokensPruned,
    chatDedupeMemoryHits: state.chatDedupeMemoryHits,
    chatDedupeDbDuplicateHits: state.chatDedupeDbDuplicateHits,
    byExperience: { ...state.byExperience },
    pushTokenCrossOwnerAudits: state.pushTokenCrossOwnerAudits,
  };
}

function reset() {
  state.expoSendBatches = 0;
  state.expoSendHttpOk = 0;
  state.expoSendHttpFail = 0;
  state.expoTicketsOk = 0;
  state.expoTicketsError = 0;
  state.receiptErrorBuckets = Object.create(null);
  state.invalidTokensPruned = 0;
  state.chatDedupeMemoryHits = 0;
  state.chatDedupeDbDuplicateHits = 0;
  state.byExperience = Object.create(null);
  state.pushTokenCrossOwnerAudits = 0;
}

/** Count terminal receipt errors after getReceipts merge (per ticket id). */
function recordMergedReceiptFinals(mergedRowById, okIds) {
  if (!mergedRowById || !Array.isArray(okIds)) return;
  for (const id of okIds) {
    const row = mergedRowById[id];
    if (!row || typeof row !== "object") continue;
    const st = String(row.status || "").toLowerCase();
    if (st !== "error") continue;
    const d = row.details;
    let err = "";
    if (d && typeof d === "object") {
      if (d.error != null) err = String(d.error);
      else if (d.apns && typeof d.apns === "object" && d.apns.reason != null) err = String(d.apns.reason);
    }
    recordReceiptRowError(err || row.message);
  }
}

/** One-line JSON for log drain / daily rollup jobs. */
function emitAggregationLogLine() {
  const snap = getSnapshot();
  console.log(JSON.stringify({ ...snap, tag: "PUSH_METRICS_AGGREGATE" }));
}

module.exports = {
  recordExpoSendBatch,
  recordReceiptRowError,
  recordMergedReceiptFinals,
  recordInvalidPrune,
  recordChatDedupeMemory,
  recordChatDedupeDbDuplicate,
  recordPushTokenCrossOwnerAudit,
  getSnapshot,
  reset,
  emitAggregationLogLine,
  bucketReceiptError,
};
