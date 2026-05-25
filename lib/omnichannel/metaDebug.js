/**
 * Temporary Meta integration tracing (Railway logs).
 * Opt out: META_DEBUG_LOGS=false
 */

function isMetaTraceEnabled() {
  return String(process.env.META_DEBUG_LOGS || "").trim() !== "false";
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
 * @param {string} tag
 * @param {Record<string, unknown>} [detail]
 */
function metaTrace(tag, detail = {}) {
  if (!isMetaTraceEnabled()) return;
  console.log(`[metaTrace] ${tag}`, detail);
}

module.exports = {
  isMetaTraceEnabled,
  metaTrace,
  tokenHint,
};
