/**
 * Patient-sent external links — warn staff not to open (malware / phishing).
 */

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * @param {string} [text]
 */
function messageContainsExternalLink(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(t);
}

module.exports = {
  messageContainsExternalLink,
  URL_PATTERN,
};
