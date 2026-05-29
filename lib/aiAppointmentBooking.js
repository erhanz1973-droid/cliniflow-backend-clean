/**
 * AI calendar booking — slot discovery, contact gate, draft / auto appointment creation.
 */

const { addDays, differenceInCalendarDays, parseISO } = require("date-fns");
const { formatInTimeZone } = require("date-fns-tz");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { getClinicAiProfile } = require("./clinicAiSettings");
const {
  persistAppointmentRow,
  resolveAiBookingCalendarContext,
  syncAppointmentToCoordination,
  formatAppointmentDisplay,
  toStartIso,
  resolveClinicIanaTimezone,
} = require("./appointmentCoordinationSync");
const {
  extractWhatsappFromPatientMessage,
  normalizeWhatsappNumber,
  resolveWhatsappFromInboundChannel,
  resolvePatientContactPhone,
  isWhatsappInboundConversation,
  persistWhatsappCollection,
} = require("./whatsappCollection");
const {
  buildSlotOfferPromptBlock,
  buildContactRequiredPrompt,
  buildContactConfirmationDirectReply,
  buildNameRequiredPrompt,
  buildSlotOfferDirectReply,
} = require("./aiAppointmentBookingPrompt");
const { resolvePatientRecordName } = require("./patientNameSync");
const {
  patientNeedsClinicEnrollmentNotice,
  patientAskedAboutAppRegistration,
  buildAiClinicMembershipAfterBookingNotice,
  fetchClinicCodeByClinicId,
} = require("./patientClinicEnrollment");
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
  isClinicFacilityOrInfoQuestion,
} = require("./conversationalTimeParse");
const { isSocialAcknowledgmentMessage } = require("./conversationRepetitionMemory");
const {
  BOOKING_PENDING_ACTIONS,
  BOOKING_AUDIT_EVENTS,
  mergeAiBookingPatch,
  readDurableBookingState,
  readCanonicalBooking,
  buildCanonicalBookingRecord,
  buildCanonicalStatusReply,
  buildPostBookingStaleInputReply,
  buildExpiredBookingReply,
  buildClosedBookingPatch,
  hasCompletedCanonicalBooking,
  isBookingStatusInquiry,
  isPostBookingStaleActionMessage,
  resolvesPendingConfirmation,
  parseSlotFromDurableState,
  validateBookingGuardian,
  logBookingAudit,
  logBookingAuditEvent,
  isBookingFlowInProgress,
  applyBookingExpiryIfNeeded,
  isBookingConfirmationYesMessage,
} = require("./aiBookingState");

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
  /^(olur|tamam|evet|ok|okay|yes|sure|tabii|uygun|kabul|peki|olsun)[\s!.?]*$/i;

const SLOT_PICK_RE = /\b(option|choice|slot|seç|sec|tercih)\s*[#:]?\s*(\d{1,2})\b/i;

const BOOKING_CONFIRM_YES_RE =
  /^(evet|tamam|olur|onayl\w*|onay|yes|ok|okay|sure|kabul|peki|confirm|confirmed)[\s!.?]*$/i;

const BOOKING_CONFIRM_NO_RE =
  /^(hayir|hayır|iptal|degil|değil|yok|no|cancel)[\s!.?]*$|^\s*(baska|başka|farkli|farklı|degistir|değiştir)\b/i;

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
    calendarPersisted: ab.calendarPersisted === true,
    adminCalendarPersisted: ab.adminCalendarPersisted === true,
    preferredDateYmd: ab.preferredDateYmd ? String(ab.preferredDateYmd) : null,
    preferredTimeMin:
      ab.preferredTimeMin != null && Number.isFinite(Number(ab.preferredTimeMin))
        ? Number(ab.preferredTimeMin)
        : null,
  };
}

/**
 * @param {Record<string, unknown>} flags
 */
function bookingNeedsCalendarPersist(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const state = readAiBookingState(f);
  if (state.adminCalendarPersisted && state.pendingAppointmentId) return false;
  if (state.calendarPersisted && state.pendingAppointmentId && state.adminCalendarPersisted) {
    return false;
  }
  if (state.selectedSlot?.startAt) return true;
  const appt = f.activeAppointment;
  if (appt && typeof appt === "object" && appt.startAt) return true;
  return false;
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string} timezone
 */
function inferPendingSlotFromRecentPatientTurns(recentTurns, timezone) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  let dateYmd = null;
  let timeMin = null;
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 10; i--) {
    const t = turns[i];
    if (t.role !== "patient") continue;
    const tx = String(t.text || "");
    if (!dateYmd) dateYmd = parsePreferredDateFromMessage(tx, timezone);
    if (timeMin == null) {
      const tm = parsePreferredTimeMinutesFromMessage(tx);
      if (tm != null) timeMin = tm;
    }
    if (dateYmd && timeMin != null) break;
  }
  return { dateYmd, timeMin };
}

/**
 * Complete booking when contact arrives after the patient already chose a time.
 * @param {object} params
 */
async function tryCompletePendingAiBooking(params) {
  const {
    message,
    state,
    flags,
    contact,
    clinicId,
    patientId,
    profileId,
    profileRow,
    booking,
    scheduling,
    treatmentLabel,
    locale,
    preferredDateYmd,
    preferredTimeMin,
    recentTurns,
  } = params;

  const phone = resolveBookingPhoneForTurn(contact, booking, state, profileRow);
  const prevStage = String(state.stage || "");
  const confirmYes = isBookingConfirmationYes(message);

  if (prevStage === "awaiting_slot_confirm" && !confirmYes) {
    const langEarly = String(locale || "tr").slice(0, 2);
    const pendingSlot = state.selectedSlot;
    const whenPending =
      pendingSlot?.label ||
      (pendingSlot?.startAt
        ? formatAppointmentDisplay(pendingSlot.startAt, locale, scheduling.timezone)
        : "");
    return {
      ok: true,
      directReply: buildSlotConfirmationReminder(langEarly, whenPending),
      booked: false,
    };
  }

  if (shouldFinalizeSlotOnPatientYes(message, state, flags, recentTurns)) {
    return completeBookingAfterSlotConfirmation({
      message,
      state,
      flags,
      contact,
      profileRow,
      profileId,
      clinicId,
      patientId,
      booking,
      scheduling,
      treatmentLabel,
      locale,
      recentTurns,
    });
  }

  if (booking.contactRequired !== false && !phone) {
    return null;
  }

  const nameState = await resolvePatientRecordName({
    profileRow,
    patientMessage: message,
    recentTurns,
  });
  if (!nameState.hasName) {
    return null;
  }

  if (state.adminCalendarPersisted && state.pendingAppointmentId) {
    return null;
  }

  const catalogSlotsPending = Array.isArray(state.offeredSlots) ? state.offeredSlots : [];
  const skipTimeFromListIndex =
    catalogSlotsPending.length > 0 && isBareSlotListIndexMessage(message, catalogSlotsPending.length);

  let slot = skipTimeFromListIndex
    ? parseSlotSelectionFromMessage(message, catalogSlotsPending)
    : catalogSlotsPending.length
      ? parseSlotSelectionFromMessage(message, catalogSlotsPending)
      : null;
  if (!slot) slot = state.selectedSlot;
  if (!slot) slot = slotFromBookingFlags(flags, scheduling, booking, treatmentLabel, locale);

  const ab = flags?.aiBooking && typeof flags.aiBooking === "object" ? flags.aiBooking : {};
  let dateYmd = preferredDateYmd || state.preferredDateYmd || ab.preferredDateYmd || null;
  const offeredCount = catalogSlotsPending.length;
  let timeMin = skipTimeFromListIndex
    ? null
    : preferredTimeMin != null
      ? Number(preferredTimeMin)
      : state.preferredTimeMin != null
        ? Number(state.preferredTimeMin)
        : ab.preferredTimeMin != null
          ? Number(ab.preferredTimeMin)
          : null;

  if ((!dateYmd || timeMin == null) && Array.isArray(recentTurns)) {
    const inferred = inferPendingSlotFromRecentPatientTurns(recentTurns, scheduling.timezone);
    dateYmd = dateYmd || inferred.dateYmd;
    if (timeMin == null) timeMin = inferred.timeMin;
  }

  if (!slot?.startAt && dateYmd && timeMin != null && Number.isFinite(timeMin)) {
    slot = buildSlotFromPreferredDateTime(
      dateYmd,
      timeMin,
      scheduling,
      booking,
      treatmentLabel,
      locale,
    );
  }

  if (!slot?.startAt) return null;

  const lang = String(locale || "tr").slice(0, 2);
  const whenLabelPending =
    slot.label || formatAppointmentDisplay(slot.startAt, locale, scheduling.timezone);

  if (
    prevStage === "need_contact" ||
    prevStage === "need_name" ||
    (state.selectedSlot && prevStage !== "booked" && prevStage !== "pending_staff")
  ) {
    await persistAiBookingFlags(profileId, {
      stage: "awaiting_slot_confirm",
      selectedSlot: slot,
      offeredSlots: state.offeredSlots || [],
      offeredAt: state.offeredAt || new Date().toISOString(),
      appointmentOfferPending: true,
      contactPhone: phone,
      preferredDateYmd: slot.dateYmd || dateYmd,
      preferredTimeMin: timeMin,
    });
    return {
      ok: true,
      directReply: buildSlotConfirmationDirectReply(lang, whenLabelPending, treatmentLabel),
      booked: false,
    };
  }

  const created = await createAppointmentFromAiSelection({
    clinicId,
    patientId,
    profileId,
    profileRow,
    patientMessage: message,
    recentTurns,
    slot,
    mode: booking.mode,
    booking,
    treatmentLabel,
    contactPhone: phone,
    locale,
    timezone: scheduling.timezone,
  });

  if (!created.ok) {
    console.warn("[aiAppointmentBooking] pending booking complete failed", created);
    return {
      ok: false,
      directReply: null,
      booked: false,
      calendarWriteFailed: true,
      reason: created.reason,
    };
  }

  await persistAiBookingFlags(profileId, {
    stage:
      booking.mode === BOOKING_MODES.FULL_AUTO
        ? "booked"
        : booking.mode === BOOKING_MODES.SUGGEST_ONLY
          ? "suggest_noted"
          : "pending_staff",
    selectedSlot: slot,
    pendingAppointmentId: created.appointmentId,
    calendarPersisted: created.adminCalendarPersisted === true,
    adminCalendarPersisted: created.adminCalendarPersisted === true,
    contactPhone: phone,
    preferredDateYmd: slot.dateYmd || dateYmd,
    preferredTimeMin: timeMin,
    offeredSlots: [],
    appointmentOfferPending: false,
  });

  const whenLabel =
    slot.label || formatAppointmentDisplay(created.startAt, locale, scheduling.timezone);
  return {
    ok: true,
    booked: true,
    directReply: await buildDirectBookingReplyForPatient(
      locale.slice(0, 2),
      booking.mode,
      whenLabel,
      treatmentLabel,
      patientId,
      clinicId,
    ),
    appointmentId: created.appointmentId,
    calendarTable: created.calendarTable,
  };
}

