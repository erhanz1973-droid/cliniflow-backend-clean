/**
 * Event-driven operational projection for Coordination Center.
 * Aggregates profile row + intake flags + timeline hints into a live mission-control DTO.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { computeSla } = require("./aiCoordinatorWorkspace");
const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const { isCoordinationPlaceholderOffer } = require("./patientCoordinationChat");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Canonical operational statuses for coordinator UI. */
const OPERATIONAL_STATUS = {
  WAITING_FOR_PATIENT: "waiting_for_patient",
  WAITING_FOR_XRAY: "waiting_for_xray",
  WAITING_FOR_PHOTOS: "waiting_for_photos",
  WAITING_FOR_QUOTE: "waiting_for_quote",
  WAITING_FOR_CLINIC: "waiting_for_clinic_reply",
  COORDINATOR_RESPONDED: "coordinator_responded",
  QUOTE_SENT: "quote_sent",
  APPOINTMENT_BOOKED: "appointment_booked",
  CONSULTATION_SCHEDULED: "consultation_scheduled",
  AI_UNRESOLVED: "ai_unresolved",
  FOLLOW_UP_NEEDED: "follow_up_needed",
  TRAVEL_PENDING: "travel_pending",
  HUMAN_TAKEOVER: "human_takeover",
  MISSING_DOCUMENTS: "missing_documents",
  IN_PROGRESS: "in_progress",
};

const STATUS_LABELS = {
  waiting_for_patient: "Waiting on patient",
  waiting_for_xray: "Waiting on X-ray",
  waiting_for_photos: "Waiting on photos",
  waiting_for_quote: "Waiting for treatment estimate",
  waiting_for_clinic_reply: "Waiting on clinic reply",
  coordinator_responded: "Clinic engaged",
  quote_sent: "Quote sent",
  appointment_booked: "Appointment booked",
  consultation_scheduled: "Consultation scheduled",
  ai_unresolved: "Needs coordinator review",
  follow_up_needed: "Follow-up needed",
  travel_pending: "Travel coordination",
  human_takeover: "Human coordinator",
  missing_documents: "Missing documents",
  in_progress: "In progress",
};

/**
 * @param {Record<string, unknown>} flags
 * @param {Record<string, unknown>} lead
 */
function deriveOperationalStatus(flags, lead) {
  const f = flags || {};
  const journey = String(f.journeyStage || "").toLowerCase();
  const ps = String(f.proposalStatus || "").toLowerCase();
  const leadSt = String(f.leadStatus || "").toLowerCase();
  const sla = lead.sla || computeSla(lead);

  if (leadSt === "booked" || journey === "appointment_scheduled" || f.appointmentScheduled === true) {
    return OPERATIONAL_STATUS.APPOINTMENT_BOOKED;
  }
  if (journey === "waiting_for_consultation" || f.waitingForConsultation === true) {
    return OPERATIONAL_STATUS.CONSULTATION_SCHEDULED;
  }
  if (ps === "quote_sent" || f.hasFormalOffer === true) {
    return OPERATIONAL_STATUS.QUOTE_SENT;
  }
  if (lead.aiEscalationRequired || lead.aiUnresolved) {
    return OPERATIONAL_STATUS.AI_UNRESOLVED;
  }
  if (String(lead.followUpStatus || "").toLowerCase() === "pending" || f.followUpNeeded === true) {
    return OPERATIONAL_STATUS.FOLLOW_UP_NEEDED;
  }
  const missingDocs =
    f.missingXray ||
    f.missingSmilePhotos ||
    f.missingTravelTimeline ||
    f.missingTreatmentPreference;
  if (missingDocs && (journey === "awaiting_xray" || journey === "awaiting_photos" || f.missingXray || f.missingSmilePhotos)) {
    return OPERATIONAL_STATUS.MISSING_DOCUMENTS;
  }
  if (f.missingXray || journey === "awaiting_xray") {
    return OPERATIONAL_STATUS.WAITING_FOR_XRAY;
  }
  if (f.missingSmilePhotos || journey === "awaiting_photos") {
    return OPERATIONAL_STATUS.WAITING_FOR_PHOTOS;
  }
  if (
    (lead.travelTimeline || f.travelTimeline) &&
    !f.appointmentScheduled &&
    journey !== "appointment_scheduled"
  ) {
    return OPERATIONAL_STATUS.TRAVEL_PENDING;
  }
  if (
    f.treatmentRequestId &&
    ["waiting_for_quote", "quote_in_progress", "doctor_review_required", "ready_to_send", "proposal_pending"].includes(ps)
  ) {
    return OPERATIONAL_STATUS.WAITING_FOR_QUOTE;
  }
  if (ps === "coordinator_responded" || f.firstClinicResponseAt) {
    return OPERATIONAL_STATUS.COORDINATOR_RESPONDED;
  }
  if (sla.isWaiting1h || sla.isWaiting4h) {
    return OPERATIONAL_STATUS.WAITING_FOR_CLINIC;
  }
  if (f.missingTreatmentPreference || f.missingTravelTimeline) {
    return OPERATIONAL_STATUS.WAITING_FOR_PATIENT;
  }
  if (lead.coordinationMode === COORDINATION_HUMAN) {
    const lp = sla.lastPatientMessageAt;
    const lh = sla.lastHumanReplyAt;
    if (lp && (!lh || new Date(lp) > new Date(lh))) {
      return OPERATIONAL_STATUS.WAITING_FOR_CLINIC;
    }
    return OPERATIONAL_STATUS.HUMAN_TAKEOVER;
  }
  return OPERATIONAL_STATUS.IN_PROGRESS;
}

