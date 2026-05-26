/**
 * AI calendar booking — slot discovery, contact gate, draft / auto appointment creation.
 */

const { addDays } = require("date-fns");
const { formatInTimeZone, fromZonedTime, toZonedTime } = require("date-fns-tz");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { getClinicAiProfile } = require("./clinicAiSettings");
const {
  persistAppointmentRow,
  syncAppointmentToCoordination,
  formatAppointmentDisplay,
  toStartIso,
} = require("./appointmentCoordinationSync");
const { extractWhatsappFromPatientMessage, normalizeWhatsappNumber } = require("./whatsappCollection");
const { buildSlotOfferPromptBlock, buildContactRequiredPrompt } = require("./aiAppointmentBookingPrompt");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BOOKING_MODES = Object.freeze({
  SUGGEST_ONLY: "suggest_only",
  DRAFT_BOOKING: "draft_booking",
  FULL_AUTO: "full_auto",
});

const BOOKING_INTENT_RE =
  /\b(book|booking|appointment|consultation|schedule|randevu|rezervasyon|müsait|musait|uygun\s+saat|available\s+time|slot|when\s+can\s+i\s+come|see\s+the\s+doctor)\b/i;

const DENTAL_SYMPTOM_INTENT_RE =
  /\b(diş\s*ağr|dis\s*agr|ağrım\s+var|agrim\s+var|dişim\s+ağr|toothache|tooth\s+pain|dental\s+pain)\b/i;

const AFFIRMATIVE_SHORT_RE =
  /^(olur|tamam|evet|ok|okay|yes|sure|tabii|uygun|kabul|peki|olsun|alo|merhaba|hello|hi)[\s!.?]*$/i;

const SLOT_PICK_RE = /\b(option|choice|slot|seç|sec|tercih)\s*[#:]?\s*(\d{1,2})\b/i;

/** Rough first-visit chair time by treatment keyword (minutes). */
const TREATMENT_DURATION_HINTS = [
  { re: /\b(full\s*mouth|all[\s-]?on|full\s*arch)\b/i, minutes: 60 },
  { re: /\b(implant|implants)\b/i, minutes: 45 },
  { re: /\b(veneer|veneers|crown|crowns)\b/i, minutes: 45 },
  { re: /\b(aligner|invisalign|orthodont)\b/i, minutes: 40 },
  { re: /\b(whiten|bleach)\b/i, minutes: 30 },
  { re: /\b(extract|extraction|çekim)\b/i, minutes: 40 },
];

const DEFAULT_BOOKING = {
  enabled: true,
  mode: BOOKING_MODES.DRAFT_BOOKING,
  contactRequired: true,
  defaultDurationMinutes: 30,
  bufferMinutes: 10,
  slotStepMinutes: 15,
  slotHorizonDays: 14,
  maxSlotsToOffer: 5,
  lunchBreak: { enabled: true, start: "13:00", end: "14:00" },
};

/**
 * @param {unknown} communicationPolicy
 */
function normalizeAiBookingConfig(communicationPolicy) {
  const cp =
    communicationPolicy && typeof communicationPolicy === "object" ? communicationPolicy : {};
  const raw =
    cp.aiBooking && typeof cp.aiBooking === "object"
      ? cp.aiBooking
      : cp.ai_booking && typeof cp.ai_booking === "object"
        ? cp.ai_booking
        : {};

  let mode = String(raw.mode || "").trim().toLowerCase();
  if (!Object.values(BOOKING_MODES).includes(mode)) {
    mode = cp.canAutoBookAppointments === true
      ? BOOKING_MODES.FULL_AUTO
      : BOOKING_MODES.DRAFT_BOOKING;
  }

  const lunch =
    raw.lunchBreak && typeof raw.lunchBreak === "object" ? raw.lunchBreak : DEFAULT_BOOKING.lunchBreak;

  return {
    enabled: raw.enabled !== false,
    mode,
    contactRequired: raw.contactRequired !== false,
    defaultDurationMinutes: Math.max(
      15,
      Math.min(180, Number(raw.defaultDurationMinutes) || DEFAULT_BOOKING.defaultDurationMinutes),
    ),
    bufferMinutes: Math.max(0, Math.min(60, Number(raw.bufferMinutes) ?? DEFAULT_BOOKING.bufferMinutes)),
    slotStepMinutes: Math.max(
      5,
      Math.min(60, Number(raw.slotStepMinutes) || DEFAULT_BOOKING.slotStepMinutes),
    ),
    slotHorizonDays: Math.max(
      1,
      Math.min(30, Number(raw.slotHorizonDays) || DEFAULT_BOOKING.slotHorizonDays),
    ),
    maxSlotsToOffer: Math.max(
      1,
      Math.min(8, Number(raw.maxSlotsToOffer) || DEFAULT_BOOKING.maxSlotsToOffer),
    ),
    lunchBreak: {
      enabled: lunch.enabled !== false,
      start: String(lunch.start || "13:00").slice(0, 5),
      end: String(lunch.end || "14:00").slice(0, 5),
    },
  };
}

/**
 * @param {Record<string, unknown>} flags
 */
function readAiBookingState(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const ab = f.aiBooking && typeof f.aiBooking === "object" ? f.aiBooking : {};
  return {
    stage: String(ab.stage || "idle"),
    offeredSlots: Array.isArray(ab.offeredSlots) ? ab.offeredSlots : [],
    offeredAt: ab.offeredAt || null,
    selectedSlot: ab.selectedSlot || null,
    pendingAppointmentId: ab.pendingAppointmentId || null,
    contactPhone: ab.contactPhone || null,
  };
}

/**
 * @param {string} message
 */
function isAffirmativeShortReply(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 48) return false;
  if (AFFIRMATIVE_SHORT_RE.test(t)) return true;
  return /^(evet|tamam|olur)\b/i.test(t) && t.length < 24;
}

