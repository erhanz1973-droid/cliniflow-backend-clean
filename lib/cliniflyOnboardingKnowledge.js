/**
 * Clinifly onboarding/support KB retrieval — user-facing setup help (not Sales product FAQ).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getBundledCliniflyOnboardingKb } = require("./cliniflyOnboardingKbBundled");
const { normalizeMatchText, normalizeLocale } = require("./cliniflySalesKnowledge");

const CACHE_TTL_MS = 300_000;
const DEFAULT_LIMIT = 3;
const MIN_SCORE = 48;

/** @type {{ loadedAt: number, entries: ReturnType<getBundledCliniflyOnboardingKb> } | null} */
let entryCache = null;

/**
 * @param {ReturnType<getBundledCliniflyOnboardingKb>[number]} row
 */
function mapOnboardingRow(row) {
  return {
    id: String(row.id || ""),
    screenKey: String(row.screen_key || row.screenKey || ""),
    topicId: String(row.topic_id || row.topicId || ""),
    priority: Number(row.priority) || 50,
    locales: Array.isArray(row.locales) ? row.locales.map(normalizeLocale) : ["en"],
    questions: Array.isArray(row.questions) ? row.questions.map(String) : [],
    userExplanation: String(row.user_explanation || row.userExplanation || ""),
    steps: Array.isArray(row.steps) ? row.steps.map(String) : [],
    commonMistakes: Array.isArray(row.common_mistakes || row.commonMistakes)
      ? (row.common_mistakes || row.commonMistakes).map(String)
      : [],
    faq: Array.isArray(row.faq) ? row.faq : [],
    aiSupportAnswers: Array.isArray(row.ai_support_answers || row.aiSupportAnswers)
      ? (row.ai_support_answers || row.aiSupportAnswers).map(String)
      : [],
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
  };
}

async function loadActiveOnboardingKbEntries(opts = {}) {
  if (!isSupabaseEnabled()) {
    const bundled = getBundledCliniflyOnboardingKb();
    entryCache = { loadedAt: Date.now(), entries: bundled };
    return bundled;
  }
  const now = Date.now();
  if (!opts.force && entryCache && now - entryCache.loadedAt < CACHE_TTL_MS) {
    return entryCache.entries;
  }

  const { data, error } = await supabase
    .from("clinifly_onboarding_kb_entries")
    .select(
      "id, screen_key, topic_id, priority, locales, questions, user_explanation, steps, common_mistakes, faq, ai_support_answers, tags",
    )
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) {
    console.warn("[cliniflyOnboardingKnowledge] load:", error.message, "— bundled");
    const bundled = getBundledCliniflyOnboardingKb();
    entryCache = { loadedAt: now, entries: bundled };
    return bundled;
  }

  let entries = (data || []).map(mapOnboardingRow).filter((e) => e.id);
  if (!entries.length) {
    entries = getBundledCliniflyOnboardingKb();
  }
  entryCache = { loadedAt: now, entries };
  return entries;
}

/**
 * @param {ReturnType<mapOnboardingRow>} entry
 * @param {string} messageNorm
 * @param {Set<string>} msgTokens
 * @param {string} locale
 */
function scoreOnboardingEntry(entry, messageNorm, msgTokens, locale) {
  let score = entry.priority;
  if (entry.locales.includes(locale)) score += 6;
  for (const rawQ of entry.questions) {
    const q = normalizeMatchText(rawQ);
    if (q && messageNorm.includes(q)) score += 44;
    else if (q.length >= 8) {
      const hits = q.split(" ").filter((w) => w.length >= 4 && msgTokens.has(w)).length;
      if (hits >= 2) score += 10 + hits * 3;
    }
  }
  for (const tag of entry.tags) {
    const tagNorm = normalizeMatchText(String(tag).replace(/_/g, " "));
    if (tagNorm && messageNorm.includes(tagNorm)) score += 14;
  }
  return score;
}

/**
 * @param {ReturnType<mapOnboardingRow>} entry
 */
function formatOnboardingEntryForContext(entry) {
  const faqLines = (entry.faq || [])
    .slice(0, 4)
    .map((f) => `  Q: ${f.q}\n  A: ${f.a}`)
    .join("\n");
  const mistakes = entry.commonMistakes.slice(0, 4).map((m) => `  - ${m}`).join("\n");
  const steps = entry.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const aiSamples = entry.aiSupportAnswers.slice(0, 2).map((a) => `  • ${a}`).join("\n");

  return (
    `[${entry.id}] screen=${entry.screenKey}\n` +
    `Summary: ${entry.userExplanation}\n` +
    `Steps:\n${steps}\n` +
    `Common mistakes:\n${mistakes}\n` +
    `FAQ:\n${faqLines}\n` +
    `AI support tone examples:\n${aiSamples}`
  );
}

/**
 * @param {{ message: string, locale?: string, limit?: number }} params
 */
async function retrieveCliniflyOnboardingKnowledge(params) {
  const message = String(params.message || "").trim();
  const messageNorm = normalizeMatchText(message);
  const locale = normalizeLocale(params.locale);
  const limit = Math.min(4, Math.max(1, Number(params.limit) || DEFAULT_LIMIT));

  if (!messageNorm) {
    return { entryIds: [], contextBlock: "", topScore: 0 };
  }

  const allEntries = await loadActiveOnboardingKbEntries();
  const msgTokens = new Set(
    messageNorm
      .split(" ")
      .filter((w) => w.length >= 3),
  );

  const ranked = allEntries
    .map((entry) => ({
      entry,
      score: scoreOnboardingEntry(entry, messageNorm, msgTokens, locale),
    }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const entryIds = ranked.map((r) => r.entry.id);
  const contextBlock = ranked.length
    ? "CLINIFLY ONBOARDING / SUPPORT KB (explain using UI labels — not database fields):\n" +
      ranked.map((r) => formatOnboardingEntryForContext(r.entry)).join("\n\n")
    : "";

  return {
    entryIds,
    contextBlock,
    topScore: ranked[0]?.score || 0,
  };
}

/** @param {string} message */
function looksLikeOnboardingSupportQuery(message) {
  const m = normalizeMatchText(message);
  if (!m) return false;
  return (
    /\b(register|login|log in|settings|whatsapp|messenger|facebook|instagram|clinic code|referral|price list|treatment price|ai training|directory profile|marketplace profile|lead inbox|doctor app|approve doctor|google reviews|forgot password|admin register|how do i set up|how to connect|onboarding|customer support|kurulum|kayit|giris|doktor|dizin profili|ai egitim|fiyat listesi|შესვლა|რეგისტრაცია|ექიმი|ლიდ|კატალოგი)\b/.test(
      m,
    ) ||
    /(clinic code|klinik kod|კლინიკის კოდი|nasil kurulur|kurulum sirasi|step by step)/.test(m)
  );
}

module.exports = {
  loadActiveOnboardingKbEntries,
  retrieveCliniflyOnboardingKnowledge,
  formatOnboardingEntryForContext,
  looksLikeOnboardingSupportQuery,
};
