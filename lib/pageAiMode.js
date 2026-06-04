/**
 * Facebook Page AI mode — routes Messenger inbound to clinic vs Clinifly sales vs human-only.
 */

/** @readonly */
const PAGE_AI_MODE = Object.freeze({
  CLINIC: "clinic",
  CLINIFLY_SALES: "clinifly_sales",
  HUMAN: "human",
});

const PAGE_AI_MODE_SET = new Set(Object.values(PAGE_AI_MODE));

/** @readonly */
const CONVERSATION_TYPE = Object.freeze({
  CLINIC: "clinic",
  CLINIFLY_SALES: "clinifly_sales",
});

/**
 * @param {string|undefined|null} raw
 */
function normalizePageAiMode(raw) {
  const m = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (PAGE_AI_MODE_SET.has(m)) return m;
  return PAGE_AI_MODE.CLINIC;
}

/**
 * @param {string|undefined|null} pageAiMode
 */
function conversationTypeForPageAiMode(pageAiMode) {
  return normalizePageAiMode(pageAiMode) === PAGE_AI_MODE.CLINIFLY_SALES
    ? CONVERSATION_TYPE.CLINIFLY_SALES
    : CONVERSATION_TYPE.CLINIC;
}

module.exports = {
  PAGE_AI_MODE,
  CONVERSATION_TYPE,
  normalizePageAiMode,
  conversationTypeForPageAiMode,
};