/**
 * @param {Record<string, unknown>} flags
 * @param {Record<string, unknown>|null|undefined} [profileRow]
 */
function patientWasOfferedAppointment(flags, profileRow) {
  const f = flags && typeof flags === "object" ? flags : {};
  if (f.appointmentOfferPending === true) return true;
  const ab = f.aiBooking && typeof f.aiBooking === "object" ? f.aiBooking : {};
  if (ab.appointmentOfferPending === true) return true;
  const stage = String(ab.stage || "");
  if (
    stage === "awaiting_patient_confirm" ||
    stage === "need_contact" ||
    stage === "slots_offered"
  ) {
    return true;
  }
  const summary = String(
    profileRow?.conversation_summary || f.conversationSummary || "",
  ).toLowerCase();
  return (
    /\brandevu\b/.test(summary) &&
    /\b(ayarla|uygun|tarih|planla|arrange|schedule|book)\b/.test(summary)
  );
}

/**
 * @param {string} lang
 */
function buildAffirmativeContactDirectReply(lang) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return "Harika! Randevu planlaması için size ulaşabileceğimiz telefon veya WhatsApp numaranızı paylaşabilir misiniz?";
  }
  return "Great! To arrange your appointment, could you share a phone or WhatsApp number where we can reach you?";
}

/**
 * @param {string} message
 * @param {import('./leadIntelligence').LeadData|null|undefined} leadData
 * @param {Record<string, unknown>} flags
 */
function shouldEngageAppointmentBooking(message, leadData, flags, profileRow) {
  if (flags.activeAppointment && typeof flags.activeAppointment === "object") {
    return false;
  }
  const state = readAiBookingState(flags);
  if (state.stage !== "idle") return true;
  if (isAffirmativeShortReply(message) && patientWasOfferedAppointment(flags, profileRow)) {
    return true;
  }
  if (leadData?.bookingIntent === "high" || leadData?.bookingIntent === "medium") return true;
  if (DENTAL_SYMPTOM_INTENT_RE.test(String(message || ""))) return true;
  return BOOKING_INTENT_RE.test(String(message || ""));
}

/**
 * @param {string} dateYmd
 * @param {string} hhmm
 * @param {string} timezone
 */
