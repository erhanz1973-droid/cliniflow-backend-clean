/**
 * Assign patient_chat_threads to the doctor who actually responds when no admin assign yet.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (msg.includes("column") && msg.includes("does not exist"));
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^patients\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

function doctorStatusEligible(statusRaw) {
  const st = String(statusRaw || "").trim().toUpperCase();
  return st === "APPROVED" || st === "ACTIVE";
}

async function resolveEligibleDoctorId(doctorUuid, clinicId) {
  const doc = String(doctorUuid || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(doc) || !UUID_RE.test(cid)) return null;
  let sel = "id, clinic_id, status, is_active";
  let { data, error } = await supabase.from("doctors").select(sel).eq("id", doc).maybeSingle();
  if (error && String(error.message || "").toLowerCase().includes("is_active")) {
    ({ data, error } = await supabase.from("doctors").select("id, clinic_id, status").eq("id", doc).maybeSingle());
  }
  if (error || !data?.id) return null;
  if (String(data.clinic_id || "").trim() !== cid) return null;
  if (Object.prototype.hasOwnProperty.call(data, "is_active") && data.is_active === false) return null;
  return doctorStatusEligible(data.status) ? String(data.id) : null;
}

async function patchPatientAssignmentPointers(patientId, doctorId) {
  const at = new Date().toISOString();
  let patch = {
    assigned_doctor_id: doctorId,
    last_assigned_doctor_id: doctorId,
    primary_doctor_id: doctorId,
    updated_at: at,
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabase.from("patients").update(patch).eq("id", patientId);
    if (!error) return;
    if (!isMissingColumnError(error)) break;
    const col = getMissingColumnName(error);
    if (!col || !(col in patch)) break;
    delete patch[col];
  }
}

async function tryClaimThread(threadId, doctorId) {
  const assignedAtIso = new Date().toISOString();
  try {
    const { data, error } = await supabase.rpc("cliniflow_try_claim_thread_assignment", {
      p_thread_id: threadId,
      p_doctor_id: doctorId,
      p_assigned_at: assignedAtIso,
      p_updated_at: assignedAtIso,
    });
    if (!error && data === true) return true;
    if (!error && data === false) return false;
  } catch (_) {
    /* RPC may be missing on older DBs */
  }
  const { data: rows, error: upErr } = await supabase
    .from("patient_chat_threads")
    .update({
      status: "assigned",
      assigned_doctor_id: doctorId,
      assigned_at: assignedAtIso,
      updated_at: assignedAtIso,
    })
    .eq("id", threadId)
    .is("assigned_doctor_id", null)
    .select("id");
  if (upErr) return false;
  return Array.isArray(rows) && rows.length > 0;
}

async function patchCoordinatorProfileDoctor(patientId, clinicId, doctorId) {
  try {
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({ assigned_doctor_id: doctorId, updated_at: new Date().toISOString() })
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .is("assigned_doctor_id", null);
  } catch (_) {
    /* non-fatal */
  }
}

/**
 * @param {{ patientId: string, clinicId: string, doctorId: string }} params
 * @returns {Promise<{ ok: boolean, reason?: string, threadId?: string|null }>}
 */
async function maybeAutoAssignRespondingDoctor(params) {
  if (!isSupabaseEnabled()) return { ok: false, reason: "supabase_disabled" };
  const patientId = String(params?.patientId || "").trim();
  let clinicId = String(params?.clinicId || "").trim();
  const doctorRaw = String(params?.doctorId || "").trim();
  if (!UUID_RE.test(patientId) || !UUID_RE.test(doctorRaw)) {
    return { ok: false, reason: "invalid_ids" };
  }

  if (!UUID_RE.test(clinicId)) {
    const { data: prow } = await supabase.from("patients").select("clinic_id").eq("id", patientId).maybeSingle();
    clinicId = prow?.clinic_id ? String(prow.clinic_id).trim() : "";
  }
  if (!UUID_RE.test(clinicId)) return { ok: false, reason: "no_clinic" };

  const doctorId = await resolveEligibleDoctorId(doctorRaw, clinicId);
  if (!doctorId) return { ok: false, reason: "doctor_not_eligible" };

  const { data: thread, error: thErr } = await supabase
    .from("patient_chat_threads")
    .select("id, assigned_doctor_id, patient_id, clinic_id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (thErr || !thread?.id) return { ok: false, reason: "no_thread" };
  if (String(thread.patient_id) !== patientId) return { ok: false, reason: "thread_patient_mismatch" };
  if (thread.assigned_doctor_id) {
    const existing = String(thread.assigned_doctor_id).trim();
    if (existing === doctorId) return { ok: true, reason: "already_assigned", threadId: thread.id };
    return { ok: false, reason: "already_assigned_other" };
  }

  const claimed = await tryClaimThread(thread.id, doctorId);
  if (!claimed) return { ok: false, reason: "claim_failed", threadId: thread.id };

  await patchPatientAssignmentPointers(patientId, doctorId);
  await patchCoordinatorProfileDoctor(patientId, clinicId, doctorId);

  console.log("[autoAssignRespondingDoctor] assigned", {
    patient_id: patientId.slice(0, 8),
    clinic_id: clinicId.slice(0, 8),
    doctor_id: doctorId.slice(0, 8),
    thread_id: String(thread.id).slice(0, 8),
    via: "responding_doctor",
  });

  return { ok: true, threadId: thread.id };
}

/**
 * After PATCH /api/patient/clinic — bind patient to doctor who already messaged in offer threads.
 */
async function maybeAutoAssignFromRecentOfferMessages(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return { ok: false, reason: "invalid_ids" };

  try {
    const { data: prof } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("assigned_doctor_id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .maybeSingle();
    const fromProfile =
      prof?.assigned_doctor_id != null ? String(prof.assigned_doctor_id).trim() : "";
    if (fromProfile) {
      const r = await maybeAutoAssignRespondingDoctor({
        patientId: pid,
        clinicId: cid,
        doctorId: fromProfile,
      });
      if (r.ok) return r;
    }
  } catch (_) {
    /* non-fatal */
  }

  const { data: reqs } = await supabase
    .from("treatment_requests")
    .select("id")
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .limit(50);
  const reqIds = (reqs || []).map((r) => String(r.id || "").trim()).filter((id) => UUID_RE.test(id));
  if (!reqIds.length) return { ok: false, reason: "no_requests" };

  const { data: offers } = await supabase
    .from("treatment_offers")
    .select("id")
    .in("request_id", reqIds)
    .limit(80);
  const offerIds = (offers || []).map((o) => String(o.id || "").trim()).filter((id) => UUID_RE.test(id));
  if (!offerIds.length) return { ok: false, reason: "no_offers" };

  const { data: msgs } = await supabase
    .from("offer_messages")
    .select("sender_id, sender_role, created_at")
    .in("offer_id", offerIds)
    .eq("sender_role", "doctor")
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = msgs?.[0];
  const doctorId = latest?.sender_id ? String(latest.sender_id).trim() : "";
  if (!doctorId) return { ok: false, reason: "no_doctor_message" };

  return maybeAutoAssignRespondingDoctor({ patientId: pid, clinicId: cid, doctorId });
}

module.exports = {
  maybeAutoAssignRespondingDoctor,
  maybeAutoAssignFromRecentOfferMessages,
};
