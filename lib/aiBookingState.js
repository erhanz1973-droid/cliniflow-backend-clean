/**
 * Durable AI booking state — survives intake sync and automation passes.
 */

const { formatInTimeZone } = require("date-fns-tz");

const BOOKING_PENDING_ACTIONS = Object.freeze({
  SELECT_SLOT: "select_slot",
  CONFIRM_BOOKING: "confirm_booking",
  CHOOSE_DOCTOR: "choose_doctor",
});

const BOOKING_EXPIRY_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.AI_BOOKING_STATE_EXPIRY_MS) || 48 * 60 * 60 * 1000,
);

const TERMINAL_COMPLETED_STAGES = new Set(["booked", "pending_staff", "suggest_noted"]);
const IN_PROGRESS_STAGES = new Set([
  "slots_offered",
  "awaiting_slot_confirm",
  "awaiting_patient_confirm",
  "need_contact",
  "need_name",
  "slot_taken",
  "no_slots_found",
]);

const BOOKING_CONFIRM_YES_RE =
  /^(evet|tamam|olur|onayl\w*|onay|yes|ok|okay|sure|kabul|peki|confirm|confirmed)[\s!.?]*$/i;

/**
 * @param {string} stage
 */
function stageToPendingAction(stage) {
  const st = String(stage || "").toLowerCase();
  if (st === "slots_offered" || st === "slot_taken" || st === "no_slots_found") {
    return BOOKING_PENDING_ACTIONS.SELECT_SLOT;
  }
  if (
    st === "awaiting_slot_confirm" ||
    st === "awaiting_patient_confirm" ||
    st === "need_contact" ||
    st === "need_name"
  ) {
    return BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING;
  }
  return null;
}

/**
 * @param {string} [prefix]
 */
function generateSlotListId(prefix = "sl") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {string} message
 */
function isBookingConfirmationYesMessage(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 80) return false;
  if (BOOKING_CONFIRM_YES_RE.test(t)) return true;
  return (
    /\b(onayliyorum|onaylıyorum|onaylarim|onaylarım|kesinlestir|kesinleştir)\b/i.test(t) &&
    t.length < 72
  );
}

/**
 * @param {string} message
 * @param {number} slotCount
 */