function clinicLocalSlotToIso(dateYmd, hhmm, timezone) {
  const hm = parseHm(hhmm);
  if (!hm || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const hh = String(Math.floor(hm / 60)).padStart(2, "0");
  const mm = String(hm % 60).padStart(2, "0");
  const tz = String(timezone || "UTC").trim() || "UTC";
  try {
    return fromZonedTime(`${dateYmd}T${hh}:${mm}:00`, tz).toISOString();
  } catch {
    return null;
  }
}

/**
 * @param {string} dateYmd
 * @param {string} timezone
 */
function clinicDayBoundsUtc(dateYmd, timezone) {
  const tz = String(timezone || "UTC").trim() || "UTC";
  try {
    return {
      start: fromZonedTime(`${dateYmd}T00:00:00`, tz).toISOString(),
      end: fromZonedTime(`${dateYmd}T23:59:59.999`, tz).toISOString(),
    };
  } catch {
    const dayStart = `${dateYmd}T00:00:00.000Z`;
    const dayEndDate = new Date(`${dateYmd}T00:00:00.000Z`);
    dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1);
    return { start: dayStart, end: dayEndDate.toISOString() };
  }
}

/**
 * @param {string} treatmentLabel
 * @param {ReturnType<typeof normalizeAiBookingConfig>} booking
 */
function resolveTreatmentDurationMinutes(treatmentLabel, booking) {
  const text = String(treatmentLabel || "");
  for (const hint of TREATMENT_DURATION_HINTS) {
    if (hint.re.test(text)) {
      return Math.max(15, Math.min(180, hint.minutes));
    }
  }
  return booking.defaultDurationMinutes;
}

/**
 * @param {string} hhmm
 */
