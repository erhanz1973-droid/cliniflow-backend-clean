/**
 * Treatment / quote request → operational coordination (lead workspace + offer thread + AI).
 * A quote request starts a coordination conversation — not a silent DB row.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { ensureCoordinationOfferForRequest } = require("./patientCoordinationChat");
const { ensureLeadWorkspaceForClinic, LEAD_STATUS } = require("./patientLeadLifecycle");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { initProposalOnRequestCreate } = require("./treatmentProposalWorkflow");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((table: string, row: object, select?: string) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertWithPruningFn = null;

/**
 * @param {{ insertIntoTableWithColumnPruning?: typeof insertWithPruningFn }} deps
 */
function setupTreatmentRequestOrchestration(deps) {
  insertWithPruningFn = deps.insertIntoTableWithColumnPruning || null;
}

/**
 * @param {string} text
 */
function summarizeForChat(text) {
  const raw = String(text || "").trim();
  if (!raw) return "Treatment quote request";
  const withoutPhotos = raw.replace(/\n+--- Photo ---[\s\S]*/i, "").trim();
  const withoutAnalysis = withoutPhotos
    .replace(/\n+--- AI analysis \(summary\) ---[\s\S]*/i, "")
    .trim();
  const body = withoutAnalysis || withoutPhotos || raw;
  return body.length > 2000 ? `${body.slice(0, 1997)}…` : body;
}

/**
 * @param {{
 *   offerId: string,
 *   patientId: string,
 *   message: string,
 *   patientName?: string|null,
 * }} params
 */
async function insertPatientQuoteAnchorToOfferThread(params) {
  const offerId = String(params.offerId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const message = summarizeForChat(params.message);
  if (!UUID_RE.test(offerId) || !UUID_RE.test(patientId) || !message) {
    return { inserted: false, reason: "invalid_params" };
  }

  const { data: recent } = await supabase
    .from("offer_messages")
    .select("id, sender_role, text, created_at")
    .eq("offer_id", offerId)
    .order("created_at", { ascending: false })
    .limit(3);

  const dup = (recent || []).find(
    (r) =>
      String(r.sender_role || "").toLowerCase() === "patient" &&
      String(r.text || "").trim() === message,
  );
  if (dup?.id) {
    return { inserted: false, reason: "duplicate_anchor", messageId: String(dup.id) };
  }

  let senderName = String(params.patientName || "").trim() || "Patient";
  if (!params.patientName) {
    const { data: prow } = await supabase
      .from("patients")
      .select("name, full_name")
      .eq("id", patientId)
      .maybeSingle();
    senderName = String(prow?.full_name || prow?.name || "").trim() || "Patient";
  }

  const insertRow = {
    offer_id: offerId,
    sender_id: patientId,
    sender_role: "patient",
    sender_name: senderName,
    text: message,
    attachment_url: null,
    attachment_type: null,
    created_at: new Date().toISOString(),
  };

  if (insertWithPruningFn) {
    const { data, error } = await insertWithPruningFn("offer_messages", insertRow, "*");
    if (!error && data) {
      return { inserted: true, messageId: String(data.id || "") };
    }
    if (error) {
      console.warn("[treatmentRequestOrchestration] anchor insert:", error.message || error);
    }
  }

  const { data, error } = await supabase.from("offer_messages").insert(insertRow).select("id").single();
  if (error) {
    console.warn("[treatmentRequestOrchestration] anchor insert fallback:", error.message);
    return { inserted: false, reason: "insert_failed" };
  }
  return { inserted: true, messageId: data?.id ? String(data.id) : null };
}

/**
 * @param {string} profileId
 * @param {string} requestId
 * @param {string|null} offerId
 */
async function recordTreatmentRequestCreatedEvent(profileId, requestId, offerId) {
  if (!UUID_RE.test(profileId)) return;
  await insertTimelineEvent({
    profileId,
    eventType: "system",
    eventMetadata: {
      kind: "treatment_request_created",
      treatmentRequestId: requestId,
      offerId: offerId || null,
      orchestration: "quote_request_workspace",
    },
    channel: "coordinator",
  }).catch((e) => {
    console.warn("[treatmentRequestOrchestration] timeline:", e?.message || e);
  });
}

/**
 * Full orchestration after POST /api/patient/treatment-requests.
 * @param {{
 *   requestRow: { id: string, patient_id: string, clinic_id: string, description?: string|null, preferred_treatment?: string|null },
 *   patientMessage?: string|null,
 *   skipProposalInit?: boolean,
 * }} params
 */
async function orchestrateTreatmentRequestCreated(params) {
  if (!isSupabaseEnabled()) {
    return { ok: false, reason: "supabase_disabled" };
  }

  const row = params.requestRow || {};
  const requestId = String(row.id || "").trim();
  const patientId = String(row.patient_id || "").trim();
  const clinicId = String(row.clinic_id || "").trim();
  const patientMessage = summarizeForChat(
    params.patientMessage || row.description || row.preferred_treatment || "",
  );

  if (!UUID_RE.test(requestId) || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, reason: "invalid_ids" };
  }

  console.log("[treatmentRequestOrchestration] start", {
    requestId: requestId.slice(0, 8),
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
  });

  if (!params.skipProposalInit) {
    await initProposalOnRequestCreate({
      id: requestId,
      clinic_id: clinicId,
      patient_id: patientId,
    }).catch((e) => console.warn("[treatmentRequestOrchestration] proposal init:", e?.message || e));
  }

  await ensureLeadWorkspaceForClinic(patientId, clinicId, {
    source: "quote_request",
    leadStatus: LEAD_STATUS.INQUIRY,
    treatmentRequestId: requestId,
  });

  const coord = await ensureCoordinationOfferForRequest(requestId, { createIfMissing: true });
  const offerId = coord.ok && coord.offerId ? String(coord.offerId) : null;

  if (!coord.ok) {
    console.warn("[treatmentRequestOrchestration] coordination offer unavailable", {
      requestId: requestId.slice(0, 8),
      reason: coord.reason,
    });
  }

  let anchor = { inserted: false };
  if (offerId) {
    anchor = await insertPatientQuoteAnchorToOfferThread({
      offerId,
      patientId,
      message: patientMessage,
    });
  }

  const { data: profileRow } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (profileRow?.id) {
    await recordTreatmentRequestCreatedEvent(profileRow.id, requestId, offerId);
  }

  const { afterPatientInboundMessage } = require("./aiSlaContinuity");
  await afterPatientInboundMessage({
    patientId,
    clinicId,
    patientMessage,
    source: "quote_request",
    contextMode: "coordinator",
    offerId,
    treatmentRequestId: requestId,
    preferOfferThread: Boolean(offerId),
  });

  console.log("[treatmentRequestOrchestration] complete", {
    requestId: requestId.slice(0, 8),
    offerId: offerId ? offerId.slice(0, 8) : null,
    anchorInserted: anchor.inserted,
    profileId: profileRow?.id ? String(profileRow.id).slice(0, 8) : null,
  });

  if (profileRow?.id) {
    const { projectCoordinationState } = require("./coordinationProjection");
    void projectCoordinationState(profileRow.id).catch((e) =>
      console.warn("[treatmentRequestOrchestration] project:", e?.message || e),
    );
  }

  return {
    ok: true,
    requestId,
    offerId,
    coordination: coord,
    anchorInserted: anchor.inserted,
    profileId: profileRow?.id || null,
  };
}

module.exports = {
  setupTreatmentRequestOrchestration,
  orchestrateTreatmentRequestCreated,
  insertPatientQuoteAnchorToOfferThread,
  summarizeForChat,
};
