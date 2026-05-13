/**
 * Standard one-line JSON for auth / OAuth observability (grep AUTH_TELEMETRY_V1).
 */

function emitAuthTelemetryV1(event, fields = {}) {
  const ev = String(event || "unknown").slice(0, 64);
  const payload = {
    tag: "AUTH_TELEMETRY_V1",
    ts: new Date().toISOString(),
    event: ev,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

module.exports = { emitAuthTelemetryV1 };
