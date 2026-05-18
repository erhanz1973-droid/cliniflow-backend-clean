/**
 * Unified operational queue for Coordination Center.
 * Merges ai_coordinator_lead_profiles with active treatment_requests / offer threads.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { ensureLeadWorkspaceForClinic, LEAD_STATUS } = require("./patientLeadLifecycle");
const { attachPatientNamesToProfileRows } = require("./coordinationProjection");
const { isCoordinationPlaceholderOffer } = require("./patientCoordinationChat");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROFILE_SELECT_FULL = `
  id, session_id, patient_id, clinic_id,
  treatment_interest, country, preferred_language, travel_timeline,
  urgency, booking_intent, budget_signal,
  conversation_summary, last_patient_message,
  lead_score, is_hot, message_count,
  coordination_mode, primary_channel, channel_metadata,
  assigned_coordinator_id, assigned_doctor_id, human_takeover_at,
  ai_mode, ai_paused, ai_escalation_required, ai_autonomy_level,
  follow_up_status, inactivity_detected_at,
  last_patient_message_at, last_human_reply_at, last_ai_reply_at,
  last_channel_message_at, escalation_flags, ai_unresolved,
  whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at,
  operational_intake_flags,
  created_at, updated_at
`;

const PROFILE_SELECT_CORE = `
  id, session_id, patient_id, clinic_id,
  treatment_interest, country, preferred_language, travel_timeline,
  urgency, booking_intent, budget_signal,
  conversation_summary, last_patient_message,
  lead_score, is_hot, message_count,
  coordination_mode, primary_channel, channel_metadata,
  assigned_coordinator_id, assigned_doctor_id, human_takeover_at,
  ai_mode, ai_paused, ai_escalation_required, ai_autonomy_level,
  follow_up_status, inactivity_detected_at,
  last_patient_message_at, last_human_reply_at, last_ai_reply_at,
  last_channel_message_at, escalation_flags, ai_unresolved,
  operational_intake_flags,
  created_at, updated_at
`;

/** Event-driven filters exposed to admin UI. */
const OPERATIONAL_FILTERS = [
  { id: "", label: "All active", description: "Every open coordination case" },
  { id: "waiting_for_patient", label: "Waiting on patient", description: "Patient must upload info or reply" },
  { id: "waiting_for_clinic", label: "Waiting on clinic", description: "Clinic reply or quote overdue" },
  { id: "quote_sent", label: "Quote sent", description: "Formal offer shared" },
  { id: "follow_up_needed", label: "Follow-up needed", description: "Scheduled follow-up or stale thread" },
  { id: "appointment_booked", label: "Appointment booked", description: "Visit scheduled" },
  { id: "travel_pending", label: "Travel pending", description: "Travel discussed, logistics open" },
  { id: "ai_unresolved", label: "AI unresolved", description: "Needs coordinator review" },
  { id: "human_takeover", label: "Human takeover", description: "Coordinator owns the thread" },
  { id: "missing_documents", label: "Missing documents", description: "X-ray, photos, or intake gaps" },
];

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

/**
 * @param {string} clinicId
 * @param {number} limit
 */
async function fetchProfileRows(clinicId, limit) {
  let select = PROFILE_SELECT_FULL;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select(select)
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (!error) return data || [];
    if (attempt === 0 && isMissingColumnError(error)) {
      select = PROFILE_SELECT_CORE;
      continue;
    }
    throw error;
  }
  return [];
}

/**
 * @param {string} clinicId
 * @param {number} limit
 */
async function fetchActiveTreatmentRequests(clinicId, limit) {
  const { data, error } = await supabase
    .from("treatment_requests")
    .select(
      "id, patient_id, clinic_id, status, proposal_status, lead_status, preferred_treatment, message, created_at, updated_at, first_clinic_response_at",
    )
    .eq("clinic_id", clinicId)
    .not("status", "eq", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingColumnError(error)) {
      const { data: slim, error: e2 } = await supabase
        .from("treatment_requests")
        .select("id, patient_id, clinic_id, status, preferred_treatment, message, created_at, updated_at")
        .eq("clinic_id", clinicId)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (e2) throw e2;
      return slim || [];
    }
    throw error;
  }
  return data || [];
}

/**
 * @param {string[]} requestIds
 */
