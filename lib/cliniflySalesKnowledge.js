/**
 * Clinifly Sales KB — Phase 1 structured FAQ retrieval (questions + tags, no embeddings).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getBundledCliniflySalesKb } = require("./cliniflySalesKbBundled");
const {
  loadPartnerClinicPlaybookAsSalesEntries,
  invalidatePartnerClinicPlaybookCache,
  PLAYBOOK_NAME,
} = require("./cliniflyPartnerClinicPlaybook");

const CACHE_TTL_MS = Math.max(
  30_000,
  parseInt(process.env.CLINIFLY_SALES_KB_CACHE_TTL_MS || "300000", 10) || 300_000,
);
const DEFAULT_RETRIEVAL_LIMIT = Math.min(
  6,
  Math.max(1, parseInt(process.env.CLINIFLY_SALES_KB_RETRIEVAL_LIMIT || "4", 10) || 4),
);
const MIN_SCORE = Math.max(20, parseInt(process.env.CLINIFLY_SALES_KB_MIN_SCORE || "52", 10) || 52);

/** @type {{ loadedAt: number, entries: Array<Record<string, unknown>> } | null} */
let entryCache = null;

/**
 * @param {string} text
 */
function normalizeMatchText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} raw
 */
function normalizeLocale(raw) {
  const base = String(raw || "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return base || "en";
}

/**
 * @param {Record<string, unknown>} row
 */
function mapKbRow(row) {
  return {
    id: String(row.id || ""),
    topicId: String(row.topic_id || ""),
    priority: Number(row.priority) || 50,
    locales: Array.isArray(row.locales) ? row.locales.map((l) => normalizeLocale(l)) : ["en"],
    questions: Array.isArray(row.questions) ? row.questions.map((q) => String(q)) : [],
    answerShort: String(row.answer_short || ""),
    answerLong: row.answer_long ? String(row.answer_long) : null,
    proofPoints: Array.isArray(row.proof_points) ? row.proof_points : [],
    cta: row.cta ? String(row.cta) : null,
    tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t)) : [],
    forbiddenPhrases: Array.isArray(row.forbidden_phrases)
      ? row.forbidden_phrases.map((p) => String(p))
      : [],
  };
}

function invalidateSalesKbCache() {
  entryCache = null;
  invalidatePartnerClinicPlaybookCache();
}

/**
 * @param {ReturnType<mapKbRow>[]} entries
 * @param {ReturnType<mapKbRow>[]} faqEntries
 */
function mergeFaqEntries(entries, faqEntries) {
  if (!faqEntries.length) return entries;
  const merged = [...entries];
  const seen = new Set(merged.map((e) => e.id));
  for (const faq of faqEntries) {
    if (!seen.has(faq.id)) {
      merged.push(faq);
      seen.add(faq.id);
    }
  }
  merged.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return merged;
}

/**
 * @param {{ force?: boolean }} [opts]
 */
async function loadActiveSalesKbEntries(opts = {}) {
  const playbookEntries = await loadPartnerClinicPlaybookAsSalesEntries({ force: opts.force });

  if (!isSupabaseEnabled()) {
    const bundled = mergeFaqEntries(getBundledCliniflySalesKb(), playbookEntries);
    entryCache = { loadedAt: Date.now(), entries: bundled };
    return bundled;
  }
  const now = Date.now();
  if (!opts.force && entryCache && now - entryCache.loadedAt < CACHE_TTL_MS) {
    return entryCache.entries;
  }

  const { data, error } = await supabase
    .from("clinifly_sales_kb_entries")
    .select(
      "id, topic_id, priority, locales, questions, answer_short, answer_long, proof_points, cta, tags, forbidden_phrases",
    )
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) {
    console.warn("[cliniflySalesKnowledge] load:", error.message, "— using bundled KB");
    const bundled = mergeFaqEntries(getBundledCliniflySalesKb(), playbookEntries);
    entryCache = { loadedAt: now, entries: bundled };
    return bundled;
  }

  let entries = (data || []).map(mapKbRow).filter((e) => e.id && e.answerShort);
  if (!entries.length) {
    console.warn("[cliniflySalesKnowledge] empty DB — using bundled KB");
    entries = getBundledCliniflySalesKb();
  }

  entries = mergeFaqEntries(entries, playbookEntries);

  entryCache = { loadedAt: now, entries };
  return entries;
}

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
 * @param {ReturnType<mapKbRow>} entry
 * @param {string} messageNorm
 * @param {Set<string>} msgTokens
 * @param {string} locale
 */
