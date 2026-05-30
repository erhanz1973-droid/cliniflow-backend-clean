/**
 * Canonical conversation identity — one patient + one clinic = one active thread.
 * Phases 1–3, 5: thread merge, getCanonicalThread resolver, clinic repair, coordinator profiles.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const THREAD_SELECT =
  "id, patient_id, clinic_id, assigned_doctor_id, status, is_lead, lifecycle_status, archived_at, assigned_at, created_at, updated_at";

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function isActiveThreadRow(row) {
  if (!row?.id) return false;
  const life = String(row.lifecycle_status || "").trim().toLowerCase();
  if (life === "archived") return false;
  if (row.archived_at != null && String(row.archived_at).trim() !== "") return false;
  const st = String(row.status || "").trim().toLowerCase();
  if (st === "archived" || st === "closed") return false;
  return true;
}

/**
 * @param {Record<string, unknown>} payload
 */
function logThreadCanonicalResolution(payload) {
  try {
    console.log(
      "[THREAD_CANONICAL_RESOLUTION]",
      JSON.stringify({ at: new Date().toISOString(), ...payload }),
    );
  } catch (e) {
    console.warn("[THREAD_CANONICAL_RESOLUTION] log_failed:", e?.message || e);
  }
}

/**
 * @param {Record<string, unknown>} payload
 */
