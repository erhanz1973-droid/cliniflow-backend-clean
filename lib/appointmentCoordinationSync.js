/**
 * Sync calendar appointments into coordinator workspace (timeline, lead flags, patient chat).
 */

const crypto = require("crypto");
const { formatInTimeZone } = require("date-fns-tz");
const { supabase, isSupabaseEnabled, insertIntoTableWithColumnPruning } = require("./supabase");
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

/** Admin calendar primary source (same as doctor POST /api/patient/:id/treatments → encounter_treatments). */
const AI_BOOKING_PROCEDURE_TYPE = "CONSULTATION";
const AI_BOOKING_DEFAULT_TOOTH = 11;

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
 * @param {string} [timeZone] IANA timezone for clinic-local display
 */
function formatAppointmentDisplay(iso, locale = "en", timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "your scheduled visit";
  const tz = String(timeZone || "").trim() || undefined;
  try {
    const datePart = d.toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(tz ? { timeZone: tz } : {}),
    });
    const timePart = d.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      ...(tz ? { timeZone: tz } : {}),
    });
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
  const isPending =
    String(appt.status || "").toLowerCase() === "pending" || appt.pendingStaffApproval === true;
  const lines = [
    isPending
      ? "PENDING CLINIC APPOINTMENT (AI draft — staff must still approve):"
      : "ACTIVE CLINIC APPOINTMENT (operational — do NOT ask patient to book again):",
    isPending
      ? `* ${appt.treatmentLabel || "Consultation"} requested for ${when} — pending clinic confirmation.`
      : `* ${appt.treatmentLabel || "Consultation"} scheduled for ${when}.`,
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
 * Build insert payloads for admin calendar tables (schema varies per clinic).
 * @param {Record<string, unknown>} row
 * @param {{ timezone?: string, patientName?: string|null }} ctx
 */
function buildCalendarAppointmentPayloads(row, ctx = {}) {
  const patientId = String(row.patient_id || row.patientId || "").trim();
  const clinicId = String(row.clinic_id || row.clinicId || "").trim();
  const startAt = toStartIso(row.start_at || row.startAt || row.start_time);
  if (!UUID_RE.test(patientId) || !startAt) return { ok: false, reason: "invalid_row" };

  const tz = String(row.timezone || ctx.timezone || "Europe/Istanbul").trim() || "Europe/Istanbul";
  const date = formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd");
  const time = formatInTimeZone(new Date(startAt), tz, "HH:mm");
  const procedure = String(row.procedure || row.treatment || "Consultation").trim() || "Consultation";
  const rawStatus = String(row.status || "pending").toLowerCase();
  const statusUpper = rawStatus === "scheduled" ? "SCHEDULED" : "PENDING";
  const duration = Number(row.duration_minutes) || 30;
  const patientName = ctx.patientName ? String(ctx.patientName).trim() : null;
  const doctorId = UUID_RE.test(String(row.doctor_id || row.assigned_doctor_id || "").trim())
    ? String(row.doctor_id || row.assigned_doctor_id || "").trim()
    : null;
  const chairNoRaw = row.chair_no ?? row.chair ?? null;
  const chairNo = chairNoRaw == null ? null : String(chairNoRaw).trim() || null;
  const appointmentType = String(row.appointment_type || "consultation").trim() || "consultation";

  const shared = {
    patient_id: patientId,
    clinic_id: UUID_RE.test(clinicId) ? clinicId : undefined,
    date,
    appointment_date: date,
    time,
    appointment_time: time,
    procedure,
    treatment: procedure,
    procedure_name: procedure,
    appointment_type: appointmentType,
    type: procedure,
    service: procedure,
    duration_minutes: duration,
    notes: row.notes || null,
    source: row.source || "ai_booking",
    ...(doctorId ? { doctor_id: doctorId, assigned_doctor_id: doctorId, created_by_doctor_id: doctorId } : {}),
    ...(chairNo ? { chair_no: chairNo, chair: chairNo } : {}),
    ...(patientName ? { patient_name: patientName, patientName } : {}),
  };

  const variants = [
    { ...shared, start_at: startAt, start_time: startAt, status: rawStatus },
    { ...shared, start_at: startAt, start_time: startAt, status: statusUpper },
    { ...shared, startTime: startAt, startAt, status: statusUpper },
    { ...shared, starts_at: startAt, status: statusUpper },
    {
      patient_id: patientId,
      clinic_id: UUID_RE.test(clinicId) ? clinicId : undefined,
      start_time: startAt,
      start_at: startAt,
      status: statusUpper,
      procedure,
      ...(doctorId ? { doctor_id: doctorId } : {}),
      ...(chairNo ? { chair_no: chairNo } : {}),
    },
  ];

  return { ok: true, startAt, date, time, tz, variants };
}

/**
 * @param {string} rawStatus
 */
function mapAiBookingStatusToEncounterTreatment(rawStatus) {
  const s = String(rawStatus || "").toLowerCase();
  if (s === "scheduled" || s === "confirmed") return "scheduled";
  if (s === "pending" || s === "draft") return "planned";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "planned";
}

/**
 * @param {string} patientUuid
 * @param {string} clinicId
 */
async function ensureEncounterForAiBooking(patientUuid, clinicId) {
  const { data: encList } = await supabase
    .from("patient_encounters")
    .select("id")
    .eq("patient_id", patientUuid)
    .order("created_at", { ascending: false })
    .limit(1);
  if (encList?.[0]?.id) return String(encList[0].id);

  /** @type {Record<string, unknown>} */
  const insert = {
    patient_id: patientUuid,
    encounter_type: "ai_booking",
    status: "draft",
  };
  if (UUID_RE.test(clinicId)) insert.clinic_id = clinicId;

  const { data: newEnc, error } = await supabase
    .from("patient_encounters")
    .insert(insert)
    .select("id")
    .single();
  if (error) {
    console.warn("[persistEncounterTreatment] encounter create:", error.message);
    return null;
  }
  return newEnc?.id ? String(newEnc.id) : null;
}

/**
 * @param {string} clinicId
 * @param {string|null} assignedDoctorId
 */
async function resolveCreatedByDoctorForEncounter(clinicId, assignedDoctorId) {
  if (UUID_RE.test(String(assignedDoctorId || "").trim())) {
    return String(assignedDoctorId).trim();
  }
  if (!UUID_RE.test(clinicId)) return null;
  try {
    const { data: anyDoc } = await supabase
      .from("doctors")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("status", "APPROVED")
      .limit(1)
      .maybeSingle();
    if (anyDoc?.id) return String(anyDoc.id).trim();
    const { data: anyDoc2 } = await supabase
      .from("doctors")
      .select("id")
      .eq("clinic_id", clinicId)
      .limit(1)
      .maybeSingle();
    if (anyDoc2?.id) return String(anyDoc2.id).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Write AI booking to encounter_treatments so admin calendar shows it (same path as doctor procedures).
 * @param {Record<string, unknown>} row
 * @param {{ startAt: string, date: string, time: string }} built
 */
async function persistEncounterTreatmentForAiBooking(row, built) {
  const patientId = String(row.patient_id || row.patientId || "").trim();
  const clinicId = String(row.clinic_id || row.clinicId || "").trim();
  const startAt = built.startAt;
  if (!UUID_RE.test(patientId) || !startAt) {
    return { ok: false, reason: "invalid_row" };
  }

  const encounterId = await ensureEncounterForAiBooking(patientId, clinicId);
  if (!encounterId) return { ok: false, reason: "no_encounter" };

  const doctorId = UUID_RE.test(String(row.assigned_doctor_id || row.doctor_id || "").trim())
    ? String(row.assigned_doctor_id || row.doctor_id || "").trim()
    : null;
  const createdByDoctorId = await resolveCreatedByDoctorForEncounter(clinicId, doctorId);
  if (!createdByDoctorId) {
    return { ok: false, reason: "no_doctor_for_encounter_treatment" };
  }

  const chairNo = row.chair_no ?? row.chair ?? null;
  const dbStatus = mapAiBookingStatusToEncounterTreatment(row.status);
  const linkedAppointmentId = row.linked_appointment_id
    ? String(row.linked_appointment_id).trim()
    : "";
  const etId =
    linkedAppointmentId && UUID_RE.test(linkedAppointmentId)
      ? linkedAppointmentId
      : crypto.randomUUID();

  try {
    const { data: existing } = await supabase
      .from("encounter_treatments")
      .select("id")
      .eq("encounter_id", encounterId)
      .eq("scheduled_at", startAt)
      .in("procedure_type", [AI_BOOKING_PROCEDURE_TYPE, "CONSULT"])
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return {
        ok: true,
        id: String(existing.id),
        table: "encounter_treatments",
        startAt,
        calendarDate: built.date,
        calendarTime: built.time,
        reused: true,
      };
    }
  } catch {
    /* ignore */
  }

  /** @type {Record<string, unknown>} */
  const insertRow = {
    id: etId,
    encounter_id: encounterId,
    tooth_number: AI_BOOKING_DEFAULT_TOOTH,
    procedure_type: AI_BOOKING_PROCEDURE_TYPE,
    status: dbStatus,
    scheduled_at: startAt,
    created_by_doctor_id: createdByDoctorId,
  };
  if (doctorId) insertRow.assigned_doctor_id = doctorId;
  if (chairNo) insertRow.chair = String(chairNo).trim();

  const { data, error } = await supabase.from("encounter_treatments").insert(insertRow).select("id").single();
  if (error) {
    if (String(error.code || "") === "23505") {
      const { data: again } = await supabase
        .from("encounter_treatments")
        .select("id")
        .eq("id", etId)
        .maybeSingle();
      if (again?.id) {
        return {
          ok: true,
          id: String(again.id),
          table: "encounter_treatments",
          startAt,
          calendarDate: built.date,
          calendarTime: built.time,
          reused: true,
        };
      }
    }
    console.warn("[persistEncounterTreatment] insert:", error.message);
    return { ok: false, reason: "encounter_treatment_insert_failed", message: error.message };
  }

  console.log("[persistEncounterTreatment] ok", {
    id: data?.id ? String(data.id).slice(0, 8) : etId.slice(0, 8),
    date: built.date,
    time: built.time,
    procedure: AI_BOOKING_PROCEDURE_TYPE,
    doctorId: doctorId ? doctorId.slice(0, 8) : null,
  });

  return {
    ok: true,
    id: data?.id ? String(data.id) : etId,
    table: "encounter_treatments",
    startAt,
    calendarDate: built.date,
    calendarTime: built.time,
  };
}

/**
 * Best-effort insert into encounter_treatments (admin calendar) and appointments / appointment_requests.
 * @param {Record<string, unknown>} row
 * @param {{ timezone?: string }} [options]
 */
async function persistAppointmentRow(row, options = {}) {
  if (!isSupabaseEnabled()) return { ok: false, reason: "supabase_disabled" };

  const patientId = String(row.patient_id || row.patientId || "").trim();
  let clinicId = String(row.clinic_id || row.clinicId || "").trim();
  if (!UUID_RE.test(clinicId) && UUID_RE.test(patientId)) {
    clinicId = (await resolvePatientClinicId(patientId)) || "";
  }
  let patientName = null;
  if (UUID_RE.test(patientId)) {
    try {
      const { data: pRow } = await supabase
        .from("patients")
        .select("name, full_name, email")
        .eq("id", patientId)
        .maybeSingle();
      patientName = pRow?.name || pRow?.full_name || pRow?.email || null;
    } catch {
      /* ignore */
    }
  }

  // Match doctor-created scheduling records: prefer operational assignee on lead thread.
  let inferredDoctorId = null;
  let inferredChairNo = null;
  if (UUID_RE.test(patientId) && UUID_RE.test(clinicId)) {
    try {
      const { data: threadRows } = await supabase
        .from("patient_chat_threads")
        .select("assigned_doctor_id, is_lead, updated_at, created_at")
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId)
        .not("assigned_doctor_id", "is", null)
        .order("is_lead", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1);
      const fromThread = Array.isArray(threadRows) && threadRows[0]?.assigned_doctor_id
        ? String(threadRows[0].assigned_doctor_id).trim()
        : "";
      if (UUID_RE.test(fromThread)) inferredDoctorId = fromThread;
    } catch {
      /* ignore */
    }
  }
  if (!inferredDoctorId && UUID_RE.test(patientId)) {
    try {
      const { data: prow } = await supabase
        .from("patients")
        .select("assigned_doctor_id, primary_doctor_id")
        .eq("id", patientId)
        .maybeSingle();
      const fromPatient = String(prow?.assigned_doctor_id || prow?.primary_doctor_id || "").trim();
      if (UUID_RE.test(fromPatient)) inferredDoctorId = fromPatient;
    } catch {
      /* ignore */
    }
  }
  if (!inferredDoctorId && UUID_RE.test(clinicId)) {
    try {
      const { data: docRows } = await supabase
        .from("doctors")
        .select("id")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: true })
        .limit(1);
      const fallbackDoc = Array.isArray(docRows) && docRows[0]?.id ? String(docRows[0].id).trim() : "";
      if (UUID_RE.test(fallbackDoc)) inferredDoctorId = fallbackDoc;
    } catch {
      /* ignore */
    }
  }
  if (inferredDoctorId) {
    try {
      const { data: drow } = await supabase
        .from("doctors")
        .select("id, chair_no, chair")
        .eq("id", inferredDoctorId)
        .maybeSingle();
      inferredChairNo = String(drow?.chair_no || drow?.chair || "").trim() || null;
    } catch {
      /* ignore */
    }
  }

  const normalizedRow = {
    ...row,
    procedure: "Consultation",
    treatment: "Consultation",
    doctor_id:
      (UUID_RE.test(String(row.doctor_id || "").trim()) && String(row.doctor_id || "").trim()) ||
      inferredDoctorId ||
      null,
    assigned_doctor_id:
      (UUID_RE.test(String(row.assigned_doctor_id || "").trim()) && String(row.assigned_doctor_id || "").trim()) ||
      inferredDoctorId ||
      null,
    chair_no: row.chair_no || row.chair || inferredChairNo || null,
    appointment_type: "consultation",
  };

  const built = buildCalendarAppointmentPayloads(normalizedRow, {
    timezone: options.timezone || row.timezone,
    patientName,
  });
  if (!built.ok) return built;

  const errors = [];
  let encounterResult = await persistEncounterTreatmentForAiBooking(normalizedRow, built);

  const tables = ["appointments", "appointment_requests"];
  let appointmentsResult = null;

  for (const table of tables) {
    for (const payload of built.variants) {
      const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
      try {
        const { data, error } = await insertIntoTableWithColumnPruning(table, clean, "id");
        if (!error && data?.id) {
          console.log("[persistAppointmentRow] ok", {
            table,
            id: String(data.id).slice(0, 8),
            date: built.date,
            time: built.time,
            tz: built.tz,
            clinicId: clinicId ? String(clinicId).slice(0, 8) : null,
            doctorId: inferredDoctorId ? String(inferredDoctorId).slice(0, 8) : null,
          });
          appointmentsResult = {
            ok: true,
            id: data.id,
            startAt: built.startAt,
            table,
            calendarDate: built.date,
            calendarTime: built.time,
          };
          break;
        }
        if (error) errors.push(`${table}: ${error.message}`);
      } catch (e) {
        errors.push(`${table}: ${e?.message || e}`);
      }
    }
    if (appointmentsResult?.ok) break;
  }

  if (!encounterResult?.ok && appointmentsResult?.ok && UUID_RE.test(String(appointmentsResult.id || ""))) {
    encounterResult = await persistEncounterTreatmentForAiBooking(
      { ...normalizedRow, linked_appointment_id: appointmentsResult.id },
      built,
    );
  }

  if (encounterResult?.ok) {
    return {
      ...encounterResult,
      appointmentsTableId: appointmentsResult?.id || null,
      appointmentsTable: appointmentsResult?.table || null,
    };
  }
  if (appointmentsResult?.ok) {
    return appointmentsResult;
  }

  console.warn("[persistAppointmentRow] failed", {
    patientId: patientId.slice(0, 8),
    date: built.date,
    time: built.time,
    errors: [
      encounterResult?.message || encounterResult?.reason,
      ...errors.slice(0, 3),
    ].filter(Boolean),
  });
  return {
    ok: false,
    reason: encounterResult?.reason || "insert_failed",
    message: encounterResult?.message || errors[0] || "unknown",
  };
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
  persistEncounterTreatmentForAiBooking,
  resolvePatientClinicId,
};