function slotFromBookingFlags(flags, scheduling, booking, treatmentLabel, locale) {
  const state = readAiBookingState(flags);
  if (state.selectedSlot?.startAt) return state.selectedSlot;

  const appt = flags?.activeAppointment;
  if (!appt || typeof appt !== "object" || !appt.startAt) return null;

  const startAt = toStartIso(appt.startAt);
  if (!startAt) return null;
  const tz = scheduling.timezone || "UTC";
  const dateYmd = formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd");
  const time = formatInTimeZone(new Date(startAt), tz, "HH:mm");
  return {
    id: `slot_${dateYmd}_${time.replace(":", "")}`,
    startAt,
    label: formatAppointmentDisplay(startAt, locale, tz),
    dateYmd,
    time,
    durationMinutes: resolveTreatmentDurationMinutes(treatmentLabel, booking),
    timezone: tz,
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
/**
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 * @param {Array<{ label?: string }>} [offeredSlots]
 */
function coordinatorRecentlySentSlotList(recentTurns, offeredSlots) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 5; i--) {
    const role = String(turns[i]?.role || "").toLowerCase();
    if (role !== "assistant" && role !== "coordinator" && role !== "clinic") continue;
    const tx = String(turns[i]?.text || "");
    if (
      /available appointment times|müsait saat|müsait saatler|uygun saatler|size uygun/i.test(tx) &&
      /\b1\.\s/.test(tx)
    ) {
      return true;
    }
    const slots = Array.isArray(offeredSlots) ? offeredSlots : [];
    if (slots[0]?.label && tx.includes(String(slots[0].label).slice(0, 24))) {
      return true;
    }
    return false;
  }
  return false;
}

const EXPLICIT_SCHEDULING_ASK_RE =
  /\b(müsait\s+saat|musait\s+saat|uygun\s+saat|randevu\s+al|randevu\s+istiyorum|randevu\s+almak|randevu\s+yap|saat\s+seç|book\s+an?\s+appointment|schedule\s+(a\s+)?appointment|available\s+(time|slot)s?)\b/i;

/**
 * Clock-time intent only when the message is actually about picking a time (not buried in a long essay).
 * @param {string} message
 */
function schedulingTimeIntent(message) {
  const msg = String(message || "").trim();
  if (!msg || parseConversationalTimeToMinutes(msg) == null) return false;
  if (isTimeOnlyPatientMessage(msg)) return true;
  if (msg.length <= 72 && messageExpressesTimeIntent(msg)) return true;
  return false;
}

/**
 * Long informational / multi-topic messages should not re-trigger the slot table.
 * @param {string} message
 */
function isPrimarilyNonSchedulingPatientMessage(message) {
  const msg = String(message || "").trim();
  if (msg.length < 88) return false;
  if (/^\s*#?\s*\d{1,2}\s*[.!)?]*\s*$/i.test(msg)) return false;
  if (EXPLICIT_SCHEDULING_ASK_RE.test(msg)) return false;
  if (patientRequestsAlternateSlots(msg)) return false;
  if (isTimeOnlyPatientMessage(msg)) return false;
  if (schedulingTimeIntent(msg)) return false;
  const questionMarks = (msg.match(/\?/g) || []).length;
  const topicHints =
    (msg.match(
      /\b(fiyat|ucret|ücret|price|cost|implant|tedavi|treatment|uygulama|app|otel|hotel|uçak|ucak|flight|belge|document|ağr|agr|pain|nereden|nasıl|nasil|how|what|ne\s+zaman)\b/gi,
    ) || []).length;
  if (msg.length >= 200) return true;
  if (msg.length >= 110 && (questionMarks >= 1 || topicHints >= 2)) return true;
  return false;
}

/**
 * @param {string} message
 * @param {ReturnType<typeof readAiBookingState>} state
 * @param {{ timezone?: string }} scheduling
 */
function patientMessageAdvancesSlotBooking(message, state, scheduling) {
  const msg = String(message || "").trim();
  if (!msg || isPrimarilyNonSchedulingPatientMessage(msg)) return false;
  const tz = scheduling?.timezone || "Europe/Istanbul";
  if (parseSlotSelectionFromMessage(msg, state.offeredSlots)) return true;
  if (isBookingConfirmationYes(msg) || isBookingConfirmationNo(msg)) return true;
  if (patientRequestsAlternateSlots(msg)) return true;
  if (parsePreferredDateFromMessage(msg, tz)) return true;
  if (schedulingTimeIntent(msg)) return true;
  if (EXPLICIT_SCHEDULING_ASK_RE.test(msg)) return true;
  if (msg.length <= 140 && (BOOKING_INTENT_RE.test(msg) || DENTAL_SYMPTOM_INTENT_RE.test(msg))) {
    return true;
  }
  return false;
}

/**
 * @param {string} message
 * @param {ReturnType<typeof readAiBookingState>} state
 * @param {{ timezone?: string }} scheduling
 * @param {{
 *   selected?: object|null,
 *   wantsFreshSlotList?: boolean,
 *   timeOnly?: boolean,
 *   parsedTimeMin?: number|null,
 *   stage?: string,
 * }} ctx
 */
function shouldSendSlotListDirectReply(message, state, scheduling, ctx = {}) {
  const stage = String(ctx.stage || state.stage || "").toLowerCase();
  if (ctx.selected) return true;
  if (ctx.wantsFreshSlotList) return true;
  if (ctx.timeOnly) return true;
  if (ctx.parsedTimeMin != null && isTimeOnlyPatientMessage(message)) return true;
  if (stage === "awaiting_slot_confirm" || stage === "need_contact" || stage === "need_name") {
    return false;
  }
  return patientMessageAdvancesSlotBooking(message, state, scheduling);
}

/**
 * @param {Record<string, unknown>} bookingPrep
 * @param {string} message
 * @param {Record<string, unknown>} flags
 * @param {{ timezone?: string }} scheduling
 */
function shouldUseBookingDirectReply(bookingPrep, message, flags, scheduling) {
  if (!bookingPrep?.directReply) return false;
  if (bookingPrep.booked || bookingPrep.awaitingConfirmation) return true;
  if (bookingPrep.needContact || bookingPrep.needName) return true;
  if (bookingPrep.nudgeOnly) return false;
  const state = readAiBookingState(flags);
  return shouldSendSlotListDirectReply(message, state, scheduling, {
    stage: state.stage,
    wantsFreshSlotList: false,
    timeOnly: isTimeOnlyPatientMessage(message),
    parsedTimeMin: parseConversationalTimeToMinutes(message),
  });
}

/**
 * @param {string} lang
 * @param {number} slotCount
 */
function buildSlotSelectionNudgeReply(lang, slotCount) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const max = Math.max(1, Math.min(Number(slotCount) || 5, 12));
  if (key === "tr") {
    return `Az önce paylaştığımız müsait saatlerden birini seçmek için 1–${max} arası numara yazabilir veya uygun saati (ör. «17:00») belirtebilirsiniz.`;
  }
  if (key === "ru") {
    return `Выберите номер (1–${max}) из списка выше или напишите удобное время.`;
  }
  if (key === "ka") {
    return `გთხოვთ, აირჩიოთ ნომერი 1–${max} ზემოთ მოცემული სიიდან ან მიუთითოთ შესაფერისი დრო (მაგ. «17:00»).`;
  }
  return `Please reply with a number (1–${max}) from the times we shared, or type your preferred time (e.g. «5:00 PM»).`;
}

function patientWasOfferedAppointment(flags, profileRow) {
  const f = flags && typeof flags === "object" ? flags : {};
  if (f.appointmentOfferPending === true) return true;
  const ab = f.aiBooking && typeof f.aiBooking === "object" ? f.aiBooking : {};
  if (ab.appointmentOfferPending === true) return true;
  const stage = String(ab.stage || "");
  if (
    stage === "awaiting_patient_confirm" ||
    stage === "awaiting_slot_confirm" ||
    stage === "need_contact" ||
    stage === "need_name" ||
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
 * @param {Record<string, unknown>} profileRow
 * @param {{ inboundSource?: string, channel?: string }} [params]
 */
function resolveBookingChannelContext(profileRow, params = {}) {
  const source = String(
    params.inboundSource || params.channel || profileRow?.primary_channel || profileRow?.source || "",
  )
    .trim()
    .toLowerCase();
  return {
    source,
    whatsappChannel: isWhatsappInboundConversation(profileRow, source),
  };
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {{ phone?: string|null }} contact
 * @param {{ whatsappChannel?: boolean }} channelCtx
 */
function buildBookingContactPromptOpts(profileRow, contact, channelCtx) {
  return {
    whatsappChannel: channelCtx.whatsappChannel === true,
    knownPhone: contact.phone || resolveWhatsappFromInboundChannel(profileRow) || null,
  };
}

/**
 * @param {string} lang
 * @param {{ whatsappChannel?: boolean, knownPhone?: string|null }} [opts]
 */
function buildAffirmativeContactDirectReply(lang, opts = {}) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  if (opts.whatsappChannel === true) {
    return buildContactConfirmationDirectReply(key, opts.knownPhone || null);
  }
  if (key === "tr") {
    return "Harika! Randevu planlaması için size ulaşabileceğimiz telefon veya WhatsApp numaranızı paylaşabilir misiniz?";
  }
  return "Great! To arrange your appointment, could you share a phone or WhatsApp number where we can reach you?";
}

/**
 * @param {string} lang
 */
function buildAffirmativeNameDirectReply(lang) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return "Harika! Randevu kaydı için adınızı yazar mısınız? (Ad ve soyadı birlikte yazabilirsiniz.)";
  }
  if (key === "ru") {
    return "Отлично! Напишите, пожалуйста, ваше имя для записи (можно имя и фамилию в одной строке).";
  }
  return "Great! May I have your name for the appointment record? (First and last name in one line is fine.)";
}