async function fetchLatestMessagesByRequest(requestIds) {
  const out = new Map();
  const ids = requestIds.filter((id) => UUID_RE.test(id));
  if (!ids.length || !isSupabaseEnabled()) return out;

  const { data: offers } = await supabase
    .from("treatment_offers")
    .select("id, request_id, note, created_at")
    .in("request_id", ids);

  const offerByRequest = new Map();
  for (const o of offers || []) {
    const rid = String(o.request_id || "");
    if (!rid) continue;
    const prev = offerByRequest.get(rid);
    if (!prev || new Date(o.created_at) > new Date(prev.created_at)) {
      offerByRequest.set(rid, o);
    }
  }

  const offerIds = [...offerByRequest.values()].map((o) => o.id).filter(Boolean);
  if (!offerIds.length) return out;

  const { data: msgs } = await supabase
    .from("offer_messages")
    .select("offer_id, text, sender_role, created_at")
    .in("offer_id", offerIds)
    .order("created_at", { ascending: false })
    .limit(500);

  const latestByOffer = new Map();
  for (const m of msgs || []) {
    const oid = String(m.offer_id || "");
    if (!oid || latestByOffer.has(oid)) continue;
    if (!String(m.text || "").trim()) continue;
    latestByOffer.set(oid, m);
  }

  for (const [rid, offer] of offerByRequest) {
    const msg = latestByOffer.get(String(offer.id));
    if (msg) {
      out.set(rid, {
        text: String(msg.text).trim().slice(0, 280),
        role: String(msg.sender_role || "unknown"),
        at: msg.created_at,
      });
    }
  }
  return out;
}

/**
 * Ensure coordinator profiles exist for treatment requests that only live in quotes/inbox.
 * @param {string} clinicId
 * @param {Array<Record<string, unknown>>} requests
 * @param {Map<string, Record<string, unknown>>} profileByPatient
 */
async function syncProfilesFromTreatmentRequests(clinicId, requests, profileByPatient) {
  let synced = 0;
  const missing = requests.filter((tr) => {
    const pid = String(tr.patient_id || "");
    return UUID_RE.test(pid) && !profileByPatient.has(pid);
  });

  for (const tr of missing.slice(0, 25)) {
    const patientId = String(tr.patient_id);
    const leadStatus =
      String(tr.lead_status || "").toLowerCase() === "booked"
        ? LEAD_STATUS.BOOKED
        : String(tr.status || "").toLowerCase() === "answered"
          ? LEAD_STATUS.QUOTED
          : LEAD_STATUS.INQUIRY;

    await ensureLeadWorkspaceForClinic(patientId, clinicId, {
      source: "coordination_queue_sync",
      leadStatus,
      treatmentRequestId: tr.id,
    });
    synced += 1;
  }
  return synced;
}

/**
 * Merge treatment request + thread hints onto profile rows for projection.
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<Record<string, unknown>>} requests
 * @param {Map<string, { text: string, role: string, at: string }>} latestByRequest
 */
function hydrateProfileRowsFromRequests(rows, requests, latestByRequest) {
  const requestByPatient = new Map();
  for (const tr of requests) {
    const pid = String(tr.patient_id || "");
    if (!UUID_RE.test(pid)) continue;
    const prev = requestByPatient.get(pid);
    if (!prev || new Date(tr.updated_at || tr.created_at) > new Date(prev.updated_at || prev.created_at)) {
      requestByPatient.set(pid, tr);
    }
  }

  return rows.map((row) => {
    const pid = String(row.patient_id || "");
    const tr = requestByPatient.get(pid);
    if (!tr) return row;

    const flags =
      row.operational_intake_flags && typeof row.operational_intake_flags === "object"
        ? { ...row.operational_intake_flags }
        : {};

    flags.treatmentRequestId = flags.treatmentRequestId || tr.id;
    if (tr.proposal_status) flags.proposalStatus = tr.proposal_status;
    if (tr.lead_status) flags.leadStatus = tr.lead_status;
    if (tr.first_clinic_response_at) flags.firstClinicResponseAt = tr.first_clinic_response_at;

    const preview = latestByRequest.get(String(tr.id));
    const reqMsg = String(tr.message || "").trim();

    let lastPatientMessage = row.last_patient_message;
    let lastPatientMessageAt = row.last_patient_message_at;
    if (preview) {
      if (!flags.latestMessagePreview) {
        flags.latestMessagePreview = preview.text;
        flags.latestMessageRole = preview.role;
        flags.latestMessageAt = preview.at;
      }
      if (preview.role === "patient") {
        lastPatientMessage = preview.text;
        lastPatientMessageAt = preview.at;
      }
    } else if (!lastPatientMessage && reqMsg) {
      lastPatientMessage = reqMsg.slice(0, 500);
      lastPatientMessageAt = tr.created_at;
    }

    const treatmentInterest =
      row.treatment_interest || tr.preferred_treatment || flags.treatmentInterest || null;

    return {
      ...row,
      treatment_interest: treatmentInterest,
      last_patient_message: lastPatientMessage,
      last_patient_message_at: lastPatientMessageAt || row.last_patient_message_at,
      operational_intake_flags: flags,
      updated_at: row.updated_at || tr.updated_at || tr.created_at,
    };
  });
}

