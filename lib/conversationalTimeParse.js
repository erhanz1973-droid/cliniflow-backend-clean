/**
 * Conversational time parsing — Turkish & common patient phrasing for booking.
 * Examples: "saat 7", "7'de", "8 buçuk", "8'i 20 geçe", "9'a 10 var", "8:30"
 */

/**
 * @param {string} s
 */
function normalizeTimeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[''`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {number} hour
 * @param {number} minute
 */
function toMinutes(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

/**
 * Parse patient message to minutes-from-midnight (clinic local intent).
 * @param {string} message
 * @returns {number|null}
 */
function parseConversationalTimeToMinutes(message) {
  const t = normalizeTimeText(message);
  if (!t) return null;

  // 8'i 20 geçe / 8i 20 gece (apostrophe or "i" required — avoids "10 var" false match)
  let m = t.match(/(\d{1,2})\s*(?:'i|i)\s*(\d{1,2})\s*gec(?:e|iyor)?\b/);
  if (m) return toMinutes(m[1], m[2]);
  m = t.match(/(\d{1,2})\s+(\d{1,2})\s*gec(?:e|iyor)?\b/);
  if (m) return toMinutes(m[1], m[2]);

  // 9'a 10 var / 9a 10 kala → minutes before the hour (apostrophe required)
  m = t.match(/(\d{1,2})\s*'a\s*(\d{1,2})\s+var\b/);
  if (m) return toMinutes(Number(m[1]), 0) - Number(m[2]);
  m = t.match(/(\d{1,2})\s*'e\s*(\d{1,2})\s+var\b/);
  if (m) return toMinutes(Number(m[1]), 0) - Number(m[2]);
  m = t.match(/(\d{1,2})\s*'a\s*(\d{1,2})\s+kala\b/);
  if (m) return toMinutes(Number(m[1]), 0) - Number(m[2]);

  // half past 8 / 8 buçuk / 8 bucuk / 8 yarim
  m = t.match(/(\d{1,2})\s*(?:'i\s*)?(?:bucuk|yarim)\b/);
  if (m) return toMinutes(m[1], 30);
  m = t.match(/\bhalf\s*past\s*(\d{1,2})\b/);
  if (m) return toMinutes(m[1], 30);

  // quarter past / quarter to
  m = t.match(/(\d{1,2})\s*(?:'i\s*)?ceyrek\s*gec/);
  if (m) return toMinutes(m[1], 15);
  m = t.match(/(\d{1,2})\s*(?:'e|a)\s*ceyrek\s*var/);
  if (m) return toMinutes(Number(m[1]), 0) - 15;

  // 08:30 / 8.30 / 8:30
  m = t.match(/\b(\d{1,2})\s*[:.]\s*(\d{2})\b/);
  if (m) return toMinutes(m[1], m[2]);

  // saat9 / saat 9 / 7'de / 7 de olur
  m = t.match(/^saat\s*(\d{1,2})$/);
  if (m) return toMinutes(m[1], 0);
  m = t.match(/(?:^|\b)saat\s+(\d{1,2})(?:\s*'de|\s*'da|\s+de|\s+da)?\b/);
  if (m) return toMinutes(m[1], 0);
  m = t.match(/(?:^|\b)(\d{1,2})\s*(?:'de|'da)\b/);
  if (m && !/\b(var|kala|gec)\b/.test(t)) return toMinutes(m[1], 0);
  m = t.match(/(?:^|\b)(\d{1,2})\s+(?:de|da|te)\b/);
  if (m && !/\b(var|kala|gec)\b/.test(t)) return toMinutes(m[1], 0);

  // standalone hour — require «saat» for 1–7 (those digits are usually list option numbers)
  const short = t.match(/^(?:saat\s*)?(\d{1,2})$/);
  if (short && t.length <= 32) {
    const h = Number(short[1]);
    if (/^saat\s*/.test(t)) return toMinutes(short[1], 0);
    if (h >= 8 && h <= 23) return toMinutes(short[1], 0);
    return null;
  }

  if (/\bsabah\b/.test(t)) return 9 * 60;
  if (/\bogle\b|\böğle\b|\bafternoon\b/.test(t) && !/\bsonra\b/.test(t)) return 12 * 60;
  if (/\bogleden sonra\b|\böğleden sonra\b/.test(t)) return 14 * 60;
  if (/\baksam\b|\bakşam\b|\bevening\b/.test(t)) return 17 * 60;

  return null;
}

/**
 * @param {number} minutes
 */
function formatMinutesAsHm(minutes) {
  if (minutes == null || minutes === "") return null;
  const m = Number(minutes);
  if (!Number.isFinite(m)) return null;
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * @param {string} message
 * @param {Array<{ time?: string, startAt?: string }>} slots
 * @param {number} [maxDeltaMinutes=45]
 */
function matchSlotByConversationalTime(message, slots, maxDeltaMinutes = 45) {
  const preferred = parseConversationalTimeToMinutes(message);
  if (preferred == null) return null;
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return { preferredMinutes: preferred, slot: null };

  const targetHm = formatMinutesAsHm(preferred);
  if (targetHm) {
    const exact = list.find((s) => String(s.time || "").slice(0, 5) === targetHm);
    if (exact) return { preferredMinutes: preferred, slot: exact };
  }

  let best = null;
  let bestDist = Infinity;
  for (const slot of list) {
    const timeStr = String(slot.time || "").match(/^(\d{1,2}):(\d{2})/);
    if (!timeStr) continue;
    const slotMin = Number(timeStr[1]) * 60 + Number(timeStr[2]);
    const dist = Math.abs(slotMin - preferred);
    if (dist < bestDist) {
      bestDist = dist;
      best = slot;
    }
  }
  if (best && bestDist <= maxDeltaMinutes) {
    return { preferredMinutes: preferred, slot: best };
  }
  return { preferredMinutes: preferred, slot: null };
}

/**
 * @param {string} message
 */
function messageExpressesTimeIntent(message) {
  const t = normalizeTimeText(message);
  if (!t) return false;
  if (parseConversationalTimeToMinutes(message) != null) return true;
  if (/\b(saat|bucuk|yarim|gec|gece|kala)\b/.test(t)) return true;
  if (/\d{1,2}\s*'[ae]\s*\d{1,2}\s+(var|kala)\b/.test(t)) return true;
  if (/\d{1,2}\s+(\d{1,2}\s+)?gec(?:e|iyor)?\b/.test(t)) return true;
  return false;
}

/**
 * Clinic capacity / logistics questions — must not trigger slot-offer booking flow.
 * @param {string} message
 */
function isClinicFacilityOrInfoQuestion(message) {
  const t = normalizeTimeText(message);
  if (!t) return false;
  if (
    /\b(kac\s+(tane|adet)|how\s+many|kac\s+ane)\b/.test(t) &&
    /\b(koltuk|chair|doktor|doctor|hekim|unit|oda|personel|sandalye|disci|dis\s*hekim)\w*/.test(t)
  ) {
    return true;
  }
  if (/\b(koltuk\s+say|chair\s+count|kac\s+koltuk|kac\s+doktor)\b/.test(t)) return true;
  if (/\b(adres|konum|neredesiniz|where\s+are\s+you|calisma\s+saat|working\s+hour|acilis|kapanis)\b/.test(t)) {
    return true;
  }
  if (/\b(fiyat|ucret|price|cost|tutar)\b/.test(t) && !/\b(randevu|appointment|musait|müsait)\b/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Patient message is essentially a clock time (e.g. "12:30", "11", "saat 10").
 * @param {string} message
 */
function isTimeOnlyPatientMessage(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 40) return false;
  if (parseConversationalTimeToMinutes(t) == null) return false;
  const withoutTime = t
    .replace(/\b\d{1,2}\s*[:.]\s*\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\b/g, " ")
    .replace(/\b(saat|de|da|te)\b/gi, " ")
    .replace(/[^\p{L}]/gu, " ")
    .trim();
  return withoutTime.length <= 2;
}

module.exports = {
  normalizeTimeText,
  parseConversationalTimeToMinutes,
  formatMinutesAsHm,
  matchSlotByConversationalTime,
  messageExpressesTimeIntent,
  isTimeOnlyPatientMessage,
  isClinicFacilityOrInfoQuestion,
};