/**
 * @param {string} message
 * @param {import('./leadIntelligence').LeadData|null|undefined} leadData
 * @param {Record<string, unknown>} flags
 */
function shouldEngageAppointmentBooking(message, leadData, flags, profileRow) {
  const msg = String(message || "");
  if (patientAskedAboutAppRegistration(msg)) return false;
  if (isClinicFacilityOrInfoQuestion(msg)) return false;
  if (isPrimarilyNonSchedulingPatientMessage(msg)) return false;
  const timeIntent = schedulingTimeIntent(msg);
  const state = readAiBookingState(flags);
  const scheduling = { timezone: "Europe/Istanbul" };

  if (patientHasActiveBooking(flags, state)) {
    if (isAppointmentStatusQuestion(msg)) return true;
    if (patientRequestsBookingChange(msg)) return true;
    if (parseSlotSelectionFromMessage(msg, state.offeredSlots)) return true;
    if (timeIntent) return true;
    return false;
  }

  if (flags.activeAppointment && typeof flags.activeAppointment === "object") {
    const st = String(flags.activeAppointment.status || "").toLowerCase();
    const needsPersist = bookingNeedsCalendarPersist(flags);
    const restatesAppointment =
      /\b(randevu|appointment|implant|muayene|consultation)\b/i.test(msg) &&
      (timeIntent || !!parsePreferredDateFromMessage(msg));
    if ((st === "scheduled" || st === "confirmed") && !timeIntent && !needsPersist && !restatesAppointment) {
    return false;
  }
    if (st === "pending" && !needsPersist && !timeIntent && !restatesAppointment) {
      return false;
    }
  }
  if (state.stage !== "idle") {
    if (state.stage === "awaiting_slot_confirm") return true;
    if (state.stage === "need_contact" || state.stage === "need_name") return true;
    if (parseSlotSelectionFromMessage(msg, state.offeredSlots)) return true;
    if (isBookingConfirmationYes(msg) || isBookingConfirmationNo(msg)) return true;
    if (
      isSocialAcknowledgmentMessage(msg) &&
      (state.stage === "slots_offered" || state.stage === "awaiting_slot_confirm")
    ) {
      return false;
    }
    if (timeIntent && !isBareSlotListIndexMessage(msg, state.offeredSlots?.length || 0)) return true;
    if (parsePreferredDateFromMessage(msg, "Europe/Istanbul")) return true;
    if (isAffirmativeShortReply(message) && patientWasOfferedAppointment(flags, profileRow)) {
      return true;
    }
    return patientMessageAdvancesSlotBooking(msg, state, scheduling);
  }
  if (timeIntent) return true;
  if (isAffirmativeShortReply(message) && patientWasOfferedAppointment(flags, profileRow)) {
    return true;
  }
  if (leadData?.bookingIntent === "high" || leadData?.bookingIntent === "medium") {
    return patientMessageAdvancesSlotBooking(msg, state, scheduling);
  }
  if (DENTAL_SYMPTOM_INTENT_RE.test(msg) && msg.length <= 140) return true;
  return patientMessageAdvancesSlotBooking(msg, state, scheduling);
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
  if (key === "ka") {
    return timeLabel
      ? `მადლობა — მივიღეთ თქვენი მოთხოვნა ${timeLabel}-ზე. ხელმისაწვდომობას შევამოწმებთ და მალე დაგიდასტურებთ.`
      : "მადლობა — მივიღეთ სასურველი დრო. მალე დაგიდასტურებთ ჩაწერას.";
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
 * Align AI slot math with clinics.iana_timezone (admin calendar), not only ops-profile logistics.
 * @param {string} clinicId
 * @param {import('./clinicAiSettings').ClinicAiProfile} clinicProfile
 */
async function resolveSchedulingRulesForClinic(clinicId, clinicProfile) {
  const base = resolveSchedulingRules(clinicProfile);
  const tz = await resolveClinicIanaTimezone(clinicId, base.timezone);
  return { ...base, timezone: tz };
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
  const preferredTimeMin =
    params.preferredTimeMin != null ? Number(params.preferredTimeMin) : null;

  const dayOffsets = params.preferredDateYmd
    ? dayOffsetsFromPreferredDate(params.preferredDateYmd, tz, booking.slotHorizonDays)
    : Array.from({ length: booking.slotHorizonDays }, (_, i) => i);

  const todayYmd = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const baseDay = parseISO(`${todayYmd}T12:00:00`);

  for (const d of dayOffsets) {
    if (slots.length >= maxSlots) break;
    const dateYmd = formatInTimeZone(addDays(baseDay, d), tz, "yyyy-MM-dd");
    const dayLocal = parseISO(`${dateYmd}T12:00:00`);
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
 *   recentTurns?: Array<{ role: string, text: string }>,
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

  const phone = await resolvePatientContactPhone(profile, {
    leadData: lead,
    patientMessage: params.patientMessage,
    bookingState: ab,
  });

  const profileId = String(profile.id || "").trim();
  if (
    phone &&
    UUID_RE.test(profileId) &&
    !normalizeWhatsappNumber(profile.whatsapp_number) &&
    resolveWhatsappFromInboundChannel(profile) === phone
  ) {
    void persistWhatsappCollection(profileId, {
      number: phone,
      source: "booking_inbound_wa_id",
    }).catch(() => {});
  }

  const nameState = await resolvePatientRecordName({
    profileRow: profile,
    patientMessage: params.patientMessage,
    recentTurns: params.recentTurns,
  });

  return {
    phone,
    hasContact: !!phone,
    name: nameState.name,
    hasName: nameState.hasName,
  };
}

/**
 * Patient picked a numbered option from the offered list (not a clock hour).
 * @param {string} message
 * @param {number} slotCount
 */
function parseSlotListIndexFromMessage(message, slotCount) {
  const max = Math.min(Math.max(Number(slotCount) || 0, 0), 12);
  if (max < 1) return null;
  const t = String(message || "").trim();
  if (!t) return null;

  const pick = t.match(SLOT_PICK_RE);
  if (pick) {
    const idx = Number(pick[2]) - 1;
    if (idx >= 0 && idx < max) return idx;
    return null;
  }

  const onlyNum = t.match(/^\s*#?\s*(\d{1,2})\s*[.!)?]*\s*$/i);
  if (onlyNum) {
    const num = Number(onlyNum[1]);
    if (num >= 1 && num <= max) return num - 1;
    return null;
  }

  const trNum = t.match(/^\s*(\d{1,2})\s*(?:\.\s*)?(?:numara|nolu|secenek|seçenek|secenegi|seçeneği)\s*$/i);
  if (trNum) {
    const num = Number(trNum[1]);
    if (num >= 1 && num <= max) return num - 1;
    return null;
  }

  if (/^\s*(birinci|ilk)\s*(?:sati[rı]|satir|secenek|seçenek|sira|sıra)?\s*$/i.test(t)) {
    return 0;
  }

  return null;
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function coordinatorRecentlyAskedSlotConfirmation(recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 6; i--) {
    const role = String(turns[i]?.role || "").toLowerCase();
    if (role !== "assistant" && role !== "coordinator" && role !== "clinic") continue;
    const tx = String(turns[i]?.text || "");
    if (
      /onayl[iı]yor musunuz/i.test(tx) &&
      (/evet.*yeterli|«evet»|yazman[iı]z yeterli/i.test(tx) || /onaylamak i[cç]in/i.test(tx))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} message
 * @param {ReturnType<typeof readAiBookingState>} state
 * @param {Record<string, unknown>} flags
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function shouldFinalizeSlotOnPatientYes(message, state, flags, recentTurns) {
  if (!isBookingConfirmationYes(message)) return false;
  const durable = readDurableBookingState(flags);
  return resolvesPendingConfirmation(message, durable);
}

/**
 * @param {string} message
 * @param {number} slotCount
 */
function isBareSlotListIndexMessage(message, slotCount) {
  return parseSlotListIndexFromMessage(message, slotCount) != null;
}

/**
 * @param {string} message
 */
function isBookingConfirmationYes(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 80) return false;
  if (BOOKING_CONFIRM_YES_RE.test(t)) return true;
  return /\b(onayliyorum|onaylıyorum|onaylarim|onaylarım|kesinlestir|kesinleştir)\b/i.test(t) && t.length < 72;
}

/**
 * @param {string} message
 */
function isBookingConfirmationNo(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 80) return false;
  return BOOKING_CONFIRM_NO_RE.test(t);
}

/**
 * @param {string} lang
 * @param {string} whenLabel
 * @param {string} [treatmentLabel]
 */
function buildSlotConfirmationDirectReply(lang, whenLabel, treatmentLabel) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const label = treatmentLabel || (key === "tr" ? "muayene" : "consultation");
  const when = String(whenLabel || "").trim();
  if (key === "tr") {
    return `${when} için ${label} randevunuzu onaylıyor musunuz? Onaylamak için «Evet» yazmanız yeterli.`;
  }
  if (key === "ru") {
    return `Подтверждаете запись на ${when}? Напишите «Да» для подтверждения.`;
  }
  if (key === "ka") {
    return `${when} ჩაწერას ადასტურებთ? დაწერეთ «კი» დასადასტურებლად.`;
  }
  return `Do you confirm your ${label} appointment for ${when}? Reply «Yes» to confirm.`;
}

/**
 * @param {string} lang
 * @param {string} whenLabel
 */
function buildSlotConfirmationReminder(lang, whenLabel) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const when = String(whenLabel || "").trim();
  if (key === "tr") {
    return `${when} randevusunu onaylıyor musunuz? Evet veya Hayır yazabilirsiniz.`;
  }
  if (key === "ru") {
    return `Подтверждаете запись на ${when}? Напишите «Да» или «Нет».`;
  }
  if (key === "ka") {
    return `${when} ჩაწერას ადასტურებთ? დაწერეთ «კი» ან «არა».`;
  }
  return `Please confirm the appointment for ${when} (Yes or No).`;
}

/**
 * @param {Array<{ dateYmd?: string }>} slots
 */
function dominantOfferedDateYmd(slots) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    const d = String(slot?.dateYmd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = d;
    }
  }
  return best;
}

