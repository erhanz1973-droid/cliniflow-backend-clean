/**
 * Skip duplicate AI replies when the patient sends the same message twice.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {Map<string, { norm: string, at: number }>} */
const inflightByPatientClinic = new Map();

/** @type {Map<string, { at: number }>} */
const aiGenerationInProgress = new Map();

const INFLIGHT_TTL_MS = 90_000;
const AI_GENERATION_MUTEX_MS = 120_000;
/** Same question within this window reuses the prior assistant reply instead of regenerating. */
const DUPLICATE_QUESTION_WINDOW_MS = 30_000;
const DUPLICATE_SIM_SHORT = 0.96;
const DUPLICATE_SIM_LONG = 0.92;

/**
 * @param {string} text
 */
function normalizePatientMessageKey(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} a
 * @param {string} b
 */
function wordSetSimilarity(a, b) {
  const na = normalizePatientMessageKey(a);
  const nb = normalizePatientMessageKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length > 8 && nb.length > 8 && (na.includes(nb) || nb.includes(na))) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    if (ratio > 0.85) return 0.97;
  }
  const wa = new Set(na.split(" ").filter((w) => w.length > 0));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 0));
  if (!wa.size || !wb.size) return na === nb ? 1 : 0;
  let inter = 0;
  for (const w of wa) {
    if (wb.has(w)) inter += 1;
  }
  const union = wa.size + wb.size - inter;
  return union ? inter / union : 0;
}

/**
 * @param {string} a
 * @param {string} b
 */
function patientMessagesNearDuplicate(a, b) {
  const na = normalizePatientMessageKey(a);
  const nb = normalizePatientMessageKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  const threshold = minLen < 24 ? DUPLICATE_SIM_SHORT : DUPLICATE_SIM_LONG;
  return wordSetSimilarity(a, b) >= threshold;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
function inflightKey(patientId, clinicId) {
  return `${String(patientId || "").trim()}:${String(clinicId || "").trim()}`;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} message
 * @returns {boolean} true if this turn may proceed
 */
function claimPatientInboundTurn(patientId, clinicId, message) {
  const key = inflightKey(patientId, clinicId);
  const norm = normalizePatientMessageKey(message);
  if (!norm) return true;

  const now = Date.now();
  for (const [k, v] of inflightByPatientClinic.entries()) {
    if (now - v.at > INFLIGHT_TTL_MS) inflightByPatientClinic.delete(k);
  }

  const prev = inflightByPatientClinic.get(key);
  if (prev && patientMessagesNearDuplicate(prev.norm, norm)) {
    return false;
  }
  inflightByPatientClinic.set(key, { norm, at: now });
  return true;
}

/**
 * One active AI generation per patient/clinic — blocks parallel workflows on split bursts.
 * @param {string} patientId
 * @param {string} clinicId
 * @returns {boolean}
 */
function beginAiReplyGeneration(patientId, clinicId) {
  const key = inflightKey(patientId, clinicId);
  const now = Date.now();
  for (const [k, v] of aiGenerationInProgress.entries()) {
    if (now - v.at > AI_GENERATION_MUTEX_MS) aiGenerationInProgress.delete(k);
  }
  if (aiGenerationInProgress.has(key)) return false;
  aiGenerationInProgress.set(key, { at: now });
  return true;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
function endAiReplyGeneration(patientId, clinicId) {
  aiGenerationInProgress.delete(inflightKey(patientId, clinicId));
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
function releasePatientInboundTurn(patientId, clinicId) {
  inflightByPatientClinic.delete(inflightKey(patientId, clinicId));
}

/**
 * @param {Record<string, unknown>} profileRow
 */
function readLastRepliedPatientNorm(profileRow) {
  const flags =
    profileRow?.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {};
  return String(
    flags.lastAiRepliedPatientMessageNorm ||
      flags.last_ai_replied_patient_message_norm ||
      "",
  ).trim();
}

/**
 * @param {string} role
 */
function isOutboundAnswerRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "assistant" || r === "ai" || r === "staff" || r === "clinic" || r === "coordinator";
}

/**
 * @param {Record<string, unknown>} row
 */
function readChannelRowExternalId(row) {
  const meta =
    row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  return String(row.external_message_id || meta.message_id || meta.external_message_id || "").trim();
}

/**
 * Latest matching patient turn was answered and not followed by a newer same-text patient turn.
 * @param {Array<{ role?: string, text?: string, body?: string, message_role?: string, created_at?: string, at?: string }>} rowsAsc
 * @param {string} message
 * @param {{ externalMessageId?: string|null }} [opts]
 */
function patientTextAlreadyAnsweredInTimeline(rowsAsc, message, opts = {}) {
  const rows = Array.isArray(rowsAsc) ? rowsAsc : [];
  const incomingExternalId = String(opts.externalMessageId || "").trim();

  if (incomingExternalId) {
    let anchorIdx = -1;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const role = String(row.message_role || row.role || "").toLowerCase();
      const ext = readChannelRowExternalId(row);
      if (role === "patient" && ext && ext === incomingExternalId) {
        anchorIdx = i;
      }
    }
    if (anchorIdx >= 0) {
      for (let i = anchorIdx + 1; i < rows.length; i += 1) {
        const row = rows[i];
        const role = String(row.message_role || row.role || "").toLowerCase();
        if (role === "patient" || role === "user") break;
        if (isOutboundAnswerRole(role)) {
          return { duplicate: true, reason: "same_external_id_already_answered" };
        }
      }
    }
    return { duplicate: false };
  }

  let lastMatchIdx = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const role = String(row.message_role || row.role || "").toLowerCase();
    const text = String(row.body || row.text || "").trim();
    if ((role === "patient" || role === "user") && patientMessagesNearDuplicate(message, text)) {
      lastMatchIdx = i;
    }
  }
  if (lastMatchIdx < 0) return { duplicate: false };

  let hasAssistantAfter = false;
  for (let i = lastMatchIdx + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const role = String(row.message_role || row.role || "").toLowerCase();
    const text = String(row.body || row.text || "").trim();
    if ((role === "patient" || role === "user") && patientMessagesNearDuplicate(message, text)) {
      return { duplicate: false };
    }
    if (isOutboundAnswerRole(role)) {
      hasAssistantAfter = true;
      break;
    }
    if (role === "patient" || role === "user") break;
  }

  if (hasAssistantAfter) {
    return { duplicate: true, reason: "same_patient_message_already_answered" };
  }
  return { duplicate: false };
}

