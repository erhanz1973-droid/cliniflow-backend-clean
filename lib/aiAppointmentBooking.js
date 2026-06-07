/**
 * AI appointment booking config + slot availability (uses weekly clinic schedule).
 */

const {
  resolveClinicWorkingHours,
  findNextAvailableSlot,
  resolveSchedulingRequest,
  formatWeeklyScheduleForAi,
  isWithinClinicHours,
} = require("./clinicWorkingHours");

const BOOKING_MODES = Object.freeze({
  DRAFT: "draft_booking",
  SUGGEST: "suggest_only",
  FULL_AUTO: "full_auto",
});

/**
 * @param {Record<string, unknown>|null|undefined} commPolicy
 */
function normalizeAiBookingConfig(commPolicy) {
  const comm = commPolicy && typeof commPolicy === "object" ? commPolicy : {};
  const raw = comm.aiBooking && typeof comm.aiBooking === "object" ? comm.aiBooking : comm;
  const modeRaw = String(raw.mode || "draft_booking").trim().toLowerCase();
  const mode = Object.values(BOOKING_MODES).includes(modeRaw) ? modeRaw : BOOKING_MODES.DRAFT;

  return {
    enabled: raw.enabled !== false,
    mode,
    contactRequired: raw.contactRequired !== false,
    defaultDurationMinutes: Math.max(15, Number(raw.defaultDurationMinutes) || 30),
    bufferMinutes: Math.max(0, Number(raw.bufferMinutes) || 10),
    slotStepMinutes: Math.max(5, Number(raw.slotStepMinutes) || 15),
    slotHorizonDays: Math.max(1, Math.min(60, Number(raw.slotHorizonDays) || 14)),
    maxSlotsToOffer: Math.max(1, Math.min(10, Number(raw.maxSlotsToOffer) || 5)),
    lunchBreak:
      raw.lunchBreak && typeof raw.lunchBreak === "object"
        ? {
            enabled: raw.lunchBreak.enabled !== false,
            start: raw.lunchBreak.start || "13:00",
            end: raw.lunchBreak.end || "14:00",
          }
        : { enabled: true, start: "13:00", end: "14:00" },
    updatedAt: raw.updatedAt || null,
  };
}

/**
 * @param {{ logistics?: object, communicationPolicy?: object }} profile
 * @param {{ fromDate?: Date, busyIntervals?: object[], maxSlots?: number }} [opts]
 */
function getAvailableAppointmentSlots(profile, opts = {}) {
  const hours = resolveClinicWorkingHours(profile?.logistics);
  const booking = normalizeAiBookingConfig(profile?.communicationPolicy);
  if (!booking.enabled) {
    return { hours, booking, slots: [], scheduleText: formatWeeklyScheduleForAi(hours) };
  }

  const bookingWithCap = {
    ...booking,
    maxSlotsToOffer: opts.maxSlots ?? booking.maxSlotsToOffer,
  };

  const slots = findNextAvailableSlot(
    hours,
    bookingWithCap,
    opts.busyIntervals || [],
    opts.fromDate || new Date(),
  );

  return {
    hours,
    booking: bookingWithCap,
    slots,
    scheduleText: formatWeeklyScheduleForAi(hours),
  };
}

/**
 * @param {Date|string} requestedTime
 * @param {{ logistics?: object, communicationPolicy?: object }} profile
 * @param {object[]} [busyIntervals]
 */
function evaluateAppointmentRequest(requestedTime, profile, busyIntervals = []) {
  const hours = resolveClinicWorkingHours(profile?.logistics);
  const booking = normalizeAiBookingConfig(profile?.communicationPolicy);
  const result = resolveSchedulingRequest(requestedTime, hours, booking, busyIntervals);
  return {
    ...result,
    hours,
    booking,
    scheduleText: formatWeeklyScheduleForAi(hours),
  };
}

/**
 * @param {Date|string} at
 * @param {{ logistics?: object }} profile
 */
function isAppointmentTimeAllowed(at, profile) {
  const hours = resolveClinicWorkingHours(profile?.logistics);
  const d = at instanceof Date ? at : new Date(String(at));
  return isWithinClinicHours(d, hours);
}

module.exports = {
  BOOKING_MODES,
  normalizeAiBookingConfig,
  getAvailableAppointmentSlots,
  evaluateAppointmentRequest,
  isAppointmentTimeAllowed,
  formatWeeklyScheduleForAi,
};