/**
 * When several offered slots share the same clock time, keep the day from the list we sent.
 * @param {Array<{ dateYmd?: string, time?: string, startAt?: string }>} slots
 * @param {number} timeMin
 */
function pickSlotMatchingTime(slots, timeMin) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length || timeMin == null || !Number.isFinite(timeMin)) return null;

  const targetHm = formatMinutesAsHm(timeMin);
  const matches = list.filter((slot) => {
    const hm = String(slot?.time || "").slice(0, 5);
    if (targetHm && hm === targetHm) return true;
    const sm = parseHm(slot?.time);
    return sm != null && Math.abs(sm - timeMin) <= 45;
  });
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  const dominant = dominantOfferedDateYmd(list);
  if (dominant) {
    const onDominant = matches.find((s) => String(s.dateYmd || "") === dominant);
    if (onDominant) return onDominant;
  }
  return matches
    .slice()
    .sort((a, b) => String(a.dateYmd || "").localeCompare(String(b.dateYmd || "")))
    .pop();
}

/**
 * @param {string} message
 * @param {Array<{ id: string, label: string, startAt: string }>} offeredSlots
 */
function parseSlotSelectionFromMessage(message, offeredSlots) {
  const slots = Array.isArray(offeredSlots) ? offeredSlots : [];
  if (!slots.length) return null;
  const t = String(message || "");

  const listIdx = parseSlotListIndexFromMessage(message, slots.length);
  if (listIdx != null) return slots[listIdx];

  const pick = t.match(SLOT_PICK_RE);
  if (pick) {
    const idx = Number(pick[2]) - 1;
    if (idx >= 0 && idx < slots.length) return slots[idx];
  }

  if (isBareSlotListIndexMessage(message, slots.length)) {
    return null;
  }

  const conversational = matchSlotByConversationalTime(message, slots, 45);
  if (conversational?.slot) {
    const refined =
      conversational.preferredMinutes != null
        ? pickSlotMatchingTime(slots, conversational.preferredMinutes)
        : null;
    return refined || conversational.slot;
  }

  const preferredMin = parseConversationalTimeToMinutes(message);
  if (preferredMin != null) {
    const matched = pickSlotMatchingTime(slots, preferredMin);
    if (matched) return matched;
  }

  /** @type {Array<Record<string, unknown>>} */
  const timeRegexMatches = [];
  for (const slot of slots) {
    const timePart = slot.time || "";
    if (timePart && new RegExp(`\\b${timePart.replace(":", "\\:")}\\b`).test(t)) {
      timeRegexMatches.push(slot);
    }
  }
  if (timeRegexMatches.length === 1) return timeRegexMatches[0];
  if (timeRegexMatches.length > 1) {
    const preferredMinForRegex = parseConversationalTimeToMinutes(message);
    if (preferredMinForRegex != null) {
      const refined = pickSlotMatchingTime(timeRegexMatches, preferredMinForRegex);
      if (refined) return refined;
    }
    const dominant = dominantOfferedDateYmd(slots);
    const onDominant = timeRegexMatches.find((s) => String(s.dateYmd || "") === dominant);
    if (onDominant) return onDominant;
    return timeRegexMatches[timeRegexMatches.length - 1];
  }

  for (const slot of slots) {
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
  const catalogSlots = Array.isArray(state.offeredSlots) ? state.offeredSlots : [];
  if (catalogSlots.length > 0) {
    const picked = parseSlotSelectionFromMessage(message, catalogSlots);
    if (picked) return picked;
  }

  const timeMin =
    preferredTimeMin != null ? Number(preferredTimeMin) : parseConversationalTimeToMinutes(message);
  if (timeMin == null || !Number.isFinite(timeMin)) return null;

  let dateYmd = preferredDateYmd || null;
  if (!dateYmd && state.selectedSlot?.dateYmd) {
    dateYmd = String(state.selectedSlot.dateYmd);
  }
  if (!dateYmd && catalogSlots.length > 0) {
    const fromMatch = pickSlotMatchingTime(catalogSlots, timeMin);
    if (fromMatch?.dateYmd) dateYmd = String(fromMatch.dateYmd);
    else {
      const dominant = dominantOfferedDateYmd(catalogSlots);
      if (dominant) dateYmd = dominant;
    }
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
function buildDirectBookingReply(lang, mode, whenLabel, treatmentLabel, opts = {}) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const label = treatmentLabel || (key === "tr" ? "Muayene" : "Consultation");
  let base = "";
  if (mode === BOOKING_MODES.SUGGEST_ONLY) {
    if (key === "tr") {
      base = `Teşekkürler! ${label} için ${whenLabel} saatini not aldık. Ekibimiz kısa süre içinde randevuyu onaylayıp size yazacak.`;
    } else {
      base = `Thank you! We noted ${label} for ${whenLabel}. Our team will confirm the appointment shortly.`;
    }
  } else if (mode === BOOKING_MODES.DRAFT_BOOKING) {
    if (key === "tr") {
      base = `Teşekkürler! ${label} için ${whenLabel} saati ön rezervasyon olarak kaydedildi. Klinik ekibimiz kısa sürede onaylayacak ve size dönecek.`;
    } else {
      base = `Thank you! We reserved ${label} for ${whenLabel} as a pending appointment. Our clinic team will confirm shortly.`;
    }
  } else if (key === "tr") {
    base = `Harika! ${label} randevunuz ${whenLabel} için onaylandı. Görüşmek üzere!`;
  } else {
    base = `Great! Your ${label} appointment is confirmed for ${whenLabel}. We look forward to seeing you!`;
  }
  if (opts.includeClinicMembershipNotice) {
    base = `${base}\n\n${buildAiClinicMembershipAfterBookingNotice(key, opts.clinicCode || null)}`;
  }
  return base;
}

/**
 * @param {string} lang
 * @param {string} mode
 * @param {string} whenLabel
 * @param {string} treatmentLabel
 * @param {string} patientId
 */
async function buildDirectBookingReplyForPatient(
  lang,
  mode,
  whenLabel,
  treatmentLabel,
  patientId,
  clinicId,
) {
  const needsNotice = patientId ? await patientNeedsClinicEnrollmentNotice(patientId) : false;
  let clinicCode = null;
  if (needsNotice && clinicId) {
    clinicCode = await fetchClinicCodeByClinicId(clinicId);
  }
  return buildDirectBookingReply(lang, mode, whenLabel, treatmentLabel, {
    includeClinicMembershipNotice: needsNotice,
    clinicCode,
  });
}

const APPOINTMENT_STATUS_QUESTION_RE =
  /\b(kesinlesti|kesinleşti|onaylandi\s*mi|onaylandı\s*mi|kesin\s*mi|netlesti|netleşti|confirmed\??|is\s+it\s+confirmed|finalized\??|randevum\s+var\s*mi|randevu\s+olustu|randevu\s+oluştu|ayni\s+saat|aynı\s+saat|yukarida|yukarıda|yazdim|yazdım)\b/i;

/**
 * @param {string} message
 */
function isAppointmentStatusQuestion(message) {
  return APPOINTMENT_STATUS_QUESTION_RE.test(String(message || ""));
}

/**
 * @param {string} message
 */
function patientRequestsBookingChange(message) {
  return /\b(baska|başka|yeni\s+saat|degistir|değiştir|ertele|iptal|farkli|farklı|yeniden\s+planla|baska\s+gun|başka\s+gün)\b/i.test(
    String(message || ""),
  );
}

/**
 * @param {Record<string, unknown>} flags
 * @param {ReturnType<typeof readAiBookingState>} state
 */
function patientHasActiveBooking(flags, state) {
  const st = String(state.stage || "").toLowerCase();
  if (st === "booked" || st === "pending_staff" || st === "suggest_noted") return true;
  if (state.adminCalendarPersisted && state.pendingAppointmentId) return true;
  const appt = flags.activeAppointment;
  if (appt && typeof appt === "object" && appt.startAt) {
    const ast = String(appt.status || "").toLowerCase();
    if (ast !== "cancelled" && ast !== "canceled") return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} flags
 * @param {ReturnType<typeof readAiBookingState>} state
 * @param {ReturnType<typeof resolveSchedulingRulesForClinic>} scheduling
 * @param {string} locale
 */
function resolveExistingBookedSlot(flags, state, scheduling, locale) {
  const appt = flags.activeAppointment;
  if (appt && typeof appt === "object" && appt.startAt) {
    const startAt = toStartIso(appt.startAt);
    if (startAt) {
      const tz = scheduling.timezone || "UTC";
      return {
        startAt,
        label: formatAppointmentDisplay(startAt, locale, tz),
        dateYmd: formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd"),
        time: formatInTimeZone(new Date(startAt), tz, "HH:mm"),
      };
    }
  }
  if (
    state.selectedSlot?.startAt &&
    (state.pendingAppointmentId || state.stage === "booked" || state.adminCalendarPersisted)
  ) {
    return state.selectedSlot;
  }
  return null;
}

/**
 * @param {{ startAt?: string }|null} a
 * @param {{ startAt?: string }|null} b
 */
function slotsMatchSameInstant(a, b) {
  const ta = Date.parse(String(a?.startAt || ""));
  const tb = Date.parse(String(b?.startAt || ""));
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) < 120000;
}

/**
 * @param {string} lang
 * @param {string} whenLabel
 * @param {string} treatmentLabel
 * @param {{ statusQuestion?: boolean }} [opts]
 */
function buildExistingBookingAckReply(lang, whenLabel, treatmentLabel, opts = {}) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const label = treatmentLabel || (key === "tr" ? "Muayene" : "Consultation");
  if (opts.statusQuestion) {
    if (key === "tr") {
      return `Evet — ${label} randevunuz ${whenLabel} için kayıtlı ve onaylı. Görüşmek üzere!`;
    }
    return `Yes — your ${label} appointment for ${whenLabel} is on our calendar. See you then!`;
  }
  if (key === "tr") {
    return `Randevunuz zaten ${whenLabel} için kayıtlı. Farklı bir saat isterseniz yazmanız yeterli.`;
  }
  return `Your appointment is already booked for ${whenLabel}. Reply with another time if you need to change it.`;
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

  const guardian = validateBookingGuardian({
    selectedSlot: params.slot,
    startAt,
    timezone: params.timezone,
  });
  if (!guardian.ok && guardian.reason !== "no_selected_slot_to_compare") {
    logBookingAudit({
      auditEvent: "GUARDIAN_BLOCKED",
      profileId: params.profileId ? String(params.profileId).slice(0, 8) : null,
      patientId: params.patientId ? String(params.patientId).slice(0, 8) : null,
      reason: guardian.reason,
      expected: guardian.expected || guardian.expectedDate || guardian.expectedStartAt || null,
      actual: guardian.actual || guardian.actualDate || guardian.actualStartAt || null,
      slot: params.slot,
      startAt,
    });
    return {
      ok: false,
      reason: "guardian_mismatch",
      guardian,
      startAt,
      mode,
    };
  }

  const durationMinutes =
    Number(params.slot.durationMinutes) ||
    resolveTreatmentDurationMinutes(params.treatmentLabel, booking);

  const calendarCtx = await resolveAiBookingCalendarContext({
    patientId: params.patientId,
    clinicId: params.clinicId,
    profileId: params.profileId,
    profileRow: params.profileRow,
    patientMessage: params.patientMessage,
    recentTurns: params.recentTurns,
  });

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
        procedure: "Consultation",
        treatment: "Consultation",
        appointment_type: "consultation",
        status: status || "scheduled",
        duration_minutes: durationMinutes,
        timezone: params.timezone || null,
        doctor_id: calendarCtx.doctorId,
        assigned_doctor_id: calendarCtx.doctorId,
        notes: `ai_booking:${mode}${params.treatmentLabel ? ` treatment:${String(params.treatmentLabel).slice(0, 80)}` : ""}${params.contactPhone ? ` contact:${params.contactPhone}` : ""}`,
        source: `ai_${mode}`,
      },
      { timezone: params.timezone, patientName: calendarCtx.patientName },
    );
    if (persisted.ok) {
      appointmentId = persisted.id;
      calendarTable = persisted.table || null;
      const adminCalendarPersisted = calendarTable === "encounter_treatments";
      if (!adminCalendarPersisted) {
        console.warn("[aiAppointmentBooking] appointments only — admin calendar may be empty", {
          table: calendarTable,
          id: appointmentId ? String(appointmentId).slice(0, 8) : null,
        });
      }
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

  const adminCalendarPersisted = calendarTable === "encounter_treatments";

  if (mode === BOOKING_MODES.FULL_AUTO) {
    await syncAppointmentToCoordination({
      patientId: params.patientId,
      clinicId: params.clinicId,
      eventType: "appointment_booked",
      appointment: {
        id: appointmentId,
        startAt,
        treatmentLabel: "Consultation",
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
        treatmentLabel: "Consultation",
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
      calendarPersisted: adminCalendarPersisted,
      adminCalendarPersisted,
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

  logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_CREATED, {
    profileId: params.profileId ? String(params.profileId).slice(0, 8) : null,
    patientId: params.patientId ? String(params.patientId).slice(0, 8) : null,
    clinicId: params.clinicId ? String(params.clinicId).slice(0, 8) : null,
    bookingPayload: {
      appointmentId: appointmentId ? String(appointmentId).slice(0, 8) : null,
      startAt,
      mode,
      selectedDate: params.slot?.dateYmd || null,
      selectedSlot: params.slot?.startAt || null,
      timezone: params.timezone || null,
    },
    guardian: guardian.ok ? "passed" : guardian.reason,
  });

  return { ok: true, appointmentId, startAt, mode, calendarTable, adminCalendarPersisted };
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
  const prevRawAb =
    prev.aiBooking && typeof prev.aiBooking === "object" ? prev.aiBooking : {};
  const mergedAb = mergeAiBookingPatch(prevRawAb, patch);
  const nextFlags = {
    ...prev,
    aiBooking: mergedAb,
  };
  if (mergedAb.bookingActive === true && mergedAb.awaitingAction) {
    nextFlags.appointmentOfferPending = true;
  }
  if (
    mergedAb.stage === "booked" ||
    mergedAb.stage === "pending_staff" ||
    mergedAb.stage === "suggest_noted"
  ) {
    nextFlags.appointmentOfferPending = false;
  }
  if (mergedAb.canonicalBooking && typeof mergedAb.canonicalBooking === "object") {
    nextFlags.canonicalBooking = mergedAb.canonicalBooking;
  }
  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: nextFlags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);
}

/**
 * @param {Awaited<ReturnType<typeof resolveBookingContact>>} contact
 * @param {ReturnType<typeof normalizeAiBookingConfig>} booking
 * @param {ReturnType<typeof readAiBookingState>} state
 * @param {Record<string, unknown>} profileRow
 */
function resolveBookingPhoneForTurn(contact, booking, state, profileRow) {
  return (
    contact.phone ||
    state.contactPhone ||
    normalizeWhatsappNumber(profileRow?.whatsapp_number) ||
    resolveWhatsappFromInboundChannel(profileRow) ||
    null
  );
}

/**
 * @param {Awaited<ReturnType<typeof resolveBookingContact>>} contact
 * @param {ReturnType<typeof normalizeAiBookingConfig>} booking
 * @param {ReturnType<typeof readAiBookingState>} state
 * @param {Record<string, unknown>} profileRow
 */
function patientCanBookWithContact(contact, booking, state, profileRow) {
  if (contact.hasContact) return true;
  if (booking.contactRequired === false) return true;
  return !!resolveBookingPhoneForTurn(contact, booking, state, profileRow);
}

/**
 * Patient confirmed a slot — create the appointment (never fall through to a fresh slot list).
 * @param {object} params
 */
async function completeBookingAfterSlotConfirmation(params) {
  const {
    message,
    state,
    flags,
    contact,
    profileRow,
    profileId,
    clinicId,
    patientId,
    booking,
    scheduling,
    treatmentLabel,
    locale,
    recentTurns,
  } = params;

  if (!shouldFinalizeSlotOnPatientYes(message, state, flags, recentTurns)) return null;

  logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_CONFIRMED, {
    profileId: profileId ? String(profileId).slice(0, 8) : null,
    selectedSlot: state.selectedSlot?.startAt || null,
    selectedDate: state.selectedSlot?.dateYmd || null,
  });

  const lang = String(locale || "tr").slice(0, 2);
  const phone = resolveBookingPhoneForTurn(contact, booking, state, profileRow);
  const channelCtx = resolveBookingChannelContext(profileRow, params);
  const contactPromptOpts = buildBookingContactPromptOpts(profileRow, contact, channelCtx);

  if (booking.contactRequired !== false && !phone) {
    if (profileId) {
      await persistAiBookingFlags(profileId, {
        stage: "need_contact",
        selectedSlot: state.selectedSlot,
        appointmentOfferPending: true,
      });
    }
    return {
      engaged: true,
      promptBlock: buildContactRequiredPrompt(lang, contactPromptOpts),
      directReply: buildAffirmativeContactDirectReply(lang, contactPromptOpts),
      needContact: true,
    };
  }

  const nameState = await resolvePatientRecordName({
    profileRow,
    patientMessage: message,
    recentTurns,
  });
  if (!nameState.hasName) {
    if (state.selectedSlot && profileId) {
      await persistAiBookingFlags(profileId, {
        stage: "need_name",
        selectedSlot: state.selectedSlot,
        appointmentOfferPending: true,
      });
    }
    return {
      engaged: true,
      promptBlock: buildNameRequiredPrompt(lang),
      directReply: buildAffirmativeNameDirectReply(lang),
      needName: true,
    };
  }

  let slotToBook = state.selectedSlot;
  if (!slotToBook?.startAt && Array.isArray(state.offeredSlots) && state.offeredSlots.length) {
    for (let i = (recentTurns || []).length - 1; i >= 0 && i >= (recentTurns || []).length - 8; i--) {
      const turn = recentTurns[i];
      if (String(turn?.role || "") !== "patient") continue;
      const picked = parseSlotSelectionFromMessage(String(turn.text || ""), state.offeredSlots);
      if (picked?.startAt) {
        slotToBook = picked;
        break;
      }
    }
  }
  if (!slotToBook?.startAt && Array.isArray(recentTurns)) {
    const inferred = inferPendingSlotFromRecentPatientTurns(recentTurns, scheduling.timezone);
    if (inferred.timeMin != null) {
      const fromOffered = pickSlotMatchingTime(state.offeredSlots, inferred.timeMin);
      if (fromOffered?.startAt) {
        slotToBook = fromOffered;
      } else if (inferred.dateYmd) {
        slotToBook = buildSlotFromPreferredDateTime(
          inferred.dateYmd,
          inferred.timeMin,
          scheduling,
          booking,
          treatmentLabel,
          locale,
        );
      }
    }
  }
  const whenPending =
    slotToBook?.label ||
    (slotToBook?.startAt
      ? formatAppointmentDisplay(slotToBook.startAt, locale, scheduling.timezone)
      : "");
  if (!slotToBook?.startAt) {
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildSlotConfirmationReminder(lang, whenPending),
      awaitingConfirmation: true,
    };
  }

  const created = await createAppointmentFromAiSelection({
    clinicId,
    patientId,
    profileId,
    profileRow,
    patientMessage: message,
    recentTurns,
    slot: slotToBook,
    mode: booking.mode,
    booking,
    treatmentLabel,
    contactPhone: phone,
    locale,
    timezone: scheduling.timezone,
  });

  if (created.reason === "contact_required") {
    return {
      engaged: true,
      promptBlock: buildContactRequiredPrompt(lang, contactPromptOpts),
      directReply: buildAffirmativeContactDirectReply(lang, contactPromptOpts),
      needContact: true,
    };
  }

  if (!created.ok) {
    if (created.reason === "guardian_mismatch") {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildSlotConfirmationReminder(
          lang,
          whenPending ||
            slotToBook?.label ||
            formatAppointmentDisplay(slotToBook.startAt, locale, scheduling.timezone),
        ),
        awaitingConfirmation: true,
        guardianBlocked: true,
      };
    }
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

  if (profileId) {
    const stage =
      booking.mode === BOOKING_MODES.SUGGEST_ONLY
        ? "suggest_noted"
        : booking.mode === BOOKING_MODES.DRAFT_BOOKING
          ? "pending_staff"
          : "booked";
    const apptStatus =
      stage === "pending_staff" ? "pending" : stage === "booked" ? "scheduled" : "noted";
    const calendarCtx = await resolveAiBookingCalendarContext({
      patientId,
      clinicId,
      profileId,
      profileRow,
      patientMessage: message,
      recentTurns,
    });
    const canonicalBooking = buildCanonicalBookingRecord({
      bookingId: created.appointmentId,
      startAt: created.startAt,
      timezone: scheduling.timezone,
      locale,
      doctorId: calendarCtx?.doctorId || null,
      doctorName: calendarCtx?.doctorName || null,
      status: apptStatus,
      treatmentLabel,
    });
    await persistAiBookingFlags(
      profileId,
      buildClosedBookingPatch({
        stage,
        bookingId: created.appointmentId,
        pendingAppointmentId: created.appointmentId,
        canonicalBooking,
        calendarPersisted: created.adminCalendarPersisted === true,
        adminCalendarPersisted: created.adminCalendarPersisted === true,
        contactPhone: phone,
      }),
    );
  }

  const whenLabel =
    slotToBook.label ||
    formatAppointmentDisplay(created.startAt, locale, scheduling.timezone);
  return {
    engaged: true,
    promptBlock: "",
    directReply: await buildDirectBookingReplyForPatient(
      lang,
      booking.mode,
      whenLabel,
      treatmentLabel,
      patientId,
      clinicId,
    ),
    booked: !!created.appointmentId || booking.mode === BOOKING_MODES.SUGGEST_ONLY,
  };
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
 *   recentTurns?: Array<{ role: string, text: string }>,
 * }} params
 */
