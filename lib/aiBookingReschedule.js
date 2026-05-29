/**
 * Reschedule workflow — move an existing confirmed appointment (never duplicate booking).
 */

const { formatInTimeZone } = require("date-fns-tz");
const {
  toStartIso,
  formatAppointmentDisplay,
  cancelAppointmentRow,
  syncAppointmentToCoordination,
  EVENT_TYPES,
} = require("./appointmentCoordinationSync");
const {
  parsePreferredDateFromMessage,
  inferPreferredDateFromConversation,
  parsePreferredTimeMinutesFromMessage,
  parseHm,
} = require("./clinicCalendarAvailability");
const {
  parseConversationalTimeToMinutes,
  isTimeOnlyPatientMessage,
  messageExpressesTimeIntent,
} = require("./conversationalTimeParse");
const {
  BOOKING_PENDING_ACTIONS,
  BOOKING_AUDIT_EVENTS,
  readDurableBookingState,
  readCanonicalBooking,
  buildCanonicalBookingRecord,
  buildClosedBookingPatch,
  logBookingAuditEvent,
  isBookingConfirmationYesMessage,
  patientBlocksBookingConfirmation,
  isPendingRescheduleConfirmation,
  resolvesPendingConfirmation,
} = require("./aiBookingState");

const RESCHEDULE_EXPLICIT_RE =
  /\b(reschedule|re-?schedule|move\s+(my\s+)?appointment|change\s+(the\s+)?(time|date|day|hour)|another\s+(hour|time|day)|different\s+(day|time|date|hour)|ertele|degistir|değiştir|baska\s+(saat|gun|gün)|başka\s+(saat|gün|gun)|yeniden\s+planla|saati\s+degistir|saati\s+değiştir|farkli\s+(saat|gun|gün)|farklı\s+(saat|gün)|randevuyu\s+tas(i|ı)|randevu\s+degistir|randevu\s+değiştir)\b/i;

const RESCHEDULE_TIME_OLSUN_RE =
  /\b(\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:[:.]?\d{2})?)\s*(?:olsun|olur|yapalim|yapalım|alalim|alalım|istiyorum)\b/i;

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function hasReschedulableActiveAppointment(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const appt = f.activeAppointment && typeof f.activeAppointment === "object" ? f.activeAppointment : null;
  if (appt?.startAt) {
    const st = String(appt.status || "scheduled").toLowerCase();
    if (st !== "cancelled" && st !== "canceled") return true;
  }
  const canonical = readCanonicalBooking(f);
  if (canonical?.startAt) {
    const st = String(canonical.status || "scheduled").toLowerCase();
    return st !== "cancelled" && st !== "canceled";
  }
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {string} locale
 * @param {{ timezone?: string }} scheduling
 */
function resolveExistingAppointmentSlot(flags, scheduling, locale) {
  const f = flags && typeof flags === "object" ? flags : {};
  const tz = scheduling?.timezone || "Europe/Istanbul";
  const appt = f.activeAppointment && typeof f.activeAppointment === "object" ? f.activeAppointment : null;
  const canonical = readCanonicalBooking(f);
  const startAt = toStartIso(appt?.startAt || canonical?.startAt || null);
  if (!startAt) return null;
  return {
    appointmentId: String(appt?.id || canonical?.bookingId || "").trim() || null,
    startAt,
    label: appt?.label || canonical?.label || formatAppointmentDisplay(startAt, locale, tz),
    dateYmd: formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd"),
    time: formatInTimeZone(new Date(startAt), tz, "HH:mm"),
    treatmentLabel: String(appt?.treatmentLabel || canonical?.treatmentLabel || "Consultation").trim(),
  };
}

/**
 * @param {string} message
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {{ recentTurns?: Array<{ role?: string, text?: string }>, scheduling?: { timezone?: string } }} [ctx]
 */
function patientRescheduleIntent(message, flags, ctx = {}) {
  if (!hasReschedulableActiveAppointment(flags)) return false;
  const msg = String(message || "").trim();
  if (!msg || msg.length > 400) return false;
  if (/^(evet|tamam|yes|ok|okay|hayir|hayır|no)[\s!.?]*$/i.test(msg)) return false;

  const durable = readDurableBookingState(flags);
  if (durable.rescheduleMode === true && durable.stage === "awaiting_slot_confirm") {
    return false;
  }

  if (RESCHEDULE_EXPLICIT_RE.test(msg)) return true;
  if (RESCHEDULE_TIME_OLSUN_RE.test(msg)) return true;
  if (isTimeOnlyPatientMessage(msg)) return true;
  if (parseConversationalTimeToMinutes(msg) != null && messageExpressesTimeIntent(msg)) return true;

  const tz = ctx.scheduling?.timezone || "Europe/Istanbul";
  if (parsePreferredDateFromMessage(msg, tz)) return true;

  return false;
}

/**
 * @param {string} lang
 * @param {string} fromLabel
 * @param {string} toLabel
 * @param {string} [treatmentLabel]
 */
function buildRescheduleConfirmDirectReply(lang, fromLabel, toLabel, treatmentLabel) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const label = treatmentLabel || (key === "tr" ? "randevunuzu" : "appointment");
  const from = String(fromLabel || "").trim();
  const to = String(toLabel || "").trim();
  if (key === "tr") {
    return `Mevcut ${label} ${from} tarihinden ${to} saatine taşımak ister misiniz? Onaylamak için «Evet» yazmanız yeterli.`;
  }
  if (key === "ru") {
    return `Перенести вашу запись с ${from} на ${to}? Напишите «Да» для подтверждения.`;
  }
  if (key === "ka") {
    return `გსურთ ჩაწერის ${from}-დან ${to}-ზე გადატანა? დაწერეთ «კი» დასადასტურებლად.`;
  }
  return `Would you like to move your existing appointment from ${from} to ${to}? Reply «Yes» to confirm.`;
}