/**
 * @param {{ at?: string, created_at?: string }} turn
 */
function turnAtMs(turn) {
  const at = turn?.at || turn?.created_at;
  if (!at) return NaN;
  const ms = Date.parse(String(at));
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * @param {Array<{ role?: string, text?: string }>} turns
 * @param {number} userIdx
 */
function findAssistantReplyAfterTurn(turns, userIdx) {
  for (let j = userIdx + 1; j < turns.length; j += 1) {
    const role = String(turns[j].role || "").toLowerCase();
    const text = String(turns[j].text || "").trim();
    if (role === "user" || role === "patient") break;
    if (isOutboundAnswerRole(role) && text) return text;
  }
  return null;
}

/**
 * Same patient text within `windowMs` that already received an assistant reply.
 * @param {Array<{ role?: string, text?: string, at?: string }>} recentTurns
 * @param {string} message
 * @param {number} [windowMs]
 */
function findRecentDuplicateWithAssistantReply(
  recentTurns,
  message,
  windowMs = DUPLICATE_QUESTION_WINDOW_MS,
) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  const now = Date.now();
  if (!normalizePatientMessageKey(message)) return null;

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    const role = String(turn.role || "").toLowerCase();
    if (role !== "user" && role !== "patient") continue;
    const text = String(turn.text || "").trim();
    if (!patientMessagesNearDuplicate(message, text)) continue;

    const atMs = turnAtMs(turn);
    if (Number.isFinite(atMs) && now - atMs > windowMs) continue;
    if (!Number.isFinite(atMs) && i < turns.length - 6) continue;

    const reply = findAssistantReplyAfterTurn(turns, i);
    if (reply) {
      return { reply, matchedMessage: text, atMs: Number.isFinite(atMs) ? atMs : now };
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {string} message
 * @param {Array<{ role: string, text: string, at?: string }>} [recentTurns]
 * @param {string|null|undefined} [externalMessageId]
 */
function duplicateFromRecentTurns(message, recentTurns, externalMessageId) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  const rowsAsc = turns.map((t) => ({
    role: t?.role,
    text: t?.text,
    at: t?.at,
  }));
  return patientTextAlreadyAnsweredInTimeline(rowsAsc, message, { externalMessageId });
}

/**
 * @param {string} profileId
 * @param {string} message
 * @param {{ externalMessageId?: string|null }} [opts]
 */
async function duplicateFromChannelHistory(profileId, message, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) {
    return { duplicate: false };
  }
  const norm = normalizePatientMessageKey(message);
  if (!norm) return { duplicate: false };

  try {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const selectAttempts = [
      "message_role, body, created_at, metadata, external_message_id",
      "message_role, body, created_at, metadata",
      "message_role, body, created_at",
    ];
    let rows = null;
    for (const sel of selectAttempts) {
      const { data, error } = await supabase
        .from("ai_coordinator_channel_messages")
        .select(sel)
        .eq("profile_id", profileId)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(48);
      if (!error) {
        rows = data;
        break;
      }
      const code = String(error.code || "");
      if (!["42703", "PGRST204", "PGRST205"].includes(code)) break;
    }
    return patientTextAlreadyAnsweredInTimeline(rows || [], message, opts);
  } catch (e) {
    console.warn("[patientInboundDedup] channel scan:", e?.message || e);
  }
  return { duplicate: false };
}