function parseHm(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param {import('./clinicAiSettings').ClinicAiProfile} clinicProfile
 */
function resolveSchedulingRules(clinicProfile) {
  const logistics = clinicProfile?.logistics || {};
  const wh = logistics.workingHours || logistics.working_hours || {};
  const weekdays = wh.weekdays || wh.weekday || { start: "09:00", end: "18:00" };
  const tz = String(wh.timezone || logistics.timezone || "Europe/Istanbul").trim();

  return {
    timezone: tz,
    workStartMin: parseHm(weekdays.start || "09:00") ?? 9 * 60,
    workEndMin: parseHm(weekdays.end || "18:00") ?? 18 * 60,
    weekendAvailable: logistics.weekendAvailability === true,
  };
}

/**
 * @param {number} minuteOfDay
 * @param {{ enabled: boolean, start: string, end: string }} lunch
 */
function isLunchMinute(minuteOfDay, lunch) {
  if (!lunch?.enabled) return false;
  const s = parseHm(lunch.start);
  const e = parseHm(lunch.end);
  if (s == null || e == null) return false;
  return minuteOfDay >= s && minuteOfDay < e;
}

/**
 * @param {string} clinicId
 * @param {string} dateYmd
 */
async function fetchBusyIntervalsForDay(clinicId, dateYmd, timezone = "UTC") {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  const { start: dayStart, end: dayEnd } = clinicDayBoundsUtc(dateYmd, timezone);

  const busy = [];

  const addRow = (row) => {
    const start =
      toStartIso(row.start_at) ||
      toStartIso(row.start_time) ||
      toStartIso(row.startTime) ||
      (row.date && row.time ? toStartIso(`${String(row.date).slice(0, 10)}T${String(row.time).trim()}`) : null);
    if (!start) return;
    const startTs = Date.parse(start);
    if (!Number.isFinite(startTs)) return;
    const dur = Number(row.duration_minutes ?? row.duration ?? 30) || 30;
    const endTs =
      toStartIso(row.end_at) || toStartIso(row.end_time)
        ? Date.parse(toStartIso(row.end_at) || toStartIso(row.end_time))
        : startTs + dur * 60000;
    busy.push([startTs, Number.isFinite(endTs) ? endTs : startTs + dur * 60000]);
  };

  try {
    const { data: appts } = await supabase
      .from("appointments")
      .select(
        "start_at, start_time, startTime, date, time, end_at, end_time, duration_minutes, status",
      )
      .eq("clinic_id", clinicId)
      .gte("start_at", dayStart)
      .lt("start_at", dayEnd);

    for (const row of appts || []) {
      const st = String(row.status || "").toLowerCase();
      if (st === "cancelled" || st === "canceled") continue;
      addRow(row);
    }
  } catch {
    /* appointments schema may vary */
  }

  try {
    const { data: appts2 } = await supabase
      .from("appointments")
      .select("date, time, start_time, duration_minutes, status")
      .eq("clinic_id", clinicId)
      .eq("date", dateYmd);
    for (const row of appts2 || []) addRow(row);
  } catch {
    /* ignore */
  }

  busy.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of busy) {
    if (!merged.length) {
      merged.push([s, e]);
      continue;
    }
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * @param {{
 *   clinicId: string,
 *   scheduling: ReturnType<typeof resolveSchedulingRules>,
 *   booking: ReturnType<typeof normalizeAiBookingConfig>,
 *   treatmentLabel?: string,
 *   locale?: string,
 * }} params
 */
async function findAvailableSlots(params) {
  const { clinicId, scheduling, booking } = params;
  const locale = String(params.locale || "en").slice(0, 5);
  const tz = scheduling.timezone || "UTC";
  const durationMin = resolveTreatmentDurationMinutes(params.treatmentLabel, booking);
  const bufferMin = booking.bufferMinutes;
  const step = booking.slotStepMinutes;
  const slots = [];
  const now = Date.now();
  const zonedNow = toZonedTime(new Date(), tz);

  for (let d = 0; d < booking.slotHorizonDays && slots.length < booking.maxSlotsToOffer; d++) {
    const dayLocal = addDays(zonedNow, d);
    const dateYmd = formatInTimeZone(dayLocal, tz, "yyyy-MM-dd");
    const dow = dayLocal.getDay();
    if (!scheduling.weekendAvailable && (dow === 0 || dow === 6)) continue;

    const busy = await fetchBusyIntervalsForDay(clinicId, dateYmd, tz);

    for (
      let minute = scheduling.workStartMin;
      minute + durationMin <= scheduling.workEndMin && slots.length < booking.maxSlotsToOffer;
      minute += step
    ) {
      if (isLunchMinute(minute, booking.lunchBreak)) continue;
      if (isLunchMinute(minute + durationMin - 1, booking.lunchBreak)) continue;

      const hh = String(Math.floor(minute / 60)).padStart(2, "0");
      const mm = String(minute % 60).padStart(2, "0");
      const timeLocal = `${hh}:${mm}`;
      const startIso = clinicLocalSlotToIso(dateYmd, timeLocal, tz);
      if (!startIso) continue;
      const startTs = Date.parse(startIso);
      if (!Number.isFinite(startTs) || startTs < now) continue;

      const endTs = startTs + durationMin * 60000;
      const bufferedStart = startTs - bufferMin * 60000;
      const bufferedEnd = endTs + bufferMin * 60000;

      const overlaps = busy.some(([b0, b1]) => bufferedStart < b1 && bufferedEnd > b0);
      if (overlaps) continue;

      const id = `slot_${dateYmd}_${hh}${mm}`;
      const label = formatAppointmentDisplay(startIso, locale);
      slots.push({
        id,
        startAt: startIso,
        label,
        dateYmd,
        time: timeLocal,
        durationMinutes: durationMin,
        timezone: tz,
      });
    }
  }

  return slots;
}

/**
 * @param {{
 *   profileRow: Record<string, unknown>,
 *   leadData?: import('./leadIntelligence').LeadData|null,
 *   patientMessage?: string,
 * }} params
 */
async function resolveBookingContact(params) {
  const profile = params.profileRow || {};
  const lead = params.leadData || {};
  const flags =
    profile.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};
  const ab = readAiBookingState(flags);

  let phone =
    normalizeWhatsappNumber(profile.whatsapp_number) ||
    normalizeWhatsappNumber(lead.whatsappNumber) ||
    normalizeWhatsappNumber(ab.contactPhone);

  if (!phone && params.patientMessage) {
    const extracted = extractWhatsappFromPatientMessage(params.patientMessage);
    if (extracted?.number) phone = normalizeWhatsappNumber(extracted.number);
  }

  if (!phone && UUID_RE.test(String(profile.patient_id || ""))) {
    try {
      const { data } = await supabase
        .from("patients")
        .select("phone, mobile, whatsapp")
        .eq("id", profile.patient_id)
        .maybeSingle();
      phone =
        normalizeWhatsappNumber(data?.whatsapp) ||
        normalizeWhatsappNumber(data?.phone) ||
        normalizeWhatsappNumber(data?.mobile);
    } catch {
      /* ignore */
    }
  }

  return { phone, hasContact: !!phone };
}

/**
 * @param {string} message
 * @param {Array<{ id: string, label: string, startAt: string }>} offeredSlots
 */
function parseSlotSelectionFromMessage(message, offeredSlots) {
  const slots = Array.isArray(offeredSlots) ? offeredSlots : [];
  if (!slots.length) return null;
  const t = String(message || "");

  const pick = t.match(SLOT_PICK_RE);
  if (pick) {
    const idx = Number(pick[2]) - 1;
    if (idx >= 0 && idx < slots.length) return slots[idx];
  }

  const onlyNum = t.match(/^\s*(\d{1,2})\s*$/);
  if (onlyNum) {
    const idx = Number(onlyNum[1]) - 1;
    if (idx >= 0 && idx < slots.length) return slots[idx];
  }

  for (const slot of slots) {
    const timePart = slot.time || "";
    if (timePart && new RegExp(`\\b${timePart.replace(":", "\\:")}\\b`).test(t)) {
      return slot;
    }
    if (slot.label && t.toLowerCase().includes(slot.label.toLowerCase().slice(0, 12))) {
      return slot;
    }
  }

  return null;
}

/**
 * @param {string} lang
 * @param {string} mode
 * @param {string} whenLabel
 * @param {string} treatmentLabel
 */
function buildDirectBookingReply(lang, mode, whenLabel, treatmentLabel) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const label = treatmentLabel || (key === "tr" ? "Muayene" : "Consultation");
  if (mode === BOOKING_MODES.SUGGEST_ONLY) {
    if (key === "tr") {
      return `Teşekkürler! ${label} için ${whenLabel} saatini not aldık. Ekibimiz kısa süre içinde randevuyu onaylayıp size yazacak.`;
    }
    return `Thank you! We noted ${label} for ${whenLabel}. Our team will confirm the appointment shortly.`;
  }
  if (mode === BOOKING_MODES.DRAFT_BOOKING) {
    if (key === "tr") {
      return `Teşekkürler! ${label} için ${whenLabel} saati ön rezervasyon olarak kaydedildi. Klinik ekibimiz kısa sürede onaylayacak ve size dönecek.`;
    }
    return `Thank you! We reserved ${label} for ${whenLabel} as a pending appointment. Our clinic team will confirm shortly.`;
  }
  if (key === "tr") {
    return `Harika! ${label} randevunuz ${whenLabel} için onaylandı. Görüşmek üzere!`;
  }
  return `Great! Your ${label} appointment is confirmed for ${whenLabel}. We look forward to seeing you!`;
}

