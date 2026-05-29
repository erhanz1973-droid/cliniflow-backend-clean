/**
 * Recent coordinator chat turns for memory + repetition awareness.
 * Merges coordinator channel/timeline with live patient_messages (doctor + patient).
 */

const { supabase } = require("./supabase");
const { trimHistoryToRecent } = require("./conversationMemory");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} messageRole
 */
function channelRoleToOpenAi(messageRole) {
  const r = String(messageRole || "").toLowerCase();
  if (r === "patient") return "user";
  return "assistant";
}

/**
 * @param {Record<string, unknown>} row
 */
function roleFromPatientMessageRow(row) {
  const sender = String(row.sender_type || row.from_role || row.from || "").toLowerCase();
  if (sender === "patient" || sender === "from_patient" || row.from_patient === true) return "patient";
  if (sender === "assistant" || sender === "ai") return "ai";
  if (sender === "doctor" || sender === "dr") return "doctor";
  return "human";
}

/**
 * @param {Record<string, unknown>} row
 */
function messageTextFromPatientMessageRow(row) {
  const text = String(row.message_text ?? row.message ?? row.text ?? "").trim();
  if (text) return text;
  if (row.attachment_url || row.file_url) return "📎 Ek";
  return "";
}

/**
 * @param {string} role
 * @param {string} text
 */
function patientClinicRoleToOpenAi(role, text) {
  const r = String(role || "").toLowerCase();
  const body = String(text || "").trim();
  if (!body) return null;
  if (r === "patient") return { role: "user", text: body };
  if (r === "ai") return { role: "assistant", text: body };
  if (r === "doctor") return { role: "assistant", text: `[Doctor]: ${body}` };
  return { role: "assistant", text: `[Clinic team]: ${body}` };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ limit?: number, sinceIso?: string|null }} [opts]
 */
async function fetchPatientClinicChatTurns(patientId, clinicId, opts = {}) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 80, 10), 200);
  const sinceIso = opts.sinceIso ? String(opts.sinceIso).trim() : null;

  const selectAttempts = [
    "id, message, sender_type, from_role, sender_name, created_at",
    "id, message, from_role, created_at",
    "id, message_text, sender_type, from_role, created_at",
    "id, message_text, from_role, created_at",
  ];

  let data = null;
  for (const selectClause of selectAttempts) {
    let q = supabase
      .from("patient_messages")
      .select(selectClause)
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const result = await q;
    if (!result.error) {
      data = result.data;
      break;
    }
    const msg = String(result.error.message || "").toLowerCase();
    if (!msg.includes("column") && !msg.includes("does not exist")) {
      console.warn("[coordinatorRecentHistory] patient_messages:", result.error.message);
      return [];
    }
  }

  if (!data) return [];

  /** @type {Array<{ role: string, text: string, at: string, source: string }>} */
  const turns = [];
  for (const row of data) {
    const role = roleFromPatientMessageRow(row);
    const text = messageTextFromPatientMessageRow(row);
    const mapped = patientClinicRoleToOpenAi(role, text);
    if (!mapped) continue;
    turns.push({
      role: mapped.role,
      text: mapped.text,
      at: String(row.created_at || ""),
      source: "patient_messages",
      rawRole: role,
    });
  }
  return turns;
}

/**
 * @param {Array<{ role: string, text: string, at?: string, source?: string }>} turns
 */