/**
 * @param {string} profileId
 */
async function fetchLatestTimelinePreview(profileId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) return null;
  const { data } = await supabase
    .from("ai_coordinator_lead_events")
    .select("event_type, patient_message, ai_reply, event_metadata, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(8);

  for (const ev of data || []) {
    const ai = String(ev.ai_reply || "").trim();
    if (ai) {
      return {
        text: ai.slice(0, 280),
        at: ev.created_at,
        role: "clinic",
        source: ev.event_type || "ai_reply",
      };
    }
    const pm = String(ev.patient_message || "").trim();
    if (pm) {
      return {
        text: pm.slice(0, 280),
        at: ev.created_at,
        role: "patient",
        source: ev.event_type || "patient_turn",
      };
    }
    const meta =
      ev.event_metadata && typeof ev.event_metadata === "object" ? ev.event_metadata : {};
    if (meta.kind === "treatment_request_created") {
      return {
        text: "Treatment quote request submitted",
        at: ev.created_at,
        role: "system",
        source: "treatment_request_created",
      };
    }
    if (meta.title) {
      return {
        text: String(meta.title).slice(0, 200),
        at: ev.created_at,
        role: "system",
        source: ev.event_type,
      };
    }
  }
  return null;
}

/**
 * @param {string} requestId
 */
async function fetchOfferThreadPreview(requestId) {
  if (!UUID_RE.test(requestId)) return null;
  const { data: offers } = await supabase
    .from("treatment_offers")
    .select("id, note")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  const real = (offers || []).filter((o) => !isCoordinationPlaceholderOffer(o));
  const coord = (offers || []).find((o) => isCoordinationPlaceholderOffer(o));
  const offerId = (real[0] || coord)?.id;
  if (!offerId) return { formalOfferCount: real.length };

  const { data: msgs } = await supabase
    .from("offer_messages")
    .select("text, sender_role, created_at")
    .eq("offer_id", offerId)
    .order("created_at", { ascending: false })
    .limit(5);

  const latest = (msgs || []).find((m) => String(m.text || "").trim());
  return {
    formalOfferCount: real.length,
    latestMessage: latest
      ? {
          text: String(latest.text).trim().slice(0, 280),
          at: latest.created_at,
          role: String(latest.sender_role || "unknown"),
        }
      : null,
    coordinationOfferId: String(offerId),
  };
}

/**
 * @param {unknown} raw
 * @param {{ role?: string, at?: string|null }} [defaults]
 */
function normalizeMessagePreview(raw, defaults = {}) {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null && "text" in raw) {
    return {
      text: String(raw.text || "").trim().slice(0, 280),
      role: String(raw.role || defaults.role || "unknown"),
      at: raw.at || defaults.at || null,
    };
  }
  const text = String(raw).trim();
  if (!text) return null;
  return {
    text: text.slice(0, 280),
    role: defaults.role || "clinic",
    at: defaults.at || null,
  };
}

/**
 * Build projection DTO for admin UI.
 * @param {Record<string, unknown>} lead — enriched lead (mapProfileRow + enrichLeadRow)
 * @param {{ timelinePreview?: object|null, offerPreview?: object|null }} [ctx]
 */
