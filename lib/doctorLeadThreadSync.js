/**
 * Lead thread ↔ assigned doctor — keeps doctor app inbox aligned with coordinator profile.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  recordThreadAssignmentChange,
  ASSIGNMENT_REASON,
  loadThreadAssignmentSnapshotByPatientClinic,
} = require("./patientChatThreadAssignmentAudit");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCTOR_FK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

function isPatientChatThreadsTableUnavailable(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return c === "42P01" || m.includes("patient_chat_threads") && m.includes("does not exist");
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^patient_chat_threads\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

/**
 * @param {string} table
 * @param {Record<string, unknown>} payload
 * @param {string} [selectClause]
 */
async function insertWithColumnPruning(table, payload, selectClause = "id") {
  let current = { ...payload };
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(current).select(selectClause).single();
    if (!error) return { data, error: null };
    lastError = error;
    if (!isMissingColumnError(error)) return { data: null, error };
    const col = getMissingColumnName(error);
    if (!col || !(col in current)) return { data: null, error };
    delete current[col];
  }
  return { data: null, error: lastError };
}

/**
 * Align patient_chat_threads.assigned_doctor_id with explicit operational assignment.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} doctorUuid
 */
async function syncPatientLeadThreadAssignedDoctor(patientId, clinicId, doctorUuid) {
  const pid = String(patientId || "").trim();
  const doc = String(doctorUuid || "").trim();
  const cid = String(clinicId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(pid) || !UUID_RE.test(cid) || !DOCTOR_FK_UUID_RE.test(doc)) {
    return { ok: false, skipped: true };
  }

  const assignedAtIso = new Date().toISOString();
  const before = await loadThreadAssignmentSnapshotByPatientClinic(pid, cid);
  const upd = {
    status: "assigned",
    assigned_doctor_id: doc,
    assigned_at: assignedAtIso,
    updated_at: assignedAtIso,
    is_lead: true,
  };

  try {
    let { data: updated, error: upErr } = await supabase
      .from("patient_chat_threads")
      .update(upd)
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .select("id, patient_id, assigned_doctor_id, status, assigned_at, is_lead")
      .maybeSingle();

    if (upErr) {
      if (isPatientChatThreadsTableUnavailable(upErr)) {
        return { ok: false, skipped: true, reason: "no_thread_table" };
      }
      console.warn("[doctorLeadThreadSync] update:", upErr.message || upErr);
      return { ok: false, error: upErr };
    }

    if (!updated?.id) {
      const insPayload = {
        patient_id: pid,
        clinic_id: cid,
        status: "assigned",
        assigned_doctor_id: doc,
        assigned_at: assignedAtIso,
        updated_at: assignedAtIso,
        is_lead: true,
      };
      const { data: insRow, error: insErr } = await insertWithColumnPruning(
        "patient_chat_threads",
        insPayload,
        "id, patient_id, assigned_doctor_id, status, assigned_at",
      );
      if (!insErr && insRow?.id) {
        void recordThreadAssignmentChange({
          threadId: String(insRow.id),
          patientId: pid,
          clinicId: cid,
          oldAssignedDoctorId: before?.assignedDoctorId || null,
          newAssignedDoctorId: doc,
          reason: ASSIGNMENT_REASON.LEAD_THREAD_SYNC,
          metadata: { mode: "inserted" },
        });
        void syncLeadProfileAssignedDoctor(pid, cid, doc, { force: true }).catch((e) =>
          console.warn("[doctorLeadThreadSync] profile after thread insert:", e?.message || e),
        );
        return { ok: true, threadId: insRow.id, mode: "inserted" };
      }
      if (insErr && isPatientChatThreadsTableUnavailable(insErr)) {
        return { ok: false, skipped: true, reason: "no_thread_table" };
      }
      return { ok: false, skipped: true, reason: "thread_upsert_unavailable", detail: insErr?.message };
    }

    void recordThreadAssignmentChange({
      threadId: String(updated.id),
      patientId: pid,
      clinicId: cid,
      oldAssignedDoctorId: before?.assignedDoctorId || null,
      newAssignedDoctorId: doc,
      reason: ASSIGNMENT_REASON.LEAD_THREAD_SYNC,
      metadata: { mode: "updated" },
    });

    void syncLeadProfileAssignedDoctor(pid, cid, doc, { force: true }).catch((e) =>
      console.warn("[doctorLeadThreadSync] profile after thread:", e?.message || e),
    );

    return { ok: true, threadId: updated.id, mode: "updated" };
  } catch (e) {
    if (isPatientChatThreadsTableUnavailable(e)) {
      return { ok: false, skipped: true, reason: "no_thread_table" };
    }
    console.warn("[doctorLeadThreadSync]:", e?.message || e);
    return { ok: false, error: e };
  }
}