/**
 * @param {{
 *   clinicId: string,
 *   patientId: string,
 *   profileId: string,
 *   slot: { startAt: string, label?: string },
 *   mode: string,
 *   treatmentLabel?: string,
 *   contactPhone?: string|null,
 *   locale?: string,
 * }} params
 */
async function createAppointmentFromAiSelection(params) {
  const mode = params.mode || BOOKING_MODES.DRAFT_BOOKING;
  const booking = params.booking || DEFAULT_BOOKING;
  if (booking.contactRequired !== false && !params.contactPhone) {
    return { ok: false, reason: "contact_required" };
  }
  const startAt = toStartIso(params.slot.startAt);
  if (!startAt) return { ok: false, reason: "invalid_slot" };

  const durationMinutes =
    Number(params.slot.durationMinutes) ||
    resolveTreatmentDurationMinutes(params.treatmentLabel, booking);

  const status =
    mode === BOOKING_MODES.FULL_AUTO
      ? "scheduled"
      : mode === BOOKING_MODES.DRAFT_BOOKING
        ? "pending"
        : null;

  let appointmentId = null;
  if (mode !== BOOKING_MODES.SUGGEST_ONLY) {
    const persisted = await persistAppointmentRow({
      patient_id: params.patientId,
      clinic_id: params.clinicId,
      start_at: startAt,
      procedure: params.treatmentLabel || "Consultation",
      status: status || "scheduled",
      duration_minutes: durationMinutes,
      notes: `ai_booking:${mode}${params.contactPhone ? ` contact:${params.contactPhone}` : ""}`,
    });
    if (persisted.ok) appointmentId = persisted.id;
  }

  if (mode === BOOKING_MODES.FULL_AUTO) {
    await syncAppointmentToCoordination({
      patientId: params.patientId,
      clinicId: params.clinicId,
      eventType: "appointment_booked",
      appointment: {
        id: appointmentId,
        startAt,
        treatmentLabel: params.treatmentLabel || "Consultation",
        status: "scheduled",
        source: "ai_auto_book",
      },
      source: "ai_auto_book",
      sendPatientMessage: false,
      locale: params.locale,
    });
  } else if (mode === BOOKING_MODES.DRAFT_BOOKING && appointmentId) {
    await syncAppointmentToCoordination({
      patientId: params.patientId,
      clinicId: params.clinicId,
      eventType: "appointment_booked",
      appointment: {
        id: appointmentId,
        startAt,
        treatmentLabel: params.treatmentLabel || "Consultation",
        status: "pending",
        pendingStaffApproval: true,
        source: "ai_draft_book",
      },
      source: "ai_draft_book",
      sendPatientMessage: false,
      locale: params.locale,
    });
  }

  if (mode === BOOKING_MODES.DRAFT_BOOKING && params.profileId) {
    await persistAiBookingFlags(params.profileId, {
      stage: "pending_staff",
      selectedSlot: params.slot,
      pendingAppointmentId: appointmentId,
      contactPhone: params.contactPhone || null,
    });
    const { data } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("operational_intake_flags")
      .eq("id", params.profileId)
      .maybeSingle();
    const prev =
      data?.operational_intake_flags && typeof data.operational_intake_flags === "object"
        ? data.operational_intake_flags
        : {};
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        operational_intake_flags: {
          ...prev,
          activeAppointment: {
            id: appointmentId,
            startAt,
            treatmentLabel: params.treatmentLabel || "Consultation",
            status: "pending",
            pendingStaffApproval: true,
            updatedAt: new Date().toISOString(),
          },
          journeyStage: "appointment_pending",
          appointmentScheduled: false,
          waitingForConsultation: true,
        },
        booking_intent: "high",
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.profileId);
  }

  return { ok: true, appointmentId, startAt, mode };
}