/**
 * @param {string} lang
 * @param {string} fromLabel
 * @param {string} toLabel
 */
function buildRescheduleCompletedReply(lang, fromLabel, toLabel) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const from = String(fromLabel || "").trim();
  const to = String(toLabel || "").trim();
  if (key === "tr") {
    return `Harika! Randevunuz ${from} yerine ${to} için güncellendi. Görüşmek üzere!`;
  }
  if (key === "ru") {
    return `Готово! Ваша запись перенесена с ${from} на ${to}.`;
  }
  if (key === "ka") {
    return `შესანიშნავია! ჩაწერა გადაიტანეთ ${from}-დან ${to}-ზე.`;
  }
  return `Done! Your appointment has been moved from ${from} to ${to}. See you then!`;
}

/**
 * @param {string} lang
 * @param {string} whenLabel
 */
function buildRescheduleRejectedReply(lang, whenLabel) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const when = String(whenLabel || "").trim();
  if (key === "tr") {
    return `Tamam, randevunuz ${when} olarak kalıyor. Başka bir saat isterseniz yazabilirsiniz.`;
  }
  if (key === "ru") {
    return `Хорошо, ваша запись остаётся на ${when}. Напишите, если нужно другое время.`;
  }
  if (key === "ka") {
    return `კარგი, ჩაწერა ${when} დროზე რჩება. სხვა დრო სურვილის შემთხვევაში დაგناწერეთ.`;
  }
  return `OK — your appointment stays at ${when}. Reply with another time if you need to change it.`;
}

/**
 * @param {string} lang
 */
function buildRescheduleNeedDetailsReply(lang) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return "Randevunuzu taşımak için uygun gün veya saati yazabilir misiniz? (Örn: «15:45» veya «çarşamba»)";
  }
  if (key === "ru") {
    return "Напишите удобный день или время для переноса записи.";
  }
  if (key === "ka") {
    return "ჩაწერის გადატანისთვის მიუთითეთ სასურველი დღე ან საათი.";
  }
  return "Which day or time would you like to move your appointment to?";
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
 * @param {string} message
 * @param {{ startAt: string, dateYmd?: string, time?: string }} existing
 * @param {{ timezone?: string }} scheduling
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 * @param {(dateYmd: string, timeMin: number) => object|null} buildSlotFn
 */
