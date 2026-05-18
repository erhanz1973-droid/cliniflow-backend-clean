/**
 * Sync calendar appointments into coordinator workspace (timeline, lead flags, patient chat).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertLeadEventWithChannel } = require("./coordinatorChannelPersistence");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { ensureLeadWorkspaceForClinic, LEAD_STATUS } = require("./patientLeadLifecycle");
const { ensureCoordinationOfferForRequest } = require("./patientCoordinationChat");
const { insertClinicReplyToOfferThread } = require("./offerInboundOrchestration");
const { buildOperationalIntakeState } = require("./aiIntakeFlags");
const { listDocumentsForPatient } = require("./aiPatientDocuments");
const { emptyLeadData } = require("./leadIntelligence");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVENT_TYPES = {
  BOOKED: "appointment_booked",
  RESCHEDULED: "appointment_rescheduled",
  CANCELLED: "appointment_cancelled",
  COMPLETED: "consultation_completed",
};

const JOURNEY = {
  APPOINTMENT_SCHEDULED: "appointment_scheduled",
  WAITING_FOR_CONSULTATION: "waiting_for_consultation",
  CONSULTATION_COMPLETED: "consultation_completed",
};

const JOURNEY_LABELS = {
  [JOURNEY.APPOINTMENT_SCHEDULED]: "Appointment scheduled",
  [JOURNEY.WAITING_FOR_CONSULTATION]: "Waiting for consultation",
  [JOURNEY.CONSULTATION_COMPLETED]: "Consultation completed",
};

/**
 * @param {string|number|Date|null|undefined} value
 */