function parseSlotListIndexFromMessage(message, slotCount) {
  const n = Math.max(0, Number(slotCount) || 0);
  if (!n) return null;
  const t = String(message || "").trim();
  if (!t || t.length > 24) return null;

  const bare = t.match(/^\s*#?\s*(\d{1,2})\s*[.!)?]*\s*$/i);
  if (bare) {
    const idx = Number(bare[1]) - 1;
    if (idx >= 0 && idx < n && idx < 12) return idx;
  }

  const ord = t.match(/^\s*(\d{1,2})\s*(?:numara|nolu|no\.?)\s*[.!)?]*\s*$/i);
  if (ord) {
    const idx = Number(ord[1]) - 1;
    if (idx >= 0 && idx < n && idx < 12) return idx;
  }

  if (/^\s*(birinci|ilk)\s*(?:sati[rı]|satir|secenek|seçenek|sira|sıra)?\s*$/i.test(t)) {
    return 0;
  }

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
 * @param {Record<string, unknown>|null|undefined} ab
 */
function isBookingExpired(ab) {
  const row = ab && typeof ab === "object" ? ab : {};
  const updatedAt = row.updatedAt || row.offeredAt || row.createdAt;
  if (!updatedAt) return false;
  const ts = Date.parse(String(updatedAt));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > BOOKING_EXPIRY_MS;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readDurableBookingState(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const ab = f.aiBooking && typeof f.aiBooking === "object" ? f.aiBooking : {};
  const stage = String(ab.stage || "idle");
  const selectedSlot = ab.selectedSlot && typeof ab.selectedSlot === "object" ? ab.selectedSlot : null;
  const selectedDate =
    ab.selectedDate != null
      ? String(ab.selectedDate)
      : selectedSlot?.dateYmd
        ? String(selectedSlot.dateYmd)
        : ab.preferredDateYmd
          ? String(ab.preferredDateYmd)
          : null;

  let awaitingAction =
    ab.awaitingAction != null
      ? ab.awaitingAction
      : ab.pendingAction != null
        ? ab.pendingAction
        : ab.pending_action != null
          ? ab.pending_action
          : stageToPendingAction(stage);

  if (TERMINAL_COMPLETED_STAGES.has(stage)) {
    awaitingAction = null;
  }

  const bookingActive = computeBookingActive(ab, f, stage);

  return {
    ...ab,
    stage,
    bookingActive,
    bookingId:
      ab.bookingId ||
      ab.pendingAppointmentId ||
      (f.activeAppointment && typeof f.activeAppointment === "object"
        ? f.activeAppointment.id
        : null) ||
      null,
    selectedDate,
    selectedSlot,
    awaitingAction,
    pendingAction: awaitingAction,
    pending_action: awaitingAction,
    slotListId: ab.slotListId ? String(ab.slotListId) : null,
    offeredSlots: Array.isArray(ab.offeredSlots) ? ab.offeredSlots : [],
    createdAt: ab.createdAt || null,
    updatedAt: ab.updatedAt || null,
  };
}

/**
 * @param {Record<string, unknown>} ab
 * @param {Record<string, unknown>} flags
 * @param {string} stage
 */
function computeBookingActive(ab, flags, stage) {
  if (ab.bookingActive === false) return false;
  if (isBookingExpired(ab)) return false;

  const st = String(stage || "").toLowerCase();
  if (st === "idle" || st === "expired" || st === "cancelled") return false;

  if (ab.bookingActive === true) return true;

  if (TERMINAL_COMPLETED_STAGES.has(st)) return true;

  if (IN_PROGRESS_STAGES.has(st)) return true;

  if (ab.appointmentOfferPending === true || flags.appointmentOfferPending === true) {
    return true;
  }

  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function isBookingActive(flags) {
  return readDurableBookingState(flags).bookingActive === true;
}

/**
 * Booking flow still needs deterministic handling (slot pick / confirm).
 * @param {Record<string, unknown>|null|undefined} flags
 */
function isBookingFlowInProgress(flags) {
  const d = readDurableBookingState(flags);
  if (!d.bookingActive) return false;
  const st = String(d.stage || "").toLowerCase();
  if (IN_PROGRESS_STAGES.has(st)) return true;
  if (
    d.awaitingAction === BOOKING_PENDING_ACTIONS.SELECT_SLOT ||
    d.awaitingAction === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING
  ) {
    return true;
  }
  return false;
}

/**
 * Never drop booking blobs during intake / automation sync.
 * @param {Record<string, unknown>} nextFlags
 * @param {Record<string, unknown>|null|undefined} prevFlags
 */
function preserveBookingStateInFlags(nextFlags, prevFlags) {
  const prev = prevFlags && typeof prevFlags === "object" ? prevFlags : {};
  const next = nextFlags && typeof nextFlags === "object" ? nextFlags : {};

  if (prev.aiBooking && typeof prev.aiBooking === "object" && !next.aiBooking) {
    next.aiBooking = prev.aiBooking;
  }
  if (prev.activeAppointment && typeof prev.activeAppointment === "object" && !next.activeAppointment) {
    next.activeAppointment = prev.activeAppointment;
  }
  if (
    prev.lastAppointmentEvent &&
    typeof prev.lastAppointmentEvent === "object" &&
    !next.lastAppointmentEvent
  ) {
    next.lastAppointmentEvent = prev.lastAppointmentEvent;
  }
  if (prev.appointmentOfferPending != null && next.appointmentOfferPending == null) {
    next.appointmentOfferPending = prev.appointmentOfferPending;
  }
  if (prev.appointmentScheduled != null && next.appointmentScheduled == null) {
    next.appointmentScheduled = prev.appointmentScheduled;
  }
  if (prev.waitingForConsultation != null && next.waitingForConsultation == null) {
    next.waitingForConsultation = prev.waitingForConsultation;
  }

  return next;
}

/**
 * @param {Record<string, unknown>|null|undefined} prevAb
 * @param {Record<string, unknown>} patch
 */
function mergeAiBookingPatch(prevAb, patch) {
  const prev = prevAb && typeof prevAb === "object" ? prevAb : {};
  const p = patch && typeof patch === "object" ? patch : {};
  const now = new Date().toISOString();

  const stage = p.stage != null ? String(p.stage) : String(prev.stage || "idle");
  const selectedSlot =
    p.selectedSlot !== undefined
      ? p.selectedSlot
      : prev.selectedSlot && typeof prev.selectedSlot === "object"
        ? prev.selectedSlot
        : null;
  const selectedDate =
    p.selectedDate !== undefined
      ? p.selectedDate
      : selectedSlot?.dateYmd
        ? String(selectedSlot.dateYmd)
        : p.preferredDateYmd != null
          ? String(p.preferredDateYmd)
          : prev.selectedDate || prev.preferredDateYmd || null;

  const offeredSlots =
    p.offeredSlots !== undefined
      ? Array.isArray(p.offeredSlots)
        ? p.offeredSlots
        : []
      : Array.isArray(prev.offeredSlots)
        ? prev.offeredSlots
        : [];

  let slotListId = p.slotListId != null ? String(p.slotListId) : prev.slotListId || null;
  const slotsChanged =
    Array.isArray(p.offeredSlots) &&
    p.offeredSlots.length > 0 &&
    JSON.stringify(p.offeredSlots) !== JSON.stringify(prev.offeredSlots || []);
  if (slotsChanged) {
    slotListId = p.slotListId ? String(p.slotListId) : generateSlotListId();
  }

  let awaitingAction =
    p.awaitingAction !== undefined
      ? p.awaitingAction
      : p.pendingAction !== undefined
        ? p.pendingAction
        : p.pending_action !== undefined
          ? p.pending_action
          : undefined;
  if (awaitingAction === undefined) {
    awaitingAction =
      p.stage != null ? stageToPendingAction(stage) : prev.awaitingAction || prev.pending_action;
  }
  if (TERMINAL_COMPLETED_STAGES.has(stage) || stage === "idle" || stage === "cancelled") {
    awaitingAction = null;
  }

  let bookingActive = p.bookingActive;
  if (bookingActive === undefined) {
    if (stage === "idle" || stage === "expired" || stage === "cancelled") {
      bookingActive = false;
    } else if (p.clearBooking === true) {
      bookingActive = false;
    } else if (TERMINAL_COMPLETED_STAGES.has(stage) || IN_PROGRESS_STAGES.has(stage)) {
      bookingActive = true;
    } else if (p.appointmentOfferPending === true || prev.appointmentOfferPending === true) {
      bookingActive = true;
    } else {
      bookingActive = prev.bookingActive === true;
    }
  }

  const bookingId =
    p.bookingId ||
    p.pendingAppointmentId ||
    prev.bookingId ||
    prev.pendingAppointmentId ||
    null;

  return {
    ...prev,
    ...p,
    stage,
    selectedSlot,
    selectedDate,
    awaitingAction,
    pendingAction: awaitingAction,
    pending_action: awaitingAction,
    bookingActive,
    bookingId,
    slotListId,
    offeredSlots,
    createdAt: prev.createdAt || now,
    updatedAt: now,
  };
}

/**
 * @param {string} message
 * @param {ReturnType<typeof readDurableBookingState>} durableState
 */
function resolvesPendingConfirmation(message, durableState) {
  if (!isBookingConfirmationYesMessage(message)) return false;
  const action =
    durableState.pendingAction ||
    durableState.awaitingAction ||
    durableState.pending_action;
  if (action === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING) return true;
  if (
    String(durableState.stage || "") === "awaiting_slot_confirm" &&
    durableState.selectedSlot?.startAt &&
    action !== BOOKING_PENDING_ACTIONS.SELECT_SLOT
  ) {
    return true;
  }
  return false;
}

/**
 * Deterministic slot pick from stored list — no LLM.
 * @param {string} message
 * @param {ReturnType<typeof readDurableBookingState>} durableState
 */
function parseSlotFromDurableState(message, durableState) {
  const slots = Array.isArray(durableState.offeredSlots) ? durableState.offeredSlots : [];
  if (!slots.length) return null;
  const idx = parseSlotListIndexFromMessage(message, slots.length);
  if (idx == null) return null;
  return slots[idx] || null;
}

/**
 * @param {string} message
 * @param {Record<string, unknown>|null|undefined} flags
 */
function shouldExemptBookingMessageFromDedup(message, flags) {
  if (!isBookingFlowInProgress(flags)) return false;
  const d = readDurableBookingState(flags);
  if (
    isBookingConfirmationYesMessage(message) &&
    (d.awaitingAction === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING ||
      String(d.stage) === "awaiting_slot_confirm")
  ) {
    return true;
  }
  if (d.offeredSlots.length && isBareSlotListIndexMessage(message, d.offeredSlots.length)) {
    return true;
  }
  return false;
}

/**
 * @param {{
 *   selectedSlot?: { startAt?: string, dateYmd?: string, time?: string }|null,
 *   startAt: string,
 *   timezone?: string,
 * }} params
 */
function validateBookingGuardian(params) {
  const slot = params.selectedSlot && typeof params.selectedSlot === "object" ? params.selectedSlot : null;
  const startAt = String(params.startAt || "").trim();
  if (!slot?.startAt || !startAt) {
    return { ok: true, reason: "no_selected_slot_to_compare" };
  }

  const expectedTs = Date.parse(String(slot.startAt));
  const actualTs = Date.parse(startAt);
  if (!Number.isFinite(expectedTs) || !Number.isFinite(actualTs)) {
    return { ok: false, reason: "invalid_timestamps", expected: slot.startAt, actual: startAt };
  }
  if (Math.abs(expectedTs - actualTs) > 120000) {
    return {
      ok: false,
      reason: "start_at_mismatch",
      expected: slot.startAt,
      actual: startAt,
      deltaMs: actualTs - expectedTs,
    };
  }

  const tz = String(params.timezone || "UTC").trim() || "UTC";
  try {
    const expectedDate = slot.dateYmd || formatInTimeZone(new Date(expectedTs), tz, "yyyy-MM-dd");
    const actualDate = formatInTimeZone(new Date(actualTs), tz, "yyyy-MM-dd");
    if (expectedDate && actualDate && expectedDate !== actualDate) {
      return {
        ok: false,
        reason: "date_mismatch",
        expectedDate,
        actualDate,
        expectedStartAt: slot.startAt,
        actualStartAt: startAt,
      };
    }
  } catch {
    /* non-fatal */
  }

  return { ok: true };
}

/**
 * Clear in-progress booking when TTL exceeded.
 * @param {string} profileId
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {(profileId: string, patch: Record<string, unknown>) => Promise<void>} persistFn
 */
async function applyBookingExpiryIfNeeded(profileId, flags, persistFn) {
  const d = readDurableBookingState(flags);
  if (!isBookingExpired(d)) return flags;
  if (!IN_PROGRESS_STAGES.has(String(d.stage || "").toLowerCase())) return flags;
  if (!profileId || typeof persistFn !== "function") return flags;
  await persistFn(profileId, {
    stage: "expired",
    bookingActive: false,
    clearBooking: true,
    awaitingAction: null,
    pendingAction: null,
    pending_action: null,
    appointmentOfferPending: false,
    offeredSlots: [],
    selectedSlot: null,
  });
  logBookingAudit({
    event: "booking_expired",
    profileId: String(profileId).slice(0, 8),
    priorStage: d.stage,
    slotListId: d.slotListId,
  });
  return {
    ...(flags && typeof flags === "object" ? flags : {}),
    aiBooking: {
      ...d,
      stage: "expired",
      bookingActive: false,
      awaitingAction: null,
      pendingAction: null,
      offeredSlots: [],
      selectedSlot: null,
    },
    appointmentOfferPending: false,
  };
}

/**
 * @param {Record<string, unknown>} payload
 */
function logBookingAudit(payload) {
  try {
    const row = {
      at: new Date().toISOString(),
      ...payload,
    };
    console.log("[booking.audit]", JSON.stringify(row));
  } catch (e) {
    console.warn("[booking.audit] log_failed:", e?.message || e);
  }
}

module.exports = {
  BOOKING_PENDING_ACTIONS,
  BOOKING_EXPIRY_MS,
  generateSlotListId,
  stageToPendingAction,
  readDurableBookingState,
  isBookingActive,
  isBookingFlowInProgress,
  preserveBookingStateInFlags,
  mergeAiBookingPatch,
  isBookingConfirmationYesMessage,
  isBareSlotListIndexMessage,
  parseSlotListIndexFromMessage,
  parseSlotFromDurableState,
  resolvesPendingConfirmation,
  shouldExemptBookingMessageFromDedup,
  validateBookingGuardian,
  logBookingAudit,
  applyBookingExpiryIfNeeded,
  isBookingExpired,
};
