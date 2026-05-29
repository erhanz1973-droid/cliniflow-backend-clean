/**
 * Explicit availability questions — check calendar, never silently substitute another slot.
 */

const { parsePreferredDateFromMessage } = require("./bookingDateParse");
const {
  parseConversationalTimeToMinutes,
  formatMinutesAsHm,
  normalizeTimeText,
} = require("./conversationalTimeParse");

/**
 * Patient asks whether a specific date/time is free (not a booking confirmation).
 * @param {string} message
 */
function isAvailabilityQueryMessage(message) {
  const t = normalizeTimeText(message);
  if (!t || t.length > 160) return false;

  const hasTime = parseConversationalTimeToMinutes(message) != null;
  const hasDate = !!parsePreferredDateFromMessage(message);

  if (
    /\b(musait|müsait|uygun|bos|boş|available|availability|free|müsaittir|musait mi|müsait mi)\b/i.test(
      t,
    ) &&
    (hasTime || hasDate)
  ) {
    return true;
  }

  if (/\b(is|are)\b.+\b(available|free|open)\b/i.test(t) && hasTime) return true;
  if (/\b(saat\s*)?\d{1,2}\s*[:.]\s*\d{2}\b/.test(t) && /\b(musait|müsait|uygun|available)\b/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * @param {string} dateYmd
 * @param {number} timeMin
 * @param {Array<{ dateYmd?: string, time?: string, startAt?: string }>} slots
 */
function findExactSlotInList(dateYmd, timeMin, slots) {
  const targetHm = formatMinutesAsHm(timeMin);
  if (!targetHm || !dateYmd) return null;
  const list = Array.isArray(slots) ? slots : [];
  return (
    list.find(
      (s) =>
        String(s.dateYmd || "") === String(dateYmd) &&
        String(s.time || "").slice(0, 5) === targetHm,
    ) || null
  );
}

/**
 * @param {string} lang
 * @param {string} whenLabel
 * @param {boolean} available
 */
function buildAvailabilityQueryReply(lang, whenLabel, available) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  if (available) {
    if (key === "tr") return `${whenLabel} müsait. Onaylamak ister misiniz?`;
    return `${whenLabel} is available. Would you like to confirm it?`;
  }
  if (key === "tr") return `${whenLabel} müsait değil. Başka bir saat önerebilirim.`;
  return `${whenLabel} is not available. I can suggest other times.`;
}

module.exports = {
  isAvailabilityQueryMessage,
  findExactSlotInList,
  buildAvailabilityQueryReply,
};