function logClinicMismatchRepaired(payload) {
  try {
    console.log(
      "[CLINIC_MISMATCH_REPAIRED]",
      JSON.stringify({ at: new Date().toISOString(), ...payload }),
    );
  } catch (e) {
    console.warn("[CLINIC_MISMATCH_REPAIRED] log_failed:", e?.message || e);
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
    .limit(32);
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
async function fetchThreadsAtClinic(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) return [];
  const { data, error } = await supabase
    .from("patient_chat_threads")
    .select(THREAD_SELECT)
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error) {
    console.warn("[canonicalChatThread] fetchAtClinic:", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Phase 1 — merge duplicate active threads at (patient_id, clinic_id).
 * @param {string} patientId
 * @param {string} clinicId
 */
async function mergeDuplicateThreadsAtClinic(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) {
    return { merged: false, canonicalThreadId: null, archivedIds: [] };
  }

  const rows = await fetchThreadsAtClinic(pid, cid);
  const active = rows.filter(isActiveThreadRow);
  if (active.length <= 1) {
    return {
      merged: false,
      canonicalThreadId: active[0]?.id ? String(active[0].id) : null,
      archivedIds: [],
    };
  }

  const winner = active.reduce(pickBetterThreadRow, null);
  const winnerId = String(winner?.id || "").trim();
  const archivedIds = [];
  const nowIso = new Date().toISOString();

  for (const row of active) {
    const tid = String(row.id || "").trim();
    if (!tid || tid === winnerId) continue;
    try {
      await supabase
        .from("patient_chat_threads")
        .update({
          lifecycle_status: "archived",
          archived_at: nowIso,
          status: "archived",
          updated_at: nowIso,
        })
        .eq("id", tid);
      archivedIds.push(tid);
    } catch (e) {
      console.warn("[canonicalChatThread] archive_duplicate:", tid.slice(0, 8), e?.message || e);
    }
  }

  if (archivedIds.length) {
    console.log("[canonicalChatThread] merged_duplicates", {
      patient_id: pid.slice(0, 8),
      clinic_id: cid.slice(0, 8),
      canonical: winnerId.slice(0, 8),
      archived: archivedIds.map((id) => id.slice(0, 8)),
    });
  }

  return { merged: archivedIds.length > 0, canonicalThreadId: winnerId || null, archivedIds };
}

/**
 * Phase 1 — archive stale active threads at clinics other than canonical operational clinic.
 * @param {string} patientId
 * @param {string} canonicalClinicId
 */
async function archiveCrossClinicStaleThreads(patientId, canonicalClinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(canonicalClinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) {
    return { archivedIds: [] };
  }

  const all = await fetchAllPatientChatThreads(pid);
  const canonicalRow = all.find(
    (t) => String(t.clinic_id || "").trim() === cid && isActiveThreadRow(t),
  );
  const archivedIds = [];
  const nowIso = new Date().toISOString();

  for (const row of all) {
    if (!isActiveThreadRow(row)) continue;
    const rowClinic = String(row.clinic_id || "").trim();
    if (rowClinic === cid) continue;

    const rowAssigned = UUID_RE.test(String(row.assigned_doctor_id || ""));
    const canonicalAssigned = UUID_RE.test(String(canonicalRow?.assigned_doctor_id || ""));
    if (rowAssigned && !canonicalAssigned) continue;

    try {
      await supabase
        .from("patient_chat_threads")
        .update({
          lifecycle_status: "archived",
          archived_at: nowIso,
          status: "archived",
          updated_at: nowIso,
        })
        .eq("id", row.id);
      archivedIds.push(String(row.id));
    } catch (e) {
      console.warn("[canonicalChatThread] archive_cross_clinic:", e?.message || e);
    }
  }

  if (archivedIds.length) {
    console.log("[canonicalChatThread] archived_cross_clinic_stale", {
      patient_id: pid.slice(0, 8),
      canonical_clinic: cid.slice(0, 8),
      archived: archivedIds.map((id) => id.slice(0, 8)),
    });
  }

  return { archivedIds };
}

/**
 * @param {string} patientId
 * @param {string} clinicIdHint
 */
async function resolveOperationalClinicIdForPatient(patientId, clinicIdHint) {
  const hint = String(clinicIdHint || "").trim();
  if (UUID_RE.test(hint)) return hint;
  const pid = String(patientId || "").trim();
  if (!UUID_RE.test(pid) || !isSupabaseEnabled()) return null;

  try {
    const { data: assigned } = await supabase
      .from("patient_chat_threads")
      .select("clinic_id, updated_at")
      .eq("patient_id", pid)
      .not("assigned_doctor_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(4);
    for (const row of assigned || []) {
      const cid = String(row?.clinic_id || "").trim();
      if (UUID_RE.test(cid)) return cid;
    }
  } catch (_) {
    /* optional */
  }

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
 * Phase 3 — align patients.clinic_id with canonical operational clinic.
 * @param {string} patientId
 * @param {string} canonicalClinicId
 * @param {string} [source]
 */
async function repairPatientClinicConsistency(patientId, canonicalClinicId, source) {
  const pid = String(patientId || "").trim();
  const cid = String(canonicalClinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) {
    return { repaired: false };
  }

  try {
    const { data: prow } = await supabase
      .from("patients")
      .select("clinic_id, is_lead, status")
      .eq("id", pid)
      .maybeSingle();
    if (!prow) return { repaired: false };

    const current = String(prow.clinic_id || "").trim();
    if (current === cid) return { repaired: false, clinicId: cid };

    const { data: threadAtCanonical } = await supabase
      .from("patient_chat_threads")
      .select("id, assigned_doctor_id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasCanonicalThread = !!threadAtCanonical?.id;
    const hasProfile = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .limit(1)
      .maybeSingle();

    if (!hasCanonicalThread && !hasProfile?.data?.id && prow.is_lead !== true) {
      return { repaired: false, skipped: "no_canonical_workspace" };
    }

    const { error } = await supabase
      .from("patients")
      .update({ clinic_id: cid, updated_at: new Date().toISOString() })
      .eq("id", pid);
    if (error) {
      console.warn("[canonicalChatThread] clinic_repair_failed:", error.message);
      return { repaired: false, error: error.message };
    }

    logClinicMismatchRepaired({
      patient_id: pid.slice(0, 8),
      previous_clinic_id: current ? current.slice(0, 8) : null,
      canonical_clinic_id: cid.slice(0, 8),
      source: source || "repair",
      is_lead: prow.is_lead === true,
    });

    return { repaired: true, previousClinicId: current || null, clinicId: cid };
  } catch (e) {
    console.warn("[canonicalChatThread] repairPatientClinic:", e?.message || e);
    return { repaired: false };
  }
}

/**
 * Phase 5 — ensure ai_coordinator_lead_profiles exists for patient+clinic.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ source?: string }} [opts]
 */
async function ensureCoordinatorProfile(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) {
    return { ok: false, profileId: null, created: false };
  }

  try {
    const { data: existing } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .maybeSingle();
    if (existing?.id) {
      return { ok: true, profileId: String(existing.id), created: false };
    }

    const { ensureLeadWorkspaceForClinic } = require("./patientLeadLifecycle");
    const ws = await ensureLeadWorkspaceForClinic(pid, cid, {
      source: opts.source || "coordinator_profile_repair",
    });
    const { data: after } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .maybeSingle();

    return {
      ok: !!after?.id,
      profileId: after?.id ? String(after.id) : null,
      created: !existing?.id && !!after?.id,
      threadId: ws?.threadId || null,
    };
  } catch (e) {
    console.warn("[canonicalChatThread] ensureCoordinatorProfile:", e?.message || e);
    return { ok: false, profileId: null, created: false };
  }
}

/**
 * Phase 2 — primary API: one patient + one clinic → one canonical thread.
 * @param {string} patientId
 * @param {string|null|undefined} clinicId
 * @param {{
 *   source?: string,
 *   assignedDoctorId?: string|null,
 *   doctorMatchKeys?: string[],
 *   repairClinic?: boolean,
 *   ensureProfile?: boolean,
 *   archiveCrossClinicStale?: boolean,
 *   mergeDuplicates?: boolean,
 * }} [opts]
 */
async function getCanonicalThread(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  const source = String(opts.source || "getCanonicalThread").trim();
  if (!UUID_RE.test(pid)) {
    return {
      ok: false,
      threadId: null,
      thread: null,
      clinicId: null,
      profileId: null,
      reason: "invalid_patient_id",
    };
  }

  let operationalClinic =
    (await resolveOperationalClinicIdForPatient(pid, clinicId)) ||
    (UUID_RE.test(String(clinicId || "")) ? String(clinicId).trim() : null);

  if (opts.mergeDuplicates !== false && operationalClinic) {
    await mergeDuplicateThreadsAtClinic(pid, operationalClinic);
  }

  const resolved = await resolveCanonicalChatThread({
    patientId: pid,
    clinicIdHint: operationalClinic,
    assignedDoctorId: opts.assignedDoctorId || null,
    doctorMatchKeys: opts.doctorMatchKeys || [],
    source,
    allowPatientClinicFallback: false,
  });

  if (resolved.clinicId && UUID_RE.test(resolved.clinicId)) {
    operationalClinic = resolved.clinicId;
  }

  if (opts.archiveCrossClinicStale && operationalClinic) {
    await archiveCrossClinicStaleThreads(pid, operationalClinic);
  }

  let clinicRepair = { repaired: false };
  if (opts.repairClinic !== false && operationalClinic) {
    clinicRepair = await repairPatientClinicConsistency(pid, operationalClinic, source);
  }

  let profile = { profileId: null, created: false };
  if (opts.ensureProfile !== false && operationalClinic) {
    profile = await ensureCoordinatorProfile(pid, operationalClinic, { source });
  }

  return {
    ok: resolved.ok,
    threadId: resolved.threadId,
    thread: resolved.thread,
    clinicId: operationalClinic || resolved.clinicId || null,
    reason: resolved.reason,
    profileId: profile.profileId || null,
    profileCreated: profile.created === true,
    clinicRepaired: clinicRepair.repaired === true,
    allThreads: resolved.allThreads,
  };
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

  const clinicHint = String(opts.clinicIdHint || "").trim();
  if (UUID_RE.test(clinicHint) && opts.mergeDuplicates !== false) {
    await mergeDuplicateThreadsAtClinic(pid, clinicHint);
  }

  const allThreads = await fetchAllPatientChatThreads(pid);
  const operationalClinic =
    (await resolveOperationalClinicIdForPatient(pid, opts.clinicIdHint)) ||
    (UUID_RE.test(clinicHint) ? clinicHint : null);

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
    const atClinic = allThreads.filter(
      (t) => String(t.clinic_id || "").trim() === operationalClinic && isActiveThreadRow(t),
    );
    if (atClinic.length === 1) {
      chosen = atClinic[0];
      reason = "operational_clinic_unique";
    } else if (atClinic.length > 1) {
      chosen = atClinic.reduce(pickBetterThreadRow, null);
      reason = "operational_clinic_duplicate_pick_best";
    }
  }

  if (!chosen && doctorKeys.length) {
    const assigned = allThreads.filter(
      (t) => isActiveThreadRow(t) && assignedDoctorMatchesKeys(t.assigned_doctor_id, doctorKeys),
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
      /* unique race — re-fetch */
    }
    if (!chosen) {
      const retry = (await fetchThreadsAtClinic(pid, operationalClinic)).filter(isActiveThreadRow);
      if (retry.length) {
        chosen = retry.reduce(pickBetterThreadRow, null);
        reason = "operational_clinic_after_insert_race";
      }
    }
  }

  if (!chosen && allThreads.length) {
    chosen = allThreads.filter(isActiveThreadRow).reduce(pickBetterThreadRow, null) || allThreads[0];
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
        const atPatientClinic = allThreads.filter(
          (t) => String(t.clinic_id || "").trim() === pcid && isActiveThreadRow(t),
        );
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
      .filter(isActiveThreadRow)
      .map((t) => String(t.id || "").slice(0, 8))
      .filter((id) => id && id !== (threadId || "").slice(0, 8)),
    assigned_doctor_id: chosen?.assigned_doctor_id
      ? String(chosen.assigned_doctor_id).slice(0, 8)
      : null,
  });

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
  UUID_RE,
  isActiveThreadRow,
  logThreadCanonicalResolution,
  logClinicMismatchRepaired,
  fetchAllPatientChatThreads,
  fetchThreadsAtClinic,
  mergeDuplicateThreadsAtClinic,
  archiveCrossClinicStaleThreads,
  repairPatientClinicConsistency,
  ensureCoordinatorProfile,
  getCanonicalThread,
  resolveCanonicalChatThread,
  pickBetterThreadRow,
};
