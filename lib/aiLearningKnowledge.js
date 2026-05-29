/**
 * Approved learned patterns — merged into clinic_ai_settings.knowledge_base_config only after admin approve.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getClinicAiProfile, upsertClinicAiSettings } = require("./clinicAiSettings");
const { writeLearningAuditLog, normalizeCandidateValue } = require("./aiLearningSystem");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} raw
 */
function normalizeLearnedPatterns(raw) {
  const lp = raw && typeof raw === "object" ? raw : {};
  return {
    version: Math.max(Number(lp.version) || 0, 1),
    greetings: Array.isArray(lp.greetings) ? lp.greetings : [],
    faqs: Array.isArray(lp.faqs) ? lp.faqs : [],
    phrases: Array.isArray(lp.phrases) ? lp.phrases : [],
    insights: Array.isArray(lp.insights) ? lp.insights : [],
  };
}

/**
 * @param {string} clinicId
 */
async function getApprovedLearnedPatterns(clinicId) {
  const profile = await getClinicAiProfile(clinicId);
  const kb = profile.knowledgeBase || {};
  return normalizeLearnedPatterns(kb.learnedPatterns || kb.learned_patterns);
}

/**
 * @param {Record<string, unknown>} row
 */
function candidateRowToPattern(row) {
  const type = String(row.candidate_type || "").trim();
  const base = {
    value: String(row.value || "").trim(),
    meaning: row.meaning ? String(row.meaning).trim() : null,
    approvedAt: new Date().toISOString(),
    candidateId: row.id,
    occurrenceCount: Number(row.occurrence_count) || 1,
  };
  if (type === "greeting") return { kind: "greetings", entry: base };
  if (type === "faq") {
    return {
      kind: "faqs",
      entry: { ...base, question: base.value, count: base.occurrenceCount },
    };
  }
  if (type === "phrase") return { kind: "phrases", entry: base };
  return {
    kind: "insights",
    entry: {
      ...base,
      type,
      note: base.meaning || type,
    },
  };
}

/**
 * @param {string} clinicId
 * @param {Record<string, unknown>} candidateRow
 */
async function applyApprovedCandidateToKnowledge(clinicId, candidateRow) {
  const profile = await getClinicAiProfile(clinicId);
  const kb = profile.knowledgeBase || {};
  const learned = normalizeLearnedPatterns(kb.learnedPatterns);
  const mapped = candidateRowToPattern(candidateRow);
  const list = learned[mapped.kind] || [];
  const norm = normalizeCandidateValue(mapped.entry.value);
  const exists = list.some(
    (item) => normalizeCandidateValue(item.value || item.question) === norm,
  );
  if (!exists) list.push(mapped.entry);
  learned[mapped.kind] = list;
  learned.version = (learned.version || 1) + 1;

  const result = await upsertClinicAiSettings(clinicId, {
    knowledgeBase: {
      ...kb,
      learnedPatterns: learned,
    },
  });

  if (result.ok) {
    await writeLearningAuditLog({
      clinicId,
      candidateId: candidateRow.id,
      action: "apply_knowledge",
      metadata: { kind: mapped.kind, value: mapped.entry.value },
    });
  }
  return result;
}

/**
 * @param {string} clinicId
 */
async function buildLearnedPatternsPromptBlock(clinicId) {
  const learned = await getApprovedLearnedPatterns(clinicId);
  const lines = [];

  if (learned.greetings.length) {
    lines.push("APPROVED PATIENT GREETINGS (admin-verified — treat as greetings only):");
    for (const g of learned.greetings.slice(0, 20)) {
      lines.push(
        `  - "${g.value}"${g.meaning ? ` → ${g.meaning}` : ""}`,
      );
    }
  }
  if (learned.faqs.length) {
    lines.push("FREQUENT PATIENT QUESTIONS (admin-approved FAQ patterns — answer naturally, do not invent prices or calendar rules):");
    for (const f of learned.faqs.slice(0, 15)) {
      lines.push(`  - ${f.question || f.value}${f.count ? ` (seen ~${f.count}x)` : ""}`);
    }
  }
  if (learned.phrases.length) {
    lines.push("APPROVED PATIENT PHRASES / SHORTHAND:");
    for (const p of learned.phrases.slice(0, 20)) {
      lines.push(`  - "${p.value}"${p.meaning ? `: ${p.meaning}` : ""}`);
    }
  }
  if (learned.insights.length) {
    lines.push("COORDINATOR INSIGHTS (from past corrections — improve tone/clarity; never change booking or pricing rules):");
    for (const i of learned.insights.slice(0, 10)) {
      lines.push(`  - [${i.type || "insight"}] ${i.value}${i.note ? ` — ${i.note}` : ""}`);
    }
  }

  if (!lines.length) return "";
  return [
    "LEARNED PATTERNS (human-approved only — do NOT override appointment, pricing, or policy systems):",
    ...lines,
  ].join("\n");
}

/**
 * @param {string} clinicId
 * @param {string} text
 */
async function isApprovedLearnedGreeting(clinicId, text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const norm = normalizeCandidateValue(t);
  const learned = await getApprovedLearnedPatterns(clinicId);
  return learned.greetings.some((g) => normalizeCandidateValue(g.value) === norm);
}

module.exports = {
  normalizeLearnedPatterns,
  getApprovedLearnedPatterns,
  applyApprovedCandidateToKnowledge,
  buildLearnedPatternsPromptBlock,
  isApprovedLearnedGreeting,
};
