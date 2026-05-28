/**
 * AI calendar booking — slot discovery, contact gate, draft / auto appointment creation.
 */

const { addDays, differenceInCalendarDays, parseISO } = require("date-fns");
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
const {
  resolveClinicWorkingHours,
  clinicLocalSlotToIso,
  parseHmToMinutes,
} = require("./clinicWorkingHours");
const {
  fetchClinicBusyIntervalsForDay,
  parsePreferredDateFromMessage,
  parsePreferredTimeMinutesFromMessage,
  patientRequestsAlternateSlots,
  patientDeclinedOfferedTimes,
  filterSlotsWithinWorkingHours,
  dayOffsetsFromPreferredDate,
  parseHm,
} = require("./clinicCalendarAvailability");
const {
  matchSlotByConversationalTime,
  parseConversationalTimeToMinutes,
  formatMinutesAsHm,
  messageExpressesTimeIntent,
  isTimeOnlyPatientMessage,
} = require("./conversationalTimeParse");

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
  // Safety: if clinic enabled auto-booking from settings, do not stay in draft mode
  // (unless operator explicitly forces suggest_only).
  if (cp.canAutoBookAppointments === true && mode !== BOOKING_MODES.SUGGEST_ONLY) {
    mode = BOOKING_MODES.FULL_AUTO;
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
  const msg = String(message || "");
  const timeIntent = messageExpressesTimeIntent(msg);
  const state = readAiBookingState(flags);

  if (flags.activeAppointment && typeof flags.activeAppointment === "object") {
    const st = String(flags.activeAppointment.status || "").toLowerCase();
    if ((st === "scheduled" || st === "confirmed") && !timeIntent) {
      return false;
    }
  }
  if (state.stage !== "idle") return true;
  if (timeIntent) return true;
  if (isAffirmativeShortReply(message) && patientWasOfferedAppointment(flags, profileRow)) {
    return true;
  }
  if (leadData?.bookingIntent === "high" || leadData?.bookingIntent === "medium") return true;
  if (DENTAL_SYMPTOM_INTENT_RE.test(msg)) return true;
  return BOOKING_INTENT_RE.test(msg);
}

/**
 * Fallback when LLM must not run (time-only turn) but calendar path did not set directReply.
 * @param {string} lang
 * @param {string} hm e.g. "12:30"
 */
function buildTimeSelectionAckReply(lang, hm) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const timeLabel = hm || "";
  if (key === "tr") {
    return timeLabel
      ? `Teşekkürler — ${timeLabel} için randevu talebinizi aldım. Uygunluğu kontrol edip kısa süre içinde onaylayacağız.`
      : "Teşekkürler — randevu saatinizi aldım. Kısa süre içinde onaylayıp size döneceğiz.";
  }
  if (key === "ru") {
    return timeLabel
      ? `Спасибо — мы получили запрос на ${timeLabel}. Проверим доступность и подтвердим запись.`
      : "Спасибо — мы получили ваше время. Скоро подтвердим запись.";
  }
  return timeLabel
    ? `Thank you — we received your request for ${timeLabel}. We will check availability and confirm shortly.`
    : "Thank you — we received your preferred time and will confirm shortly.";
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
 * @param {import('./clinicAiSettings').ClinicAiProfile} clinicProfile
 */