function resolveRescheduleTargetSlot(message, existing, scheduling, recentTurns, buildSlotFn) {
  const tz = scheduling?.timezone || "Europe/Istanbul";
  const msg = String(message || "").trim();
  const preferredDateYmd =
    parsePreferredDateFromMessage(msg, tz) ||
    inferPreferredDateFromConversation(recentTurns, tz) ||
    null;
  let preferredTimeMin = parsePreferredTimeMinutesFromMessage(msg);
  if (preferredTimeMin == null) {
    preferredTimeMin = parseConversationalTimeToMinutes(msg);
  }

  if (preferredTimeMin != null) {
    const dateYmd = preferredDateYmd || existing.dateYmd;
    if (dateYmd) {
      return buildSlotFn(dateYmd, preferredTimeMin);
    }
  }

  if (preferredDateYmd && !preferredTimeMin) {
    const existingMin = parseHm(existing.time);
    if (existingMin != null) {
      return buildSlotFn(preferredDateYmd, existingMin);
    }
  }

  return null;
}

/**
 * @param {object} params
 */
async function completeRescheduleAfterConfirmation(params) {
  const {
    flags,
    state,
    profileId,
    clinicId,
    patientId,
    profileRow,
    booking,
    scheduling,
    treatmentLabel,
    locale,
    recentTurns,
    message,
    contact,
  } = params;

  const durable = readDurableBookingState(flags);
  const existing = durable.rescheduleFromSlot || resolveExistingAppointmentSlot(flags, scheduling, locale);
  const targetSlot = state.selectedSlot || durable.selectedSlot;
  if (!targetSlot?.startAt || !existing?.startAt) {
    return { engaged: true, directReply: null, reason: "missing_slots" };
  }

  const lang = String(locale || "tr").slice(0, 2);
  const fromLabel = existing.label || formatAppointmentDisplay(existing.startAt, locale, scheduling.timezone);
  const toLabel =
    targetSlot.label || formatAppointmentDisplay(targetSlot.startAt, locale, scheduling.timezone);

  logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_RESCHEDULE_CONFIRMED, {
    profileId: profileId ? String(profileId).slice(0, 8) : null,
    from: existing.startAt,
    to: targetSlot.startAt,
    appointmentId: existing.appointmentId || durable.rescheduleFromAppointmentId || null,
  });

  const oldAppointmentId =
    String(durable.rescheduleFromAppointmentId || existing.appointmentId || flags.activeAppointment?.id || "").trim() ||
    null;

  if (oldAppointmentId) {
    await cancelAppointmentRow(oldAppointmentId, {
      patientId,
      clinicId,
      locale,
      previousStartAt: existing.startAt,
      treatmentLabel: existing.treatmentLabel || treatmentLabel,
      source: "ai_reschedule",
    });
  }

  const {
    createAppointmentFromAiSelection,
    persistAiBookingFlags,
    resolveBookingPhoneForTurn,
  } = require("./aiAppointmentBooking");

  const phone = resolveBookingPhoneForTurn(contact, booking, state, profileRow);
  const created = await createAppointmentFromAiSelection({
    clinicId,
    patientId,
    profileId,
    profileRow,
    patientMessage: message,
    recentTurns,
    slot: targetSlot,
    mode: booking.mode,
    booking,
    treatmentLabel: existing.treatmentLabel || treatmentLabel,
    contactPhone: phone,
    locale,
    timezone: scheduling.timezone,
  });

  if (!created.ok) {
    const failMsg =
      lang === "tr"
        ? "Randevu güncellenirken kısa bir sorun oluştu. Ekibimiz birkaç dakika içinde size yazacak."
        : "There was a brief issue updating your appointment. Our team will follow up shortly.";
    return { engaged: true, directReply: failMsg, rescheduleFailed: true };
  }

  await syncAppointmentToCoordination({
    patientId,
    clinicId,
    eventType: EVENT_TYPES.RESCHEDULED,
    appointment: {
      id: created.appointmentId,
      startAt: created.startAt,
      treatmentLabel: existing.treatmentLabel || treatmentLabel,
      status: booking.mode === "full_auto" ? "scheduled" : "pending",
    },
    source: "ai_reschedule",
    sendPatientMessage: false,
    locale,
  });

  const canonicalBooking = buildCanonicalBookingRecord({
    bookingId: created.appointmentId,
    startAt: created.startAt,
    timezone: scheduling.timezone,
    locale,
    status: booking.mode === "full_auto" ? "scheduled" : "pending",
    treatmentLabel: existing.treatmentLabel || treatmentLabel,
  });

  if (profileId) {
    await persistAiBookingFlags(
      profileId,
      buildClosedBookingPatch({
        stage: booking.mode === "full_auto" ? "booked" : "pending_staff",
        bookingId: created.appointmentId,
        pendingAppointmentId: created.appointmentId,
        canonicalBooking,
        calendarPersisted: created.adminCalendarPersisted === true,
        adminCalendarPersisted: created.adminCalendarPersisted === true,
        contactPhone: phone,
        rescheduleMode: false,
        rescheduleFromAppointmentId: null,
        rescheduleFromSlot: null,
        selectedSlot: targetSlot,
      }),
    );

    const { supabase, isSupabaseEnabled } = require("./supabase");
    if (isSupabaseEnabled()) {
      const { data } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("operational_intake_flags")
        .eq("id", profileId)
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
              id: created.appointmentId,
              startAt: created.startAt,
              treatmentLabel: existing.treatmentLabel || treatmentLabel,
              status: booking.mode === "full_auto" ? "scheduled" : "pending",
              updatedAt: new Date().toISOString(),
            },
            canonicalBooking,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", profileId);
    }
  }

  logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_RESCHEDULE_COMPLETED, {
    profileId: profileId ? String(profileId).slice(0, 8) : null,
    from: existing.startAt,
    to: created.startAt,
    oldAppointmentId: oldAppointmentId || null,
    newAppointmentId: created.appointmentId || null,
  });

  return {
    engaged: true,
    promptBlock: "",
    directReply: buildRescheduleCompletedReply(lang, fromLabel, toLabel),
    booked: true,
    rescheduled: true,
  };
}

