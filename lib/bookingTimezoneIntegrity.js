/**
 * Canonical clinic timezone + booking time integrity guards.
 * Antalya / Turkey clinics must always schedule in Europe/Istanbul.
 */

const { formatInTimeZone } = require("date-fns-tz");

const DEFAULT_BOOKING_CLINIC_TZ = "Europe/Istanbul";

/**
 * @param {string|null|undefined} timezone
 */
function resolveCanonicalClinicTimezone(timezone) {
  const tz = String(timezone || DEFAULT_BOOKING_CLINIC_TZ).trim();
  return tz || DEFAULT_BOOKING_CLINIC_TZ;
}

/**
 * @param {string} [locale]
 * @param {string} [timezone]
 */
function formatBookingTimezoneLabel(locale = "tr", timezone = DEFAULT_BOOKING_CLINIC_TZ) {
  const key = String(locale || "tr").slice(0, 2).toLowerCase();
  const tz = resolveCanonicalClinicTimezone(timezone);
  if (tz === "Europe/Istanbul") {
    if (key === "tr") return "Türkiye saati";
    if (key === "ru") return "время Турции";
    if (key === "ka") return "საქართველოს დრო";
    return "Turkey Time";
  }
  return tz.replace(/_/g, " ");
}

/**
 * Patient-facing appointment label with explicit clinic timezone.
 * @param {string} iso
 * @param {string} [locale]
 * @param {string} [timeZone]
 */
function formatAppointmentDisplayWithTimezone(iso, locale = "en", timeZone = DEFAULT_BOOKING_CLINIC_TZ) {
  const tz = resolveCanonicalClinicTimezone(timeZone);
  const { formatAppointmentDisplay } = require("./appointmentCoordinationSync");
  const base = formatAppointmentDisplay(iso, locale, tz);
  const suffix = formatBookingTimezoneLabel(locale, tz);
  return `${base} (${suffix})`;
}

/**
 * @param {string|null|undefined} iso
 * @param {string} [timezone]
 */
function clinicLocalHmFromIso(iso, timezone = DEFAULT_BOOKING_CLINIC_TZ) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return null;
  const tz = resolveCanonicalClinicTimezone(timezone);
  try {
    return formatInTimeZone(new Date(ts), tz, "HH:mm");
  } catch {
    return null;
  }
}

/**
 * @param {string|null|undefined} iso
 * @param {string} [timezone]
 */
function clinicLocalYmdFromIso(iso, timezone = DEFAULT_BOOKING_CLINIC_TZ) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return null;
  const tz = resolveCanonicalClinicTimezone(timezone);
  try {
    return formatInTimeZone(new Date(ts), tz, "yyyy-MM-dd");
  } catch {
    return null;
  }
}

/**
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
function bookingInstantSame(a, b, toleranceMs = 120000) {
  const ta = Date.parse(String(a || ""));
  const tb = Date.parse(String(b || ""));
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= toleranceMs;
}

/**
 * @param {{
 *   selectedSlot?: { startAt?: string, dateYmd?: string, time?: string }|null,
 *   bookingPayloadStartAt?: string|null,
 *   calendarWriteStartAt?: string|null,
 *   timezone?: string|null,
 * }} params
 */
function validateBookingTimeChain(params) {
  const tz = resolveCanonicalClinicTimezone(params.timezone);
  const slot = params.selectedSlot && typeof params.selectedSlot === "object" ? params.selectedSlot : null;
  const selectedSlotStartAt = slot?.startAt ? String(slot.startAt).trim() : null;
  const bookingPayloadStartAt = params.bookingPayloadStartAt
    ? String(params.bookingPayloadStartAt).trim()
    : null;
  const calendarWriteStartAt = params.calendarWriteStartAt
    ? String(params.calendarWriteStartAt).trim()
    : null;

  if (!selectedSlotStartAt || !bookingPayloadStartAt) {
    return { ok: true, reason: "incomplete_chain" };
  }

  if (!bookingInstantSame(selectedSlotStartAt, bookingPayloadStartAt)) {
    return {
      ok: false,
      reason: "selected_slot_booking_payload_mismatch",
      selected_slot: selectedSlotStartAt,
      booking_payload: bookingPayloadStartAt,
      calendar_write: calendarWriteStartAt,
      clinic_timezone: tz,
    };
  }

  if (calendarWriteStartAt && !bookingInstantSame(bookingPayloadStartAt, calendarWriteStartAt)) {
    return {
      ok: false,
      reason: "booking_payload_calendar_write_mismatch",
      selected_slot: selectedSlotStartAt,
      booking_payload: bookingPayloadStartAt,
      calendar_write: calendarWriteStartAt,
      clinic_timezone: tz,
    };
  }

  const expectedTime = String(slot?.time || "").match(/^(\d{1,2}:\d{2})/)?.[1];
  if (expectedTime) {
    const actualTime = clinicLocalHmFromIso(bookingPayloadStartAt, tz);
    const padExpected = expectedTime.length === 4 ? `0${expectedTime}` : expectedTime;
    if (actualTime && padExpected.slice(-5) !== actualTime) {
      return {
        ok: false,
        reason: "clinic_local_time_mismatch",
        selected_slot: selectedSlotStartAt,
        booking_payload: bookingPayloadStartAt,
        calendar_write: calendarWriteStartAt,
        expected_time: padExpected.slice(-5),
        actual_time: actualTime,
        clinic_timezone: tz,
      };
    }
  }

  const expectedDate = slot?.dateYmd ? String(slot.dateYmd).trim() : null;
  if (expectedDate) {
    const actualDate = clinicLocalYmdFromIso(bookingPayloadStartAt, tz);
    if (actualDate && expectedDate !== actualDate) {
      return {
        ok: false,
        reason: "clinic_local_date_mismatch",
        selected_slot: selectedSlotStartAt,
        booking_payload: bookingPayloadStartAt,
        calendar_write: calendarWriteStartAt,
        expected_date: expectedDate,
        actual_date: actualDate,
        clinic_timezone: tz,
      };
    }
  }

  return { ok: true, clinic_timezone: tz };
}

/**
 * @param {Record<string, unknown>} payload
 */
function logBookingTimeAudit(payload) {
  try {
    console.log(
      "[BOOKING_TIME_AUDIT]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (e) {
    console.warn("[BOOKING_TIME_AUDIT] log_failed:", e?.message || e);
  }
}

/**
 * @param {Record<string, unknown>} payload
 */
function logBookingTimeMismatchBlocked(payload) {
  try {
    console.warn(
      "[BOOKING_TIME_MISMATCH_BLOCKED]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (e) {
    console.warn("[BOOKING_TIME_MISMATCH_BLOCKED] log_failed:", e?.message || e);
  }
}

module.exports = {
  DEFAULT_BOOKING_CLINIC_TZ,
  resolveCanonicalClinicTimezone,
  formatBookingTimezoneLabel,
  formatAppointmentDisplayWithTimezone,
  clinicLocalHmFromIso,
  clinicLocalYmdFromIso,
  bookingInstantSame,
  validateBookingTimeChain,
  logBookingTimeAudit,
  logBookingTimeMismatchBlocked,
};
