/**
 * AI Learning System — detect patterns from conversations; never auto-change business rules.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { isGreetingOnlyMessage } = require("./greetingIntent");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Types the analyzer may emit — never appointment/pricing/policy/calendar/db rules. */
const ALLOWED_CANDIDATE_TYPES = new Set([
  "greeting",
  "faq",
  "phrase",
  "failed_reply",
  "user_correction",
  "dissatisfaction",
]);

/** Block learning signals dominated by critical business logic (no auto rule changes). */
const BLOCKED_LEARNING_CONTEXT_RE =
  /\b(\d{1,2}\s*[:.]\s*\d{2}\s*(am|pm)?|\d{4}-\d{2}-\d{2}|slot\s*#?\s*\d|onaylıyor musunuz|awaiting_slot|calendar\s+sync|sql\s+insert|patient_registration|klinik\s*politik|pricing\s*rule|fiyat\s*tablosu)\b/i;

const GREETING_SLANG = [
  { re: /^(slm|mrb|mrbn|selm|sa|s\.a\.|hg|hb|naber|nbr|heyoo)$/iu, meaning: "selam" },
  { re: /^(hi+|hello+)$/iu, meaning: "hello" },
  { re: /^(gamarjoba|gmr)$/iu, meaning: "gamarjoba" },
];

const FAQ_QUESTION_RE =
  /\?|^(ne\s+kadar|how\s+much|kaç\s+para|nasıl|nasil|nerede|where|what\s+is|nedir|var\s+mı|varmi)\b/i;

const CORRECTION_RE =
  /\b(yanlış|yanlis|öyle\s+değil|oyle\s+degil|not\s+what|that's\s+wrong|tekrar\s+söyle|already\s+(told|said)|söylemiştim|düzelt|duzelt|hayır\s+böyle|hayir\s+boyle)\b/i;

const DISSATISFACTION_RE =
  /\b(memnun\s+değil|memnun\s+degil|kötü\s+hizmet|anlamadım|understand\s+you|frustrat|sinir|saçma|sacma|ridiculous|useless|berbat|rezalet)\b|!{3,}/i;

/**
 * @param {string} value
 */
function normalizeCandidateValue(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/**
 * @param {string} message
 */
function isBlockedLearningContext(message) {
  const t = String(message || "").trim();
  if (!t) return true;
  if (BLOCKED_LEARNING_CONTEXT_RE.test(t)) return true;
  return false;
}

/**
 * @param {string} patientMessage
 */
function detectGreetingCandidate(patientMessage) {
  const t = String(patientMessage || "").trim();
  if (!t || t.length > 32) return null;
  if (isGreetingOnlyMessage(t)) return null;
  for (const item of GREETING_SLANG) {
    if (item.re.test(t)) {
      return {
        type: "greeting",
        value: t,
        meaning: item.meaning,
        confidence: 0.98,
      };
    }
  }
  if (/^(merhaba|selam|hello|hi|gamarjoba)/i.test(t) && t.length <= 20) {
    return { type: "greeting", value: t, meaning: "greeting", confidence: 0.75 };
  }
  return null;
}

/**
 * @param {string} patientMessage
 */
function detectFaqCandidate(patientMessage) {
  const t = String(patientMessage || "").trim();
  if (t.length < 10 || t.length > 320) return null;
  if (!FAQ_QUESTION_RE.test(t)) return null;
  if (isBlockedLearningContext(t)) return null;
  const norm = normalizeCandidateValue(t);
  if (norm.length < 8) return null;
  return {
    type: "faq",
    value: t.slice(0, 280),
    meaning: null,
    confidence: 0.72,
  };
}

/**
 * @param {string} patientMessage
 */
function detectPhraseCandidate(patientMessage) {
  const t = String(patientMessage || "").trim();
  if (t.length < 4 || t.length > 80) return null;
  const tokens = t.split(/\s+/).filter((w) => w.length >= 2 && w.length <= 12);
  if (tokens.length !== 1) return null;
  const word = tokens[0];
  if (/^\d+$/.test(word) || /[:.@/]/.test(word)) return null;
  if (/^(evet|hayir|hayır|ok|tamam|yes|no|the|and|ve)$/i.test(word)) return null;
  if (isGreetingOnlyMessage(t)) return null;
  return {
    type: "phrase",
    value: word,
    meaning: "informal or clinic-specific shorthand — verify before using in replies",
    confidence: 0.55,
  };
}

/**
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 */
function findLastAssistantText(recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const role = String(turns[i]?.role || "").toLowerCase();
    if (role === "assistant" || role === "coordinator" || role === "clinic") {
      return String(turns[i]?.text || "").trim();
    }
  }
  return "";
}

/**
 * @param {string} a
 * @param {string} b
 */
function messagesSimilar(a, b) {
  const na = normalizeCandidateValue(a);
  const nb = normalizeCandidateValue(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 12 && nb.length > 12 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
}

/**
 * @param {string} patientMessage
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 */
function detectFailedReplyCandidate(patientMessage, recentTurns) {
  const t = String(patientMessage || "").trim();
  if (t.length < 8) return null;
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  let sawAssistant = false;
  let priorPatient = "";
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 8; i--) {
    const role = String(turns[i]?.role || "").toLowerCase();
    const text = String(turns[i]?.text || "").trim();
    if (!text) continue;
    if (role === "patient" || role === "user") {
      if (!priorPatient) priorPatient = text;
      continue;
    }
    if (role === "assistant" || role === "coordinator" || role === "clinic") {
      sawAssistant = true;
      break;
    }
  }
  if (!sawAssistant || !priorPatient) return null;
  if (!messagesSimilar(priorPatient, t)) return null;
  const lastAi = findLastAssistantText(turns);
  return {
    type: "failed_reply",
    value: t.slice(0, 280),
    meaning: lastAi ? lastAi.slice(0, 400) : null,
    confidence: 0.8,
    evidence: { priorPatientMessage: priorPatient.slice(0, 280), priorAiReply: lastAi.slice(0, 400) },
  };
}

/**
 * @param {string} patientMessage
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 */
function detectUserCorrectionCandidate(patientMessage, recentTurns) {
  const t = String(patientMessage || "").trim();
  if (!CORRECTION_RE.test(t)) return null;
  const lastAi = findLastAssistantText(recentTurns);
  return {
    type: "user_correction",
    value: t.slice(0, 280),
    meaning: lastAi ? `Patient corrected after: ${lastAi.slice(0, 200)}` : "Patient correction",
    confidence: 0.88,
    evidence: { priorAiReply: lastAi.slice(0, 400) },
  };
}

/**
 * @param {string} patientMessage
 */
function detectDissatisfactionCandidate(patientMessage) {
  const t = String(patientMessage || "").trim();
  if (!DISSATISFACTION_RE.test(t)) return null;
  return {
    type: "dissatisfaction",
    value: t.slice(0, 280),
    meaning: "Patient expressed dissatisfaction — review tone and accuracy",
    confidence: 0.82,
  };
}

/**
 * @param {{
 *   clinicId: string,
 *   profileId?: string|null,
 *   patientMessage: string,
 *   aiReply?: string|null,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 *   channel?: string,
 * }} params
 */
function analyzeConversationTurn(params) {
  const patientMessage = String(params.patientMessage || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  if (!patientMessage || !UUID_RE.test(clinicId)) {
    return { candidates: [], skipped: true, reason: "invalid_input" };
  }
  if (isBlockedLearningContext(patientMessage)) {
    return { candidates: [], skipped: true, reason: "blocked_context" };
  }

  /** @type {Array<Record<string, unknown>>} */
  const found = [];
  const seen = new Set();

  const push = (c) => {
    if (!c || !ALLOWED_CANDIDATE_TYPES.has(c.type)) return;
    const key = `${c.type}:${normalizeCandidateValue(c.value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(c);
  };

  push(detectGreetingCandidate(patientMessage));
  push(detectFaqCandidate(patientMessage));
  push(detectPhraseCandidate(patientMessage));
  push(detectUserCorrectionCandidate(patientMessage, params.recentTurns));
  push(detectDissatisfactionCandidate(patientMessage));
  push(detectFailedReplyCandidate(patientMessage, params.recentTurns));

  return { candidates: found, skipped: false };
}

/**
 * @param {string} clinicId
 * @param {Record<string, unknown>} candidate
 * @param {{ profileId?: string, channel?: string, aiReply?: string }} ctx
 */
async function upsertLearningCandidate(clinicId, candidate, ctx = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return { ok: false };

  const type = String(candidate.type || "").trim();
  const value = String(candidate.value || "").trim();
  if (!ALLOWED_CANDIDATE_TYPES.has(type) || !value) return { ok: false };

  const norm = normalizeCandidateValue(value);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("ai_learning_candidates")
    .select("id, occurrence_count")
    .eq("clinic_id", clinicId)
    .eq("candidate_type", type)
    .eq("status", "pending")
    .ilike("value", value)
    .maybeSingle();

  if (existing?.id) {
    const nextCount = Number(existing.occurrence_count || 1) + 1;
    await supabase
      .from("ai_learning_candidates")
      .update({
        occurrence_count: nextCount,
        confidence: candidate.confidence ?? null,
        meaning: candidate.meaning ?? null,
        evidence: candidate.evidence || {},
        last_seen_at: now,
        updated_at: now,
        source_profile_id: ctx.profileId || null,
        source_channel: ctx.channel || null,
      })
      .eq("id", existing.id);

    await writeLearningAuditLog({
      clinicId,
      candidateId: existing.id,
      action: "increment_count",
      metadata: { type, value: norm, count: nextCount },
    });
    return { ok: true, id: existing.id, incremented: true };
  }

  const { data: inserted, error } = await supabase
    .from("ai_learning_candidates")
    .insert({
      clinic_id: clinicId,
      candidate_type: type,
      value,
      meaning: candidate.meaning || null,
      confidence: candidate.confidence ?? null,
      occurrence_count: type === "faq" ? Number(candidate.count) || 1 : 1,
      status: "pending",
      source_profile_id: ctx.profileId || null,
      source_channel: ctx.channel || null,
      evidence: {
        ...(candidate.evidence && typeof candidate.evidence === "object" ? candidate.evidence : {}),
        aiReplySnippet: ctx.aiReply ? String(ctx.aiReply).slice(0, 400) : null,
      },
      last_seen_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[aiLearning] insert candidate:", error.message);
    return { ok: false, error: error.message };
  }

  await writeLearningAuditLog({
    clinicId,
    candidateId: inserted?.id,
    action: "analyze_detect",
    metadata: { type, value: norm, confidence: candidate.confidence },
  });

  return { ok: true, id: inserted?.id, created: true };
}

/**
 * @param {{
 *   clinicId: string,
 *   candidateId?: string|null,
 *   action: string,
 *   actorAdminId?: string|null,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function writeLearningAuditLog(params) {
  if (!isSupabaseEnabled() || !UUID_RE.test(params.clinicId)) return;
  try {
    await supabase.from("ai_learning_audit_logs").insert({
      clinic_id: params.clinicId,
      candidate_id: params.candidateId || null,
      action: String(params.action || "analyze_detect"),
      actor_admin_id: params.actorAdminId || null,
      actor_role: "admin",
      metadata: params.metadata && typeof params.metadata === "object" ? params.metadata : {},
    });
  } catch (e) {
    console.warn("[aiLearning] audit:", e?.message || e);
  }
}

/**
 * Fire-and-forget post-turn learning analysis.
 */
async function runPostConversationLearningAnalysis(params) {
  if (process.env.AI_LEARNING_ENABLED === "false") return { analyzed: false };

  const clinicId = String(params.clinicId || "").trim();
  const profileId = String(params.profileId || "").trim();
  const patientMessage = String(params.patientMessage || "").trim();
  const aiReply = String(params.aiReply || "").trim();

  if (!UUID_RE.test(clinicId) || !patientMessage) return { analyzed: false };

  const analysis = analyzeConversationTurn({
    clinicId,
    profileId,
    patientMessage,
    aiReply,
    recentTurns: params.recentTurns,
    channel: params.channel,
  });

  if (analysis.skipped) {
    await writeLearningAuditLog({
      clinicId,
      action: "analyze_skip",
      metadata: { reason: analysis.reason, profileId: profileId || null },
    });
    return { analyzed: true, skipped: true, count: 0 };
  }

  let saved = 0;
  for (const c of analysis.candidates) {
    const r = await upsertLearningCandidate(clinicId, c, {
      profileId: profileId || null,
      channel: params.channel,
      aiReply,
    });
    if (r.ok) saved += 1;
  }
  return { analyzed: true, count: saved };
}

module.exports = {
  ALLOWED_CANDIDATE_TYPES,
  analyzeConversationTurn,
  runPostConversationLearningAnalysis,
  upsertLearningCandidate,
  writeLearningAuditLog,
  normalizeCandidateValue,
  isBlockedLearningContext,
};