async function prepareAiAppointmentBookingTurn(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const profileRow = params.profileRow || {};
  const profileId = String(profileRow.id || "").trim();
  const message = String(params.patientMessage || "");
  const locale = String(params.locale || profileRow.conversation_primary_language || "en").slice(0, 5);

  let flags =
    profileRow.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {};
  if (profileId && isSupabaseEnabled()) {
    try {
      const { data: freshRow } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("operational_intake_flags")
        .eq("id", profileId)
        .maybeSingle();
      if (
        freshRow?.operational_intake_flags &&
        typeof freshRow.operational_intake_flags === "object"
      ) {
        flags = freshRow.operational_intake_flags;
      }
    } catch {
      /* use profileRow flags */
    }
  }
  if (profileId) {
    flags = await applyBookingExpiryIfNeeded(profileId, flags, persistAiBookingFlags);
  }
  const langEarlyAll = locale.slice(0, 2);
  const durableAfterExpiry = readDurableBookingState(flags);
  if (
    String(durableAfterExpiry.stage || "") === "expired" &&
    isBookingConfirmationYesMessage(message)
  ) {
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildExpiredBookingReply(langEarlyAll),
      expiredBooking: true,
    };
  }

  const canonical = readCanonicalBooking(flags);
  if (hasCompletedCanonicalBooking(flags)) {
    if (isBookingStatusInquiry(message)) {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildCanonicalStatusReply(langEarlyAll, canonical),
        booked: true,
        statusQuery: true,
        canonicalBooking: canonical,
      };
    }
    if (isPostBookingStaleActionMessage(message) && !patientRequestsBookingChange(message)) {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildPostBookingStaleInputReply(langEarlyAll, canonical),
        booked: true,
        postBookingGuard: true,
        canonicalBooking: canonical,
      };
    }
  }

  const leadData = params.leadData || {};

  if (!shouldEngageAppointmentBooking(message, leadData, flags, profileRow)) {
    return { engaged: false, promptBlock: "", directReply: null };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const booking = normalizeAiBookingConfig(clinicProfile.communicationPolicy);
  if (!booking.enabled) {
    return { engaged: false, promptBlock: "", directReply: null };
  }

  const scheduling = await resolveSchedulingRulesForClinic(clinicId, clinicProfile);
  const state = readAiBookingState(flags);
  const durable = readDurableBookingState(flags);
  const recentTurns = Array.isArray(params.recentTurns) ? params.recentTurns : [];
  const preferredDateYmd = parsePreferredDateFromMessage(message, scheduling.timezone);
  const catalogSlots = Array.isArray(state.offeredSlots)
    ? state.offeredSlots
    : durable.offeredSlots?.length
      ? durable.offeredSlots
      : [];
  let offeredSlots = filterSlotsWithinWorkingHours(catalogSlots, scheduling);
  if (!offeredSlots.length && catalogSlots.length) offeredSlots = catalogSlots;
  const listIndexOnly =
    catalogSlots.length > 0 && isBareSlotListIndexMessage(message, catalogSlots.length);
  const pickingOfferedSlot =
    catalogSlots.length > 0 && !!parseSlotSelectionFromMessage(message, catalogSlots);
  const preferredTimeMin = listIndexOnly ? null : parsePreferredTimeMinutesFromMessage(message);
  const slotIndexPick = listIndexOnly
    ? parseSlotSelectionFromMessage(message, catalogSlots) ||
      parseSlotFromDurableState(message, durable)
    : offeredSlots.length > 0
      ? parseSlotSelectionFromMessage(message, offeredSlots) ||
        parseSlotFromDurableState(message, durable)
      : parseSlotFromDurableState(message, durable);
  const isSlotIndexOnlyReply =
    listIndexOnly ||
    (!!slotIndexPick &&
      /^\s*#?\s*(\d{1,2})\s*[.!)?]*\s*$/i.test(String(message || "").trim()));
  const timeOnly =
    isTimeOnlyPatientMessage(message) && !isSlotIndexOnlyReply && !listIndexOnly;
  // Do not wipe offered slots when the patient picks a concrete time (e.g. "11:00") —
  // that prevented parseSlotSelectionFromMessage from matching and blocked calendar writes.
  const wantsFreshSlotList =
    !pickingOfferedSlot &&
    !isSlotIndexOnlyReply &&
    state.stage !== "awaiting_slot_confirm" &&
    !shouldFinalizeSlotOnPatientYes(message, state, flags, recentTurns) &&
    (patientRequestsAlternateSlots(message) ||
    patientDeclinedOfferedTimes(message) ||
      (!!preferredDateYmd && preferredTimeMin == null));

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
    recentTurns,
  });
  const channelCtx = resolveBookingChannelContext(profileRow, params);
  const contactPromptOpts = buildBookingContactPromptOpts(profileRow, contact, channelCtx);

  const pendingCompletion = await tryCompletePendingAiBooking({
    message,
    state,
    flags,
    contact,
    clinicId,
    patientId,
    profileId,
    profileRow,
    booking,
    scheduling,
    treatmentLabel,
    locale,
    preferredDateYmd,
    preferredTimeMin,
    recentTurns,
  });
  if (pendingCompletion?.directReply) {
    return {
      engaged: true,
      promptBlock: "",
      directReply: pendingCompletion.directReply,
      booked: pendingCompletion.booked === true,
      calendarCompleted: true,
    };
  }

  const langEarly = locale.slice(0, 2);

  if (state.stage === "awaiting_slot_confirm") {
    const pendingSlot = state.selectedSlot;
    const whenPending =
      pendingSlot?.label ||
      (pendingSlot?.startAt
        ? formatAppointmentDisplay(pendingSlot.startAt, locale, scheduling.timezone)
        : "");

    if (isBookingConfirmationNo(message)) {
      const slotsRestore = filterSlotsWithinWorkingHours(
        state.offeredSlots?.length ? state.offeredSlots : offeredSlots,
        scheduling,
      );
      if (profileId && slotsRestore.length) {
        await persistAiBookingFlags(profileId, {
          stage: "slots_offered",
          offeredSlots: slotsRestore,
          offeredAt: state.offeredAt || new Date().toISOString(),
          selectedSlot: null,
          appointmentOfferPending: true,
        });
      }
      return {
        engaged: true,
        promptBlock: buildSlotOfferPromptBlock({
          mode: booking.mode,
          slots: slotsRestore,
          treatmentLabel,
          lang: langEarly,
          hasContact: contact.hasContact,
          hasName: contact.hasName,
          scheduling,
          patientMessage: message,
          preferredDateYmd,
          whatsappChannel: contactPromptOpts.whatsappChannel,
          knownPhone: contactPromptOpts.knownPhone,
        }),
        directReply: buildSlotOfferDirectReply(slotsRestore, langEarly, {
          intro:
            langEarly === "tr"
              ? "Tamam, başka bir saat seçebilirsiniz. Müsait saatler:"
              : langEarly === "ka"
                ? "კარგი, აირჩიეთ სხვა დრო. თავისუფალი საათები:"
                : langEarly === "ru"
                  ? "Хорошо, выберите другое время. Свободные слоты:"
                  : "Sure — please pick another time. Available slots:",
          needContact: booking.contactRequired !== false && !contact.hasContact,
          needName: contact.hasContact && !contact.hasName,
          whatsappChannel: contactPromptOpts.whatsappChannel,
          knownPhone: contactPromptOpts.knownPhone,
        }),
      };
    }

    const newPick =
      offeredSlots.length > 0
        ? parseSlotSelectionFromMessage(message, offeredSlots)
        : parseSlotSelectionFromMessage(message, state.offeredSlots);
    if (newPick && !slotsMatchSameInstant(newPick, pendingSlot)) {
      if (profileId) {
        await persistAiBookingFlags(profileId, {
          stage: "awaiting_slot_confirm",
          selectedSlot: newPick,
          offeredSlots: state.offeredSlots?.length ? state.offeredSlots : offeredSlots,
          appointmentOfferPending: true,
          awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
        });
        logBookingAuditEvent(BOOKING_AUDIT_EVENTS.SLOT_SELECTED, {
          profileId: String(profileId).slice(0, 8),
          selectedSlot: newPick.startAt,
          selectedDate: newPick.dateYmd || null,
        });
        logBookingAuditEvent(BOOKING_AUDIT_EVENTS.CONFIRMATION_REQUESTED, {
          profileId: String(profileId).slice(0, 8),
          selectedSlot: newPick.startAt,
        });
      }
      const whenNew =
        newPick.label ||
        formatAppointmentDisplay(newPick.startAt, locale, scheduling.timezone);
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildSlotConfirmationDirectReply(langEarly, whenNew, treatmentLabel),
        awaitingConfirmation: true,
      };
    }

    if (!isBookingConfirmationYes(message)) {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildSlotConfirmationReminder(langEarly, whenPending),
        awaitingConfirmation: true,
      };
    }

    const confirmed = await completeBookingAfterSlotConfirmation({
      message,
      state,
      flags,
      contact,
      profileRow,
      profileId,
      clinicId,
      patientId,
      booking,
      scheduling,
      treatmentLabel,
      locale,
      recentTurns,
      channel: params.channel,
      inboundSource: params.inboundSource || params.channel,
    });
    if (confirmed) return confirmed;
  }

  if (bookingNeedsCalendarPersist(flags)) {
    const slotFromFlags = slotFromBookingFlags(flags, scheduling, booking, treatmentLabel, locale);
    const phone =
      contact.phone ||
      readAiBookingState(flags).contactPhone ||
      normalizeWhatsappNumber(profileRow.whatsapp_number);
    if (
      slotFromFlags?.startAt &&
      (contact.hasContact || booking.contactRequired === false || phone)
    ) {
      const reconciled = await createAppointmentFromAiSelection({
        clinicId,
        patientId,
        profileId,
        profileRow,
        patientMessage: message,
        recentTurns,
        slot: slotFromFlags,
        mode: booking.mode,
        booking,
        treatmentLabel,
        contactPhone: phone,
        locale,
        timezone: scheduling.timezone,
      });
      if (reconciled.ok) {
        await persistAiBookingFlags(profileId, {
          stage:
            booking.mode === BOOKING_MODES.FULL_AUTO
              ? "booked"
              : booking.mode === BOOKING_MODES.SUGGEST_ONLY
                ? "suggest_noted"
                : "pending_staff",
          selectedSlot: slotFromFlags,
          pendingAppointmentId: reconciled.appointmentId,
          calendarPersisted: reconciled.adminCalendarPersisted === true,
          adminCalendarPersisted: reconciled.adminCalendarPersisted === true,
          contactPhone: phone,
        });
        const whenLabel =
          slotFromFlags.label ||
          formatAppointmentDisplay(reconciled.startAt, locale, scheduling.timezone);
        const restatesOnly =
          /\b(randevu|appointment|implant|implantasyon)\b/i.test(message) &&
          (preferredDateYmd || preferredTimeMin != null);
        if (restatesOnly) {
          return {
            engaged: true,
            promptBlock: "",
            directReply: await buildDirectBookingReplyForPatient(
              locale.slice(0, 2),
              booking.mode,
              whenLabel,
              treatmentLabel,
              patientId,
              clinicId,
            ),
            booked: true,
            calendarReconciled: true,
          };
        }
      } else {
        console.warn("[aiAppointmentBooking] calendar reconcile failed", reconciled);
      }
    }
  }

  let selected = slotIndexPick;
  if (
    !selected &&
    state.stage === "awaiting_slot_confirm" &&
    state.selectedSlot &&
    isBookingConfirmationYes(message)
  ) {
    selected = state.selectedSlot;
  }
  if (!selected && catalogSlots.length > 0) {
    selected = parseSlotSelectionFromMessage(message, catalogSlots);
  }
  if (!selected && offeredSlots.length > 0) {
    selected = parseSlotSelectionFromMessage(message, offeredSlots);
  }
  if (!selected && !listIndexOnly) {
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

  const existingBooked = resolveExistingBookedSlot(flags, state, scheduling, locale);
  if (existingBooked) {
    const lang = locale.slice(0, 2);
    const whenLabel =
      existingBooked.label ||
      formatAppointmentDisplay(existingBooked.startAt, locale, scheduling.timezone);
    if (isAppointmentStatusQuestion(message)) {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildExistingBookingAckReply(lang, whenLabel, treatmentLabel, {
          statusQuestion: true,
        }),
        booked: true,
      };
    }
    if (selected && slotsMatchSameInstant(selected, existingBooked)) {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildExistingBookingAckReply(lang, whenLabel, treatmentLabel),
        booked: true,
      };
    }
    if (!selected && !patientRequestsBookingChange(message) && patientHasActiveBooking(flags, state)) {
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildExistingBookingAckReply(lang, whenLabel, treatmentLabel, {
          statusQuestion: true,
        }),
        booked: true,
      };
    }
  }

  if (selected && contact.hasContact && !contact.hasName) {
    const lang = locale.slice(0, 2);
    const slotTimeMin = parseHm(selected.time);
    await persistAiBookingFlags(profileId, {
      stage: "need_name",
      selectedSlot: selected,
      preferredDateYmd: selected.dateYmd || preferredDateYmd || null,
      preferredTimeMin:
        slotTimeMin != null
          ? slotTimeMin
          : preferredTimeMin != null
            ? preferredTimeMin
            : null,
      appointmentOfferPending: true,
    });
    return {
      engaged: true,
      promptBlock: buildNameRequiredPrompt(lang),
      directReply: isAffirmativeShortReply(message) ? buildAffirmativeNameDirectReply(lang) : null,
      needName: true,
    };
  }

  if (selected && booking.contactRequired && !contact.hasContact) {
    const lang = locale.slice(0, 2);
    const slotTimeMin = parseHm(selected.time);
    await persistAiBookingFlags(profileId, {
      stage: "need_contact",
      selectedSlot: selected,
      preferredDateYmd: selected.dateYmd || preferredDateYmd || null,
      preferredTimeMin:
        slotTimeMin != null
          ? slotTimeMin
          : preferredTimeMin != null
            ? preferredTimeMin
            : null,
      appointmentOfferPending: true,
    });
    return {
      engaged: true,
      promptBlock: buildContactRequiredPrompt(lang, contactPromptOpts),
      directReply: null,
      needContact: true,
    };
  }

  if (selected && patientCanBookWithContact(contact, booking, state, profileRow)) {
    const bookingPhone = resolveBookingPhoneForTurn(contact, booking, state, profileRow);
    if (existingBooked && slotsMatchSameInstant(selected, existingBooked)) {
      const lang = locale.slice(0, 2);
      const whenLabel =
        existingBooked.label ||
        formatAppointmentDisplay(existingBooked.startAt, locale, scheduling.timezone);
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildExistingBookingAckReply(lang, whenLabel, treatmentLabel),
        booked: true,
      };
    }

    const busyNow = await fetchClinicBusyIntervalsForDay(
      clinicId,
      selected.dateYmd || String(selected.startAt || "").slice(0, 10),
      scheduling.timezone,
      { excludePatientId: patientId },
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
        directReply: altSlots.length
          ? buildSlotOfferDirectReply(altSlots, lang, {
              intro:
          lang === "tr"
                  ? "O saat maalesef artık dolu görünüyor. Size uygun en yakın boş saatler:"
                  : lang === "ru"
                    ? "Это время уже занято. Ближайшие свободные слоты:"
                    : lang === "ka"
                      ? "ეს დრო სამწუხაროდ დაკავებულია. უახლოესი თავისუფალი საათები:"
                      : "That time appears taken. Here are the nearest available slots:",
              needContact: false,
            })
          : lang === "tr"
            ? "O saat maalesef dolu görünüyor ve yakın alternatif bulamadık. Başka bir gün veya saat yazarsanız kontrol edelim."
            : "That time appears taken and we could not find nearby alternatives. Please suggest another day or time.",
        slotUnavailable: true,
      };
    }

    const slotToBook =
      state.stage === "awaiting_slot_confirm" && state.selectedSlot
        ? state.selectedSlot
        : selected;
    const whenConfirm =
      slotToBook.label ||
      formatAppointmentDisplay(slotToBook.startAt, locale, scheduling.timezone);

    if (
      state.stage !== "awaiting_slot_confirm" ||
      !slotsMatchSameInstant(slotToBook, state.selectedSlot)
    ) {
      if (profileId) {
        await persistAiBookingFlags(profileId, {
          stage: "awaiting_slot_confirm",
          selectedSlot: slotToBook,
          offeredSlots: state.offeredSlots?.length ? state.offeredSlots : offeredSlots,
          offeredAt: state.offeredAt || new Date().toISOString(),
          appointmentOfferPending: true,
          awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
          contactPhone: contact.phone || state.contactPhone || null,
        });
        logBookingAuditEvent(BOOKING_AUDIT_EVENTS.SLOT_SELECTED, {
          profileId: String(profileId).slice(0, 8),
          selectedSlot: slotToBook.startAt,
          selectedDate: slotToBook.dateYmd || null,
        });
        logBookingAuditEvent(BOOKING_AUDIT_EVENTS.CONFIRMATION_REQUESTED, {
          profileId: String(profileId).slice(0, 8),
          selectedSlot: slotToBook.startAt,
        });
      }
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildSlotConfirmationDirectReply(
          locale.slice(0, 2),
          whenConfirm,
          treatmentLabel,
        ),
        awaitingConfirmation: true,
      };
    }

    const created = await createAppointmentFromAiSelection({
      clinicId,
      patientId,
      profileId,
      profileRow,
      patientMessage: message,
      recentTurns,
      slot: slotToBook,
      mode: booking.mode,
      booking,
      treatmentLabel,
      contactPhone: bookingPhone || contact.phone,
      locale,
      timezone: scheduling.timezone,
    });
    if (created.reason === "contact_required") {
      const lang = locale.slice(0, 2);
      return {
        engaged: true,
        promptBlock: buildContactRequiredPrompt(lang, contactPromptOpts),
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
        selectedSlot: slotToBook,
        pendingAppointmentId: created.appointmentId,
        calendarPersisted: created.adminCalendarPersisted === true,
        adminCalendarPersisted: created.adminCalendarPersisted === true,
        contactPhone: bookingPhone || contact.phone,
        offeredSlots: [],
        appointmentOfferPending: false,
      });
    }
    const whenLabel =
      slotToBook.label ||
      formatAppointmentDisplay(slotToBook.startAt, locale, scheduling.timezone);
    return {
      engaged: true,
      promptBlock: "",
      directReply: await buildDirectBookingReplyForPatient(
        locale.slice(0, 2),
        booking.mode,
        whenLabel,
        treatmentLabel,
        patientId,
        clinicId,
      ),
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
        ? buildAffirmativeContactDirectReply(lang, contactPromptOpts)
        : null;
    return {
      engaged: true,
      promptBlock: buildContactRequiredPrompt(lang, contactPromptOpts),
      directReply,
      needContact: true,
    };
  }

  if (shouldFinalizeSlotOnPatientYes(message, state, flags, recentTurns)) {
    const confirmed = await completeBookingAfterSlotConfirmation({
      message,
      state,
      flags,
      contact,
      profileRow,
      profileId,
      clinicId,
      patientId,
      booking,
      scheduling,
      treatmentLabel,
      locale,
      recentTurns,
      channel: params.channel,
      inboundSource: params.inboundSource || params.channel,
    });
    if (confirmed) return confirmed;
    const lang = locale.slice(0, 2);
    const whenPending =
      state.selectedSlot?.label ||
      (state.selectedSlot?.startAt
        ? formatAppointmentDisplay(state.selectedSlot.startAt, locale, scheduling.timezone)
        : "");
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildSlotConfirmationReminder(lang, whenPending),
      awaitingConfirmation: true,
    };
  }

  const slotsAlreadyOnRecord = state.offeredSlots?.length > 0;
  const listRecentlySent =
    slotsAlreadyOnRecord &&
    (state.stage === "slots_offered" || coordinatorRecentlySentSlotList(recentTurns, state.offeredSlots));
  if (
    !selected &&
    !wantsFreshSlotList &&
    listRecentlySent &&
    !patientMessageAdvancesSlotBooking(message, state, scheduling)
  ) {
    return { engaged: false, promptBlock: "", directReply: null };
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
      awaitingAction: slots.length ? BOOKING_PENDING_ACTIONS.SELECT_SLOT : null,
      bookingActive: !!slots.length,
      contactPhone: contact.phone,
      preferredDateYmd: preferredDateYmd || null,
      preferredTimeMin: preferredTimeMin != null ? preferredTimeMin : null,
    });
    if (slots.length) {
      logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_STARTED, {
        profileId: String(profileId).slice(0, 8),
        slotCount: slots.length,
        slotListId: readDurableBookingState({ aiBooking: { offeredSlots: slots } }).slotListId,
      });
    }
  }

  if (
    (preferredDateYmd || preferredTimeMin != null) &&
    (timeOnly || messageExpressesTimeIntent(message))
  ) {
    const pendingSlot =
      preferredDateYmd && preferredTimeMin != null
        ? buildSlotFromPreferredDateTime(
            preferredDateYmd,
            preferredTimeMin,
            scheduling,
            booking,
            treatmentLabel,
            locale,
          )
        : null;
    if (pendingSlot?.startAt) {
      if (contact.hasContact && !contact.hasName) {
        await persistAiBookingFlags(profileId, {
          stage: "need_name",
          selectedSlot: pendingSlot,
          preferredDateYmd,
          preferredTimeMin,
          appointmentOfferPending: true,
        });
      } else if (!contact.hasContact && booking.contactRequired !== false) {
        await persistAiBookingFlags(profileId, {
          stage: "need_contact",
          selectedSlot: pendingSlot,
          preferredDateYmd,
          preferredTimeMin,
          appointmentOfferPending: true,
        });
      }
    }
  }

  const lang = locale.slice(0, 2);
  const parsedTimeMin = parseConversationalTimeToMinutes(message);
  const timeHm = formatMinutesAsHm(parsedTimeMin);
  const sendSlotList = shouldSendSlotListDirectReply(message, state, scheduling, {
    selected,
    wantsFreshSlotList,
    timeOnly,
    parsedTimeMin,
    stage: state.stage,
  });

  if (!sendSlotList && !selected) {
    return { engaged: false, promptBlock: "", directReply: null };
  }

  const promptBlock = buildSlotOfferPromptBlock({
    mode: booking.mode,
    slots,
    treatmentLabel,
    lang,
    hasContact: contact.hasContact,
    hasName: contact.hasName,
    scheduling,
    patientMessage: message,
    preferredDateYmd,
    wantsAlternate: wantsFreshSlotList,
    whatsappChannel: contactPromptOpts.whatsappChannel,
    knownPhone: contactPromptOpts.knownPhone,
  });

  if (
    !selected &&
    !patientHasActiveBooking(flags, state) &&
    (timeOnly || (parsedTimeMin != null && timeHm))
  ) {
    const timeIntro =
      timeHm && slots.length
        ? lang === "tr"
          ? `${timeHm} için en yakın müsait saatler:`
          : lang === "ru"
            ? `Ближайшее свободное время к ${timeHm}:`
            : lang === "ka"
              ? `${timeHm}-ზე უახლოესი თავისუფალი დროები:`
              : `Nearest available times around ${timeHm}:`
        : undefined;
  return {
    engaged: true,
    promptBlock,
      directReply: slots.length
        ? buildSlotOfferDirectReply(slots, lang, {
            intro: timeIntro,
            needContact: booking.contactRequired !== false && !contact.hasContact,
            needName: contact.hasContact && !contact.hasName,
            whatsappChannel: contactPromptOpts.whatsappChannel,
            knownPhone: contactPromptOpts.knownPhone,
          })
        : buildTimeSelectionAckReply(lang, timeHm),
      slotsOffered: slots.length,
      timeSelectionAck: !slots.length,
      schedulingPromptForLlm: true,
    };
  }

  return {
    engaged: true,
    promptBlock,
    directReply: buildSlotOfferDirectReply(slots, lang, {
      needContact: booking.contactRequired !== false && !contact.hasContact,
      needName: contact.hasContact && !contact.hasName,
      whatsappChannel: contactPromptOpts.whatsappChannel,
      knownPhone: contactPromptOpts.knownPhone,
    }),
    slotsOffered: slots.length,
    schedulingPromptForLlm: true,
  };
}