function buildCoordinationProjection(lead, ctx = {}) {
  const flags =
    lead.operationalIntakeFlags && typeof lead.operationalIntakeFlags === "object"
      ? lead.operationalIntakeFlags
      : {};

  const operationalStatus = deriveOperationalStatus(flags, lead);
  const timeline = normalizeMessagePreview(ctx.timelinePreview || flags.latestMessagePreview, {
    role: flags.latestMessageRole,
    at: flags.latestMessageAt,
  });
  const offerCtx = ctx.offerPreview || {};

  let latestMessage =
    normalizeMessagePreview(offerCtx.latestMessage) ||
    timeline ||
    (lead.lastPatientMessage
      ? { text: String(lead.lastPatientMessage).slice(0, 280), role: "patient", at: lead.lastPatientMessageAt }
      : null);

  if (!latestMessage && lead.conversationSummary) {
    latestMessage = {
      text: String(lead.conversationSummary).slice(0, 200),
      role: "summary",
      at: lead.updatedAt,
    };
  }

  const appt = flags.activeAppointment && typeof flags.activeAppointment === "object"
    ? flags.activeAppointment
    : null;

  return {
    operationalStatus,
    operationalStatusLabel: STATUS_LABELS[operationalStatus] || operationalStatus,
    latestMessagePreview: latestMessage?.text || null,
    latestMessageRole: latestMessage?.role || null,
    latestMessageAt: latestMessage?.at || null,
    blocker: lead.blockingReason || flags.blockingReason || null,
    nextStep: lead.nextAction || flags.nextStep || null,
    waitingParty: lead.waitingParty || flags.waitingParty || null,
    sla: lead.sla || null,
    assignedCoordinatorId: lead.assignedCoordinatorId || null,
    assignedDoctorId: lead.assignedDoctorId || null,
    aiStatusLabel: lead.aiStatusLabel || lead.delegation?.statusLabel || null,
    aiMode: lead.aiMode || null,
    aiPaused: lead.aiPaused === true,
    aiEscalationRequired: lead.aiEscalationRequired === true,
    responderMode: lead.responderMode || null,
    responderModeLabel: lead.responderModeLabel || null,
    primaryResponderLabel: lead.primaryResponderLabel || null,
    handlingState: lead.handlingState || null,
    handlingStateLabel: lead.handlingStateLabel || null,
    needsTakeover: lead.needsTakeover === true,
    appointmentStatus: appt?.startAt ? "scheduled" : flags.appointmentScheduled ? "scheduled" : null,
    appointmentStartAt: appt?.startAt || flags.appointmentStartAt || null,
    treatmentRequestId: flags.treatmentRequestId || null,
    proposalStatus: flags.proposalStatus || null,
    formalOfferCount: offerCtx.formalOfferCount ?? flags.formalOfferCount ?? 0,
    coordinationOfferId: offerCtx.coordinationOfferId || flags.coordinationOfferId || null,
    hasWhatsapp: !!(lead.whatsappNumber || lead.whatsapp_number || flags.hasWhatsapp),
    whatsappMissing:
      !(lead.whatsappNumber || lead.whatsapp_number || flags.hasWhatsapp) &&
      String(lead.whatsappCollectionStage || lead.whatsapp_collection_stage || "").toLowerCase() !==
        "declined",
    preferredContactChannel: lead.preferredContactChannel || lead.primaryChannel || "in_app",
    projectedAt: new Date().toISOString(),
  };
}

/**
 * Persist projection into operational_intake_flags (merge).
 * @param {string} profileId
 * @param {Record<string, unknown>} [opts]
 */
