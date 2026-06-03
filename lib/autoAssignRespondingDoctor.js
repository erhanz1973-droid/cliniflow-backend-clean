/**
 * Assign patient_chat_threads to the doctor who actually responds when no admin assign yet.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { resolveDefaultDoctorForClinic } = require("./patientCoordinationChat");
const {
  recordThreadAssignmentChange,
  ASSIGNMENT_REASON,
  loadThreadAssignmentSnapshot,
} = require("./patientChatThreadAssignmentAudit");

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

/** doctors.id UUID or legacy doctors.doctor_id code (e.g. SZ45) → eligible doctors.id */
async function resolveEligibleDoctorKey(doctorKeyRaw, clinicId) {
  const raw = String(doctorKeyRaw || "").trim();
  if (!raw) return null;
  if (UUID_RE.test(raw)) return resolveEligibleDoctorId(raw, clinicId);
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(cid)) return null;
  const variants = [...new Set([raw, raw.toUpperCase(), raw.toLowerCase()])];
  for (const code of variants) {
    let sel = "id, clinic_id, status, is_active";
    let { data, error } = await supabase.from("doctors").select(sel).eq("doctor_id", code).maybeSingle();
    if (error && String(error.message || "").toLowerCase().includes("is_active")) {
      ({ data, error } = await supabase.from("doctors").select("id, clinic_id, status").eq("doctor_id", code).maybeSingle());
    }
    if (!error && data?.id) {
      if (String(data.clinic_id || "").trim() !== cid) return null;
      if (Object.prototype.hasOwnProperty.call(data, "is_active") && data.is_active === false) return null;
      return doctorStatusEligible(data.status) ? String(data.id) : null;
    }
  }
  return null;
}

/**
 * Same doctor as admin "Lead inbox" routing (clinic_lead_routing_settings) — used when patient becomes a member.
 */
async function resolveLeadRoutingDoctorForMembership(clinicId) {
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(cid) || !isSupabaseEnabled()) return null;
  try {
    const { data: row, error } = await supabase
      .from("clinic_lead_routing_settings")
      .select("auto_routing_enabled, routing_mode, fixed_doctor_id")
      .eq("clinic_id", cid)
      .maybeSingle();
    if (error || !row) return null;
    const enabled =
      row.auto_routing_enabled === true ||
      String(row.auto_routing_enabled || "").toLowerCase() === "true";
    if (!enabled) return null;
    const mode = String(row.routing_mode || "").trim().toLowerCase();
    if (mode === "fixed_doctor" && row.fixed_doctor_id != null) {
      return resolveEligibleDoctorKey(row.fixed_doctor_id, cid);
    }
    return null;
  } catch (_) {
    return null;
  }
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

