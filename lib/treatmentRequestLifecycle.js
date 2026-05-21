/**
 * Conversation-aware treatment request lifecycle.
 * status (patient badge): pending → answered on first clinic-side engagement
 * lead_status: inquiry → quoted → booked
 * proposal_status: waiting_for_quote → coordinator_responded → quote_sent
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { LEAD_STATUS, setTreatmentRequestLeadStatus } = require("./patientLeadLifecycle");
const {
  isCoordinationPlaceholderOffer,
  clinicHasMessagingDoctor,
} = require("./patientCoordinationChat");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PATIENT_STATUS = {
  WAITING: "pending",
  RESPONDED: "answered",
  CLOSED: "closed",
};

const PROPOSAL_COORDINATOR_RESPONDED = "coordinator_responded";

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
  if (quoted?.[1]) return quoted[1].replace(/^treatment_requests\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

/**
 * @param {string} requestId
 * @param {Record<string, unknown>} patch
 */
async function patchTreatmentRequestRow(requestId, patch) {
  if (!isSupabaseEnabled() || !UUID_RE.test(requestId)) return { ok: false };
  let current = { ...patch, updated_at: new Date().toISOString() };
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabase.from("treatment_requests").update(current).eq("id", requestId);
    if (!error) return { ok: true };
    lastError = error;
    if (!isMissingColumnError(error)) break;
    const col = getMissingColumnName(error);
    if (!col || !(col in current)) break;
    delete current[col];
  }
  if (lastError) {
    console.warn("[treatmentRequestLifecycle] patch:", lastError.message);
  }
  return { ok: false, error: lastError };
}

/**
 * @param {string} offerId
 */
async function resolveRequestIdFromOfferId(offerId) {
  if (!UUID_RE.test(offerId)) return null;
  const { data } = await supabase
    .from("treatment_offers")
    .select("request_id")
    .eq("id", offerId)
    .maybeSingle();
  const rid = data?.request_id ? String(data.request_id).trim() : "";
  return UUID_RE.test(rid) ? rid : null;
}

/**
 * Latest open request for patient+clinic (pending or answered, not closed).
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveLatestRequestForPatientClinic(patientId, clinicId) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return null;
  const { data } = await supabase
    .from("treatment_requests")
    .select("id, status, lead_status, proposal_status, clinic_id, patient_id, created_at")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .neq("status", PATIENT_STATUS.CLOSED)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? data : null;
}

/**
 * @param {{
 *   requestId?: string|null,
 *   patientId?: string|null,
 *   clinicId?: string|null,
 *   offerId?: string|null,
 *   profileId?: string|null,
 * }} params
 */
async function resolveTreatmentRequestRow(params) {
  const requestId = String(params.requestId || "").trim();
  if (UUID_RE.test(requestId)) {
    const { data } = await supabase
      .from("treatment_requests")
      .select("id, status, lead_status, proposal_status, clinic_id, patient_id")
      .eq("id", requestId)
      .maybeSingle();
    if (data?.id) return data;
  }

  const offerId = String(params.offerId || "").trim();
  if (UUID_RE.test(offerId)) {
    const rid = await resolveRequestIdFromOfferId(offerId);
    if (rid) {
      const { data } = await supabase
        .from("treatment_requests")
        .select("id, status, lead_status, proposal_status, clinic_id, patient_id")
        .eq("id", rid)
        .maybeSingle();
      if (data?.id) return data;
    }
  }

  if (UUID_RE.test(params.profileId)) {
    const { data: profile } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("patient_id, clinic_id, operational_intake_flags")
      .eq("id", params.profileId)
      .maybeSingle();
    const flags =
      profile?.operational_intake_flags && typeof profile.operational_intake_flags === "object"
        ? profile.operational_intake_flags
        : {};
    const trId = String(flags.treatmentRequestId || "").trim();
    if (UUID_RE.test(trId)) {
      const { data } = await supabase
        .from("treatment_requests")
        .select("id, status, lead_status, proposal_status, clinic_id, patient_id")
        .eq("id", trId)
        .maybeSingle();
      if (data?.id) return data;
    }
    const patientId = String(profile?.patient_id || params.patientId || "").trim();
    const clinicId = String(profile?.clinic_id || params.clinicId || "").trim();
    if (patientId && clinicId) {
      return resolveLatestRequestForPatientClinic(patientId, clinicId);
    }
  }

  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  if (UUID_RE.test(patientId) && UUID_RE.test(clinicId)) {
    return resolveLatestRequestForPatientClinic(patientId, clinicId);
  }

  return null;
}

/**
 * @param {Record<string, unknown>} row
 */
function shouldMarkResponded(row) {
  const status = String(row.status || PATIENT_STATUS.WAITING).toLowerCase();
  const lead = String(row.lead_status || "").toLowerCase();
  if (status === PATIENT_STATUS.CLOSED) return false;
  if (lead === LEAD_STATUS.BOOKED || lead === LEAD_STATUS.QUOTED) return false;
  if (status === PATIENT_STATUS.RESPONDED) return false;
  return status === PATIENT_STATUS.WAITING || status === "waiting" || !status;
}

/**
 * First clinic-side engagement (AI, continuity, coordinator, doctor).
 * @param {{
 *   requestId?: string|null,
 *   patientId?: string|null,
 *   clinicId?: string|null,
 *   offerId?: string|null,
 *   profileId?: string|null,
 *   source?: string,
 * }} params
 */
const HUMAN_RESPONSE_SOURCES = new Set([
  "doctor_reply",
  "human_reply",
  "coordinator_human",
]);