async function projectCoordinationState(profileId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) {
    return { ok: false, reason: "invalid_profile" };
  }

  const { data: row, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, treatment_interest, country, preferred_language, urgency, booking_intent, lead_score, is_hot, message_count, coordination_mode, ai_mode, ai_paused, ai_escalation_required, ai_unresolved, follow_up_status, assigned_coordinator_id, assigned_doctor_id, last_patient_message, last_patient_message_at, last_human_reply_at, last_ai_reply_at, last_channel_message_at, escalation_flags, conversation_summary, operational_intake_flags, updated_at",
    )
    .eq("id", profileId)
    .maybeSingle();

  if (error || !row?.id) {
    return { ok: false, reason: error?.message || "not_found" };
  }

  const flags =
    row.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? row.operational_intake_flags
      : {};

  const leadStub = {
    ...row,
    operationalIntakeFlags: flags,
    sla: computeSla(row),
    coordinationMode: row.coordination_mode,
    aiMode: row.ai_mode,
    aiPaused: row.ai_paused,
    aiEscalationRequired: row.ai_escalation_required,
    aiUnresolved: row.ai_unresolved,
    followUpStatus: row.follow_up_status,
    assignedCoordinatorId: row.assigned_coordinator_id,
    assignedDoctorId: row.assigned_doctor_id,
    lastPatientMessage: row.last_patient_message,
    lastPatientMessageAt: row.last_patient_message_at,
    conversationSummary: row.conversation_summary,
    escalationFlags: row.escalation_flags,
    updatedAt: row.updated_at,
  };

  const requestId = String(flags.treatmentRequestId || opts.treatmentRequestId || "").trim();
  const [timelinePreview, offerPreview] = await Promise.all([
    fetchLatestTimelinePreview(profileId),
    requestId ? fetchOfferThreadPreview(requestId) : Promise.resolve(null),
  ]);

  const projection = buildCoordinationProjection(leadStub, {
    timelinePreview,
    offerPreview: offerPreview || {},
  });

  const mergedFlags = {
    ...flags,
    operationalStatus: projection.operationalStatus,
    operationalStatusLabel: projection.operationalStatusLabel,
    latestMessagePreview: projection.latestMessagePreview,
    latestMessageRole: projection.latestMessageRole,
    latestMessageAt: projection.latestMessageAt,
    blockingReason: projection.blocker,
    nextStep: projection.nextStep,
    waitingParty: projection.waitingParty,
    formalOfferCount: projection.formalOfferCount,
    coordinationOfferId: projection.coordinationOfferId || flags.coordinationOfferId,
    hasFormalOffer: projection.formalOfferCount > 0,
    hasWhatsapp: projection.hasWhatsapp === true,
    whatsappMissing: projection.whatsappMissing === true,
    preferredContactChannel: projection.preferredContactChannel || null,
    projectionUpdatedAt: projection.projectedAt,
  };

  if (offerPreview?.formalOfferCount != null) {
    mergedFlags.formalOfferCount = offerPreview.formalOfferCount;
  }

  const { error: updErr } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: mergedFlags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);

  if (updErr) {
    console.warn("[coordinationProjection] persist:", updErr.message);
    return { ok: false, reason: updErr.message };
  }

  return { ok: true, projection, operationalIntakeFlags: mergedFlags };
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
async function attachPatientNamesToProfileRows(rows) {
  if (!rows?.length || !isSupabaseEnabled()) return rows;
  const ids = [...new Set(rows.map((r) => r.patient_id).filter((id) => UUID_RE.test(String(id))))];
  if (!ids.length) return rows;

  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, name, first_name, last_name, email, phone")
    .in("id", ids);

  const byId = new Map((patients || []).map((p) => [String(p.id), p]));
  return rows.map((row) => ({
    ...row,
    patients: byId.get(String(row.patient_id)) || null,
  }));
}

/**
 * @param {Record<string, unknown>} lead
 * @param {Record<string, unknown>} projection
 */
function attachProjectionToLead(lead, projection) {
  return {
    ...lead,
    operationalProjection: projection,
    operationalStatus: projection.operationalStatus,
    operationalStatusLabel: projection.operationalStatusLabel,
    latestMessagePreview: projection.latestMessagePreview || lead.latestMessagePreview,
    latestMessageAt: projection.latestMessageAt,
    latestMessageRole: projection.latestMessageRole,
    appointmentStatus: projection.appointmentStatus || lead.appointmentStatus,
    appointmentStartAt: projection.appointmentStartAt || lead.appointmentStartAt,
    proposalStatus: projection.proposalStatus || lead.proposalStatus,
    blockingReason: lead.blockingReason || projection.blocker || null,
    nextAction: lead.nextAction || projection.nextStep || null,
  };
}

module.exports = {
  OPERATIONAL_STATUS,
  STATUS_LABELS,
  normalizeMessagePreview,
  deriveOperationalStatus,
  buildCoordinationProjection,
  projectCoordinationState,
  fetchLatestTimelinePreview,
  fetchOfferThreadPreview,
  attachPatientNamesToProfileRows,
  attachProjectionToLead,
};
