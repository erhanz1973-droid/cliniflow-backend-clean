/**
 * Skip duplicate AI replies when the patient sends the same message twice.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {Map<string, { norm: string, at: number }>} */
const inflightByPatientClinic = new Map();

const INFLIGHT_TTL_MS = 90_000;
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
 * @param {Record<string, unknown>} profileRow
 * @param {string} message
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function duplicateFromRecentTurns(message, recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  let sawPatient = false;
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 8; i--) {
    const t = turns[i];
    const role = String(t?.role || "").toLowerCase();
    const text = String(t?.text || "").trim();
    if (!text) continue;
    if (role === "assistant" || role === "coordinator" || role === "clinic") {
      if (sawPatient) break;
      continue;
    }
    if (role === "patient" || role === "user") {
      if (patientMessagesNearDuplicate(message, text)) {
        return { duplicate: true, reason: "same_text_in_recent_turns" };
      }
      sawPatient = true;
    }
  }
  return { duplicate: false };
}

/**
 * @param {string} profileId
 * @param {string} message
 */
async function duplicateFromChannelHistory(profileId, message) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) {
    return { duplicate: false };
  }
  const norm = normalizePatientMessageKey(message);
  if (!norm) return { duplicate: false };

  try {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: rows } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("message_role, body, created_at")
      .eq("profile_id", profileId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(24);

    let matchedPatient = false;
    for (const row of rows || []) {
      const role = String(row.message_role || "").toLowerCase();
      const body = String(row.body || "").trim();
      if (role === "patient" && patientMessagesNearDuplicate(message, body)) {
        matchedPatient = true;
        continue;
      }
      if (
        matchedPatient &&
        (role === "assistant" || role === "ai" || role === "staff" || role === "clinic")
      ) {
        return { duplicate: true, reason: "same_patient_message_already_answered" };
      }
    }
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
 * }} params
 */
async function detectDuplicatePatientInbound(params) {
  const message = String(params.message || "").trim();
  const profileRow = params.profileRow || {};
  const profileId = String(profileRow.id || "").trim();

  if (!message) {
    return { duplicate: false };
  }

  const repliedNorm = readLastRepliedPatientNorm(profileRow);
  if (repliedNorm && patientMessagesNearDuplicate(message, repliedNorm)) {
    const la = profileRow.last_ai_reply_at
      ? new Date(String(profileRow.last_ai_reply_at)).getTime()
      : 0;
    if (la > 0) {
      return { duplicate: true, reason: "already_replied_same_text" };
    }
  }

  const fromTurns = duplicateFromRecentTurns(message, params.recentTurns);
  if (fromTurns.duplicate) return fromTurns;

  if (profileId) {
    const fromChannel = await duplicateFromChannelHistory(profileId, message);
    if (fromChannel.duplicate) return fromChannel;
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
  detectDuplicatePatientInbound,
  buildRepliedPatientMessageFlags,
  aiAlreadyRepliedToSamePatientText,
};
