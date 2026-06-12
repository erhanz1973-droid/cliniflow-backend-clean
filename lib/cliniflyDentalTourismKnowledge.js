/**
 * Clinifly AI — Dental Tourism KB v1 retrieval (bundled; structured FAQ matching).
 */

const { getBundledCliniflyDentalTourismKb } = require("./cliniflyDentalTourismKbBundled");
const {
  normalizeMatchText,
  normalizeLocale,
} = require("./cliniflySalesKnowledge");

const DEFAULT_LIMIT = Math.min(
  4,
  Math.max(1, parseInt(process.env.CLINIFLY_DENTAL_TOURISM_KB_LIMIT || "3", 10) || 3),
);
const MIN_SCORE = Math.max(
  24,
  parseInt(process.env.CLINIFLY_DENTAL_TOURISM_KB_MIN_SCORE || "48", 10) || 48,
);

const DENTAL_TOURISM_AI_BEHAVIOR_RULES = `DENTAL TOURISM KB — AI BEHAVIOUR (v1):
• Help users understand treatments, compare clinics, and submit treatment requests.
• Never guarantee treatment outcomes or claim a clinic is the "best".
• Never provide medical diagnosis.
• Never promise exact pricing unless a specific clinic quotation is already in context.
• Encourage comparing multiple clinics and requesting personalized quotations.
• Encourage photo upload when relevant (smile/teeth photos help clinics quote).
• Focus on education, comparison, and lead generation — not long generic lectures.`;

/**
 * @param {string} messageNorm
 */
function tokenSet(messageNorm) {
  return new Set(
    messageNorm
      .split(" ")
      .map((w) => w.trim())
      .filter((w) => w.length >= 3),
  );
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} messageNorm
 * @param {Set<string>} msgTokens
 * @param {string} locale
 */
function scoreKbEntry(entry, messageNorm, msgTokens, locale) {
  if (!entry?.id || !messageNorm) return 0;

  let contentScore = 0;

  for (const rawQ of entry.questions || []) {
    const q = normalizeMatchText(rawQ);
    if (!q) continue;
    if (messageNorm.includes(q)) {
      contentScore += 48;
      continue;
    }
    const qTokens = q.split(" ").filter((w) => w.length >= 4);
    let hits = 0;
    for (const t of qTokens) {
      if (msgTokens.has(t)) hits += 1;
    }
    if (hits >= 2) contentScore += 12 + hits * 4;
  }

  for (const tag of entry.tags || []) {
    const tagNorm = normalizeMatchText(String(tag).replace(/_/g, " "));
    if (tagNorm && messageNorm.includes(tagNorm)) contentScore += 14;
  }

  const topicNorm = normalizeMatchText(String(entry.topicId || "").replace(/_/g, " "));
  if (topicNorm && messageNorm.includes(topicNorm)) contentScore += 8;

  if (contentScore < 12) return 0;

  let score = (Number(entry.priority) || 50) + contentScore;
  const locales = Array.isArray(entry.locales) ? entry.locales : ["en"];
  if (locales.includes(locale)) score += 6;
  else if (locales.includes("en")) score += 2;

  return score;
}

/**
 * @param {{
 *   message: string,
 *   locale?: string|null,
 *   limit?: number,
 *   minScore?: number,
 * }} params
 */
async function retrieveCliniflyDentalTourismKnowledge(params) {
  const message = String(params.message || "").trim();
  const messageNorm = normalizeMatchText(message);
  const locale = normalizeLocale(params.locale);
  const limit = Math.min(5, Math.max(1, Number(params.limit) || DEFAULT_LIMIT));
  const minScore = Number(params.minScore) || MIN_SCORE;

  if (!messageNorm) {
    return { entryIds: [], entries: [], contextBlock: "", topScore: 0 };
  }

  const allEntries = getBundledCliniflyDentalTourismKb();
  const msgTokens = tokenSet(messageNorm);

  const ranked = allEntries
    .map((entry) => ({
      entry,
      score: scoreKbEntry(entry, messageNorm, msgTokens, locale),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  let selected = ranked.slice(0, limit);
  if (!selected.length && ranked.length) {
    selected = ranked.slice(0, Math.min(2, limit));
  }

  const entryIds = selected.map((s) => s.entry.id);
  const lines = selected.map((s, idx) => {
    const e = s.entry;
    const extra = e.answerLong ? `\n   Rule: ${e.answerLong}` : "";
    return `[${idx + 1}] id=${e.id} topic=${e.topicId}\n   Guidance: ${e.answerShort}${extra}`;
  });

  const contextBlock = lines.length
    ? `${DENTAL_TOURISM_AI_BEHAVIOR_RULES}

AUTHORITATIVE DENTAL TOURISM KB v1 — use to inform your reply (do not paste verbatim):
${lines.join("\n")}`
    : "";

  return {
    entryIds,
    entries: selected.map((s) => s.entry),
    contextBlock,
    topScore: selected[0]?.score || 0,
  };
}

module.exports = {
  retrieveCliniflyDentalTourismKnowledge,
  DENTAL_TOURISM_AI_BEHAVIOR_RULES,
};