function toStartIso(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const s = String(value).trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (Number.isFinite(ts)) return new Date(ts).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T12:00:00.000Z`);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

/**
 * @param {string} iso
 * @param {string} [locale]
 */
function formatAppointmentDisplay(iso, locale = "en") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "your scheduled visit";
  try {
    const datePart = d.toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const timePart = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return `${datePart} at ${timePart}`;
  } catch {
    return d.toISOString();
  }
}

/**
 * @param {string} patientId
 */
async function resolvePatientClinicId(patientId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId)) return null;
  const { data } = await supabase.from("patients").select("clinic_id").eq("id", patientId).maybeSingle();
  const cid = data?.clinic_id ? String(data.clinic_id).trim() : "";
  return UUID_RE.test(cid) ? cid : null;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveLeadProfile(patientId, clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return null;
  const { data } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, operational_intake_flags, treatment_interest, booking_intent, preferred_language")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? data : null;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function findLatestTreatmentRequestId(patientId, clinicId) {
  if (!isSupabaseEnabled()) return null;
  const { data } = await supabase
    .from("treatment_requests")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

/**
 * @param {Record<string, unknown>} appointment
 */
function normalizeAppointmentRecord(appointment) {
  const startAt =
    toStartIso(appointment.startAt) ||
    toStartIso(appointment.start_at) ||
    toStartIso(appointment.start_time) ||
    toStartIso(appointment.scheduled_at) ||
    (appointment.date && appointment.time
      ? toStartIso(`${String(appointment.date).slice(0, 10)}T${String(appointment.time).trim()}`)
      : null) ||
    toStartIso(appointment.date);

  return {
    id: appointment.id ? String(appointment.id) : null,
    startAt,
    endAt: toStartIso(appointment.endAt || appointment.end_at) || null,
    status: String(appointment.status || "scheduled").toLowerCase(),
    treatmentLabel: String(
      appointment.treatmentLabel ||
        appointment.treatment ||
        appointment.procedure ||
        appointment.procedure_name ||
        appointment.type ||
        "Consultation",
    ).trim(),
    doctorName: appointment.doctorName || appointment.doctor_name || null,
    chair: appointment.chair || appointment.chair_no || null,
    source: String(appointment.source || "calendar").trim(),
  };
}

/**
 * @param {string} eventType
 * @param {ReturnType<typeof normalizeAppointmentRecord>} appt
 * @param {string} [locale]
 */
function buildTimelineCopy(eventType, appt, locale = "en") {
  const when = appt.startAt ? formatAppointmentDisplay(appt.startAt, locale) : "the scheduled time";
  const label = appt.treatmentLabel || "Consultation";
  switch (eventType) {
    case EVENT_TYPES.BOOKED:
      return {
        title: `${label} booked`,
        summary: `Consultation booked — ${when}`,
        patientMessage: `Your clinic appointment is confirmed for ${when}. We look forward to seeing you. If you need to change the time, message us here.`,
      };
    case EVENT_TYPES.RESCHEDULED:
      return {
        title: `${label} rescheduled`,
        summary: `Appointment moved to ${when}`,
        patientMessage: `Your appointment has been rescheduled to ${when}. Reply here if you have any questions.`,
      };
    case EVENT_TYPES.CANCELLED:
      return {
        title: `${label} cancelled`,
        summary: "Appointment cancelled",
        patientMessage:
          "Your scheduled appointment has been cancelled. Tell us when you would like to rebook and we will help you find a new time.",
      };
    case EVENT_TYPES.COMPLETED:
      return {
        title: "Consultation completed",
        summary: `Consultation completed (${when})`,
        patientMessage:
          "Thank you for visiting the clinic today. Your care team will follow up with next steps and any treatment plan details.",
      };
    default:
      return {
        title: "Appointment update",
        summary: when,
        patientMessage: `Appointment update: ${when}.`,
      };
  }
}

/**
 * @param {string} eventType
 */
function journeyStageForEvent(eventType) {
  if (eventType === EVENT_TYPES.COMPLETED) return JOURNEY.CONSULTATION_COMPLETED;
  if (eventType === EVENT_TYPES.CANCELLED) return JOURNEY.WAITING_FOR_CONSULTATION;
  return JOURNEY.APPOINTMENT_SCHEDULED;
}

/**
 * Build prompt block so AI knows an appointment exists.
 * @param {Record<string, unknown>|null|undefined} flags
 */
function buildAppointmentAwarenessPromptBlock(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const appt = f.activeAppointment && typeof f.activeAppointment === "object" ? f.activeAppointment : null;
  if (!appt?.startAt) return "";

  const when = formatAppointmentDisplay(String(appt.startAt), "en");
  const lines = [
    "ACTIVE CLINIC APPOINTMENT (operational — do NOT ask patient to book again):",
    `* ${appt.treatmentLabel || "Consultation"} scheduled for ${when}.`,
    "* Confirm logistics if asked; do not repeatedly push booking or consultation scheduling.",
    "* If patient asks to change time, offer coordinator assistance — do not invent new slots.",
  ];
  if (f.journeyStage === JOURNEY.CONSULTATION_COMPLETED) {
    lines.push("* Consultation already took place — focus on treatment plan / next steps, not re-booking intake.");
  }
  return lines.join("\n");
}

/**
 * @param {{
 *   patientId: string,
 *   clinicId?: string|null,
 *   eventType?: string,
 *   appointment: Record<string, unknown>,
 *   source?: string,
 *   sendPatientMessage?: boolean,
 *   channel?: string,
 *   locale?: string,
 * }} params
 */
async function syncAppointmentToCoordination(params) {
  const patientId = String(params.patientId || "").trim();
  let clinicId = String(params.clinicId || "").trim();
  if (!UUID_RE.test(patientId)) {
    return { ok: false, reason: "invalid_patient" };
  }
  if (!UUID_RE.test(clinicId)) {
    clinicId = (await resolvePatientClinicId(patientId)) || "";
  }
  if (!UUID_RE.test(clinicId)) {
    return { ok: false, reason: "clinic_unresolved" };
  }
  if (!isSupabaseEnabled()) {
    return { ok: false, reason: "supabase_disabled" };
  }

  const appt = normalizeAppointmentRecord({
    ...params.appointment,
    source: params.source || params.appointment?.source,
  });

  let eventType = String(params.eventType || "").trim();
  if (!eventType) {
    if (appt.status === "cancelled" || appt.status === "canceled") {
      eventType = EVENT_TYPES.CANCELLED;
    } else if (appt.status === "completed" || appt.status === "done") {
      eventType = EVENT_TYPES.COMPLETED;
    } else {
      eventType = EVENT_TYPES.BOOKED;
    }
  }

  const journeyStage = journeyStageForEvent(eventType);
  const journeyStageLabel = JOURNEY_LABELS[journeyStage] || journeyStage;
  const locale = String(params.locale || "en").slice(0, 5);
  const copy = buildTimelineCopy(eventType, appt, locale);

  await ensureLeadWorkspaceForClinic(patientId, clinicId, {
    source: params.source || "appointment_sync",
    leadStatus: eventType === EVENT_TYPES.CANCELLED ? LEAD_STATUS.INQUIRY : LEAD_STATUS.BOOKED,
  });

  const profile = await resolveLeadProfile(patientId, clinicId);
  const prevFlags =
    profile?.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};

  const activeAppointment =
    eventType === EVENT_TYPES.CANCELLED
      ? null
      : {
          id: appt.id,
          startAt: appt.startAt,
          endAt: appt.endAt,
          treatmentLabel: appt.treatmentLabel,
          status: appt.status,
          doctorName: appt.doctorName,
          updatedAt: new Date().toISOString(),
        };

  const mergedFlags = {
    ...prevFlags,
    journeyStage,
    journeyStageLabel,
    activeAppointment,
    appointmentScheduled: eventType !== EVENT_TYPES.CANCELLED && !!appt.startAt,
    waitingForConsultation:
      eventType === EVENT_TYPES.BOOKED ||
      eventType === EVENT_TYPES.RESCHEDULED ||
      journeyStage === JOURNEY.WAITING_FOR_CONSULTATION,
    lastAppointmentEvent: {
      type: eventType,
      at: new Date().toISOString(),
      startAt: appt.startAt,
    },
  };

  if (profile?.id) {
    const documents = await listDocumentsForPatient(patientId, clinicId);
    const intake = buildOperationalIntakeState({
      leadData: emptyLeadData(),
      documents,
      persistedFlags: { ...prevFlags, ...mergedFlags },
    });
    const patch = {
      operational_intake_flags: {
        ...intake,
        journeyStage,
        journeyStageLabel,
        activeAppointment,
        appointmentScheduled: mergedFlags.appointmentScheduled,
        waitingForConsultation: mergedFlags.waitingForConsultation,
        lastAppointmentEvent: mergedFlags.lastAppointmentEvent,
      },
      booking_intent: eventType === EVENT_TYPES.CANCELLED ? profile.booking_intent || "medium" : "high",
      updated_at: new Date().toISOString(),
    };
    if (appt.startAt && eventType !== EVENT_TYPES.CANCELLED) {
      patch.last_channel_message_at = new Date().toISOString();
    }
    await supabase.from("ai_coordinator_lead_profiles").update(patch).eq("id", profile.id);

    const eventMeta = {
      appointmentId: appt.id,
      startAt: appt.startAt,
      treatmentLabel: appt.treatmentLabel,
      status: appt.status,
      source: params.source || appt.source,
      title: copy.title,
      summary: copy.summary,
    };

    const channel = params.channel || "in_app";
    await insertLeadEventWithChannel({
      profile_id: profile.id,
      event_type: eventType,
      event_metadata: eventMeta,
      channel,
      message_role: "system",
      patient_message: null,
      ai_reply: copy.summary,
    });

    if (prevFlags.journeyStage !== journeyStage) {
      void insertTimelineEvent({
        profileId: profile.id,
        eventType: "intake_journey_updated",
        eventMetadata: {
          from: prevFlags.journeyStage || null,
          to: journeyStage,
          reason: eventType,
        },
        channel,
      });
    }
  }

  if (eventType !== EVENT_TYPES.CANCELLED) {
    const { setTreatmentRequestsLeadStatusForPatientClinic } = require("./patientLeadLifecycle");
    await setTreatmentRequestsLeadStatusForPatientClinic(patientId, clinicId, LEAD_STATUS.BOOKED);
    const requestId = await findLatestTreatmentRequestId(patientId, clinicId);
    if (requestId) {
      const { markTreatmentRequestBooked } = require("./treatmentRequestLifecycle");
      await markTreatmentRequestBooked(requestId);
    }
  }

  if (params.sendPatientMessage !== false && copy.patientMessage) {
    try {
      const requestId = await findLatestTreatmentRequestId(patientId, clinicId);
      if (requestId) {
        const coord = await ensureCoordinationOfferForRequest(requestId, { createIfMissing: true });
        if (coord.ok && coord.offerId) {
          await insertClinicReplyToOfferThread({
            offerId: coord.offerId,
            message: copy.patientMessage,
            clinicId,
          });
        }
      }
    } catch (e) {
      console.warn("[appointmentCoordination] patient message:", e?.message || e);
    }
  }

  console.log("[appointmentCoordination] synced", {
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    eventType,
    startAt: appt.startAt,
    profileId: profile?.id ? String(profile.id).slice(0, 8) : null,
  });

  return {
    ok: true,
    eventType,
    journeyStage,
    profileId: profile?.id || null,
    copy,
  };
}

/**
 * @param {{
 *   patientId: string,
 *   clinicId?: string|null,
 *   scheduledAt: string|number|Date,
 *   treatmentLabel?: string,
 *   appointmentId?: string|null,
 *   source?: string,
 *   previousScheduledAt?: string|null,
 *   sendPatientMessage?: boolean,
 * }} params
 */
async function syncAppointmentFromProcedureSchedule(params) {
  const startAt = toStartIso(params.scheduledAt);
  if (!startAt || !UUID_RE.test(String(params.patientId || ""))) return { ok: false, reason: "no_schedule" };

  const prev = toStartIso(params.previousScheduledAt);
  let eventType = EVENT_TYPES.BOOKED;
  if (prev && prev !== startAt) eventType = EVENT_TYPES.RESCHEDULED;

  return syncAppointmentToCoordination({
    patientId: params.patientId,
    clinicId: params.clinicId,
    eventType,
    appointment: {
      id: params.appointmentId,
      startAt,
      treatmentLabel: params.treatmentLabel || "Consultation",
      status: "scheduled",
      source: params.source || "treatment_schedule",
    },
    source: params.source || "treatment_schedule",
    sendPatientMessage: params.sendPatientMessage,
  });
}

/**
 * @param {string} patientId
 * @param {string} [clinicId]
 */
async function listPatientCoordinationTimelineItems(patientId, clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId)) return [];

  let cid = clinicId && UUID_RE.test(clinicId) ? clinicId : await resolvePatientClinicId(patientId);
  if (!cid) return [];

  const profile = await resolveLeadProfile(patientId, cid);
  if (!profile?.id) return [];

  const flags =
    profile.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};

  const items = [];
  const appt = flags.activeAppointment;
  if (appt && typeof appt === "object" && appt.startAt) {
    const iso = String(appt.startAt);
    items.push({
      id: `coord_appt_${profile.id}`,
      patient_id: patientId,
      type: "appointment",
      title: appt.treatmentLabel ? `${appt.treatmentLabel} — confirmed` : "Clinic appointment confirmed",
      description: formatAppointmentDisplay(iso, "en"),
      start_date: iso,
      end_date: appt.endAt || null,
      metadata: { coordination: true, ...appt },
      created_at: appt.updatedAt || new Date().toISOString(),
    });
  }

  const { data: events } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id, event_type, event_metadata, created_at, ai_reply")
    .eq("profile_id", profile.id)
    .in("event_type", [
      EVENT_TYPES.BOOKED,
      EVENT_TYPES.RESCHEDULED,
      EVENT_TYPES.CANCELLED,
      EVENT_TYPES.COMPLETED,
    ])
    .order("created_at", { ascending: false })
    .limit(20);

  for (const row of events || []) {
    const meta =
      row.event_metadata && typeof row.event_metadata === "object" ? row.event_metadata : {};
    const startAt = meta.startAt ? String(meta.startAt) : null;
    items.push({
      id: `coord_evt_${row.id}`,
      patient_id: patientId,
      type: "appointment",
      title: meta.title || row.event_type || "Appointment",
      description: meta.summary || row.ai_reply || null,
      start_date: startAt,
      end_date: null,
      metadata: { coordination: true, eventType: row.event_type, ...meta },
      created_at: row.created_at || new Date().toISOString(),
    });
  }

  return items;
}

/**
 * Best-effort insert into appointments table (schema varies by clinic).
 * @param {Record<string, unknown>} row
 */
async function persistAppointmentRow(row) {
  if (!isSupabaseEnabled()) return { ok: false, reason: "supabase_disabled" };

  const patientId = String(row.patient_id || row.patientId || "").trim();
  const clinicId = String(row.clinic_id || row.clinicId || "").trim();
  const startAt = toStartIso(row.start_at || row.startAt || row.start_time);
  if (!UUID_RE.test(patientId) || !startAt) {
    return { ok: false, reason: "invalid_row" };
  }

  const date = startAt.slice(0, 10);
  const time = startAt.slice(11, 16);
  const payloads = [
    {
      patient_id: patientId,
      clinic_id: UUID_RE.test(clinicId) ? clinicId : undefined,
      start_time: startAt,
      start_at: startAt,
      date,
      time,
      procedure: row.procedure || row.treatment || "Consultation",
      status: String(row.status || "scheduled").toUpperCase(),
      duration_minutes: row.duration_minutes || 30,
      notes: row.notes || null,
    },
    {
      patient_id: patientId,
      clinic_id: UUID_RE.test(clinicId) ? clinicId : undefined,
      startTime: startAt,
      date,
      time,
      procedure: row.procedure || "Consultation",
      status: "SCHEDULED",
    },
  ];

  for (const payload of payloads) {
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    const { data, error } = await supabase.from("appointments").insert(clean).select("id").single();
    if (!error && data?.id) {
      return { ok: true, id: data.id, startAt };
    }
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("schema cache") || msg.includes("does not exist")) {
      return { ok: false, reason: "appointments_table_unavailable", message: error?.message };
    }
  }

  return { ok: false, reason: "insert_failed" };
}

module.exports = {
  EVENT_TYPES,
  JOURNEY,
  JOURNEY_LABELS,
  toStartIso,
  formatAppointmentDisplay,
  normalizeAppointmentRecord,
  buildAppointmentAwarenessPromptBlock,
  syncAppointmentToCoordination,
  syncAppointmentFromProcedureSchedule,
  listPatientCoordinationTimelineItems,
  persistAppointmentRow,
  resolvePatientClinicId,
};
