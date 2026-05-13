/**
 * Production-safe structured logging for push / Expo paths.
 * - Default: in production, `debug` is silent unless PUSH_LOG_VERBOSE=1.
 * - Never log full Expo push tokens; previews only.
 */
const crypto = require("crypto");

const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const PUSH_LOG_VERBOSE = String(process.env.PUSH_LOG_VERBOSE || "").trim() === "1";

function newPushTraceId() {
  return crypto.randomUUID();
}

function redactExpoToken(val) {
  const s = String(val || "");
  if (!s.startsWith("ExponentPushToken[")) {
    return s.length > 120 ? `${s.slice(0, 80)}…` : s;
  }
  return `${s.slice(0, 28)}…`;
}

function sanitizeFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  const out = { ...fields };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v !== "string") continue;
    if (/^(authorization|cookie|password|secret|jwt|token)$/i.test(k)) {
      out[k] = v.length > 16 ? `${v.slice(0, 4)}…` : "(redacted)";
    }
    if (k === "to" || k === "expo_push_token" || k.endsWith("Token")) out[k] = redactExpoToken(v);
  }
  return out;
}

function logLine(level, event, fields) {
  if (level === "debug" && IS_PROD && !PUSH_LOG_VERBOSE) return;
  const traceId = fields && fields.traceId != null ? String(fields.traceId) : undefined;
  const payload = {
    ts: new Date().toISOString(),
    level,
    event: String(event || "push"),
    ...(traceId ? { traceId } : {}),
    ...sanitizeFields(fields || {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error("[push]", line);
  else if (level === "warn") console.warn("[push]", line);
  else console.log("[push]", line);
}

const pushLog = {
  debug: (event, fields) => logLine("debug", event, fields),
  info: (event, fields) => logLine("info", event, fields),
  warn: (event, fields) => logLine("warn", event, fields),
  error: (event, fields) => logLine("error", event, fields),
};

/** Attach req.traceId + echo x-request-id (for push/oauth debugging). */
function traceMiddleware(req, res, next) {
  const incoming =
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    req.headers["x-trace-id"];
  const tid =
    incoming != null && String(incoming).trim()
      ? String(incoming).trim().slice(0, 128)
      : crypto.randomUUID();
  req.traceId = tid;
  try {
    res.setHeader("x-request-id", tid);
  } catch (_) {
    /* ignore */
  }
  next();
}

/**
 * Single-line JSON for log aggregation (Datadog / Railway). Opt-in via DOCTOR_PUSH_EXPO_TRACE
 * or PUSH_DELIVERY_UNIFIED_LOG=1 for non-doctor paths that pass a traceId.
 *
 * Standard keys: traceId, phase, doctorId, threadId, experiencePartition, expoTicketIds
 */
function pushDeliveryV1(level, fields) {
  const traceId =
    fields && fields.traceId != null && String(fields.traceId).trim()
      ? String(fields.traceId).trim()
      : newPushTraceId();
  const payload = {
    tag: "PUSH_DELIVERY_V1",
    ts: new Date().toISOString(),
    traceId,
    phase: fields.phase != null ? String(fields.phase) : "",
    doctorId: fields.doctorId ?? null,
    patientId: fields.patientId ?? null,
    recipientKind: fields.recipientKind != null ? String(fields.recipientKind) : null,
    threadId: fields.threadId ?? null,
    experiencePartition: fields.experiencePartition ?? null,
    expoTicketIds: Array.isArray(fields.expoTicketIds)
      ? fields.expoTicketIds.map((x) => String(x || "").trim()).filter(Boolean)
      : fields.expoTicketId != null
        ? [String(fields.expoTicketId).trim()]
        : null,
    httpOk: fields.httpOk === undefined ? null : !!fields.httpOk,
    httpStatus: fields.httpStatus != null ? Number(fields.httpStatus) : null,
    batchSize: fields.batchSize != null ? Number(fields.batchSize) : null,
    droppedCrossExperience: fields.droppedCrossExperience != null ? Number(fields.droppedCrossExperience) : null,
    pruneCount: fields.pruneCount != null ? Number(fields.pruneCount) : null,
    detailsError: fields.detailsError != null ? String(fields.detailsError).slice(0, 500) : null,
    tokenPreview: fields.tokenPreview != null ? redactExpoToken(fields.tokenPreview) : null,
    tokenPreviews: Array.isArray(fields.tokenPreviews)
      ? fields.tokenPreviews.slice(0, 12).map((x) => redactExpoToken(x))
      : null,
    message: fields.message != null ? String(fields.message).slice(0, 300) : null,
  };
  const line = JSON.stringify(sanitizeFields(payload));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

module.exports = { pushLog, newPushTraceId, traceMiddleware, pushDeliveryV1 };
