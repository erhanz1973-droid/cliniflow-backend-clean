/**
 * Audit log when patient_chat_threads.assigned_doctor_id changes.
 * Used to distinguish "doctor lost visibility" vs "assignment transferred to another doctor".
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ASSIGNMENT_REASON = {
  ADMIN_ASSIGN_DOCTOR: "admin_assign_doctor",
  ADMIN_PATIENTS_ASSIGN_DOCTOR: "admin_patients_assign_doctor",
  ADMIN_AUTO_ASSIGN_LEADS: "admin_auto_assign_leads",
  LEAD_THREAD_SYNC: "lead_thread_sync",
  RESPONDING_DOCTOR_CLAIM: "responding_doctor_claim",
  CLINIC_DUTY_DOCTOR: "clinic_duty_doctor",
  CLINIC_DUTY_DOCTOR_REPLACED: "clinic_duty_doctor_replaced",
  INBOUND_AUTO_ASSIGN: "inbound_auto_assign",
  INBOUND_LEAD_ROUTING: "inbound_lead_routing",
  INBOUND_WHATSAPP_ROUTING: "inbound_whatsapp_routing",
  UNKNOWN: "unknown",
};

/**
 * @param {unknown} value
 */
function normalizeDoctorUuid(value) {
  const raw = value != null ? String(value).trim() : "";
  return UUID_RE.test(raw) ? raw : null;
}

/**
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
function assignmentChanged(a, b) {
  const na = normalizeDoctorUuid(a);
  const nb = normalizeDoctorUuid(b);
  if (!na && !nb) return false;
  return na !== nb;
}

/**
 * @param {{
 *   threadId: string,
 *   patientId: string,
 *   clinicId?: string|null,
 *   oldAssignedDoctorId?: string|null,
 *   newAssignedDoctorId?: string|null,
 *   reason: string,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function recordThreadAssignmentChange(params) {
  const threadId = String(params.threadId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const clinicId = normalizeDoctorUuid(params.clinicId) || String(params.clinicId || "").trim() || null;
  const oldId = normalizeDoctorUuid(params.oldAssignedDoctorId);
  const newId = normalizeDoctorUuid(params.newAssignedDoctorId);
  const reason = String(params.reason || ASSIGNMENT_REASON.UNKNOWN).trim().slice(0, 160);

  if (!UUID_RE.test(threadId) || !UUID_RE.test(patientId)) {
    return { ok: false, skipped: true, reason: "invalid_ids" };
  }
  if (!assignmentChanged(oldId, newId)) {
    return { ok: true, skipped: true, reason: "unchanged" };
  }

  const createdAt = new Date().toISOString();
  const payload = {
    thread_id: threadId,
    patient_id: patientId,
    clinic_id: UUID_RE.test(String(clinicId || "")) ? clinicId : null,
    old_assigned_doctor_id: oldId,
    new_assigned_doctor_id: newId,
    reason,
    metadata: params.metadata && typeof params.metadata === "object" ? params.metadata : {},
    created_at: createdAt,
  };

  console.log("[THREAD_ASSIGNMENT_AUDIT]", {
    thread_id: threadId,
    patient_id: patientId,
    clinic_id: payload.clinic_id,
    old_assigned_doctor_id: oldId,
    new_assigned_doctor_id: newId,
    reason,
    timestamp: createdAt,
  });

  if (!isSupabaseEnabled()) {
    return { ok: true, persisted: false, reason: "supabase_disabled" };
  }

  try {
    const { data, error } = await supabase
      .from("patient_chat_thread_assignment_events")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      const code = String(error.code || "");
      const msg = String(error.message || "").toLowerCase();
      if (code === "42P01" || msg.includes("patient_chat_thread_assignment_events")) {
        console.warn("[THREAD_ASSIGNMENT_AUDIT] table missing — run migration 20260529120000");
        return { ok: true, persisted: false, reason: "table_missing" };
      }
      console.warn("[THREAD_ASSIGNMENT_AUDIT] insert failed:", error.message || error);
      return { ok: false, error };
    }
    return { ok: true, persisted: true, eventId: data?.id || null };
  } catch (e) {
    console.warn("[THREAD_ASSIGNMENT_AUDIT] insert exception:", e?.message || e);
    return { ok: false, error: e };
  }
}

/**
 * @param {string} threadId
 */
async function loadThreadAssignmentSnapshot(threadId) {
  const tid = String(threadId || "").trim();
  if (!UUID_RE.test(tid) || !isSupabaseEnabled()) return null;
  try {
    const { data, error } = await supabase
      .from("patient_chat_threads")
      .select("id, patient_id, clinic_id, assigned_doctor_id")
      .eq("id", tid)
      .maybeSingle();
    if (error || !data?.id) return null;
    return {
      threadId: String(data.id),
      patientId: String(data.patient_id || ""),
      clinicId: data.clinic_id ? String(data.clinic_id) : null,
      assignedDoctorId: normalizeDoctorUuid(data.assigned_doctor_id),
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function loadThreadAssignmentSnapshotByPatientClinic(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) return null;
  try {
    const { data, error } = await supabase
      .from("patient_chat_threads")
      .select("id, patient_id, clinic_id, assigned_doctor_id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.id) return null;
    return {
      threadId: String(data.id),
      patientId: String(data.patient_id || pid),
      clinicId: String(data.clinic_id || cid),
      assignedDoctorId: normalizeDoctorUuid(data.assigned_doctor_id),
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ days?: number, clinicId?: string|null, patientId?: string|null, threadId?: string|null, doctorId?: string|null, limit?: number }} [opts]
 */
async function fetchThreadAssignmentChanges(opts = {}) {
  const days = Math.min(Math.max(Number(opts.days) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 5000);

  if (!isSupabaseEnabled()) {
    return { ok: false, error: "supabase_disabled", events: [], since, days };
  }

  let q = supabase
    .from("patient_chat_thread_assignment_events")
    .select(
      "id, thread_id, patient_id, clinic_id, old_assigned_doctor_id, new_assigned_doctor_id, reason, metadata, created_at",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  const clinicId = String(opts.clinicId || "").trim();
  const patientId = String(opts.patientId || "").trim();
  const threadId = String(opts.threadId || "").trim();
  const doctorId = normalizeDoctorUuid(opts.doctorId);

  if (UUID_RE.test(clinicId)) q = q.eq("clinic_id", clinicId);
  if (UUID_RE.test(patientId)) q = q.eq("patient_id", patientId);
  if (UUID_RE.test(threadId)) q = q.eq("thread_id", threadId);
  if (doctorId) {
    q = q.or(`old_assigned_doctor_id.eq.${doctorId},new_assigned_doctor_id.eq.${doctorId}`);
  }

  const { data, error } = await q;
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (String(error.code || "") === "42P01" || msg.includes("patient_chat_thread_assignment_events")) {
      return { ok: false, error: "table_missing", events: [], since, days };
    }
    return { ok: false, error: error.message || error, events: [], since, days };
  }

  return {
    ok: true,
    since,
    days,
    count: Array.isArray(data) ? data.length : 0,
    events: data || [],
  };
}

module.exports = {
  ASSIGNMENT_REASON,
  recordThreadAssignmentChange,
  loadThreadAssignmentSnapshot,
  loadThreadAssignmentSnapshotByPatientClinic,
  fetchThreadAssignmentChanges,
  assignmentChanged,
};
