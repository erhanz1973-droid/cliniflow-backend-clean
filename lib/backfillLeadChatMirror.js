/**
 * Backfill coordinator / offer AI history into patient_messages when a lead doctor is assigned.
 * Fixes assigned doctors missing pre-assignment AI chat in the doctor app.
 */

const { supabase, isSupabaseEnabled, insertIntoTableWithColumnPruning } = require("./supabase");
const { resolveCoordinationOfferIdForPatientClinic } = require("./patientCoordinationChat");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} text
 */
function bodyFields(text) {
  const t = String(text || "").trim().slice(0, 8000);
  return { text: t, message: t, message_text: t, content: t };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveThreadId(patientId, clinicId) {
  const { getCanonicalThread } = require("./canonicalChatThread");
  const canonical = await getCanonicalThread(patientId, clinicId, {
    source: "backfill_mirror",
    repairClinic: false,
    ensureProfile: true,
  });
  if (canonical.threadId && UUID_RE.test(canonical.threadId)) {
    return canonical.threadId;
  }
  const { data: thr } = await supabase
    .from("patient_chat_threads")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return thr?.id && UUID_RE.test(String(thr.id)) ? String(thr.id).trim() : null;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveProfileIds(patientId, clinicId) {
  const ids = new Set();
  const { data: strict } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .limit(8);
  for (const row of strict || []) {
    const id = String(row?.id || "").trim();
    if (UUID_RE.test(id)) ids.add(id);
  }
  if (!ids.size) {
    const { data: loose } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("patient_id", patientId)
      .order("updated_at", { ascending: false })
      .limit(8);
    for (const row of loose || []) {
      const id = String(row?.id || "").trim();
      if (UUID_RE.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * @param {string} patientId
 * @param {string} dedupeKey
 */
async function patientMessageExists(patientId, dedupeKey) {
  const key = String(dedupeKey || "").trim();
  if (!key) return false;
  const { data } = await supabase
    .from("patient_messages")
    .select("id")
    .eq("patient_id", patientId)
    .eq("message_id", key)
    .limit(1);
  return (data || []).length > 0;
}

/**
 * @param {Record<string, unknown>} row
 */
async function insertMirrorRow(row) {
  const payloads = [row, { ...row, clinic_id: undefined }];
  for (const payload of payloads) {
    const pr = await insertIntoTableWithColumnPruning("patient_messages", payload);
    if (!pr.error && pr.data) return { ok: true };
  }
  return { ok: false };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ limit?: number }} [opts]
 */
async function backfillLeadCoordinatorHistoryToPatientMessages(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(pid) || !UUID_RE.test(cid)) {
    return { ok: false, reason: "invalid_params", inserted: 0 };
  }

  const limit = Math.min(400, Math.max(20, Number(opts.limit) || 200));
  const threadId = await resolveThreadId(pid, cid);
  const profileIds = await resolveProfileIds(pid, cid);
  let inserted = 0;

  for (const profileId of profileIds) {
    const { data: chRows } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("id, message_role, body, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: true })
      .limit(limit);

    for (const row of chRows || []) {
      const text = String(row.body || "").trim();
      if (!text) continue;
      const role = String(row.message_role || "").toLowerCase();
      const isPatient =
        role === "patient" || role === "user" || role === "human" || role === "lead";
      const dedupeKey = `coord_mirror_${row.id}`;
      if (await patientMessageExists(pid, dedupeKey)) continue;

      const from_role = isPatient ? "patient" : "clinic";
      const senderName = isPatient
        ? undefined
        : role === "assistant" || role === "ai"
          ? "AI"
          : "Care Team";

      const mirrorRow = {
        patient_id: pid,
        message_id: dedupeKey,
        chat_id: pid,
        type: "text",
        from_role,
        read_at: null,
        clinic_id: cid,
        ...(threadId ? { thread_id: threadId } : {}),
        ...bodyFields(text),
        ...(senderName ? { sender_name: senderName, sender_display_name: senderName } : {}),
      };
      const ins = await insertMirrorRow(mirrorRow);
      if (ins.ok) inserted += 1;
    }
  }

  try {
    const offerId = await resolveCoordinationOfferIdForPatientClinic(pid, cid, {
      createIfMissing: false,
    });
    if (UUID_RE.test(String(offerId || ""))) {
      const { data: offerRows } = await supabase
        .from("offer_messages")
        .select("id, sender_role, text, message_text, created_at, sender_name")
        .eq("offer_id", offerId)
        .order("created_at", { ascending: true })
        .limit(limit);

      for (const row of offerRows || []) {
        const text = String(row.text || row.message_text || "").trim();
        if (!text) continue;
        const dedupeKey = `offer_mirror_${row.id}`;
        if (await patientMessageExists(pid, dedupeKey)) continue;

        const role = String(row.sender_role || "").toLowerCase();
        const isPatient = role === "patient";
        const senderName = isPatient
          ? undefined
          : String(row.sender_name || "").trim() ||
            (role === "doctor" ? "Doktor" : role === "assistant" || role === "ai" ? "AI" : "Care Team");

        const mirrorRow = {
          patient_id: pid,
          message_id: dedupeKey,
          chat_id: pid,
          type: "text",
          from_role: isPatient ? "patient" : "clinic",
          read_at: null,
          clinic_id: cid,
          ...(threadId ? { thread_id: threadId } : {}),
          ...bodyFields(text),
          ...(senderName ? { sender_name: senderName, sender_display_name: senderName } : {}),
        };
        const ins = await insertMirrorRow(mirrorRow);
        if (ins.ok) inserted += 1;
      }
    }
  } catch (e) {
    console.warn("[backfillLeadChatMirror] offer archive:", e?.message || e);
  }

  if (inserted > 0) {
    console.log("[backfillLeadChatMirror] inserted history rows", {
      patient_id: pid.slice(0, 8),
      clinic_id: cid.slice(0, 8),
      inserted,
      thread_id: threadId ? threadId.slice(0, 8) : null,
    });
  }

  return { ok: true, inserted, threadId };
}

module.exports = {
  backfillLeadCoordinatorHistoryToPatientMessages,
};