/**
 * Post-turn: persist contact from patient message if provided.
 */
async function finalizeAiAppointmentBookingTurn(params) {
  const profileId = String(params.profileId || "").trim();
  if (!profileId) return;

  const extracted = extractWhatsappFromPatientMessage(params.patientMessage || "");
  if (!extracted?.number) return;

    const phone = normalizeWhatsappNumber(extracted.number);
  if (!phone) return;

      await persistAiBookingFlags(profileId, {
        contactPhone: phone,
        stage: "contact_collected",
      });

  if (!isSupabaseEnabled()) return;

  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, operational_intake_flags, treatment_interest, conversation_primary_language, whatsapp_number",
    )
    .eq("id", profileId)
    .maybeSingle();
  if (!row?.patient_id || !row?.clinic_id) return;

  const profileRow = row;
  const flags =
    row.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? row.operational_intake_flags
      : {};
  const clinicProfile = await getClinicAiProfile(String(row.clinic_id));
  const booking = normalizeAiBookingConfig(clinicProfile.communicationPolicy);
  if (!booking.enabled) return;

  const scheduling = await resolveSchedulingRulesForClinic(String(row.clinic_id), clinicProfile);
  const state = readAiBookingState(flags);
  const locale = String(
    params.locale || row.conversation_primary_language || "tr",
  ).slice(0, 5);
  const treatmentLabel =
    String(row.treatment_interest || "Consultation").replace(/_/g, " ").trim() || "Consultation";

  await tryCompletePendingAiBooking({
    message: params.patientMessage || "",
    state,
    flags,
    contact: { phone, hasContact: true },
    clinicId: String(row.clinic_id),
    patientId: String(row.patient_id),
    profileId,
    profileRow,
    booking,
    scheduling,
    treatmentLabel,
    locale,
    preferredDateYmd: null,
    preferredTimeMin: null,
    recentTurns: Array.isArray(params.recentTurns) ? params.recentTurns : [],
  });
}