async function tryClaimThread(threadId, doctorId, auditReason = ASSIGNMENT_REASON.RESPONDING_DOCTOR_CLAIM) {
  const before = await loadThreadAssignmentSnapshot(threadId);
  const assignedAtIso = new Date().toISOString();
  try {
    const { data, error } = await supabase.rpc("cliniflow_try_claim_thread_assignment", {
      p_thread_id: threadId,
      p_doctor_id: doctorId,
      p_assigned_at: assignedAtIso,
      p_updated_at: assignedAtIso,
    });
    if (!error && data === true) {
      void recordThreadAssignmentChange({
        threadId,
        patientId: before?.patientId || "",
        clinicId: before?.clinicId || null,
        oldAssignedDoctorId: before?.assignedDoctorId || null,
        newAssignedDoctorId: doctorId,
        reason: auditReason,
        metadata: { via: "rpc_claim" },
      });
      return true;
    }
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
    .select("id, patient_id, clinic_id, assigned_doctor_id");
  if (upErr) return false;
  const claimed = Array.isArray(rows) && rows.length > 0;
  if (claimed) {
    const row = rows[0];
    void recordThreadAssignmentChange({
      threadId,
      patientId: String(row?.patient_id || before?.patientId || ""),
      clinicId: row?.clinic_id ? String(row.clinic_id) : before?.clinicId || null,
      oldAssignedDoctorId: before?.assignedDoctorId || null,
      newAssignedDoctorId: doctorId,
      reason: auditReason,
      metadata: { via: "conditional_update" },
    });
  }
  return claimed;
}

async function patchCoordinatorProfileDoctor(patientId, clinicId, doctorId, opts = {}) {
  const { syncLeadProfileAssignedDoctor } = require("./doctorLeadThreadSync");
  await syncLeadProfileAssignedDoctor(patientId, clinicId, doctorId, {
    force: opts.force === true,
  }).catch(() => {});
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

/**
 * Optional Railway env: {"<clinic_uuid>":"<doctor_uuid>",...} for explicit default assignee (e.g. Cem → Serap).
 */
function resolveDoctorIdFromClinicAutoAssignMap(clinicId) {
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(cid)) return null;
  const raw = String(process.env.CLINIC_AUTO_ASSIGN_DOCTOR_MAP || "").trim();
  if (!raw) return null;
  try {
    const map = JSON.parse(raw);
    if (!map || typeof map !== "object") return null;
    const hit = map[cid] || map[cid.toLowerCase()];
    const doc = String(hit || "").trim();
    return UUID_RE.test(doc) ? doc : null;
  } catch (_) {
    return null;
  }
}

/**
 * clinics.settings — görevli / duty doctor (admin JSON, no migration).
 */
async function resolveDoctorIdFromClinicSettings(clinicId) {
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(cid)) return null;
  try {
    const { data: crow } = await supabase.from("clinics").select("settings").eq("id", cid).maybeSingle();
    let settings = crow?.settings;
    if (typeof settings === "string") {
      try {
        settings = JSON.parse(settings);
      } catch (_) {
        settings = {};
      }
    }
    if (!settings || typeof settings !== "object") return null;
    const keys = [
      "duty_doctor_id",
      "dutyDoctorId",
      "gorevli_doctor_id",
      "gorevliDoctorId",
      "on_duty_doctor_id",
      "onDutyDoctorId",
      "auto_assign_doctor_id",
      "autoAssignDoctorId",
      "default_doctor_id",
      "defaultDoctorId",
    ];
    for (let i = 0; i < keys.length; i++) {
      const raw = settings[keys[i]];
      const doc = String(raw || "").trim();
      if (UUID_RE.test(doc)) return doc;
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Clinic görevli (duty) doctor — not inferred from old offer_messages (prior doctor may be offline).
 */
async function resolveDutyDoctorForClinic(clinicId) {
  const fromMap = resolveDoctorIdFromClinicAutoAssignMap(clinicId);
  if (fromMap) {
    const eligible = await resolveEligibleDoctorId(fromMap, clinicId);
    if (eligible) return eligible;
  }
  const fromSettings = await resolveDoctorIdFromClinicSettings(clinicId);
  if (fromSettings) {
    const eligible = await resolveEligibleDoctorId(fromSettings, clinicId);
    if (eligible) return eligible;
  }
  return resolveDefaultDoctorForClinic(clinicId);
}

/** @deprecated alias */
async function resolveDefaultAssignDoctorForClinic(clinicId) {
  return resolveDutyDoctorForClinic(clinicId);
}

/**
 * Enrolled member (PATCH /api/patient/clinic) — ensure a thread row exists for assignment + inbox.
 */
async function ensureEnrolledPatientChatThreadForJoin(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(pid) || !UUID_RE.test(cid)) {
    return { ok: false, reason: "invalid_ids" };
  }

  const { data: existing, error: exErr } = await supabase
    .from("patient_chat_threads")
    .select("id, assigned_doctor_id, is_lead")
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exErr && !isMissingColumnError(exErr)) {
    console.warn("[ensureEnrolledPatientChatThreadForJoin] select:", exErr.message);
    return { ok: false, reason: "thread_select_failed" };
  }
  if (existing?.id) {
    return { ok: true, threadId: String(existing.id), created: false };
  }

  const nowIso = new Date().toISOString();
  let insertPayload = {
    patient_id: pid,
    clinic_id: cid,
    status: "unassigned",
    assigned_doctor_id: null,
    is_lead: false,
    lifecycle_status: "active",
    created_at: nowIso,
    updated_at: nowIso,
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data: ins, error: insErr } = await supabase
      .from("patient_chat_threads")
      .insert(insertPayload)
      .select("id")
      .single();
    if (!insErr && ins?.id) {
      console.log("[ensureEnrolledPatientChatThreadForJoin] created", {
        patient_id: pid.slice(0, 8),
        clinic_id: cid.slice(0, 8),
        thread_id: String(ins.id).slice(0, 8),
      });
      return { ok: true, threadId: String(ins.id), created: true };
    }
    if (!isMissingColumnError(insErr)) {
      console.warn("[ensureEnrolledPatientChatThreadForJoin] insert:", insErr?.message || insErr);
      return { ok: false, reason: "thread_insert_failed" };
    }
    const col = getMissingColumnName(insErr);
    if (!col || !(col in insertPayload)) {
      return { ok: false, reason: "thread_insert_failed" };
    }
    delete insertPayload[col];
  }
  return { ok: false, reason: "thread_insert_prune_exhausted" };
}