async function markTreatmentRequestResponded(params) {
  const row = await resolveTreatmentRequestRow(params);
  if (!row?.id) {
    return { updated: false, reason: "no_request" };
  }
  if (!shouldMarkResponded(row)) {
    return { updated: false, reason: "already_advanced", requestId: row.id };
  }

  const clinicId = String(row.clinic_id || params.clinicId || "").trim();
  const source = String(params.source || "clinic_outbound");
  const hasDoctor = UUID_RE.test(clinicId) ? await clinicHasMessagingDoctor(clinicId) : false;
  if (!hasDoctor && !HUMAN_RESPONSE_SOURCES.has(source)) {
    return {
      updated: false,
      reason: "awaiting_clinic_doctor",
      requestId: row.id,
    };
  }

  const now = new Date().toISOString();
  const proposalStatus = String(row.proposal_status || "").toLowerCase();
  /** @type {Record<string, unknown>} */
  const patch = {
    status: PATIENT_STATUS.RESPONDED,
    first_clinic_response_at: now,
  };

  if (
    !proposalStatus ||
    proposalStatus === "waiting_for_quote" ||
    proposalStatus === "proposal_pending"
  ) {
    patch.proposal_status = PROPOSAL_COORDINATOR_RESPONDED;
    patch.proposal_status_at = now;
  }

  const result = await patchTreatmentRequestRow(String(row.id), patch);
  if (result.ok) {
    console.log("[treatmentRequestLifecycle] marked responded", {
      requestId: String(row.id).slice(0, 8),
      source: params.source || "clinic_outbound",
    });
    const { projectCoordinationState } = require("./coordinationProjection");
    if (params.profileId) {
      void projectCoordinationState(params.profileId).catch(() => {});
    } else {
      const { data: prof } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("id")
        .eq("patient_id", row.patient_id)
        .eq("clinic_id", row.clinic_id)
        .limit(1)
        .maybeSingle();
      if (prof?.id) void projectCoordinationState(prof.id).catch(() => {});
    }
  }
  return { updated: result.ok, requestId: row.id, reason: result.ok ? "ok" : "patch_failed" };
}

/**
 * Formal quote / non-placeholder offer sent.
 * @param {string} requestId
 */
async function markTreatmentRequestQuoted(requestId) {
  if (!UUID_RE.test(requestId)) return { updated: false };
  const now = new Date().toISOString();
  await patchTreatmentRequestRow(requestId, {
    status: PATIENT_STATUS.RESPONDED,
    proposal_status: "quote_sent",
    proposal_status_at: now,
    proposal_waiting_since: null,
  });
  await setTreatmentRequestLeadStatus(requestId, LEAD_STATUS.QUOTED);
  return { updated: true };
}

/**
 * @param {string} requestId
 */
async function markTreatmentRequestBooked(requestId) {
  if (!UUID_RE.test(requestId)) return { updated: false };
  await patchTreatmentRequestRow(requestId, {
    status: PATIENT_STATUS.RESPONDED,
  });
  await setTreatmentRequestLeadStatus(requestId, LEAD_STATUS.BOOKED);
  return { updated: true };
}

/**
 * Patient-visible status for GET /treatment-requests (defensive if patch missed).
 * @param {Record<string, unknown>} row
 * @param {{ coordinationHasClinicReply?: boolean, formalOfferCount?: number, clinicHasMessagingDoctor?: boolean }} [opts]
 */
function resolvePatientVisibleStatus(row, opts = {}) {
  const lead = String(row.lead_status || "").toLowerCase();
  const status = String(row.status || PATIENT_STATUS.WAITING).toLowerCase();
  const formalOffers = Number(opts.formalOfferCount) || 0;
  const proposal = String(row.proposal_status || "").toLowerCase();
  const clinicReady = opts.clinicHasMessagingDoctor !== false;

  if (lead === LEAD_STATUS.BOOKED) {
    return { status: PATIENT_STATUS.RESPONDED, lifecycle: "booked" };
  }
  if (formalOffers > 0 || proposal === "quote_sent") {
    return { status: PATIENT_STATUS.RESPONDED, lifecycle: "quoted" };
  }
  if (
    clinicReady &&
    (status === PATIENT_STATUS.RESPONDED ||
      proposal === PROPOSAL_COORDINATOR_RESPONDED ||
      opts.coordinationHasClinicReply)
  ) {
    return { status: PATIENT_STATUS.RESPONDED, lifecycle: "responded" };
  }
  if (!clinicReady && (opts.coordinationHasClinicReply || proposal === PROPOSAL_COORDINATOR_RESPONDED)) {
    return { status: PATIENT_STATUS.WAITING, lifecycle: "awaiting_clinic_doctor" };
  }
  return { status: PATIENT_STATUS.WAITING, lifecycle: "waiting" };
}

/**
 * @param {string} requestId
 */
async function countFormalOffersForRequest(requestId) {
  if (!UUID_RE.test(requestId)) return 0;
  const { data: offers } = await supabase
    .from("treatment_offers")
    .select("id, note, price_text, price_range, is_coordination_placeholder")
    .eq("request_id", requestId);
  return (offers || []).filter((o) => !isCoordinationPlaceholderOffer(o)).length;
}

module.exports = {
  PATIENT_STATUS,
  PROPOSAL_COORDINATOR_RESPONDED,
  markTreatmentRequestResponded,
  markTreatmentRequestQuoted,
  markTreatmentRequestBooked,
  resolveTreatmentRequestRow,
  resolvePatientVisibleStatus,
  countFormalOffersForRequest,
  shouldMarkResponded,
};
