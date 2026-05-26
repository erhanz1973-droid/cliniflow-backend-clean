/**
 * Lead thread ↔ assigned doctor — keeps doctor app inbox aligned with coordinator profile.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

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
      if (!insErr && insRow?.id) return { ok: true, threadId: insRow.id, mode: "inserted" };
      if (insErr && isPatientChatThreadsTableUnavailable(insErr)) {
        return { ok: false, skipped: true, reason: "no_thread_table" };
      }
      return { ok: false, skipped: true, reason: "thread_upsert_unavailable", detail: insErr?.message };
    }

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
  collectPatientIdsFromLeadProfileDoctorAssignments,
};