/**
 * Lead inbox fixed doctor (clinic_lead_routing_settings.fixed_doctor_id) when routing enabled.
 * @param {string} clinicId
 */
async function resolveFixedLeadRoutingDoctorId(clinicId) {
  return resolveLeadRoutingDoctorForMembership(clinicId);
}

/**
 * Block automatic reassignment away from the configured fixed lead doctor (e.g. Burhan).
 * @param {string} currentDoctorId
 * @param {string} targetDoctorId
 * @param {string} clinicId
 * @param {{ allowReplace?: boolean }} [auditOpts]
 */
async function shouldPreserveFixedLeadDoctorAssignment(
  currentDoctorId,
  targetDoctorId,
  clinicId,
  auditOpts = {},
) {
  if (auditOpts.allowReplace === true) return false;
  const current = String(currentDoctorId || "").trim();
  const target = String(targetDoctorId || "").trim();
  if (!UUID_RE.test(current) || current === target) return false;
  const fixedLead = await resolveFixedLeadRoutingDoctorId(clinicId);
  return Boolean(fixedLead && current === fixedLead);
}

/**
 * Assign clinic görevli (duty) doctor — replaces stale offer-thread doctor when different.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} dutyDoctorIdRaw
 * @param {{ auditReason?: string, auditMetadata?: Record<string, unknown>, allowReplace?: boolean }} [auditOpts]
 */
async function assignClinicDutyDoctorToPatient(patientId, clinicId, dutyDoctorIdRaw, auditOpts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return { ok: false, reason: "invalid_ids" };

  const doctorId = await resolveEligibleDoctorId(dutyDoctorIdRaw, cid);
  if (!doctorId) return { ok: false, reason: "doctor_not_eligible" };

  let threadId = null;
  const ensured = await ensureEnrolledPatientChatThreadForJoin(pid, cid);
  if (ensured.ok && ensured.threadId) threadId = ensured.threadId;

  const { data: thread } = await supabase
    .from("patient_chat_threads")
    .select("id, assigned_doctor_id")
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (thread?.id) threadId = String(thread.id);
  if (!threadId) return { ok: false, reason: "no_thread" };

  const current = String(thread?.assigned_doctor_id || "").trim();
  if (current === doctorId) {
    await patchPatientAssignmentPointers(pid, doctorId);
    await patchCoordinatorProfileDoctor(pid, cid, doctorId, { force: true });
    return { ok: true, reason: "already_duty_doctor", threadId, doctorId };
  }

  if (await shouldPreserveFixedLeadDoctorAssignment(current, doctorId, cid, auditOpts)) {
    console.log("[assignClinicDutyDoctorToPatient] preserved fixed lead doctor (no auto-replace)", {
      patient_id: pid.slice(0, 8),
      clinic_id: cid.slice(0, 8),
      current_doctor_id: current.slice(0, 8),
      blocked_target_doctor_id: doctorId.slice(0, 8),
    });
    await patchPatientAssignmentPointers(pid, current);
    await patchCoordinatorProfileDoctor(pid, cid, current, { force: true });
    return {
      ok: true,
      reason: "preserved_fixed_lead_doctor",
      threadId,
      doctorId: current,
      skippedReplace: true,
    };
  }

  const replaced = UUID_RE.test(current) && current !== doctorId;
  const assignedAtIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("patient_chat_threads")
    .update({
      status: "assigned",
      assigned_doctor_id: doctorId,
      assigned_at: assignedAtIso,
      updated_at: assignedAtIso,
    })
    .eq("id", threadId);

  if (upErr) {
    console.warn("[assignClinicDutyDoctorToPatient] thread update:", upErr.message);
    return { ok: false, reason: "thread_update_failed", doctorId };
  }

  const auditReason =
    auditOpts.auditReason ||
    (replaced ? ASSIGNMENT_REASON.CLINIC_DUTY_DOCTOR_REPLACED : ASSIGNMENT_REASON.CLINIC_DUTY_DOCTOR);
  void recordThreadAssignmentChange({
    threadId,
    patientId: pid,
    clinicId: cid,
    oldAssignedDoctorId: current || null,
    newAssignedDoctorId: doctorId,
    reason: auditReason,
    metadata: {
      ...(auditOpts.auditMetadata && typeof auditOpts.auditMetadata === "object"
        ? auditOpts.auditMetadata
        : {}),
      replaced_previous: replaced,
    },
  });

  await patchPatientAssignmentPointers(pid, doctorId);
  await patchCoordinatorProfileDoctor(pid, cid, doctorId, { force: true });

  try {
    const { backfillLeadCoordinatorHistoryToPatientMessages } = require("./backfillLeadChatMirror");
    void backfillLeadCoordinatorHistoryToPatientMessages(pid, cid).catch((e) =>
      console.warn("[assignClinicDutyDoctorToPatient] chat backfill:", e?.message || e),
    );
  } catch (_) {
    /* optional */
  }

  console.log("[assignClinicDutyDoctorToPatient] assigned duty doctor", {
    patient_id: pid.slice(0, 8),
    clinic_id: cid.slice(0, 8),
    doctor_id: doctorId.slice(0, 8),
    replaced_previous: replaced ? current.slice(0, 8) : null,
  });

  return {
    ok: true,
    reason: replaced ? "replaced_previous_doctor" : "assigned",
    threadId,
    doctorId,
    previousDoctorId: replaced ? current : null,
  };
}

