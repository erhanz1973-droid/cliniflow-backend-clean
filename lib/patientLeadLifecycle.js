/**
 * Lead vs clinic membership — quote/inquiry must NOT auto-enroll patients on patients.clinic_id.
 * Workspace context lives on patient_chat_threads + ai_coordinator_lead_profiles + treatment_requests.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { COORDINATION_AI } = require("./aiCoordinatorCoordination");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEAD_STATUS = {
  INQUIRY: "inquiry",
  QUOTED: "quoted",
  NEGOTIATING: "negotiating",
  BOOKED: "booked",
  CONVERTED_TO_PATIENT: "converted_to_patient",
  ARCHIVED: "archived",
};

/**
 * @param {string} source
 * @param {Record<string, unknown>} detail
 */
function logLeadLifecycle(source, detail) {
  console.log("[patientLeadLifecycle]", source, detail);
}

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^patients\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

/**
 * @param {string} requestId
 * @param {string} status
 */
async function setTreatmentRequestLeadStatus(requestId, status) {
  if (!isSupabaseEnabled() || !UUID_RE.test(requestId)) return;
  const normalized = String(status || "").trim().toLowerCase();
  if (!Object.values(LEAD_STATUS).includes(normalized)) return;

  let patch = { lead_status: normalized, updated_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await supabase.from("treatment_requests").update(patch).eq("id", requestId);
    if (!error) return;
    if (!isMissingColumnError(error)) {
      console.warn("[patientLeadLifecycle] lead_status patch:", error.message);
      return;
    }
    const col = getMissingColumnName(error);
    if (!col || !(col in patch)) return;
    delete patch[col];
  }
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} status
 */
async function setTreatmentRequestsLeadStatusForPatientClinic(patientId, clinicId, status) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return;
  let patch = { lead_status: status, updated_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await supabase
      .from("treatment_requests")
      .update(patch)
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId);
    if (!error) return;
    if (!isMissingColumnError(error)) return;
    const col = getMissingColumnName(error);
    if (!col || !(col in patch)) return;
    delete patch[col];
  }
}

/**
 * Ensure lead thread + coordinator profile — never writes patients.clinic_id.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ source?: string, leadStatus?: string, treatmentRequestId?: string }} [opts]
 */
async function ensureLeadWorkspaceForClinic(patientId, clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, reason: "invalid_ids" };
  }

  const source = String(opts.source || "inquiry").trim();
  const leadStatus = opts.leadStatus || LEAD_STATUS.INQUIRY;
  const nowIso = new Date().toISOString();

  let threadId = null;
  try {
    const { data: existing } = await supabase
      .from("patient_chat_threads")
      .select("id, is_lead, lifecycle_status, archived_at")
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      threadId = existing.id;
      const archived =
        existing.lifecycle_status === "archived" ||
        (existing.archived_at != null && String(existing.archived_at).trim() !== "");
      if (!archived && existing.is_lead !== true) {
        await supabase
          .from("patient_chat_threads")
          .update({ is_lead: true, status: "unassigned", updated_at: nowIso })
          .eq("id", existing.id);
      }
    } else {
      const { data: ins } = await supabase
        .from("patient_chat_threads")
        .insert({
          patient_id: patientId,
          clinic_id: clinicId,
          status: "unassigned",
          assigned_doctor_id: null,
          is_lead: true,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .single();
      threadId = ins?.id || null;
    }
  } catch (e) {
    console.warn("[patientLeadLifecycle] thread:", e?.message || e);
  }

  const sessionId = `inq_${patientId}_${clinicId}`;
  const { data: profileRow } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, operational_intake_flags")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const prevFlags =
    profileRow?.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {};

  const flags = {
    ...prevFlags,
    workspaceClinicId: clinicId,
    leadStatus,
    membershipType: "inquiry",
    ...(opts.treatmentRequestId ? { treatmentRequestId: opts.treatmentRequestId } : {}),
  };

  if (profileRow?.id) {
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        operational_intake_flags: flags,
        updated_at: nowIso,
      })
      .eq("id", profileRow.id);
  } else {
    const { data: inserted } = await supabase
      .from("ai_coordinator_lead_profiles")
      .insert({
        session_id: sessionId,
        patient_id: patientId,
        clinic_id: clinicId,
        coordination_mode: COORDINATION_AI,
        ai_mode: "AI_ACTIVE",
        source: "clinic_inquiry",
        primary_channel: "in_app",
        operational_intake_flags: flags,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (inserted?.id) {
      void insertTimelineEvent({
        profileId: inserted.id,
        eventType: "system",
        eventMetadata: { kind: "lead_workspace_created", source, leadStatus },
      }).catch(() => {});
    }
  }

  logLeadLifecycle("ensureLeadWorkspace", {
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    source,
    leadStatus,
    threadId: threadId ? String(threadId).slice(0, 8) : null,
    patientMembershipPatched: false,
  });

  return { ok: true, threadId, leadStatus };
}

/**
 * Explicit conversion — only path that should set patients.clinic_id (called from PATCH /api/patient/clinic).
 * @param {string} patientId
 * @param {string} clinicId
 */
async function markLeadConvertedToClinicPatient(patientId, clinicId) {
  await setTreatmentRequestsLeadStatusForPatientClinic(
    patientId,
    clinicId,
    LEAD_STATUS.CONVERTED_TO_PATIENT,
  );
  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, operational_intake_flags")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .limit(1);
  const profile = profiles?.[0];
  if (!profile?.id) return;
  const prev =
    profile.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};
  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: {
        ...prev,
        leadStatus: LEAD_STATUS.CONVERTED_TO_PATIENT,
        membershipType: "clinic_patient",
        convertedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
}

module.exports = {
  LEAD_STATUS,
  ensureLeadWorkspaceForClinic,
  setTreatmentRequestLeadStatus,
  setTreatmentRequestsLeadStatusForPatientClinic,
  markLeadConvertedToClinicPatient,
};
