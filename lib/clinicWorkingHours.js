/**
 * Clinic weekly schedule — AI appointment slots, availability, timezone-aware bounds.
 */

const { addDays, addMinutes, parseISO, isBefore, isAfter } = require("date-fns");
const { formatInTimeZone, fromZonedTime, toZonedTime } = require("date-fns-tz");

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DEFAULT_TZ = "Europe/Istanbul";
const DEFAULT_WEEKDAY = { enabled: true, open: "09:00", close: "18:00", is24Hours: false };
const DEFAULT_WEEKEND = { enabled: false, open: "10:00", close: "15:00", is24Hours: false };

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeHm(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * @param {string|null|undefined} hm
 */
function hmToMinutes(hm) {
  const n = normalizeHm(hm);
  if (!n) return null;
  const [h, m] = n.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/**
 * @param {Record<string, unknown>|null|undefined} day
 */
function normalizeDaySchedule(day, fallback = DEFAULT_WEEKDAY) {
  const src = day && typeof day === "object" ? day : {};
  const fb = fallback && typeof fallback === "object" ? fallback : DEFAULT_WEEKDAY;
  const is24Hours = src.is24Hours === true || src.is_24_hours === true || fb.is24Hours === true;
  let open = normalizeHm(src.open ?? src.opening_time ?? src.start ?? fb.open) || "09:00";
  let close = normalizeHm(src.close ?? src.closing_time ?? src.end ?? fb.close) || "18:00";
  if (is24Hours) {
    open = "00:00";
    close = "23:59";
  }
  return {
    enabled: "enabled" in src ? src.enabled === true : fb.enabled !== false,
    open,
    close,
    is24Hours,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 */
function buildDefaultWeeklySchedule(raw) {
  const base = {};
  for (const key of DAY_KEYS) {
    const isWeekend = key === "saturday" || key === "sunday";
    base[key] = normalizeDaySchedule(null, isWeekend ? DEFAULT_WEEKEND : DEFAULT_WEEKDAY);
  }
  if (raw && typeof raw === "object") {
    for (const key of DAY_KEYS) {
      if (raw[key]) base[key] = normalizeDaySchedule(raw[key], base[key]);
    }
  }
  return { version: 2, ...base };
}

/**
 * Migrate legacy logistics.workingHours.weekdays → weeklySchedule (Mon–Fri).
 * @param {Record<string, unknown>|null|undefined} logistics
 */
function resolveClinicWorkingHours(logistics) {
  const log = logistics && typeof logistics === "object" ? logistics : {};
  const wh =
    log.workingHours && typeof log.workingHours === "object"
      ? /** @type {Record<string, unknown>} */ (log.workingHours)
      : {};
  const timezone =
    String(log.timezone || wh.timezone || DEFAULT_TZ).trim() || DEFAULT_TZ;

  let weekly = null;
  if (log.weeklySchedule && typeof log.weeklySchedule === "object") {
    weekly = buildDefaultWeeklySchedule(log.weeklySchedule);
  } else if (wh.weeklySchedule && typeof wh.weeklySchedule === "object") {
    weekly = buildDefaultWeeklySchedule(wh.weeklySchedule);
  }

  const legacyStart =
    normalizeHm(wh.weekdays?.start) ||
    normalizeHm(log.weekdayStart) ||
    parseLegacyRange(log.weekdayHours)?.start ||
    "09:00";
  const legacyEnd =
    normalizeHm(wh.weekdays?.end) ||
    normalizeHm(log.weekdayEnd) ||
    parseLegacyRange(log.weekdayHours)?.end ||
    "18:00";

  if (!weekly) {
    weekly = buildDefaultWeeklySchedule(null);
    for (const key of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
      weekly[key] = normalizeDaySchedule(
        { enabled: true, open: legacyStart, close: legacyEnd },
        DEFAULT_WEEKDAY,
      );
    }
    weekly.saturday = normalizeDaySchedule({ enabled: false }, DEFAULT_WEEKEND);
    weekly.sunday = normalizeDaySchedule({ enabled: false }, DEFAULT_WEEKEND);
  }

  return {
    timezone,
    weeklySchedule: weekly,
    weekdays: { start: legacyStart, end: legacyEnd },
    saturday: weekly.saturday,
    sunday: weekly.sunday,
    monday: weekly.monday,
    tuesday: weekly.tuesday,
    wednesday: weekly.wednesday,
    thursday: weekly.thursday,
    friday: weekly.friday,
  };
}

/**
 * @param {unknown} text
 */
function parseLegacyRange(text) {
  const s = String(text || "");
  const m = s.match(/(\d{1,2}:\d{2})\s*[–\-—]\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  return { start: normalizeHm(m[1]), end: normalizeHm(m[2]) };
}

/**
 * @param {Date} date
 * @param {string} timezone
 */
function dayKeyForDate(date, timezone) {
  const name = formatInTimeZone(date, timezone, "EEEE").toLowerCase();
  return DAY_KEYS.includes(name) ? name : "monday";
}

/**
 * @param {string} ymd
 * @param {string} timezone
 */
function dayKeyForYmd(ymd, timezone) {
  const d = fromZonedTime(`${ymd}T12:00:00`, timezone);
  return dayKeyForDate(d, timezone);
}

/**
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 * @param {string} dayKey
 */
function getDaySchedule(hours, dayKey) {
  const key = DAY_KEYS.includes(dayKey) ? dayKey : "monday";
  return normalizeDaySchedule(hours.weeklySchedule?.[key], DEFAULT_WEEKDAY);
}

/**
 * @param {Date} date
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 */
function isWithinClinicHours(date, hours) {
  const tz = hours.timezone || DEFAULT_TZ;
  const dayKey = dayKeyForDate(date, tz);
  const day = getDaySchedule(hours, dayKey);
  if (!day.enabled) return false;
  if (day.is24Hours) return true;

  const hm = formatInTimeZone(date, tz, "HH:mm");
  const mins = hmToMinutes(hm);
  const open = hmToMinutes(day.open);
  const close = hmToMinutes(day.close);
  if (mins == null || open == null || close == null) return false;
  if (close <= open) return mins >= open || mins < close;
  return mins >= open && mins < close;
}

/**
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 * @param {Date} [now]
 */
function isClinicOpenNow(hours, now = new Date()) {
  return isWithinClinicHours(now, hours);
}

/**
 * @param {string} ymd YYYY-MM-DD
 * @param {string} timezone
 */
function clinicDayBoundsUtc(ymd, timezone) {
  const tz = String(timezone || DEFAULT_TZ).trim() || DEFAULT_TZ;
  const start = fromZonedTime(`${ymd}T00:00:00`, tz).toISOString();
  const end = fromZonedTime(`${ymd}T23:59:59.999`, tz).toISOString();
  return { start, end, timezone: tz };
}

/**
 * @param {string} ymd
 * @param {string} hm HH:mm
 * @param {string} timezone
 */
function clinicLocalSlotToIso(ymd, hm, timezone) {
  const tz = String(timezone || DEFAULT_TZ).trim() || DEFAULT_TZ;
  const day = String(ymd || "").slice(0, 10);
  const time = normalizeHm(hm) || "09:00";
  return fromZonedTime(`${day}T${time}:00`, tz).toISOString();
}

/**
 * @param {{ enabled?: boolean, open?: string, close?: string, is24Hours?: boolean }} day
 * @param {{ startMinutes: number, endMinutes: number }} lunch
 */
function isWithinLunch(localMinutes, lunch) {
  if (!lunch) return false;
  return localMinutes >= lunch.startMinutes && localMinutes < lunch.endMinutes;
}

/**
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 * @param {string} ymd
 * @param {{ slotStepMinutes?: number, durationMinutes?: number, lunchBreak?: object, maxSlots?: number }} opts
 * @param {Set<number>|number[]} [busyStartMinutes]
 */
function generateSlotsForDay(hours, ymd, opts = {}, busyStartMinutes = []) {
  const tz = hours.timezone || DEFAULT_TZ;
  const dayKey = dayKeyForYmd(ymd, tz);
  const day = getDaySchedule(hours, dayKey);
  const slots = [];
  if (!day.enabled) return slots;

  const step = Math.max(5, Number(opts.slotStepMinutes) || 15);
  const duration = Math.max(step, Number(opts.durationMinutes) || 30);
  const maxSlots = Math.max(1, Number(opts.maxSlots) || 48);
  const busy = new Set(Array.isArray(busyStartMinutes) ? busyStartMinutes : []);

  const lunchRaw = opts.lunchBreak && typeof opts.lunchBreak === "object" ? opts.lunchBreak : null;
  const lunch =
    lunchRaw && lunchRaw.enabled !== false
      ? {
          startMinutes: hmToMinutes(lunchRaw.start) ?? 13 * 60,
          endMinutes: hmToMinutes(lunchRaw.end) ?? 14 * 60,
        }
      : null;

  if (day.is24Hours) {
    for (let m = 0; m < 24 * 60 - duration; m += step) {
      if (busy.has(m)) continue;
      if (isWithinLunch(m, lunch)) continue;
      const hm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      slots.push({
        date: ymd,
        time: hm,
        iso: clinicLocalSlotToIso(ymd, hm, tz),
        dayKey,
      });
      if (slots.length >= maxSlots) break;
    }
    return slots;
  }

  const open = hmToMinutes(day.open) ?? 9 * 60;
  const close = hmToMinutes(day.close) ?? 18 * 60;
  for (let m = open; m + duration <= close; m += step) {
    if (busy.has(m)) continue;
    if (isWithinLunch(m, lunch)) continue;
    const hm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    slots.push({
      date: ymd,
      time: hm,
      iso: clinicLocalSlotToIso(ymd, hm, tz),
      dayKey,
    });
    if (slots.length >= maxSlots) break;
  }
  return slots;
}

/**
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 * @param {object} bookingConfig
 * @param {Array<{ startAt?: string, iso?: string }>} [busyIntervals]
 * @param {Date} [fromDate]
 */
function findNextAvailableSlot(hours, bookingConfig = {}, busyIntervals = [], fromDate = new Date()) {
  const tz = hours.timezone || DEFAULT_TZ;
  const horizon = Math.max(1, Number(bookingConfig.slotHorizonDays) || 14);
  const maxSlots = Math.max(1, Number(bookingConfig.maxSlotsToOffer) || 5);
  const opts = {
    slotStepMinutes: bookingConfig.slotStepMinutes,
    durationMinutes: bookingConfig.defaultDurationMinutes,
    lunchBreak: bookingConfig.lunchBreak,
    maxSlots: 24,
  };

  const busyByYmd = {};
  for (const b of busyIntervals || []) {
    const iso = b.startAt || b.iso || b.scheduled_at;
    if (!iso) continue;
    try {
      const d = parseISO(String(iso));
      const ymd = formatInTimeZone(d, tz, "yyyy-MM-dd");
      const mins =
        parseInt(formatInTimeZone(d, tz, "H"), 10) * 60 +
        parseInt(formatInTimeZone(d, tz, "m"), 10);
      if (!busyByYmd[ymd]) busyByYmd[ymd] = [];
      busyByYmd[ymd].push(mins);
    } catch {
      /* skip */
    }
  }

  let cursor = fromDate;
  const collected = [];

  for (let dayOffset = 0; dayOffset < horizon && collected.length < maxSlots; dayOffset += 1) {
    const probe = addDays(cursor, dayOffset);
    const ymd = formatInTimeZone(probe, tz, "yyyy-MM-dd");
    let daySlots = generateSlotsForDay(hours, ymd, opts, busyByYmd[ymd] || []);

    if (dayOffset === 0) {
      const nowHm = formatInTimeZone(fromDate, tz, "HH:mm");
      const nowMins = hmToMinutes(nowHm) ?? 0;
      daySlots = daySlots.filter((s) => (hmToMinutes(s.time) ?? 0) >= nowMins);
    }

    for (const slot of daySlots) {
      collected.push(slot);
      if (collected.length >= maxSlots) break;
    }
  }

  return collected;
}

/**
 * @param {Date|string} requested
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 * @param {object} bookingConfig
 * @param {Array<object>} busyIntervals
 */
function resolveSchedulingRequest(requested, hours, bookingConfig = {}, busyIntervals = []) {
  const tz = hours.timezone || DEFAULT_TZ;
  const reqDate = requested instanceof Date ? requested : parseISO(String(requested));
  if (Number.isNaN(reqDate.getTime())) {
    return { ok: false, reason: "invalid_time", alternatives: findNextAvailableSlot(hours, bookingConfig, busyIntervals) };
  }

  if (isWithinClinicHours(reqDate, hours)) {
    const ymd = formatInTimeZone(reqDate, tz, "yyyy-MM-dd");
    const hm = formatInTimeZone(reqDate, tz, "HH:mm");
    return {
      ok: true,
      slot: { date: ymd, time: hm, iso: clinicLocalSlotToIso(ymd, hm, tz) },
      alternatives: [],
    };
  }

  return {
    ok: false,
    reason: "outside_hours",
    alternatives: findNextAvailableSlot(hours, bookingConfig, busyIntervals, reqDate),
  };
}

/**
 * Human-readable schedule for AI prompts.
 * @param {ReturnType<typeof resolveClinicWorkingHours>} hours
 */
function formatWeeklyScheduleForAi(hours) {
  const tz = hours.timezone || DEFAULT_TZ;
  const lines = [`Clinic timezone: ${tz}`];
  for (const key of DAY_KEYS) {
    const d = getDaySchedule(hours, key);
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    if (!d.enabled) {
      lines.push(`${label}: Closed`);
    } else if (d.is24Hours) {
      lines.push(`${label}: Open 24 hours`);
    } else {
      lines.push(`${label}: ${d.open} – ${d.close}`);
    }
  }
  lines.push(
    "If the patient requests a time outside these hours, offer the next available slot within this schedule.",
  );
  return lines.join("\n");
}

/**
 * Build weekly schedule from admin PATCH body (weekday block + sat/sun).
 * @param {Record<string, unknown>} body
 * @param {ReturnType<typeof resolveClinicWorkingHours>} current
 */
function buildWeeklyScheduleFromAdminBody(body, current) {
  const timezone =
    String(body.clinicTimezone || body.timezone || current.timezone || DEFAULT_TZ).trim() ||
    DEFAULT_TZ;

  const weekdayStart =
    normalizeHm(body.clinicWeekdayStart ?? body.weekdayStart) || current.weekdays.start;
  const weekdayEnd =
    normalizeHm(body.clinicWeekdayEnd ?? body.weekdayEnd) || current.weekdays.end;
  const weekday24 =
    body.weekday24Hours === true ||
    body.clinicWeekday24Hours === true ||
    body.open24Hours === true;

  const saturdayEnabled = body.saturdayEnabled === true || body.enableSaturday === true;
  const sundayEnabled = body.sundayEnabled === true || body.enableSunday === true;

  const saturday = normalizeDaySchedule(
    {
      enabled: body.saturdayEnabled !== undefined ? body.saturdayEnabled === true : saturdayEnabled,
      open: body.saturdayStart ?? body.saturdayOpen,
      close: body.saturdayEnd ?? body.saturdayClose,
      is24Hours: body.saturday24Hours === true,
    },
    { ...DEFAULT_WEEKEND, enabled: current.saturday?.enabled === true },
  );

  const sunday = normalizeDaySchedule(
    {
      enabled: body.sundayEnabled !== undefined ? body.sundayEnabled === true : sundayEnabled,
      open: body.sundayStart ?? body.sundayOpen,
      close: body.sundayEnd ?? body.sundayClose,
      is24Hours: body.sunday24Hours === true,
    },
    { ...DEFAULT_WEEKEND, enabled: current.sunday?.enabled === true },
  );

  let weekly = buildDefaultWeeklySchedule(body.weeklySchedule || null);

  if (body.weeklySchedule && typeof body.weeklySchedule === "object") {
    weekly = buildDefaultWeeklySchedule(body.weeklySchedule);
  } else {
    for (const key of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
      weekly[key] = normalizeDaySchedule(
        {
          enabled: true,
          open: weekdayStart,
          close: weekdayEnd,
          is24Hours: weekday24,
        },
        DEFAULT_WEEKDAY,
      );
    }
    weekly.saturday = saturday;
    weekly.sunday = sunday;
  }

  if (body.open24_7 === true || body.open247 === true) {
    for (const key of DAY_KEYS) {
      weekly[key] = { enabled: true, open: "00:00", close: "23:59", is24Hours: true };
    }
  }

  return {
    timezone,
    weeklySchedule: weekly,
    weekdays: { start: weekdayStart, end: weekdayEnd },
    saturday: weekly.saturday,
    sunday: weekly.sunday,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} logistics
 * @param {Record<string, unknown>} body
 */
function mergeLogisticsWorkingHours(logistics, body) {
  const log = logistics && typeof logistics === "object" ? { ...logistics } : {};
  const current = resolveClinicWorkingHours(log);
  const next = buildWeeklyScheduleFromAdminBody(body, current);
  return {
    ...log,
    timezone: next.timezone,
    weeklySchedule: next.weeklySchedule,
    weekdayHours: `${next.weekdays.start} – ${next.weekdays.end}`,
    workingHours: {
      timezone: next.timezone,
      weekdays: next.weekdays,
      weeklySchedule: next.weeklySchedule,
    },
  };
}

module.exports = {
  DAY_KEYS,
  DEFAULT_TZ,
  normalizeHm,
  hmToMinutes,
  normalizeDaySchedule,
  buildDefaultWeeklySchedule,
  resolveClinicWorkingHours,
  getDaySchedule,
  dayKeyForDate,
  dayKeyForYmd,
  isWithinClinicHours,
  isClinicOpenNow,
  clinicDayBoundsUtc,
  clinicLocalSlotToIso,
  generateSlotsForDay,
  findNextAvailableSlot,
  resolveSchedulingRequest,
  formatWeeklyScheduleForAi,
  buildWeeklyScheduleFromAdminBody,
  mergeLogisticsWorkingHours,
};
