/**
 * Temporary Meta integration tracing (Railway logs).
 * Opt out: META_DEBUG_LOGS=false
 */

function isMetaTraceEnabled() {
  return String(process.env.META_DEBUG_LOGS || "").trim() !== "false";
}

function isMetaDebugVerbose() {
  return String(process.env.META_DEBUG_VERBOSE || "").trim() === "true";
}

/**
 * @param {unknown} token
 */
function tokenHint(token) {
  const t = String(token || "").trim();
  if (!t) return { present: false };
  return { present: true, length: t.length, suffix: t.slice(-6) };
}

/**
 * Log-safe Graph URL (redacts access_token query param).
 * @param {string} urlString
 */
function graphUrlForLog(urlString) {
  try {
    const u = new URL(String(urlString || ""));
    if (u.searchParams.has("access_token")) {
      const t = u.searchParams.get("access_token") || "";
      u.searchParams.set(
        "access_token",
        `[REDACTED len=${t.length} suffix=${t.slice(-6)}]`,
      );
    }
    return u.toString();
  } catch {
    return "[invalid-graph-url]";
  }
}

/**
 * Strip page access_token fields from Graph payloads before logging.
 * @param {unknown} value
 */
function redactGraphPayload(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactGraphPayload);
  if (typeof value !== "object") return value;
  const out = { ...value };
  if (typeof out.access_token === "string" && out.access_token) {
    out.access_token = `[REDACTED len=${out.access_token.length}]`;
  }
  for (const key of Object.keys(out)) {
    if (key === "access_token") continue;
    out[key] = redactGraphPayload(out[key]);
  }
  return out;
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [detail]
 */
function metaTrace(tag, detail = {}) {
  if (!isMetaTraceEnabled()) return;
  console.log(`[metaTrace] ${tag}`, detail);
}

/**
 * @param {unknown} granularScopes
 */
function serializeGranularScopes(granularScopes) {
  try {
    return JSON.parse(JSON.stringify(granularScopes ?? []));
  } catch {
    return [];
  }
}

module.exports = {
  isMetaTraceEnabled,
  isMetaDebugVerbose,
  metaTrace,
  tokenHint,
  graphUrlForLog,
  redactGraphPayload,
  serializeGranularScopes,
};