/**
 * Mirror patient_chat_threads.assigned_doctor_id → ai_coordinator_lead_profiles.assigned_doctor_id.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string|null} doctorUuid — null clears profile assignment
 * @param {{ force?: boolean }} [opts] — force overwrites non-null profile assignee
 */
async function syncLeadProfileAssignedDoctor(patientId, clinicId, doctorUuid, opts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  const doc =
    doctorUuid == null || String(doctorUuid || "").trim() === ""
      ? null
      : String(doctorUuid).trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(pid) || !UUID_RE.test(cid)) {
    return { ok: false, skipped: true, reason: "invalid_ids" };
  }
  if (doc != null && !DOCTOR_FK_UUID_RE.test(doc)) {
    return { ok: false, skipped: true, reason: "invalid_doctor" };
  }

  const nowIso = new Date().toISOString();
  let patch = { assigned_doctor_id: doc, updated_at: nowIso };
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let q = supabase
      .from("ai_coordinator_lead_profiles")
      .update(patch)
      .eq("patient_id", pid)
      .eq("clinic_id", cid);
    if (!opts.force && doc) {
      q = q.is("assigned_doctor_id", null);
    }
    const { data, error } = await q.select("id, assigned_doctor_id").maybeSingle();
    if (!error) {
      if (!data?.id) return { ok: false, skipped: true, reason: "no_profile" };
      return { ok: true, profileId: data.id, assignedDoctorId: data.assigned_doctor_id || null };
    }
    lastError = error;
    if (!isMissingColumnError(error)) break;
    const col = getMissingColumnName(error);
    if (!col || !(col in patch)) break;
    delete patch[col];
  }

  if (lastError && !isMissingColumnError(lastError)) {
    console.warn("[doctorLeadThreadSync] profile assign sync:", lastError.message || lastError);
    return { ok: false, error: lastError };
  }
  return { ok: false, skipped: true, reason: "update_failed" };
}

/**
 * Backfill profile assignee from lead threads where profile.assigned_doctor_id is stale/null.
 * @param {string} clinicId
 * @param {{ limit?: number }} [opts]
 */
async function backfillLeadProfileAssignedDoctorFromThreads(clinicId, opts = {}) {
  const cid = String(clinicId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(cid)) {
    return { ok: false, synced: 0, reason: "invalid_clinic" };
  }
  const limit = Math.min(500, Math.max(1, opts.limit || 200));
  const { data: threads, error } = await supabase
    .from("patient_chat_threads")
    .select("patient_id, assigned_doctor_id")
    .eq("clinic_id", cid)
    .eq("is_lead", true)
    .not("assigned_doctor_id", "is", null)
    .order("assigned_at", { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(threads)) {
    return { ok: false, synced: 0, error: error?.message || "thread_fetch_failed" };
  }

  let synced = 0;
  for (const row of threads) {
    const pid = String(row?.patient_id || "").trim();
    const doc = String(row?.assigned_doctor_id || "").trim();
    if (!UUID_RE.test(pid) || !DOCTOR_FK_UUID_RE.test(doc)) continue;
    const { data: prof } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id, assigned_doctor_id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .maybeSingle();
    if (!prof?.id) continue;
    const cur = prof.assigned_doctor_id != null ? String(prof.assigned_doctor_id).trim() : "";
    if (cur === doc) continue;
    const r = await syncLeadProfileAssignedDoctor(pid, cid, doc, { force: true });
    if (r.ok) synced += 1;
  }
  return { ok: true, synced, scanned: threads.length };
}

/**
 * Patients visible via ai_coordinator_lead_profiles.assigned_doctor_id (Messenger/WhatsApp leads).
 * @param {string[]} doctorKeysRaw
 * @param {string} clinicId
 */
async function collectPatientIdsFromLeadProfileDoctorAssignments(doctorKeysRaw, clinicId) {
  const out = new Set();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(cid) || !isSupabaseEnabled()) return out;

  const keys = [...new Set((doctorKeysRaw || []).map((k) => String(k || "").trim()).filter(Boolean))];
  const uuidKeys = keys.filter((k) => DOCTOR_FK_UUID_RE.test(k));
  if (!uuidKeys.length) return out;

  try {
    const { data, error } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("patient_id")
      .eq("clinic_id", cid)
      .in("assigned_doctor_id", uuidKeys)
      .limit(800);
    if (error) {
      if (!isMissingColumnError(error)) {
        console.warn("[doctorLeadThreadSync] profile assignments:", error.message);
      }
      return out;
    }
    for (const row of data || []) {
      const pid = String(row?.patient_id || "").trim();
      if (pid) out.add(pid);
    }
  } catch (e) {
    console.warn("[doctorLeadThreadSync] profile assignments:", e?.message || e);
  }
  return out;
}

module.exports = {
  syncPatientLeadThreadAssignedDoctor,
  syncLeadProfileAssignedDoctor,
  backfillLeadProfileAssignedDoctorFromThreads,
  collectPatientIdsFromLeadProfileDoctorAssignments,
};