function resolveSchedulingRules(clinicProfile) {
  const logistics = clinicProfile?.logistics || {};
  const resolved = resolveClinicWorkingHours(logistics);
  const weekdays = resolved.weekdays;

  return {
    timezone: resolved.timezone,
    workStartMin: parseHmToMinutes(weekdays.start) ?? 9 * 60,
    workEndMin: parseHmToMinutes(weekdays.end) ?? 18 * 60,
    weekendAvailable: resolved.weekendAvailable,
    weekdayStart: weekdays.start,
    weekdayEnd: weekdays.end,
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
 * @param {{
 *   clinicId: string,
 *   scheduling: ReturnType<typeof resolveSchedulingRules>,
 *   booking: ReturnType<typeof normalizeAiBookingConfig>,
 *   treatmentLabel?: string,
 *   locale?: string,
 *   preferredDateYmd?: string|null,
 *   preferredTimeMin?: number|null,
 * }} params
 */
async function findAvailableSlots(params) {
  const { clinicId, scheduling, booking } = params;
  const locale = String(params.locale || "en").slice(0, 5);
  const tz = scheduling.timezone || "UTC";
  const durationMin = resolveTreatmentDurationMinutes(params.treatmentLabel, booking);
  const bufferMin = booking.bufferMinutes;
  const step = booking.slotStepMinutes;
  const maxSlots = booking.maxSlotsToOffer;
  /** @type {Array<Record<string, unknown>>} */
  const slots = [];
  const now = Date.now();
  const zonedNow = toZonedTime(new Date(), tz);
  const preferredTimeMin =
    params.preferredTimeMin != null ? Number(params.preferredTimeMin) : null;

  const dayOffsets = params.preferredDateYmd
    ? dayOffsetsFromPreferredDate(params.preferredDateYmd, tz, booking.slotHorizonDays)
    : Array.from({ length: booking.slotHorizonDays }, (_, i) => i);

  for (const d of dayOffsets) {
    if (slots.length >= maxSlots) break;
    const dayLocal = addDays(zonedNow, d);
    const dateYmd = formatInTimeZone(dayLocal, tz, "yyyy-MM-dd");
    const dow = dayLocal.getDay();
    if (!scheduling.weekendAvailable && (dow === 0 || dow === 6)) continue;

    const busy = await fetchClinicBusyIntervalsForDay(clinicId, dateYmd, tz);

    for (
      let minute = scheduling.workStartMin;
      minute + durationMin <= scheduling.workEndMin;
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
      const label = formatAppointmentDisplay(startIso, locale, tz);
      slots.push({
        id,
        startAt: startIso,
        label,
        dateYmd,
        time: timeLocal,
        durationMinutes: durationMin,
        timezone: tz,
        _dist:
          preferredTimeMin != null && dateYmd === (params.preferredDateYmd || dateYmd)
            ? Math.abs(minute - preferredTimeMin)
            : 9999,
        _dayDist: params.preferredDateYmd
          ? Math.abs(
              differenceInCalendarDays(
                parseISO(dateYmd),
                parseISO(params.preferredDateYmd),
              ),
            )
          : d,
      });
    }
  }

  slots.sort((a, b) => {
    const dayA = Number(a._dayDist ?? 99);
    const dayB = Number(b._dayDist ?? 99);
    if (dayA !== dayB) return dayA - dayB;
    return Number(a._dist ?? 9999) - Number(b._dist ?? 9999);
  });

  return filterSlotsWithinWorkingHours(slots, scheduling).slice(0, maxSlots);
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

  const conversational = matchSlotByConversationalTime(message, slots, 45);
  if (conversational?.slot) return conversational.slot;

  const preferredMin = parseConversationalTimeToMinutes(message);
  if (preferredMin != null) {
    let best = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      const hm = parseHm(slot.time);
      if (hm == null) continue;
      const dist = Math.abs(hm - preferredMin);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }
    if (best && bestDist <= 45) return best;
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
 * Build a concrete slot when the patient names a date/time (even if offeredSlots was cleared).
 */
function buildSlotFromPreferredDateTime(dateYmd, timeMin, scheduling, booking, treatmentLabel, locale) {
  const tz = scheduling.timezone || "UTC";
  const hh = String(Math.floor(timeMin / 60)).padStart(2, "0");
  const mm = String(timeMin % 60).padStart(2, "0");
  const timeLocal = `${hh}:${mm}`;
  const startIso = clinicLocalSlotToIso(dateYmd, timeLocal, tz);
  if (!startIso) return null;
  return {
    id: `slot_${dateYmd}_${hh}${mm}`,
    startAt: startIso,
    label: formatAppointmentDisplay(startIso, locale, tz),
    dateYmd,
    time: timeLocal,
    durationMinutes: resolveTreatmentDurationMinutes(treatmentLabel, booking),
    timezone: tz,
  };
}

/**
 * Resolve slot from conversational date/time when list-based selection fails.
 */
function resolveSlotFromPatientMessage(
  message,
  state,
  preferredDateYmd,
  preferredTimeMin,
  scheduling,
  booking,
  treatmentLabel,
  locale,
) {
  const timeMin =
    preferredTimeMin != null ? Number(preferredTimeMin) : parseConversationalTimeToMinutes(message);
  if (timeMin == null || !Number.isFinite(timeMin)) return null;

  let dateYmd = preferredDateYmd || null;
  if (!dateYmd && state.selectedSlot?.dateYmd) {
    dateYmd = String(state.selectedSlot.dateYmd);
  }
  if (!dateYmd) {
    const tz = scheduling.timezone || "UTC";
    dateYmd = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  }
  return buildSlotFromPreferredDateTime(dateYmd, timeMin, scheduling, booking, treatmentLabel, locale);
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
  let calendarTable = null;
  if (mode !== BOOKING_MODES.SUGGEST_ONLY) {
    const persisted = await persistAppointmentRow(
      {
        patient_id: params.patientId,
        clinic_id: params.clinicId,
        start_at: startAt,
        procedure: params.treatmentLabel || "Consultation",
        status: status || "scheduled",
        duration_minutes: durationMinutes,
        timezone: params.timezone || null,
        notes: `ai_booking:${mode}${params.contactPhone ? ` contact:${params.contactPhone}` : ""}`,
        source: `ai_${mode}`,
      },
      { timezone: params.timezone },
    );
    if (persisted.ok) {
      appointmentId = persisted.id;
      calendarTable = persisted.table || null;
    } else {
      console.warn("[aiAppointmentBooking] calendar write failed", persisted);
      return {
        ok: false,
        reason: persisted.reason || "calendar_write_failed",
        message: persisted.message,
        startAt,
        mode,
      };
    }
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
  } else if (mode === BOOKING_MODES.DRAFT_BOOKING) {
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

  if (mode === BOOKING_MODES.DRAFT_BOOKING && params.profileId && appointmentId) {
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

  return { ok: true, appointmentId, startAt, mode, calendarTable };
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

  const scheduling = resolveSchedulingRules(clinicProfile);
  const state = readAiBookingState(flags);
  const preferredDateYmd = parsePreferredDateFromMessage(message, scheduling.timezone);
  const preferredTimeMin = parsePreferredTimeMinutesFromMessage(message);
  // Do not wipe offered slots when the patient picks a concrete time (e.g. "11:00") —
  // that prevented parseSlotSelectionFromMessage from matching and blocked calendar writes.
  const wantsFreshSlotList =
    patientRequestsAlternateSlots(message) ||
    patientDeclinedOfferedTimes(message) ||
    (!!preferredDateYmd && preferredTimeMin == null);

  let offeredSlots = filterSlotsWithinWorkingHours(state.offeredSlots, scheduling);
  if (wantsFreshSlotList || offeredSlots.length !== state.offeredSlots.length) {
    if (wantsFreshSlotList) offeredSlots = [];
  }

  const treatmentLabel =
    String(leadData.treatmentInterest || profileRow.treatment_interest || "Consultation")
      .replace(/_/g, " ")
      .trim() || "Consultation";

  const contact = await resolveBookingContact({
    profileRow,
    leadData,
    patientMessage: message,
  });

  let selected =
    offeredSlots.length > 0 ? parseSlotSelectionFromMessage(message, offeredSlots) : null;
  if (!selected) {
    selected = resolveSlotFromPatientMessage(
      message,
      state,
      preferredDateYmd,
      preferredTimeMin,
      scheduling,
      booking,
      treatmentLabel,
      locale,
    );
  }

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
    const busyNow = await fetchClinicBusyIntervalsForDay(
      clinicId,
      selected.dateYmd || String(selected.startAt || "").slice(0, 10),
      scheduling.timezone,
    );
    const startTs = Date.parse(String(selected.startAt || ""));
    const dur = Number(selected.durationMinutes) || booking.defaultDurationMinutes;
    const bufferedStart = startTs - booking.bufferMinutes * 60000;
    const bufferedEnd = startTs + dur * 60000 + booking.bufferMinutes * 60000;
    const stillFree =
      Number.isFinite(startTs) &&
      !busyNow.some(([b0, b1]) => bufferedStart < b1 && bufferedEnd > b0);
    if (!stillFree) {
      const lang = locale.slice(0, 2);
      const altSlotsRaw = await findAvailableSlots({
        clinicId,
        scheduling,
        booking,
        treatmentLabel,
        locale,
        preferredDateYmd: selected.dateYmd || preferredDateYmd,
        preferredTimeMin,
      });
      // If a specific picked hour just turned unavailable, avoid re-suggesting the
      // same clock time in immediate alternatives (prevents "15:00 is full" + "15:00 available" confusion).
      const selectedTimeHm = String(selected.time || "").trim();
      const altSlotsFiltered =
        selectedTimeHm && Array.isArray(altSlotsRaw)
          ? altSlotsRaw.filter((slot) => String(slot?.time || "").trim() !== selectedTimeHm)
          : altSlotsRaw;
      const altSlots =
        Array.isArray(altSlotsFiltered) && altSlotsFiltered.length
          ? altSlotsFiltered
          : altSlotsRaw;
      if (profileId) {
        await persistAiBookingFlags(profileId, {
          stage: altSlots.length ? "slots_offered" : "slot_taken",
          offeredSlots: altSlots,
          offeredAt: new Date().toISOString(),
        });
      }
      return {
        engaged: true,
        promptBlock: buildSlotOfferPromptBlock({
          mode: booking.mode,
          slots: altSlots,
          treatmentLabel,
          lang,
          hasContact: true,
          scheduling,
          patientMessage: message,
          preferredDateYmd,
          wantsAlternate: true,
        }),
        directReply:
          lang === "tr"
            ? "O saat maalesef artık dolu görünüyor. Size uygun en yakın boş saatler aşağıda — lütfen birini seçin veya başka bir saat önerin."
            : "That time appears to be taken now. Here are the nearest available slots — please pick one or suggest another time.",
        slotUnavailable: true,
      };
    }

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
      timezone: scheduling.timezone,
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
    if (!created.ok) {
      const lang = locale.slice(0, 2);
      return {
        engaged: true,
        promptBlock: "",
        directReply:
          lang === "tr"
            ? "Saatinizi not aldık; takvime işlerken kısa bir sorun oluştu. Ekibimiz birkaç dakika içinde onaylayıp size yazacak."
            : "We noted your preferred time; there was a brief issue saving to the calendar. Our team will confirm shortly.",
        booked: false,
        calendarWriteFailed: true,
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
    const whenLabel =
      selected.label || formatAppointmentDisplay(selected.startAt, locale, scheduling.timezone);
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildDirectBookingReply(locale.slice(0, 2), booking.mode, whenLabel, treatmentLabel),
      booked: !!created.appointmentId || booking.mode === BOOKING_MODES.SUGGEST_ONLY,
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

  const slots = await findAvailableSlots({
    clinicId,
    scheduling,
    booking,
    treatmentLabel,
    locale,
    preferredDateYmd,
    preferredTimeMin,
  });

  if (profileId) {
    await persistAiBookingFlags(profileId, {
      stage: slots.length ? "slots_offered" : "no_slots_found",
      offeredSlots: slots,
      offeredAt: new Date().toISOString(),
      contactPhone: contact.phone,
      preferredDateYmd: preferredDateYmd || null,
    });
  }

  const promptBlock = buildSlotOfferPromptBlock({
    mode: booking.mode,
    slots,
    treatmentLabel,
    lang: locale.slice(0, 2),
    hasContact: contact.hasContact,
    scheduling,
    patientMessage: message,
    preferredDateYmd,
    wantsAlternate: wantsFreshSlots,
  });

  const lang = locale.slice(0, 2);
  const timeHm = formatMinutesAsHm(parseConversationalTimeToMinutes(message));
  const timeOnly = isTimeOnlyPatientMessage(message);
  if (timeOnly || (messageExpressesTimeIntent(message) && timeHm)) {
    return {
      engaged: true,
      promptBlock,
      directReply: buildTimeSelectionAckReply(lang, timeHm),
      slotsOffered: slots.length,
      timeSelectionAck: true,
    };
  }

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
  buildTimeSelectionAckReply,
  isTimeOnlyPatientMessage,
  prepareAiAppointmentBookingTurn,
  finalizeAiAppointmentBookingTurn,
  findAvailableSlots,
  resolveBookingContact,
  parseSlotSelectionFromMessage,
  markAppointmentOfferInAiReply,
};