/**
 * @param {string} profileId
 * @param {Record<string, unknown>} patch
 */
async function persistAiBookingFlags(profileId, patch) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) return;
  const { data } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("operational_intake_flags")
    .eq("id", profileId)
    .maybeSingle();
  const prev =
    data?.operational_intake_flags && typeof data.operational_intake_flags === "object"
      ? data.operational_intake_flags
      : {};
  const prevAb = readAiBookingState(prev);
  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: {
        ...prev,
        aiBooking: { ...prevAb, ...patch, updatedAt: new Date().toISOString() },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);
}

/**
 * Pre-turn: prompt injection, slot discovery, or direct reply when patient picks a slot.
 * @param {{
 *   clinicId: string,
 *   patientId: string,
 *   profileRow: Record<string, unknown>,
 *   patientMessage: string,
 *   leadData?: import('./leadIntelligence').LeadData|null,
 *   locale?: string,
 * }} params
 */
async function prepareAiAppointmentBookingTurn(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const profileRow = params.profileRow || {};
  const profileId = String(profileRow.id || "").trim();
  const message = String(params.patientMessage || "");
  const locale = String(params.locale || profileRow.conversation_primary_language || "en").slice(0, 5);

  const flags =
    profileRow.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {};
  const leadData = params.leadData || {};

  if (!shouldEngageAppointmentBooking(message, leadData, flags, profileRow)) {
    return { engaged: false, promptBlock: "", directReply: null };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const booking = normalizeAiBookingConfig(clinicProfile.communicationPolicy);
  if (!booking.enabled) {
    return { engaged: false, promptBlock: "", directReply: null };
  }

  const state = readAiBookingState(flags);
  const contact = await resolveBookingContact({
    profileRow,
    leadData,
    patientMessage: message,
  });

  const treatmentLabel =
    String(leadData.treatmentInterest || profileRow.treatment_interest || "Consultation")
      .replace(/_/g, " ")
      .trim() || "Consultation";

  const selected =
    state.offeredSlots.length > 0
      ? parseSlotSelectionFromMessage(message, state.offeredSlots)
      : null;

  if (selected && booking.contactRequired && !contact.hasContact) {
    const lang = locale.slice(0, 2);
    return {
      engaged: true,
      promptBlock: buildContactRequiredPrompt(lang),
      directReply: null,
      needContact: true,
    };
  }

  if (selected && contact.hasContact) {
    const created = await createAppointmentFromAiSelection({
      clinicId,
      patientId,
      profileId,
      slot: selected,
      mode: booking.mode,
      booking,
      treatmentLabel,
      contactPhone: contact.phone,
      locale,
    });
    if (created.reason === "contact_required") {
      const lang = locale.slice(0, 2);
      return {
        engaged: true,
        promptBlock: buildContactRequiredPrompt(lang),
        directReply: buildAffirmativeContactDirectReply(lang),
        needContact: true,
      };
    }
    if (created.ok && profileId) {
      const stage =
        booking.mode === BOOKING_MODES.SUGGEST_ONLY
          ? "suggest_noted"
          : booking.mode === BOOKING_MODES.DRAFT_BOOKING
            ? "pending_staff"
            : "booked";
      await persistAiBookingFlags(profileId, {
        stage,
        selectedSlot: selected,
        pendingAppointmentId: created.appointmentId,
        contactPhone: contact.phone,
        offeredSlots: [],
        appointmentOfferPending: false,
      });
    }
    const whenLabel = selected.label || formatAppointmentDisplay(selected.startAt, locale);
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildDirectBookingReply(locale.slice(0, 2), booking.mode, whenLabel, treatmentLabel),
      booked: true,
    };
  }

  if (booking.contactRequired && !contact.hasContact) {
    await persistAiBookingFlags(profileId, {
      stage: "need_contact",
      appointmentOfferPending: true,
    });
    const lang = locale.slice(0, 2);
    const directReply =
      isAffirmativeShortReply(message) || patientWasOfferedAppointment(flags, profileRow)
        ? buildAffirmativeContactDirectReply(lang)
        : null;
    return {
      engaged: true,
      promptBlock: buildContactRequiredPrompt(lang),
      directReply,
      needContact: true,
    };
  }

  const scheduling = resolveSchedulingRules(clinicProfile);
  const slots = await findAvailableSlots({
    clinicId,
    scheduling,
    booking,
    treatmentLabel,
    locale,
  });

  if (profileId && slots.length) {
    await persistAiBookingFlags(profileId, {
      stage: "slots_offered",
      offeredSlots: slots,
      offeredAt: new Date().toISOString(),
      contactPhone: contact.phone,
    });
  }

  const promptBlock = buildSlotOfferPromptBlock({
    mode: booking.mode,
    slots,
    treatmentLabel,
    lang: locale.slice(0, 2),
    hasContact: contact.hasContact,
  });

  return {
    engaged: true,
    promptBlock,
    directReply: null,
    slotsOffered: slots.length,
  };
}

