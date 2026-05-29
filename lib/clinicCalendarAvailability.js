/**
 * Clinic calendar availability — same data sources as admin schedule (/api/admin/appointments).
 */

const { addDays, differenceInCalendarDays, parseISO } = require("date-fns");
const { formatInTimeZone, toZonedTime } = require("date-fns-tz");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { toStartIso } = require("./appointmentCoordinationSync");
const { clinicDayBoundsUtc } = require("./clinicWorkingHours");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TR_MONTHS = {
  ocak: 1,
  january: 1,
  şubat: 2,
  subat: 2,
  february: 2,
  mart: 3,
  march: 3,
  nisan: 4,
  april: 4,
  mayıs: 5,
  mayis: 5,
  mayia: 5,
  maya: 5,
  may: 5,
  haziran: 6,
  june: 6,
  temmuz: 7,
  july: 7,
  ağustos: 8,
  agustos: 8,
  august: 8,
  eylül: 9,
  eylul: 9,
  september: 9,
  ekim: 10,
  october: 10,
  kasım: 11,
  kasim: 11,
  november: 11,
  aralık: 12,
  aralik: 12,
  december: 12,
};

const BUSY_TABLES = ["appointments", "appointment_requests"];

/**
 * @param {string} hhmm
 */
function parseHm(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param {Record<string, unknown>} row
 */
function rowToBusyInterval(row) {
  const start =
    toStartIso(row.start_at) ||
    toStartIso(row.start_time) ||
    toStartIso(row.startTime) ||
    toStartIso(row.scheduled_at) ||
    (row.date && row.time
      ? toStartIso(`${String(row.date).slice(0, 10)}T${String(row.time).trim()}`)
      : null);
  if (!start) return null;
  const startTs = Date.parse(start);
  if (!Number.isFinite(startTs)) return null;
  const dur = Number(row.duration_minutes ?? row.duration ?? row.durationMinutes ?? 30) || 30;
  const endRaw = toStartIso(row.end_at) || toStartIso(row.end_time) || toStartIso(row.endTime);
  const endTs = endRaw ? Date.parse(endRaw) : startTs + dur * 60000;
  return [startTs, Number.isFinite(endTs) ? endTs : startTs + dur * 60000];
}

/**
 * @param {string} clinicId
 * @param {string} dateYmd
 * @param {string} timezone
 */
async function fetchClinicBusyIntervalsForDay(clinicId, dateYmd, timezone = "UTC", options = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  const { start: dayStart, end: dayEnd } = clinicDayBoundsUtc(dateYmd, timezone);
  const excludePatientId = String(options.excludePatientId || "").trim();
  /** @type {Array<[number, number]>} */
  const ownPatientIntervals = [];

  if (UUID_RE.test(excludePatientId)) {
    try {
      const { data: ownEnc } = await supabase
        .from("patient_encounters")
        .select("id")
        .eq("patient_id", excludePatientId)
        .limit(40);
      const ownEncIds = (ownEnc || []).map((e) => String(e?.id || "").trim()).filter(Boolean);
      for (let i = 0; i < ownEncIds.length; i += 40) {
        const chunk = ownEncIds.slice(i, i + 40);
        const { data: ownEt } = await supabase
          .from("encounter_treatments")
          .select("scheduled_at, status")
          .in("encounter_id", chunk)
          .not("scheduled_at", "is", null)
          .gte("scheduled_at", dayStart)
          .lt("scheduled_at", dayEnd);
        for (const row of ownEt || []) {
          const st = String(row.status || "").toLowerCase();
          if (st === "cancelled" || st === "canceled") continue;
          const interval = rowToBusyInterval(row);
          if (interval) ownPatientIntervals.push(interval);
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** @type {Array<[number, number]>} */
  const busy = [];

  const isOwnPatientBooking = (interval) => {
    if (!interval || !ownPatientIntervals.length) return false;
    const [s] = interval;
    return ownPatientIntervals.some(([os, oe]) => s >= os - 60000 && s < oe + 60000);
  };

  const addRow = (row) => {
    const st = String(row.status || row.state || "").toLowerCase();
    if (st === "cancelled" || st === "canceled" || st === "rejected" || st === "declined") {
      return;
    }
    if (excludePatientId) {
      const rowPid = String(row.patient_id || row.patientId || "").trim();
      if (rowPid && rowPid === excludePatientId) return;
    }
    const interval = rowToBusyInterval(row);
    if (interval && !isOwnPatientBooking(interval)) busy.push(interval);
  };

  try {
    const { data: encRows } = await supabase
      .from("patient_encounters")
      .select("id")
      .eq("clinic_id", clinicId)
      .limit(800);
    const encIds = (encRows || []).map((e) => String(e?.id || "").trim()).filter(Boolean);
    for (let i = 0; i < encIds.length; i += 80) {
      const chunk = encIds.slice(i, i + 80);
      const { data: etRows, error: etErr } = await supabase
        .from("encounter_treatments")
        .select("scheduled_at, status")
        .in("encounter_id", chunk)
        .not("scheduled_at", "is", null)
        .gte("scheduled_at", dayStart)
        .lt("scheduled_at", dayEnd);
      if (etErr) continue;
      for (const row of etRows || []) addRow(row);
    }
  } catch {
    /* encounter_treatments may be unavailable in some envs */
  }

  for (const table of BUSY_TABLES) {
    const attempts = [
      () =>
        supabase
          .from(table)
          .select("*")
          .eq("clinic_id", clinicId)
          .gte("start_at", dayStart)
          .lt("start_at", dayEnd),
      () =>
        supabase
          .from(table)
          .select("*")
          .eq("clinic_id", clinicId)
          .gte("start_time", dayStart)
          .lt("start_time", dayEnd),
      () =>
        supabase.from(table).select("*").eq("clinic_id", clinicId).eq("date", dateYmd),
      () =>
        supabase
          .from(table)
          .select("*")
          .eq("clinic_id", clinicId)
          .gte("date", dateYmd)
          .lte("date", dateYmd),
    ];

    for (const run of attempts) {
      try {
        const { data, error } = await run();
        if (error) continue;
        for (const row of data || []) addRow(row);
        if ((data || []).length) break;
      } catch {
        /* schema may vary */
      }
    }
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
 * @param {string} message
 * @param {string} timezone
 */
function parsePreferredDateFromMessage(message, timezone = "Europe/Istanbul") {
  const t = String(message || "").toLowerCase();
  const tz = timezone || "UTC";
  const zonedNow = toZonedTime(new Date(), tz);
  let year = Number(formatInTimeZone(zonedNow, tz, "yyyy"));

  const numeric = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (numeric[3]) {
      const y = Number(numeric[3]);
      year = y < 100 ? 2000 + y : y;
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const mayTypo = t.match(/\b(\d{1,2})\s*may[ıi]?a?\b/i);
  if (mayTypo) {
    const day = Number(mayTypo[1]);
    if (day >= 1 && day <= 31) {
      return `${year}-05-${String(day).padStart(2, "0")}`;
    }
  }

  for (const [name, monthNum] of Object.entries(TR_MONTHS)) {
    const dayFirst = new RegExp(`\\b(\\d{1,2})\\s*${name}\\b`, "i");
    const monthFirst = new RegExp(`\\b${name}\\s*(\\d{1,2})\\b`, "i");
    const m1 = t.match(dayFirst);
    if (m1) {
      const day = Number(m1[1]);
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const m2 = t.match(monthFirst);
    if (m2) {
      const day = Number(m2[1]);
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * @param {string} message
 */
function parsePreferredTimeMinutesFromMessage(message) {
  const { parseConversationalTimeToMinutes } = require("./conversationalTimeParse");
  return parseConversationalTimeToMinutes(message);
}

/**
 * @param {string} message
 */
function patientRequestsAlternateSlots(message) {
  const t = String(message || "").toLowerCase();
  return /\b(başka|baska|farklı|farkli|alternatif|olmaz|olmasın|olmasin|uygun değil|uygun degil|musait degil|müsait değil|yer yok|dolu|meşgul|mesgul|başka saat|baska saat|farklı saat|farkli saat|erken|geç|gec|yarın|yarin)\b/i.test(
    t,
  );
}

/**
 * @param {string} message
 */
function patientDeclinedOfferedTimes(message) {
  return /\b(6|06|7|07)\s*[:.]?\s*00\b/.test(String(message || "")) && /\b(olmaz|uygun değil|musait degil|müsait değil|erken|açılm|acilm)\b/i.test(String(message || ""));
}

/**
 * @param {Array<{ startAt: string, time?: string }>} slots
 * @param {{ workStartMin: number, workEndMin: number }} scheduling
 */
function filterSlotsWithinWorkingHours(slots, scheduling) {
  return (Array.isArray(slots) ? slots : []).filter((slot) => {
    const hm = parseHm(slot.time);
    if (hm == null) return false;
    if (hm < scheduling.workStartMin) return false;
    const dur = Number(slot.durationMinutes) || 30;
    if (hm + dur > scheduling.workEndMin) return false;
    const ts = Date.parse(String(slot.startAt || ""));
    return Number.isFinite(ts) && ts >= Date.now();
  });
}

/**
 * @param {string} preferredDateYmd
 * @param {string} timezone
 */
function dayOffsetsFromPreferredDate(preferredDateYmd, timezone, horizonDays) {
  const tz = timezone || "UTC";
  const todayYmd = formatInTimeZone(toZonedTime(new Date(), tz), tz, "yyyy-MM-dd");
  let start = 0;
  try {
    start = differenceInCalendarDays(parseISO(preferredDateYmd), parseISO(todayYmd));
    if (start < 0) start = 0;
  } catch {
    start = 0;
  }
  const offsets = [];
  for (let d = start; d < start + horizonDays; d++) offsets.push(d);
  if (start > 0) {
    for (let d = 0; d < start && offsets.length < horizonDays + start; d++) offsets.push(d);
  }
  return [...new Set(offsets)].slice(0, horizonDays + 7);
}

module.exports = {
  parseHm,
  fetchClinicBusyIntervalsForDay,
  parsePreferredDateFromMessage,
  parsePreferredTimeMinutesFromMessage,
  patientRequestsAlternateSlots,
  patientDeclinedOfferedTimes,
  filterSlotsWithinWorkingHours,
  dayOffsetsFromPreferredDate,
};