/**
 * Mark that the coordinator offered an appointment (next patient "Tamam" continues booking).
 * @param {string} profileId
 * @param {string} aiReplyText
 */
async function markAppointmentOfferInAiReply(profileId, aiReplyText) {
  if (!profileId || !/\brandevu\b/i.test(String(aiReplyText || ""))) return;
  if (!/\b(ayarla|uygun|tarih|planla|schedule|book)\b/i.test(String(aiReplyText || ""))) return;
  const { data } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("operational_intake_flags")
    .eq("id", profileId)
    .maybeSingle();
  const prev =
    data?.operational_intake_flags && typeof data.operational_intake_flags === "object"
      ? data.operational_intake_flags
      : {};
  if (isBookingFlowInProgress(prev)) return;
  await persistAiBookingFlags(profileId, {
    appointmentOfferPending: true,
    stage: "awaiting_patient_confirm",
    bookingActive: true,
    awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
  });
}

module.exports = {
  BOOKING_MODES,
  normalizeAiBookingConfig,
  shouldEngageAppointmentBooking,
  isAffirmativeShortReply,
  isBookingConfirmationYes,
  isBareSlotListIndexMessage,
  buildTimeSelectionAckReply,
  isTimeOnlyPatientMessage,
  prepareAiAppointmentBookingTurn,
  finalizeAiAppointmentBookingTurn,
  findAvailableSlots,
  resolveBookingContact,
  parseSlotSelectionFromMessage,
  markAppointmentOfferInAiReply,
  shouldUseBookingDirectReply,
  patientMessageAdvancesSlotBooking,
  readDurableBookingState,
};