function mergeTurnsChronologically(turns) {
  const list = Array.isArray(turns) ? [...turns] : [];
  list.sort((a, b) => {
    const ta = Date.parse(String(a.at || ""));
    const tb = Date.parse(String(b.at || ""));
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return 0;
  });
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const text = String(t.text || "").trim();
    if (!text) continue;
    const key = `${t.role}|${text.slice(0, 120)}|${String(t.at || "").slice(0, 19)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: t.role, text: t.text, at: t.at, source: t.source, rawRole: t.rawRole });
  }
  return out;
}

/**
 * @param {string} profileId
 * @param {number} [limit]
 */
async function fetchChannelTurns(profileId, limit = 24) {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabase
    .from("ai_coordinator_channel_messages")
    .select("message_role, body, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[coordinatorRecentHistory] channel:", error.message);
    return [];
  }
  return (data || [])
    .map((row) => ({
      role: channelRoleToOpenAi(row.message_role),
      text: String(row.body || "").trim(),
      at: row.created_at,
      source: "channel",
    }))
    .filter((t) => t.text);
}

/**
 * @param {string} profileId
 * @param {number} [limit]
 */
async function fetchTimelineTurns(profileId, limit = 24) {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabase
    .from("ai_coordinator_lead_events")
    .select("patient_message, ai_reply, event_type, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[coordinatorRecentHistory] timeline:", error.message);
    return [];
  }
  /** @type {Array<{ role: string, text: string, at?: string, source: string }>} */
  const turns = [];
  for (const ev of data || []) {
    if (ev.patient_message) {
      turns.push({
        role: "user",
        text: String(ev.patient_message).trim(),
        at: ev.created_at,
        source: "timeline",
      });
    }
    if (ev.ai_reply) {
      const evType = String(ev.event_type || "").toLowerCase();
      const isHuman =
        evType === "human_reply" || evType === "doctor_reply" || evType === "human_takeover";
      turns.push({
        role: "assistant",
        text: isHuman ? `[Doctor]: ${String(ev.ai_reply).trim()}` : String(ev.ai_reply).trim(),
        at: ev.created_at,
        source: "timeline",
        rawRole: isHuman ? "doctor" : "ai",
      });
    }
  }
  return turns.filter((t) => t.text);
}

/**
 * @param {string} profileId
 * @param {{
 *   maxTurns?: number,
 *   patientId?: string,
 *   clinicId?: string,
 *   sinceIso?: string|null,
 *   includeClinicChat?: boolean,
 * }} [opts]
 */
async function fetchRecentCoordinatorTurns(profileId, opts = {}) {
  const maxTurns = opts.maxTurns || 12;
  const fetchLimit = Math.min(maxTurns * 4, 48);

  const channel = await fetchChannelTurns(profileId, fetchLimit);
  const coordinator =
    channel.length >= 2 ? channel : await fetchTimelineTurns(profileId, fetchLimit);

  let merged = [...coordinator];

  const includeClinic =
    opts.includeClinicChat !== false &&
    UUID_RE.test(String(opts.patientId || "")) &&
    UUID_RE.test(String(opts.clinicId || ""));

  if (includeClinic) {
    const clinicChat = await fetchPatientClinicChatTurns(opts.patientId, opts.clinicId, {
      limit: fetchLimit * 2,
      sinceIso: opts.sinceIso || null,
    });
    merged = mergeTurnsChronologically([...merged, ...clinicChat]);
  } else {
    merged = mergeTurnsChronologically(merged);
  }

  return trimHistoryToRecent(
    merged.map((t) => ({ role: t.role, text: t.text })),
    maxTurns,
  );
}

/**
 * Full turns (with rawRole) for snooze catch-up prompt — not trimmed as aggressively.
 * @param {string} profileId
 * @param {{ patientId: string, clinicId: string, sinceIso: string, maxTurns?: number }} opts
 */
async function fetchCoordinatorTurnsForSnoozeCatchUp(profileId, opts) {
  const maxTurns = opts.maxTurns || 24;
  const sinceIso = String(opts.sinceIso || "").trim();
  if (!sinceIso || !UUID_RE.test(profileId)) return [];

  const channel = await fetchChannelTurns(profileId, maxTurns * 2);
  const coordinator =
    channel.length >= 2 ? channel : await fetchTimelineTurns(profileId, maxTurns * 2);

  const clinicChat = await fetchPatientClinicChatTurns(opts.patientId, opts.clinicId, {
    limit: maxTurns * 3,
    sinceIso,
  });

  const merged = mergeTurnsChronologically([...coordinator, ...clinicChat]).filter((t) => {
    const at = Date.parse(String(t.at || ""));
    const since = Date.parse(sinceIso);
    if (!Number.isFinite(at) || !Number.isFinite(since)) return true;
    return at >= since - 5000;
  });

  return merged.slice(-maxTurns);
}

/**
 * Last N assistant texts (for repetition scan).
 * @param {Array<{ role: string, text: string }>} turns
 * @param {number} [n]
 */
function recentAssistantTexts(turns, n = 4) {
  return (turns || [])
    .filter((t) => t.role === "assistant")
    .map((t) => t.text)
    .slice(-n);
}

module.exports = {
  fetchRecentCoordinatorTurns,
  fetchCoordinatorTurnsForSnoozeCatchUp,
  fetchPatientClinicChatTurns,
  recentAssistantTexts,
};
