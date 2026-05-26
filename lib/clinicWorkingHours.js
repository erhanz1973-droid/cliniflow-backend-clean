/**
 * Clinic working hours — normalize ops-profile logistics for AI scheduling.
 */

const { fromZonedTime } = require("date-fns-tz");

/**
 * @param {number} n
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * @param {string} hhmm
 */
function normalizeHm(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

/**
 * @param {string} raw
 * @returns {{ start: string, end: string }|null}
 */
function parseWeekdayHoursString(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const range = s.match(
    /(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:[-–—]|to|ile|до)\s*(\d{1,2})\s*[:.]\s*(\d{2})/i,
  );
  if (range) {
    const start = normalizeHm(`${range[1]}:${range[2]}`);
    const end = normalizeHm(`${range[3]}:${range[4]}`);
    if (start && end) return { start, end };
  }

  const single = normalizeHm(s);
  if (single) return { start: single, end: "18:00" };

  return null;
}

/**
 * @param {unknown} logistics
 */
function resolveClinicWorkingHours(logistics) {
  const log = logistics && typeof logistics === "object" ? logistics : {};
  const wh = log.workingHours ?? log.working_hours ?? null;

  let timezone = String(log.timezone || "Europe/Istanbul").trim() || "Europe/Istanbul";
  /** @type {{ start: string, end: string }|null} */
  let weekdays = null;

  if (typeof log.weekdayHours === "string") {
    weekdays = parseWeekdayHoursString(log.weekdayHours);
  }

  if (wh && typeof wh === "object" && !Array.isArray(wh)) {
    if (wh.timezone) timezone = String(wh.timezone).trim() || timezone;
    const wd = wh.weekdays ?? wh.weekday;
    if (wd && typeof wd === "object") {
      const start = normalizeHm(wd.start ?? wd.open ?? wd.from);
      const end = normalizeHm(wd.end ?? wd.close ?? wd.to);
      if (start && end) weekdays = { start, end };
    } else if (typeof wd === "string") {
      weekdays = parseWeekdayHoursString(wd) || weekdays;
    }
  } else if (typeof wh === "string") {
    weekdays = parseWeekdayHoursString(wh);
    if (wh.includes("/") || wh.includes("Europe/") || wh.includes("America/")) {
      timezone = wh;
    }
  }

  const start = weekdays?.start || "09:00";
  const end = weekdays?.end || "18:00";

  return {
    timezone,
    weekdays: { start, end },
    weekdayHoursDisplay: `${start} – ${end}`,
    weekendAvailable: log.weekendAvailability === true,
    workingHours: {
      timezone,
      weekdays: { start, end },
    },
  };
}

/**
 * @param {string} hhmm
 */
function parseHmToMinutes(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param {string} dateYmd
 * @param {string} hhmm
 * @param {string} timezone
 */
function clinicLocalSlotToIso(dateYmd, hhmm, timezone) {
  const hm = parseHmToMinutes(hhmm);
  if (hm == null || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const hh = pad2(Math.floor(hm / 60));
  const mm = pad2(hm % 60);
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

module.exports = {
  parseWeekdayHoursString,
  resolveClinicWorkingHours,
  normalizeHm,
  parseHmToMinutes,
  clinicLocalSlotToIso,
  clinicDayBoundsUtc,
};
