/**
 * One canonical patient_chat_threads row per operational conversation.
 * Resolves split-brain when patients.clinic_id, lead profile clinic, and assigned thread diverge.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const THREAD_SELECT =
  "id, patient_id, clinic_id, assigned_doctor_id, status, is_lead, lifecycle_status, archived_at, assigned_at, created_at, updated_at";

/**
 * @param {Record<string, unknown>} payload
 */
function logThreadCanonicalResolution(payload) {
  try {
    console.log(
      "[THREAD_CANONICAL_RESOLUTION]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (e) {
    console.warn("[THREAD_CANONICAL_RESOLUTION] log_failed:", e?.message || e);
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} a
 * @param {Record<string, unknown>|null|undefined} b
 */
function pickBetterThreadRow(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const aAssigned = UUID_RE.test(String(a.assigned_doctor_id || ""));
  const bAssigned = UUID_RE.test(String(b.assigned_doctor_id || ""));
  if (aAssigned && !bAssigned) return a;
  if (!aAssigned && bAssigned) return b;
  const aLead = a.is_lead === true;
  const bLead = b.is_lead === true;
  if (aLead && !bLead) return b;
  if (!aLead && bLead) return a;
  const ts = (row) => {
    const u = Date.parse(String(row?.updated_at || row?.assigned_at || row?.created_at || ""));
    return Number.isFinite(u) ? u : 0;
  };
  return ts(b) >= ts(a) ? b : a;
}

/**
 * @param {string} assignedRaw
 * @param {string[]} matchKeys
 */
function assignedDoctorMatchesKeys(assignedRaw, matchKeys) {
  const assigned = String(assignedRaw || "").trim().toLowerCase();
  if (!assigned || !matchKeys?.length) return false;
  const set = new Set(matchKeys.map((k) => String(k || "").trim().toLowerCase()).filter(Boolean));
  return set.has(assigned);
}

/**
 * @param {string} patientId
 */
async function fetchAllPatientChatThreads(patientId) {
  const pid = String(patientId || "").trim();
  if (!UUID_RE.test(pid) || !isSupabaseEnabled()) return [];
  const { data, error } = await supabase
    .from("patient_chat_threads")
    .select(THREAD_SELECT)
    .eq("patient_id", pid)
    .order("updated_at", { ascending: false })
    .limit(24);
  if (error) {
    console.warn("[canonicalChatThread] fetchAll:", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveOperationalClinicIdForPatient(patientId, clinicIdHint) {
  const hint = String(clinicIdHint || "").trim();
  if (UUID_RE.test(hint)) return hint;
  const pid = String(patientId || "").trim();
  if (!UUID_RE.test(pid) || !isSupabaseEnabled()) return null;

  try {
    const { data: profiles } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("clinic_id, updated_at")
      .eq("patient_id", pid)
      .order("updated_at", { ascending: false })
      .limit(6);
    for (const row of profiles || []) {
      const cid = String(row?.clinic_id || "").trim();
      if (UUID_RE.test(cid)) return cid;
    }
  } catch (_) {
    /* optional */
  }

  try {
    const { data: identities } = await supabase
      .from("channel_identities")
      .select("clinic_id, updated_at")
      .eq("patient_id", pid)
      .order("updated_at", { ascending: false })
      .limit(4);
    for (const row of identities || []) {
      const cid = String(row?.clinic_id || "").trim();
      if (UUID_RE.test(cid)) return cid;
    }
  } catch (_) {
    /* optional */
  }

  return null;
}

/**
 * @param {{
 *   patientId: string,
 *   clinicIdHint?: string|null,
 *   assignedDoctorId?: string|null,
 *   doctorMatchKeys?: string[],
 *   source: string,
 *   allowPatientClinicFallback?: boolean,
 * }} opts
 */
async function resolveCanonicalChatThread(opts) {
  const pid = String(opts.patientId || "").trim();
  const source = String(opts.source || "unknown").trim();
  if (!UUID_RE.test(pid)) {
    return { ok: false, reason: "invalid_patient_id", threadId: null, thread: null, clinicId: null };
  }

  const allThreads = await fetchAllPatientChatThreads(pid);
  const operationalClinic =
    (await resolveOperationalClinicIdForPatient(pid, opts.clinicIdHint)) ||
    (UUID_RE.test(String(opts.clinicIdHint || "")) ? String(opts.clinicIdHint).trim() : null);

  const doctorKeys = [
    ...new Set(
      [
        ...(Array.isArray(opts.doctorMatchKeys) ? opts.doctorMatchKeys : []),
        opts.assignedDoctorId ? String(opts.assignedDoctorId).trim() : "",
      ].filter(Boolean),
    ),
  ];

  let chosen = null;
  let reason = "none";

  if (operationalClinic) {
    const atClinic = allThreads.filter((t) => String(t.clinic_id || "").trim() === operationalClinic);
    if (atClinic.length === 1) {
      chosen = atClinic[0];
      reason = "operational_clinic_unique";
    } else if (atClinic.length > 1) {
      chosen = atClinic.reduce(pickBetterThreadRow, null);
      reason = "operational_clinic_duplicate_pick_best";
    }
  }

  if (!chosen && doctorKeys.length) {
    const assigned = allThreads.filter((t) =>
      assignedDoctorMatchesKeys(t.assigned_doctor_id, doctorKeys),
    );
    if (assigned.length) {
      const atOp = operationalClinic
        ? assigned.filter((t) => String(t.clinic_id || "").trim() === operationalClinic)
        : [];
      chosen = (atOp.length ? atOp : assigned).reduce(pickBetterThreadRow, null);
      reason = atOp.length ? "assigned_doctor_at_operational_clinic" : "assigned_doctor_any_clinic";
    }
  }

  if (!chosen && operationalClinic) {
    try {
      const { data: inserted } = await supabase
        .from("patient_chat_threads")
        .insert({
          patient_id: pid,
          clinic_id: operationalClinic,
          status: "unassigned",
          is_lead: true,
          updated_at: new Date().toISOString(),
        })
        .select(THREAD_SELECT)
        .maybeSingle();
      if (inserted?.id) {
        chosen = inserted;
        reason = "created_operational_clinic_thread";
      }
    } catch {
      /* race / unique — re-fetch below */
    }
    if (!chosen) {
      const retry = allThreads.filter((t) => String(t.clinic_id || "").trim() === operationalClinic);
      if (retry.length) {
        chosen = retry.reduce(pickBetterThreadRow, null);
        reason = "operational_clinic_after_insert_race";
      }
    }
  }

  if (!chosen && allThreads.length) {
    chosen = allThreads.reduce(pickBetterThreadRow, null);
    reason = "most_recent_thread_fallback";
  }

  if (!chosen && opts.allowPatientClinicFallback !== false && isSupabaseEnabled()) {
    try {
      const { data: prow } = await supabase
        .from("patients")
        .select("clinic_id")
        .eq("id", pid)
        .maybeSingle();
      const pcid = String(prow?.clinic_id || "").trim();
      if (UUID_RE.test(pcid)) {
        const atPatientClinic = allThreads.filter((t) => String(t.clinic_id || "").trim() === pcid);
        if (atPatientClinic.length) {
          chosen = atPatientClinic.reduce(pickBetterThreadRow, null);
          reason = "patients_clinic_id_fallback";
        }
      }
    } catch (_) {
      /* optional */
    }
  }

  const threadId = chosen?.id ? String(chosen.id).trim() : null;
  const clinicId = chosen?.clinic_id ? String(chosen.clinic_id).trim() : operationalClinic;

  logThreadCanonicalResolution({
    patient_id: pid.slice(0, 8),
    resolved_thread_id: threadId ? threadId.slice(0, 8) : null,
    resolved_clinic_id: clinicId ? clinicId.slice(0, 8) : null,
    source,
    reason,
    operational_clinic_hint: operationalClinic ? operationalClinic.slice(0, 8) : null,
    thread_count: allThreads.length,
    alternate_thread_ids: allThreads
      .map((t) => String(t.id || "").slice(0, 8))
      .filter((id) => id && id !== (threadId || "").slice(0, 8)),
    assigned_doctor_id: chosen?.assigned_doctor_id
      ? String(chosen.assigned_doctor_id).slice(0, 8)
      : null,
  });

  if (allThreads.length > 1 && threadId) {
    const dupClinics = new Set(allThreads.map((t) => String(t.clinic_id || "").trim()).filter(Boolean));
    if (dupClinics.size > 1) {
      console.warn("[canonicalChatThread] multiple_clinic_threads", {
        patient_id: pid.slice(0, 8),
        clinic_count: dupClinics.size,
        resolved: threadId.slice(0, 8),
        source,
      });
    }
  }

  return {
    ok: !!threadId,
    threadId,
    thread: chosen,
    clinicId: clinicId || null,
    reason,
    allThreads,
  };
}

module.exports = {
  logThreadCanonicalResolution,
  fetchAllPatientChatThreads,
  resolveCanonicalChatThread,
  pickBetterThreadRow,
};