/**
 * @param {object} params
 */
async function prepareAiAppointmentRescheduleTurn(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const profileRow = params.profileRow || {};
  const profileId = String(profileRow.id || "").trim();
  const message = String(params.patientMessage || "").trim();
  const locale = String(params.locale || profileRow.conversation_primary_language || "en").slice(0, 5);
  const lang = locale.slice(0, 2);
  let flags =
    params.flags ||
    (profileRow.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {});
  const recentTurns = Array.isArray(params.recentTurns) ? params.recentTurns : [];
  const scheduling = params.scheduling;
  const booking = params.booking;
  const contact = params.contact;
  const treatmentLabel =
    String(params.treatmentLabel || profileRow.treatment_interest || "Consultation")
      .replace(/_/g, " ")
      .trim() || "Consultation";

  if (!hasReschedulableActiveAppointment(flags)) {
    return { engaged: false };
  }

  const durable = readDurableBookingState(flags);
  const existing = resolveExistingAppointmentSlot(flags, scheduling, locale);
  if (!existing?.startAt) return { engaged: false };

  const {
    persistAiBookingFlags,
    buildSlotFromPreferredDateTime,
    parseSlotSelectionFromMessage,
    isBookingConfirmationNo,
  } = require("./aiAppointmentBooking");

  const buildSlotFn = (dateYmd, timeMin) =>
    buildSlotFromPreferredDateTime(dateYmd, timeMin, scheduling, booking, treatmentLabel, locale);

  if (durable.rescheduleMode === true && String(durable.stage || "") === "awaiting_slot_confirm") {
    if (isBookingConfirmationNo(message)) {
      if (profileId) {
        await persistAiBookingFlags(profileId, {
          stage: "booked",
          rescheduleMode: false,
          rescheduleFromAppointmentId: null,
          rescheduleFromSlot: null,
          selectedSlot: null,
          awaitingAction: null,
          appointmentOfferPending: false,
          bookingActive: false,
        });
      }
      const whenLabel =
        existing.label || formatAppointmentDisplay(existing.startAt, locale, scheduling.timezone);
      return {
        engaged: true,
        promptBlock: "",
        directReply: buildRescheduleRejectedReply(lang, whenLabel),
        rescheduleRejected: true,
      };
    }

    if (isPendingRescheduleConfirmation(message, flags, recentTurns)) {
      return completeRescheduleAfterConfirmation({
        flags,
        state: { selectedSlot: durable.selectedSlot },
        profileId,
        clinicId,
        patientId,
        profileRow,
        booking,
        scheduling,
        treatmentLabel,
        locale,
        recentTurns,
        message,
        contact,
      });
    }

    const whenPending =
      durable.selectedSlot?.label ||
      formatAppointmentDisplay(durable.selectedSlot?.startAt, locale, scheduling.timezone);
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildRescheduleConfirmDirectReply(
        lang,
        existing.label,
        whenPending,
        treatmentLabel,
      ),
      awaitingConfirmation: true,
      rescheduleMode: true,
    };
  }

  if (!patientRescheduleIntent(message, flags, { recentTurns, scheduling })) {
    return { engaged: false };
  }

  let targetSlot =
    parseSlotSelectionFromMessage(message, durable.offeredSlots) ||
    resolveRescheduleTargetSlot(message, existing, scheduling, recentTurns, buildSlotFn);

  if (!targetSlot) {
    return {
      engaged: true,
      promptBlock: "",
      directReply: buildRescheduleNeedDetailsReply(lang),
      rescheduleNeedDetails: true,
    };
  }

  if (slotsMatchSameInstant(targetSlot, existing)) {
    const whenLabel =
      existing.label || formatAppointmentDisplay(existing.startAt, locale, scheduling.timezone);
    return {
      engaged: true,
      promptBlock: "",
      directReply:
        lang === "tr"
          ? `Randevunuz zaten ${whenLabel} için kayıtlı. Farklı bir saat veya gün yazarsanız taşıyabilirim.`
          : `Your appointment is already set for ${whenLabel}. Send another day or time to reschedule.`,
      rescheduleSameSlot: true,
    };
  }

  const fromLabel = existing.label || formatAppointmentDisplay(existing.startAt, locale, scheduling.timezone);
  const toLabel =
    targetSlot.label || formatAppointmentDisplay(targetSlot.startAt, locale, scheduling.timezone);

  if (profileId) {
    await persistAiBookingFlags(profileId, {
      stage: "awaiting_slot_confirm",
      rescheduleMode: true,
      rescheduleFromAppointmentId: existing.appointmentId || flags.activeAppointment?.id || null,
      rescheduleFromSlot: existing,
      selectedSlot: targetSlot,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      appointmentOfferPending: true,
      bookingActive: true,
    });
    logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_RESCHEDULE_STARTED, {
      profileId: String(profileId).slice(0, 8),
      from: existing.startAt,
      to: targetSlot.startAt,
      appointmentId: existing.appointmentId || null,
    });
  }

  return {
    engaged: true,
    promptBlock: "",
    directReply: buildRescheduleConfirmDirectReply(lang, fromLabel, toLabel, treatmentLabel),
    awaitingConfirmation: true,
    rescheduleMode: true,
    rescheduleStarted: true,
  };
}

module.exports = {
  hasReschedulableActiveAppointment,
  resolveExistingAppointmentSlot,
  patientRescheduleIntent,
  buildRescheduleConfirmDirectReply,
  buildRescheduleCompletedReply,
  buildRescheduleRejectedReply,
  buildRescheduleNeedDetailsReply,
  resolveRescheduleTargetSlot,
  prepareAiAppointmentRescheduleTurn,
  completeRescheduleAfterConfirmation,
};