/**
 * @param {Record<string, unknown>} lead
 * @param {string} filter
 */
function matchesOperationalFilter(lead, filter) {
  const f = String(filter || "").trim().toLowerCase();
  if (!f) return true;

  const flags = lead.operationalIntakeFlags || {};
  const st = String(lead.operationalStatus || flags.operationalStatus || "").toLowerCase();

  switch (f) {
    case "waiting_for_patient":
      return st === "waiting_for_patient" || lead.waitingParty === "patient";
    case "waiting_for_clinic":
      return st === "waiting_for_clinic_reply" || lead.waitingParty === "clinic";
    case "quote_sent":
      return st === "quote_sent";
    case "follow_up_needed":
      return st === "follow_up_needed" || String(lead.followUpStatus || "").toLowerCase() === "pending";
    case "appointment_booked":
      return st === "appointment_booked" || st === "consultation_scheduled";
    case "travel_pending":
      return st === "travel_pending" || (Boolean(lead.travelTimeline || flags.travelTimeline) && st !== "appointment_booked");
    case "ai_unresolved":
      return st === "ai_unresolved" || lead.aiUnresolved === true || lead.aiEscalationRequired === true;
    case "human_takeover":
      return lead.coordinationMode === "human_active" || st === "human_takeover";
    case "missing_documents":
      return (
        flags.missingXray === true ||
        flags.missingSmilePhotos === true ||
        flags.missingTravelTimeline === true ||
        flags.missingTreatmentPreference === true ||
        lead.needsDoctorDocumentReview === true
      );
    default:
      return st === f;
  }
}

/**
 * Build merged profile rows for a clinic operational queue.
 * @param {string} clinicId
 * @param {{ limit?: number, syncRequests?: boolean }} [opts]
 */
async function buildOperationalQueueForClinic(clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) {
    return { rows: [], meta: { error: "invalid_clinic" } };
  }

  const limit = Math.min(250, Math.max(20, opts.limit || 120));
  const syncRequests = opts.syncRequests !== false;

  const [requests, initialRows] = await Promise.all([
    fetchActiveTreatmentRequests(clinicId, limit),
    fetchProfileRows(clinicId, limit),
  ]);

  const profileByPatient = new Map();
  for (const row of initialRows) {
    const pid = String(row.patient_id || "");
    if (UUID_RE.test(pid)) profileByPatient.set(pid, row);
  }

  let requestsSynced = 0;
  if (syncRequests && requests.length) {
    requestsSynced = await syncProfilesFromTreatmentRequests(clinicId, requests, profileByPatient);
  }

  let rows = initialRows;
  if (requestsSynced > 0) {
    rows = await fetchProfileRows(clinicId, limit);
  }

  const requestIds = requests.map((r) => String(r.id)).filter(Boolean);
  const latestByRequest = await fetchLatestMessagesByRequest(requestIds);
  rows = hydrateProfileRowsFromRequests(rows, requests, latestByRequest);
  rows = await attachPatientNamesToProfileRows(rows);

  return {
    rows,
    requests,
    requestsSynced,
    meta: {
      profileCount: rows.length,
      requestCount: requests.length,
      requestsSynced,
    },
  };
}

module.exports = {
  OPERATIONAL_FILTERS,
  PROFILE_SELECT_FULL,
  PROFILE_SELECT_CORE,
  fetchProfileRows,
  fetchActiveTreatmentRequests,
  buildOperationalQueueForClinic,
  matchesOperationalFilter,
  hydrateProfileRowsFromRequests,
};