function scoreKbEntry(entry, messageNorm, msgTokens, locale) {
  if (!entry.id || !messageNorm) return 0;

  let score = entry.priority;

  if (entry.locales.includes(locale)) score += 6;
  else if (entry.locales.includes("en")) score += 2;

  for (const rawQ of entry.questions) {
    const q = normalizeMatchText(rawQ);
    if (!q) continue;
    if (messageNorm.includes(q)) {
      score += 48;
      continue;
    }
    if (q.length >= 12 && q.split(" ").filter((w) => messageNorm.includes(w)).length >= 3) {
      score += 32;
    }
    const qTokens = q.split(" ").filter((w) => w.length >= 4);
    let hits = 0;
    for (const t of qTokens) {
      if (msgTokens.has(t)) hits += 1;
    }
    if (hits >= 2) score += 12 + hits * 4;
  }

  for (const tag of entry.tags) {
    const tagNorm = normalizeMatchText(String(tag).replace(/_/g, " "));
    if (!tagNorm) continue;
    if (messageNorm.includes(tagNorm)) score += 18;
    const tagToken = tagNorm.split(" ").find((w) => w.length >= 4);
    if (tagToken && msgTokens.has(tagToken)) score += 10;
  }

  const topicNorm = normalizeMatchText(entry.topicId.replace(/_/g, " "));
  if (topicNorm && messageNorm.includes(topicNorm)) score += 8;

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
async function retrieveCliniflySalesKnowledge(params) {
  const message = String(params.message || "").trim();
  const messageNorm = normalizeMatchText(message);
  const locale = normalizeLocale(params.locale);
  const limit = Math.min(8, Math.max(1, Number(params.limit) || DEFAULT_RETRIEVAL_LIMIT));
  const minScore = Number(params.minScore) || MIN_SCORE;

  if (!messageNorm) {
    return {
      entryIds: [],
      entries: [],
      contextBlock: "",
      topScore: 0,
    };
  }

  const allEntries = await loadActiveSalesKbEntries();
  const msgTokens = tokenSet(messageNorm);

  const ranked = allEntries
    .map((entry) => ({
      entry,
      score: scoreKbEntry(entry, messageNorm, msgTokens, locale),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const selected = ranked.slice(0, limit);
  if (!selected.length && allEntries.length) {
    const fallback = allEntries
      .map((entry) => ({
        entry,
        score: scoreKbEntry(entry, messageNorm, msgTokens, locale),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(2, limit));
    selected.push(...fallback.filter((f) => f.score > 0));
  }

  const deduped = [];
  const seenTopics = new Set();
  for (const row of selected) {
    const topic = row.entry.topicId || row.entry.id;
    if (seenTopics.has(topic) && deduped.length >= 1) continue;
    seenTopics.add(topic);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }

  const entryIds = deduped.map((s) => s.entry.id);
  const lines = deduped.map((s, idx) => {
    const e = s.entry;
    const proofs =
      e.proofPoints?.length > 0
        ? `\n   Facts: ${e.proofPoints.join("; ")}.`
        : "";
    const long = e.answerLong ? `\n   Extra: ${e.answerLong}` : "";
    const cta = e.cta
      ? `\n   Internal tag: ${e.cta} (visitor CTA is still free self-service signup unless they explicitly asked for a demo).`
      : "";
    return `[${idx + 1}] id=${e.id} topic=${e.topicId}\n   Use for Solution step only (do NOT copy verbatim): ${e.answerShort}${long}${proofs}${cta}`;
  });

  const { getCliniflyClinicRegisterUrl } = require("./cliniflyClinicRegisterUrl");
  const registerUrl = getCliniflyClinicRegisterUrl();
  const contextBlock = lines.length
    ? `${PLAYBOOK_NAME.toUpperCase()} + AUTHORITATIVE SALES KB — FACTS ONLY.
Speak like a clinic partnership specialist (not a chatbot). Use simple clinic-owner language: more inquiries, appointments, faster replies, less staff workload, international patients, 24/7, 20+ languages.
AVOID jargon: workflow automation, omnichannel, ecosystem, operational efficiency, SaaS.
Example style: "Clinifly can answer patient messages from WhatsApp, Messenger, and Clinifly 24/7, helping you turn more inquiries into appointments."
CLINIC AI TRAINING: Clinifly lets each clinic train its AI with clinic-specific pricing (Treatment Price List), treatment processes, FAQs, hours, materials, policies, and workflows (AI Training Center). NEVER deny this capability.
Transform into Problem → Benefit → Solution → CTA (default: free clinic registration at ${registerUrl} — no credit card). Never paste KB verbatim. Never guarantee patient counts or revenue.
${lines.join("\n")}`
    : "";

  return {
    entryIds,
    entries: selected.map((s) => s.entry),
    contextBlock,
    topScore: selected[0]?.score || 0,
  };
}

/**
 * @param {string[]} entryIds
 */
function formatKbIdsForLog(entryIds) {
  return (entryIds || []).map((id) => String(id).trim()).filter(Boolean);
}

module.exports = {
  loadActiveSalesKbEntries,
  retrieveCliniflySalesKnowledge,
  invalidateSalesKbCache,
  normalizeMatchText,
  normalizeLocale,
  formatKbIdsForLog,
};
