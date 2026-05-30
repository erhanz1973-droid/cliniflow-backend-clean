/**
 * Deterministic date parsing for appointment booking — weekdays, relative dates, TR/EN months.
 * Uses an explicit reference date in tests (default: now in clinic timezone).
 */

const { addDays, getDay, parseISO } = require("date-fns");
const { formatInTimeZone, toZonedTime } = require("date-fns-tz");

const TR_MONTHS = {
  ocak: 1,
  january: 1,
  subat: 2,
  february: 2,
  mart: 3,
  march: 3,
  nisan: 4,
  april: 4,
  mayis: 5,
  mayia: 5,
  maya: 5,
  may: 5,
  haziran: 6,
  june: 6,
  temmuz: 7,
  july: 7,
  agustos: 8,
  august: 8,
  eylul: 9,
  september: 9,
  ekim: 10,
  october: 10,
  kasim: 11,
  november: 11,
  aralik: 12,
  december: 12,
};

/** @type {Array<{ re: RegExp, dow: number }>} dow: 0=Sun … 6=Sat (date-fns getDay) */
const WEEKDAY_PATTERNS = [
  { re: /\bpazar\b|\bsunday\b/i, dow: 0 },
  { re: /\bpazartesi\b|\bmonday\b/i, dow: 1 },
  { re: /\bsali\b|\btuesday\b/i, dow: 2 },
  { re: /\bcarsamba\b|\bwednesday\b/i, dow: 3 },
  { re: /\bpersembe\b|\bthursday\b/i, dow: 4 },
  { re: /\bcuma\b|\bfriday\b/i, dow: 5 },
  { re: /\bcumartesi\b|\bsaturday\b/i, dow: 6 },
];

/**
 * @param {string} message
 */
function normalizeDateText(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

/** «3 hazirana», «mayisa» — Turkish dative/locative suffixes on month names. */
function normalizeTurkishMonthTokens(text) {
  let t = String(text || "");
  for (const name of Object.keys(TR_MONTHS)) {
    const re = new RegExp(`\\b${name}[a-z]{0,4}\\b`, "gi");
    t = t.replace(re, name);
  }
  return t;
}

/**
 * @param {number} targetDow
 * @param {string} timezone
 * @param {Date} refDate
 * @param {{ forceNext?: boolean }} [opts]
 */
function nextWeekdayYmd(targetDow, timezone, refDate, opts = {}) {
  const tz = timezone || "UTC";
  const zoned = toZonedTime(refDate instanceof Date ? refDate : new Date(refDate), tz);
  const todayDow = getDay(zoned);
  let delta = (targetDow - todayDow + 7) % 7;
  if (delta === 0 && opts.forceNext) delta = 7;
  return formatInTimeZone(addDays(zoned, delta), tz, "yyyy-MM-dd");
}

/**
 * @param {string} message
 * @param {string} timezone
 * @param {Date} refDate
 */
function parseRelativeDateFromMessage(message, timezone, refDate) {
  const t = normalizeDateText(message);
  const tz = timezone || "UTC";
  const zoned = toZonedTime(refDate instanceof Date ? refDate : new Date(refDate), tz);

  if (/\b(yarin|tomorrow)\b/.test(t)) {
    return formatInTimeZone(addDays(zoned, 1), tz, "yyyy-MM-dd");
  }
  if (/\b(bugun|today)\b/.test(t)) {
    return formatInTimeZone(zoned, tz, "yyyy-MM-dd");
  }
  return null;
}

/**
 * Weekday mentioned as excluded (e.g. "Pazartesi harici", "not Monday", "I do NOT want Monday").
 * @param {string} normalizedText
 * @param {RegExp} weekdayRe
 */
function isWeekdayExcludedInMessage(normalizedText, weekdayRe) {
  const t = String(normalizedText || "");
  if (!t || !weekdayRe.test(t)) return false;

  if (/\b(harici|haric|disinda|except|excluding)\b/.test(t) && weekdayRe.test(t)) {
    return true;
  }
  if (/\b(istemiyorum|istemedim|istemem)\b/.test(t) && weekdayRe.test(t)) {
    return true;
  }
  if (/\b(olmaz|olmasin|uygun degil|musait degil|degil)\b/.test(t) && weekdayRe.test(t)) {
    return true;
  }
  if (/\bnot\b/.test(t) && weekdayRe.test(t)) {
    return true;
  }
  if (/\b(do not want|don't want|dont want|do not need)\b/.test(t) && weekdayRe.test(t)) {
    return true;
  }
  return false;
}

/**
 * @param {string} message
 * @param {string} timezone
 * @param {Date} refDate
 */
function parseWeekdayFromMessage(message, timezone, refDate) {
  const t = normalizeDateText(message);
  const forceNext = /\b(next|gelecek|onumuzdeki|önümüzdeki)\b/.test(t);
  for (const { re, dow } of WEEKDAY_PATTERNS) {
    if (re.test(t) && !isWeekdayExcludedInMessage(t, re)) {
      return nextWeekdayYmd(dow, timezone, refDate, { forceNext });
    }
  }
  return null;
}

/**
 * @param {string} message
 * @param {string} timezone
 * @param {Date} refDate
 */
function parsePreferredDateFromMessage(message, timezone = "Europe/Istanbul", refDate = new Date()) {
  const t = normalizeTurkishMonthTokens(normalizeDateText(message));
  if (!t) return null;
  const tz = timezone || "UTC";
  const zonedRef = toZonedTime(refDate instanceof Date ? refDate : new Date(refDate), tz);
  let year = Number(formatInTimeZone(zonedRef, tz, "yyyy"));

  const relative = parseRelativeDateFromMessage(message, tz, refDate);
  if (relative) return relative;

  const weekday = parseWeekdayFromMessage(message, tz, refDate);
  if (weekday) return weekday;

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
 * Scan recent turns (patient + assistant) for the most recent explicit date mention.
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 * @param {string} timezone
 * @param {Date} [refDate]
 */
function inferPreferredDateFromConversation(recentTurns, timezone, refDate = new Date()) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 12; i--) {
    const tx = String(turns[i]?.text || "");
    const d = parsePreferredDateFromMessage(tx, timezone, refDate);
    if (d) return d;
  }
  return null;
}

module.exports = {
  TR_MONTHS,
  normalizeDateText,
  normalizeTurkishMonthTokens,
  nextWeekdayYmd,
  isWeekdayExcludedInMessage,
  parseRelativeDateFromMessage,
  parseWeekdayFromMessage,
  parsePreferredDateFromMessage,
  inferPreferredDateFromConversation,
};