/**
 * Patient joined clinic — keep lead-thread assignee (Burhan from lead inbox); else lead routing fixed doctor; else clinic görevli.
 */
async function assignDoctorOnPatientClinicJoin(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return { ok: false, reason: "invalid_ids" };

  await ensureEnrolledPatientChatThreadForJoin(pid, cid);

  let threadAssignedRaw = "";
  let threadId = null;
  try {
    const { data: thr } = await supabase
      .from("patient_chat_threads")
      .select("id, assigned_doctor_id, is_lead")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (thr?.assigned_doctor_id != null) {
      threadAssignedRaw = String(thr.assigned_doctor_id).trim();
    }
    if (thr?.id) threadId = String(thr.id);
  } catch (_) {
    /* non-fatal */
  }

  const fixedLeadDoctorId = await resolveFixedLeadRoutingDoctorId(cid);
  if (threadAssignedRaw && fixedLeadDoctorId && threadAssignedRaw === fixedLeadDoctorId) {
    const preserved = await resolveEligibleDoctorKey(threadAssignedRaw, cid);
    if (preserved) {
      await patchPatientAssignmentPointers(pid, preserved);
      await patchCoordinatorProfileDoctor(pid, cid, preserved, { force: true });
      return {
        ok: true,
        path: "fixed_lead_doctor_locked",
        doctorId: preserved,
        threadId,
        reason: "already_assigned_fixed_lead_doctor",
      };
    }
  }

  /** Lead inbox routing (Burhan) — assign only when thread has no assignee yet. */
  if (!threadAssignedRaw && fixedLeadDoctorId) {
    const result = await assignClinicDutyDoctorToPatient(pid, cid, fixedLeadDoctorId, {
      auditReason: ASSIGNMENT_REASON.CLINIC_DUTY_DOCTOR,
      auditMetadata: { path: "clinic_lead_routing_fixed" },
    });
    if (result.ok) {
      return {
        ok: true,
        path: "clinic_lead_routing_fixed",
        doctorId: fixedLeadDoctorId,
        ...result,
      };
    }
  }

  if (threadAssignedRaw) {
    const preserved = await resolveEligibleDoctorKey(threadAssignedRaw, cid);
    if (preserved) {
      const result = await assignClinicDutyDoctorToPatient(pid, cid, preserved, {
        auditReason: ASSIGNMENT_REASON.CLINIC_DUTY_DOCTOR,
        auditMetadata: { path: "preserved_lead_thread_doctor" },
      });
      if (result.ok) {
        return {
          ok: true,
          path: "preserved_lead_thread_doctor",
          doctorId: preserved,
          ...result,
        };
      }
    }
  }

  const dutyDoctorId = await resolveDutyDoctorForClinic(cid);
  if (!dutyDoctorId) {
    console.warn("[assignDoctorOnPatientClinicJoin] no_duty_doctor", {
      clinic_id: cid.slice(0, 8),
      patient_id: pid.slice(0, 8),
    });
    return { ok: false, path: "none", reason: "no_duty_doctor" };
  }

  const result = await assignClinicDutyDoctorToPatient(pid, cid, dutyDoctorId, {
    auditReason: ASSIGNMENT_REASON.CLINIC_DUTY_DOCTOR,
    auditMetadata: { path: "clinic_duty_doctor", trigger: "patient_clinic_join" },
  });
  if (result.ok) {
    return { ok: true, path: "clinic_duty_doctor", doctorId: dutyDoctorId, ...result };
  }
  return { ok: false, path: "none", ...result };
}