/**
 * Post-turn: persist contact from patient message if provided.
 */
async function finalizeAiAppointmentBookingTurn(params) {
  const profileId = String(params.profileId || "").trim();
  if (!profileId) return;

  const extracted = extractWhatsappFromPatientMessage(params.patientMessage || "");
  if (extracted?.number) {
    const phone = normalizeWhatsappNumber(extracted.number);
    if (phone) {
      await persistAiBookingFlags(profileId, {
        contactPhone: phone,
        stage: "contact_collected",
      });
    }
  }
}

/**
 * Mark that the coordinator offered an appointment (next patient "Tamam" continues booking).
 * @param {string} profileId
 * @param {string} aiReplyText
 */
async function markAppointmentOfferInAiReply(profileId, aiReplyText) {
  if (!profileId || !/\brandevu\b/i.test(String(aiReplyText || ""))) return;
  if (!/\b(ayarla|uygun|tarih|planla|schedule|book)\b/i.test(String(aiReplyText || ""))) return;
  await persistAiBookingFlags(profileId, {
    appointmentOfferPending: true,
    stage: "awaiting_patient_confirm",
  });
}

module.exports = {
  BOOKING_MODES,
  normalizeAiBookingConfig,
  shouldEngageAppointmentBooking,
  isAffirmativeShortReply,
  prepareAiAppointmentBookingTurn,
  finalizeAiAppointmentBookingTurn,
  findAvailableSlots,
  resolveBookingContact,
  parseSlotSelectionFromMessage,
  markAppointmentOfferInAiReply,
};