/**
 * @param {{
 *   profileRow: Record<string, unknown>,
 *   patientId: string,
 *   clinicId: string,
 *   message: string,
 *   recentTurns?: Array<{ role: string, text: string }>,
 *   externalMessageId?: string|null,
 * }} params
 */
async function detectDuplicatePatientInbound(params) {
  const message = String(params.message || "").trim();
  const profileRow = params.profileRow || {};
  const profileId = String(profileRow.id || "").trim();
  const externalMessageId = params.externalMessageId || null;

  if (!message) {
    return { duplicate: false };
  }

  const recentDup = findRecentDuplicateWithAssistantReply(
    params.recentTurns,
    message,
    DUPLICATE_QUESTION_WINDOW_MS,
  );
  if (recentDup?.reply) {
    return {
      duplicate: true,
      reason: "same_question_within_30s",
      reuseReply: recentDup.reply,
    };
  }

  if (externalMessageId) {
    if (profileId) {
      const fromChannel = await duplicateFromChannelHistory(profileId, message, { externalMessageId });
      if (fromChannel.duplicate) return fromChannel;
    }
    const fromTurns = duplicateFromRecentTurns(message, params.recentTurns, externalMessageId);
    if (fromTurns.duplicate) return fromTurns;
  } else {
    const repliedNorm = readLastRepliedPatientNorm(profileRow);
    if (repliedNorm && patientMessagesNearDuplicate(message, repliedNorm)) {
      const la = profileRow.last_ai_reply_at
        ? new Date(String(profileRow.last_ai_reply_at)).getTime()
        : 0;
      const lp = profileRow.last_patient_message_at
        ? new Date(String(profileRow.last_patient_message_at)).getTime()
        : 0;
      if (la > 0 && lp > 0 && la >= lp) {
        if (Date.now() - la <= DUPLICATE_QUESTION_WINDOW_MS) {
          const reuse =
            findRecentDuplicateWithAssistantReply(
              params.recentTurns,
              message,
              DUPLICATE_QUESTION_WINDOW_MS,
            )?.reply || null;
          if (reuse) {
            return {
              duplicate: true,
              reason: "already_replied_same_text_within_30s",
              reuseReply: reuse,
            };
          }
        }
        return { duplicate: true, reason: "already_replied_same_text" };
      }
    }

    const fromTurns = duplicateFromRecentTurns(message, params.recentTurns, null);
    if (fromTurns.duplicate) return fromTurns;

    if (profileId) {
      const fromChannel = await duplicateFromChannelHistory(profileId, message);
      if (fromChannel.duplicate) return fromChannel;
    }
  }

  const key = inflightKey(params.patientId, params.clinicId);
  const inflight = inflightByPatientClinic.get(key);
  if (inflight && patientMessagesNearDuplicate(inflight.norm, message)) {
    return { duplicate: true, reason: "duplicate_inflight" };
  }

  return { duplicate: false };
}

/**
 * @param {string} profileId
 * @param {string} message
 * @param {Record<string, unknown>} [prevFlags]
 */
function buildRepliedPatientMessageFlags(message, prevFlags = {}) {
  const norm = normalizePatientMessageKey(message);
  return {
    ...prevFlags,
    lastAiRepliedPatientMessageNorm: norm,
    last_ai_replied_patient_message_norm: norm,
    lastAiRepliedPatientMessageAt: new Date().toISOString(),
  };
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {string} message
 */
function aiAlreadyRepliedToSamePatientText(profileRow, message) {
  const repliedNorm = readLastRepliedPatientNorm(profileRow);
  if (!repliedNorm) return false;
  if (!patientMessagesNearDuplicate(message, repliedNorm)) return false;
  const la = profileRow.last_ai_reply_at
    ? new Date(String(profileRow.last_ai_reply_at)).getTime()
    : 0;
  return la > 0;
}

module.exports = {
  normalizePatientMessageKey,
  patientMessagesNearDuplicate,
  readLastRepliedPatientNorm,
  claimPatientInboundTurn,
  releasePatientInboundTurn,
  beginAiReplyGeneration,
  endAiReplyGeneration,
  detectDuplicatePatientInbound,
  buildRepliedPatientMessageFlags,
  aiAlreadyRepliedToSamePatientText,
  findRecentDuplicateWithAssistantReply,
  DUPLICATE_QUESTION_WINDOW_MS,
};
