/**
 * Patient slot-list index parsing — TR/EN ordinals, satır, seçenek, option N, bare digits.
 */

const MAX_SLOT_INDEX = 12;

/** @type {Record<string, number>} */
const ORDINAL_WORD_TO_ONE_BASED = {
  birinci: 1,
  ilk: 1,
  first: 1,
  one: 1,
  ikinci: 2,
  second: 2,
  two: 2,
  ucuncu: 3,
  third: 3,
  three: 3,
  dorduncu: 4,
  fourth: 4,
  four: 4,
  besinci: 5,
  fifth: 5,
  five: 5,
  altinci: 6,
  sixth: 6,
  six: 6,
  yedinci: 7,
  seventh: 7,
  seven: 7,
  sekizinci: 8,
  eighth: 8,
  eight: 8,
  dokuzuncu: 9,
  ninth: 9,
  nine: 9,
  onuncu: 10,
  tenth: 10,
  ten: 10,
};

/**
 * @param {string} message
 */
function normalizeSlotSelectionText(message) {
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
    .replace(/[''`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {number} oneBased
 * @param {number} slotCount
 * @returns {number|null} zero-based index
 */
function toZeroBasedIndex(oneBased, slotCount) {
  const max = Math.min(Math.max(Number(slotCount) || 0, 0), MAX_SLOT_INDEX);
  if (max < 1) return null;
  const n = Number(oneBased);
  if (!Number.isFinite(n) || n < 1) return null;
  const idx = n - 1;
  if (idx >= 0 && idx < max) return idx;
  return null;
}

/**
 * @param {string} normalized
 * @param {number} slotCount
 * @returns {number|null}
 */
function parseOrdinalWordIndex(normalized, slotCount) {
  const word = normalized.replace(/[!.?,…]+$/g, "").trim();
  const oneBased = ORDINAL_WORD_TO_ONE_BASED[word];
  if (oneBased == null) return null;
  return toZeroBasedIndex(oneBased, slotCount);
}

/**
 * Extract list option index from patient message (0-based).
 * @param {string} message
 * @param {number} slotCount
 * @returns {number|null}
 */
function parseSlotListIndexFromMessage(message, slotCount) {
  const max = Math.min(Math.max(Number(slotCount) || 0, 0), MAX_SLOT_INDEX);
  if (max < 1) return null;
  const raw = String(message || "").trim();
  if (!raw || raw.length > 64) return null;
  const t = normalizeSlotSelectionText(raw);
  if (!t) return null;

  let m = t.match(/^\s*#?\s*(\d{1,2})\s*[.!?) ]*\s*$/);
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(/^\s*(\d{1,2})\s*\.\s*(?:satir|sira|secenek|secenegi)\s*[.!?) ]*\s*$/);
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(/^\s*(\d{1,2})\s*\.\s*$/);
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(/^\s*(\d{1,2})\s*(?:\.\s*)?(?:numara|nolu|no)\s*[.!?) ]*\s*$/);
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(
    /^\s*(?:option|choice|slot|secenek|secenegi|sec|secim|seçim|tercih)\s*#?\s*(\d{1,2})\s*[.!?) ]*\s*$/i,
  );
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(
    /^\s*(\d{1,2})\s*(?:\.\s*)?(?:option|choice|slot|secenek|secenegi|sec|secim|seçim|tercih)\s*[.!?) ]*\s*$/i,
  );
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(/\b(?:option|choice|slot|secenek|secenegi|sec|tercih)\s*#?\s*(\d{1,2})\b/);
  if (m && t.length <= 48) return toZeroBasedIndex(Number(m[1]), max);

  m = t.match(/\b(\d{1,2})\s*(?:\.\s*)?(?:numara|nolu|secenek|secenegi)\b/);
  if (m && t.length <= 48) return toZeroBasedIndex(Number(m[1]), max);

  const ordinalIdx = parseOrdinalWordIndex(t, max);
  if (ordinalIdx != null) return ordinalIdx;

  m = t.match(/^\s*(?:satir|sira|secenek)\s*#?\s*(\d{1,2})\s*[.!?) ]*\s*$/);
  if (m) return toZeroBasedIndex(Number(m[1]), max);

  return null;
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
 * @param {Array<{ id?: string, startAt?: string, label?: string }>} offeredSlots
 */
function resolveOfferedSlotByListIndex(message, offeredSlots) {
  const slots = Array.isArray(offeredSlots) ? offeredSlots : [];
  if (!slots.length) return { slot: null, index: null, resolved: false };
  const index = parseSlotListIndexFromMessage(message, slots.length);
  if (index == null) return { slot: null, index: null, resolved: false };
  return { slot: slots[index] || null, index, resolved: !!slots[index] };
}

/**
 * @param {{
 *   message: string,
 *   slotCount?: number,
 *   parsedIndex?: number|null,
 *   resolved?: boolean,
 *   profileId?: string|null,
 *   logFn?: (payload: Record<string, unknown>) => void,
 * }} params
 */
function logSlotSelectionAudit(params) {
  const logFn = typeof params.logFn === "function" ? params.logFn : null;
  if (!logFn) return;
  logFn({
    auditEvent: "SLOT_SELECTION_RESOLVED",
    slot_selection_text: String(params.message || "").slice(0, 120),
    parsed_slot_index:
      params.parsedIndex != null ? Number(params.parsedIndex) : null,
    slot_selection_resolved: params.resolved === true,
    slotCount: params.slotCount != null ? Number(params.slotCount) : null,
    profileId: params.profileId ? String(params.profileId).slice(0, 8) : null,
  });
}

module.exports = {
  MAX_SLOT_INDEX,
  normalizeSlotSelectionText,
  parseSlotListIndexFromMessage,
  isBareSlotListIndexMessage,
  resolveOfferedSlotByListIndex,
  logSlotSelectionAudit,
};
