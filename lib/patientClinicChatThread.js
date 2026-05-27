/**
 * One persistent conversation per (patient_id, clinic_id).
 * Canonical table: patient_chat_threads (view: chat_threads).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || error?.details || "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("could not find")
  );
}

function isPatientChatThreadsTableUnavailable(error) {
  if (!error) return false;
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  return msg.includes("patient_chat_threads") && msg.includes("does not exist");
}

/**
 * @param {string} patientId patients.id UUID
 * @param {string} clinicId clinics.id UUID
 * @param {{ isLead?: boolean }} [opts]
 * @returns {Promise<{ threadId: string|null, created: boolean, error?: unknown }>}
 */
async function ensurePatientClinicThread(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) {
    return { threadId: null, created: false };
  }

  const isLead = opts.isLead !== false;

  try {
    const { data: existing, error: qErr } = await supabase
      .from("patient_chat_threads")
      .select("id, is_lead, assigned_doctor_id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .maybeSingle();

    if (qErr && isPatientChatThreadsTableUnavailable(qErr)) {
      return { threadId: null, created: false, unavailable: true };
    }
    if (!qErr && existing?.id) {
      return { threadId: String(existing.id), created: false };
    }

    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await supabase
      .from("patient_chat_threads")
      .insert({
        patient_id: pid,
        clinic_id: cid,
        status: "unassigned",
        assigned_doctor_id: null,
        is_lead: isLead,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      if (String(insErr.code || "") === "23505") {
        const { data: again } = await supabase
          .from("patient_chat_threads")
          .select("id")
          .eq("patient_id", pid)
          .eq("clinic_id", cid)
          .maybeSingle();
        if (again?.id) return { threadId: String(again.id), created: false };
      }
      if (isPatientChatThreadsTableUnavailable(insErr)) {
        return { threadId: null, created: false, unavailable: true };
      }
      return { threadId: null, created: false, error: insErr };
    }

    console.log("[patientClinicChatThread] created", {
      thread_id: inserted?.id ? String(inserted.id).slice(0, 8) : null,
      patient_id: pid.slice(0, 8),
      clinic_id: cid.slice(0, 8),
    });
    return { threadId: inserted?.id ? String(inserted.id) : null, created: true };
  } catch (e) {
    return { threadId: null, created: false, error: e };
  }
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function getThreadIdForPatientClinic(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase
      .from("patient_chat_threads")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} requestId
 * @param {string} threadId
 */
async function linkTreatmentRequestToThread(requestId, threadId) {
  const rid = String(requestId || "").trim();
  const tid = String(threadId || "").trim();
  if (!UUID_RE.test(rid) || !UUID_RE.test(tid) || !isSupabaseEnabled()) {
    return { ok: false };
  }
  try {
    const { error } = await supabase
      .from("treatment_requests")
      .update({ thread_id: tid, updated_at: new Date().toISOString() })
      .eq("id", rid);
    if (error && isMissingColumnError(error)) return { ok: false, skipped: true };
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/**
 * @param {string} threadId
 * @param {string} [atIso]
 */
async function touchThreadLastMessageAt(threadId, atIso) {
  const tid = String(threadId || "").trim();
  if (!UUID_RE.test(tid) || !isSupabaseEnabled()) return;
  const ts = atIso || new Date().toISOString();
  try {
    const { error } = await supabase
      .from("patient_chat_threads")
      .update({ last_message_at: ts, updated_at: ts })
      .eq("id", tid);
    if (error && !isMissingColumnError(error)) {
      console.warn("[patientClinicChatThread] touch last_message_at:", error.message);
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Optional columns on offer_messages (migration 20260530140000).
 * @param {Record<string, unknown>} row
 */
function offerMessageThreadFields(row) {
  const out = {};
  const threadId = row?.threadId || row?.thread_id;
  const treatmentRequestId = row?.treatmentRequestId || row?.treatment_request_id;
  if (threadId && UUID_RE.test(String(threadId))) out.thread_id = String(threadId);
  if (treatmentRequestId && UUID_RE.test(String(treatmentRequestId))) {
    out.treatment_request_id = String(treatmentRequestId);
  }
  return out;
}

module.exports = {
  ensurePatientClinicThread,
  getThreadIdForPatientClinic,
  linkTreatmentRequestToThread,
  touchThreadLastMessageAt,
  offerMessageThreadFields,
  isMissingColumnError,
  isPatientChatThreadsTableUnavailable,
};