/**
 * WhatsApp / Messenger inbound: apply clinic lead routing (fixed doctor) to unassigned lead thread.
 * In-app chat uses ensureInboundLeadThread + maybeAutoAssignInboundLeadThread; omnichannel must match.
 */
async function assignInboundLeadFromClinicRouting(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return { ok: false, reason: "invalid_ids" };

  const { data: thread } = await supabase
    .from("patient_chat_threads")
    .select("id, assigned_doctor_id, is_lead")
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (thread?.assigned_doctor_id) {
    return { ok: true, skipped: true, reason: "already_assigned", threadId: thread.id };
  }
  if (!thread?.id) {
    return { ok: false, reason: "no_thread" };
  }

  let dutyDoctorId = await resolveLeadRoutingDoctorForMembership(cid);
  if (!dutyDoctorId) {
    dutyDoctorId = await resolveDutyDoctorForClinic(cid);
  }
  if (!dutyDoctorId) {
    const fallback = await resolveDefaultAssignDoctorForClinic(cid);
    dutyDoctorId = fallback?.doctorId || null;
  }
  if (!dutyDoctorId) return { ok: false, reason: "no_routing_doctor" };

  const result = await assignClinicDutyDoctorToPatient(pid, cid, dutyDoctorId, {
    auditReason: ASSIGNMENT_REASON.INBOUND_WHATSAPP_ROUTING,
    auditMetadata: { path: "inbound_lead_routing" },
  });
  if (result.ok) {
    console.log("[assignInboundLeadFromClinicRouting] assigned", {
      patient_id: pid.slice(0, 8),
      clinic_id: cid.slice(0, 8),
      doctor_id: dutyDoctorId.slice(0, 8),
      path: result.reason || "assigned",
    });
  }
  return { ...result, doctorId: dutyDoctorId };
}

/** @deprecated use assignClinicDutyDoctorToPatient */
async function maybeAutoAssignDefaultClinicDoctorOnJoin(patientId, clinicId) {
  const cid = String(clinicId || "").trim();
  const dutyDoctorId = await resolveDutyDoctorForClinic(cid);
  if (!dutyDoctorId) return { ok: false, reason: "no_duty_doctor" };
  return assignClinicDutyDoctorToPatient(patientId, clinicId, dutyDoctorId);
}

module.exports = {
  maybeAutoAssignRespondingDoctor,
  maybeAutoAssignFromRecentOfferMessages,
  ensureEnrolledPatientChatThreadForJoin,
  assignClinicDutyDoctorToPatient,
  maybeAutoAssignDefaultClinicDoctorOnJoin,
  assignDoctorOnPatientClinicJoin,
  resolveDutyDoctorForClinic,
  resolveDefaultAssignDoctorForClinic,
  resolveEligibleDoctorKey,
  resolveLeadRoutingDoctorForMembership,
  resolveLeadRoutingDoctorForClinic: resolveLeadRoutingDoctorForMembership,
  assignInboundLeadFromClinicRouting,
};
