/**
 * Durable AI booking state — survives intake sync and automation passes.
 */

const { formatInTimeZone } = require("date-fns-tz");

const {
  parseSlotListIndexFromMessage,
  isBareSlotListIndexMessage,
  MAX_SLOT_INDEX,
} = require("./slotSelectionParse");

const BOOKING_PENDING_ACTIONS = Object.freeze({
  SELECT_SLOT: "select_slot",
  CONFIRM_BOOKING: "confirm_booking",
  CHOOSE_DOCTOR: "choose_doctor",
});

const BOOKING_AUDIT_EVENTS = Object.freeze({
  BOOKING_STARTED: "BOOKING_STARTED",
  SLOT_SELECTED: "SLOT_SELECTED",
  CONFIRMATION_REQUESTED: "CONFIRMATION_REQUESTED",
  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_CREATED: "BOOKING_CREATED",
  SLOT_SELECTION_RESOLVED: "SLOT_SELECTION_RESOLVED",
  BOOKING_EXPIRED: "BOOKING_EXPIRED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
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

/** Affirmative + scheduling intent: "Yes, schedule it", "Evet randevu alalım". */
const BOOKING_COMPOUND_SCHEDULE_YES_RE =
  /^(?:yes|evet|ok|okay|sure|tamam|olur|yep|yeah|please\s+yes|yes\s+please)[,.\s!]*(?:.*\b(?:schedule|book|appointment|randevu|planla|ayarla|confirm|onayla|onay)\b)/i;

const SCHEDULING_OFFER_ASSISTANT_RE =
  /\b(i can schedule|can schedule your|schedule your appointment|book your appointment|book an appointment|would you like to (book|schedule)|shall we (book|schedule)|let me schedule|randevu(nuzu|yu)?\s*(ayarla|planla|olustur|oluştur)|randevu\s*al|randevu\s*verebilirim|randevu\s*yapabilirim|size\s+uygun\s+bir\s+saat|müsait\s+saat)\b/i;

const BOOKING_STATUS_INQUIRY_RE =
  /\b(what time is my appointment|which day am i booked|which appointment did i book|did my booking succeed|did you create my appointment|my appointment time|when is my appointment|randevum ne zaman|saat kaçta|hangi gün|hangi randevu|randevu oluşturuldu|randevu olustu|randevum var\s*mi|randevu onaylandi|booking succeed|appointment time|what time am i booked)\b/i;

/**
 * @param {string} [fromIso]
 */
function computeExpiresAt(fromIso) {
  const base = Date.parse(String(fromIso || new Date().toISOString()));
  if (!Number.isFinite(base)) return new Date(Date.now() + BOOKING_EXPIRY_MS).toISOString();
  return new Date(base + BOOKING_EXPIRY_MS).toISOString();
}

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
 * @param {string} text
 */
function assistantMessageOffersScheduling(text) {
  return SCHEDULING_OFFER_ASSISTANT_RE.test(String(text || ""));
}

/**
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 */
function coordinatorRecentlyOfferedScheduling(recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 8; i--) {
    const role = String(turns[i]?.role || "").toLowerCase();
    if (role !== "assistant" && role !== "coordinator" && role !== "clinic") continue;
    const tx = String(turns[i]?.text || "");
    if (SCHEDULING_OFFER_ASSISTANT_RE.test(tx)) return true;
    if (/\bonayl[iı]yor musunuz\b/i.test(tx) && /\brandevu\b/i.test(tx)) return true;
  }
  return false;
}

/**
 * Patient accepted a scheduling offer or confirmed a pending slot.
 * @param {string} message
 * @param {{
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 *   pendingConfirmation?: boolean,
 *   schedulingOfferPending?: boolean,
 * }} [ctx]
 */
function isBookingConfirmationYesMessage(message, ctx = {}) {
  const t = String(message || "").trim();
  if (!t || t.length > 120) return false;
  if (BOOKING_CONFIRM_YES_RE.test(t)) return true;
  if (
    /\b(onayliyorum|onaylıyorum|onaylarim|onaylarım|kesinlestir|kesinleştir)\b/i.test(t) &&
    t.length < 72
  ) {
    return true;
  }
  if (BOOKING_COMPOUND_SCHEDULE_YES_RE.test(t)) return true;

  const recentTurns = ctx.recentTurns || [];
  const schedulingOffered =
    ctx.schedulingOfferPending === true || coordinatorRecentlyOfferedScheduling(recentTurns);

  if (schedulingOffered) {
    if (/^(yes|evet|ok|okay|sure|tamam|olur|yep|yeah|please)[\s,!.?]*$/i.test(t)) return true;
    if (/^(yes|evet|ok|tamam|sure)[,.\s]+/i.test(t) && /\b(schedule|book|randevu|appointment)\b/i.test(t)) {
      return true;
    }
  }

  if (ctx.pendingConfirmation && /^(yes|evet|ok|okay|sure|tamam|olur)[\s,!.?]*$/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * @param {string} message
 * @param {Array<{ role?: string, text?: string }>} [recentTurns]
 */
function isSchedulingAcceptanceMessage(message, recentTurns) {
  return isBookingConfirmationYesMessage(message, {
    recentTurns,
    schedulingOfferPending: true,
  });
}

/**
 * @param {string} message
 */
function isBookingStatusInquiry(message) {
  return BOOKING_STATUS_INQUIRY_RE.test(String(message || ""));
}

/**
 * @param {string} message
 */
function isPostBookingStaleActionMessage(message) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (isBookingConfirmationYesMessage(t)) return true;
  if (isBareSlotListIndexMessage(t, MAX_SLOT_INDEX)) return true;
  if (/^confirm(ed)?[\s!.?]*$/i.test(t)) return true;
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} ab
 */
function isBookingExpired(ab) {
  const row = ab && typeof ab === "object" ? ab : {};
  if (row.expiresAt) {
    const exp = Date.parse(String(row.expiresAt));
    if (Number.isFinite(exp) && Date.now() > exp) return true;
  }
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

  if (TERMINAL_COMPLETED_STAGES.has(stage) || stage === "expired" || stage === "cancelled") {
    awaitingAction = null;
  }

  const bookingActive = computeBookingActive(ab, f, stage);
  const canonicalBooking = readCanonicalBooking(f);

  return {
    ...ab,
    stage,
    bookingActive,
    bookingId:
      ab.bookingId ||
      ab.pendingAppointmentId ||
      canonicalBooking?.bookingId ||
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
    expiresAt: ab.expiresAt || null,
    canonicalBooking,
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
  if (TERMINAL_COMPLETED_STAGES.has(String(stage || "").toLowerCase())) return false;
  if (String(stage || "").toLowerCase() === "expired" || String(stage || "").toLowerCase() === "cancelled") {
    return false;
  }
  if (isBookingExpired(ab)) return false;

  const st = String(stage || "").toLowerCase();
  if (st === "idle") return false;

  if (ab.bookingActive === true) return true;

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
 * @param {Record<string, unknown>|null|undefined} flags
 */
function isBookingFlowInProgress(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const d = readDurableBookingState(f);
  if (String(d.stage || "").toLowerCase() === "expired") return false;
  if (isBookingExpired(d)) return false;
  if (
    d.awaitingAction === BOOKING_PENDING_ACTIONS.SELECT_SLOT ||
    d.awaitingAction === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING
  ) {
    return true;
  }
  if (f.appointmentOfferPending === true || d.appointmentOfferPending === true) {
    return true;
  }
  if (!d.bookingActive) return false;
  const st = String(d.stage || "").toLowerCase();
  if (IN_PROGRESS_STAGES.has(st)) return true;
  return false;
}

/**
 * Hard router lock — pricing / FAQ / LLM marketing must not run when locked.
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {{
 *   bookingPrep?: Record<string, unknown>|null,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 * }} [opts]
 */
function resolveBookingRouterLock(flags, opts = {}) {
  const f = flags && typeof flags === "object" ? flags : {};
  const bookingPrep = opts.bookingPrep && typeof opts.bookingPrep === "object" ? opts.bookingPrep : {};
  const d = readDurableBookingState(f);

  if (String(d.stage || "").toLowerCase() === "expired" || isBookingExpired(d)) {
    return { locked: false, reason: "booking_expired", durable: d };
  }

  if (isBookingFlowInProgress(f)) {
    return { locked: true, reason: "booking_flow_in_progress", durable: d };
  }

  if (
    bookingPrep.engaged === true &&
    (bookingPrep.awaitingConfirmation ||
      bookingPrep.needContact ||
      bookingPrep.needName ||
      bookingPrep.booked ||
      bookingPrep.slotsOffered ||
      bookingPrep.directReply)
  ) {
    return { locked: true, reason: "booking_prep_engaged", durable: d };
  }

  const msg = String(bookingPrep.patientMessage || opts.patientMessage || "").trim();
  if (
    msg &&
    isSchedulingAcceptanceMessage(msg, opts.recentTurns) &&
    coordinatorRecentlyOfferedScheduling(opts.recentTurns || [])
  ) {
    return { locked: true, reason: "scheduling_acceptance", durable: d };
  }

  return { locked: false, reason: null, durable: d };
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readCanonicalBooking(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  if (f.canonicalBooking && typeof f.canonicalBooking === "object") {
    return f.canonicalBooking;
  }
  const ab = f.aiBooking && typeof f.aiBooking === "object" ? f.aiBooking : {};
  if (ab.canonicalBooking && typeof ab.canonicalBooking === "object") {
    return ab.canonicalBooking;
  }
  const appt = f.activeAppointment;
  if (appt && typeof appt === "object" && appt.startAt) {
    return buildCanonicalBookingFromAppointment(appt, f);
  }
  return null;
}

/**
 * @param {Record<string, unknown>} appt
 * @param {Record<string, unknown>} [flags]
 */
function buildCanonicalBookingFromAppointment(appt, flags = {}) {
  const startAt = String(appt.startAt || "").trim();
  if (!startAt) return null;
  const tz =
    String(appt.timezone || flags?.clinicTimezone || "Europe/Istanbul").trim() || "Europe/Istanbul";
  let date = appt.dateYmd ? String(appt.dateYmd) : null;
  let time = appt.time ? String(appt.time).slice(0, 5) : null;
  try {
    if (!date) date = formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd");
    if (!time) time = formatInTimeZone(new Date(startAt), tz, "HH:mm");
  } catch {
    /* non-fatal */
  }
  return {
    bookingId: appt.id || appt.appointmentId || null,
    date,
    time,
    doctor: appt.doctorName || appt.doctorId || appt.assignedDoctorId || null,
    status: appt.status || "scheduled",
    createdAt: appt.createdAt || appt.updatedAt || flags?.lastAppointmentEvent?.at || null,
    startAt,
    treatmentLabel: appt.treatmentLabel || null,
    label: appt.label || null,
  };
}

/**
 * @param {{
 *   bookingId?: string|null,
 *   startAt: string,
 *   timezone?: string,
 *   locale?: string,
 *   doctorId?: string|null,
 *   doctorName?: string|null,
 *   status?: string,
 *   treatmentLabel?: string|null,
 * }} params
 */
function buildCanonicalBookingRecord(params) {
  const startAt = String(params.startAt || "").trim();
  if (!startAt) return null;
  const tz = String(params.timezone || "Europe/Istanbul").trim() || "Europe/Istanbul";
  const locale = String(params.locale || "tr").slice(0, 5);
  let date = null;
  let time = null;
  let label = null;
  try {
    date = formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd");
    time = formatInTimeZone(new Date(startAt), tz, "HH:mm");
    const { formatAppointmentDisplay } = require("./appointmentCoordinationSync");
    label = formatAppointmentDisplay(startAt, locale, tz);
  } catch {
    /* non-fatal */
  }
  return {
    bookingId: params.bookingId || null,
    date,
    time,
    doctor: params.doctorName || params.doctorId || null,
    status: params.status || "scheduled",
    createdAt: new Date().toISOString(),
    startAt,
    treatmentLabel: params.treatmentLabel || null,
    label,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function hasCompletedCanonicalBooking(flags) {
  const canonical = readCanonicalBooking(flags);
  if (!canonical) return false;
  if (!canonical.bookingId && !canonical.startAt) return false;
  const st = String(canonical.status || "").toLowerCase();
  if (st === "cancelled" || st === "canceled") return false;
  const abStage = String(flags?.aiBooking?.stage || "").toLowerCase();
  if (abStage === "expired") return false;
  return TERMINAL_COMPLETED_STAGES.has(abStage) || !!flags?.activeAppointment?.startAt;
}

/**
 * @param {string} lang
 * @param {Record<string, unknown>|null} canonical
 */
function buildCanonicalStatusReply(lang, canonical) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const when =
    canonical?.label ||
    (canonical?.date && canonical?.time ? `${canonical.date} ${canonical.time}` : null) ||
    canonical?.startAt ||
    "";
  const status = String(canonical?.status || "scheduled").toLowerCase();
  if (key === "tr") {
    if (status === "pending") {
      return `Randevunuz ${when} için kayıtlı ve klinik onayı bekliyor.`;
    }
    return `Evet — randevunuz ${when} için sistemde kayıtlı.`;
  }
  if (status === "pending") {
    return `Your appointment for ${when} is recorded and awaiting clinic confirmation.`;
  }
  return `Yes — your appointment for ${when} is on our calendar.`;
}

/**
 * @param {string} lang
 * @param {Record<string, unknown>|null} canonical
 */
function buildPostBookingStaleInputReply(lang, canonical) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const when =
    canonical?.label ||
    (canonical?.date && canonical?.time ? `${canonical.date} ${canonical.time}` : null) ||
    "";
  if (key === "tr") {
    return `Randevunuz zaten ${when} için kayıtlı. Yeni bir randevu almak isterseniz «yeni randevu» veya farklı bir saat yazabilirsiniz.`;
  }
  return `You already have an appointment for ${when}. Reply with a new time or «new appointment» if you want another booking.`;
}

/**
 * @param {string} lang
 */
function buildExpiredBookingReply(lang) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return "Önceki randevu oturumunuzun süresi doldu. Yeni randevu almak için uygun bir gün veya saat yazabilirsiniz.";
  }
  return "Your previous booking session expired. Send a preferred day or time to start a new appointment request.";
}

/**
 * @param {Record<string, unknown>} params
 */
function buildClosedBookingPatch(params) {
  return {
    stage: params.stage,
    bookingActive: false,
    bookingId: params.bookingId || params.pendingAppointmentId || null,
    pendingAppointmentId: params.pendingAppointmentId || params.bookingId || null,
    canonicalBooking: params.canonicalBooking || null,
    calendarPersisted: params.calendarPersisted === true,
    adminCalendarPersisted: params.adminCalendarPersisted === true,
    contactPhone: params.contactPhone || null,
    offeredSlots: [],
    slotListId: null,
    selectedSlot: null,
    selectedDate: null,
    awaitingAction: null,
    pendingAction: null,
    pending_action: null,
    appointmentOfferPending: false,
    expiresAt: null,
  };
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
  if (prev.canonicalBooking && typeof prev.canonicalBooking === "object" && !next.canonicalBooking) {
    next.canonicalBooking = prev.canonicalBooking;
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

  let slotListId = p.slotListId !== undefined ? (p.slotListId ? String(p.slotListId) : null) : prev.slotListId || null;
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
  if (TERMINAL_COMPLETED_STAGES.has(stage) || stage === "idle" || stage === "cancelled" || stage === "expired") {
    awaitingAction = null;
  }

  let bookingActive = p.bookingActive;
  if (bookingActive === undefined) {
    if (stage === "idle" || stage === "expired" || stage === "cancelled") {
      bookingActive = false;
    } else if (TERMINAL_COMPLETED_STAGES.has(stage)) {
      bookingActive = false;
    } else if (p.clearBooking === true) {
      bookingActive = false;
    } else if (IN_PROGRESS_STAGES.has(stage)) {
      bookingActive = true;
    } else if (p.appointmentOfferPending === true || prev.appointmentOfferPending === true) {
      bookingActive = true;
    } else {
      bookingActive = prev.bookingActive === true;
    }
  }

  let expiresAt =
    p.expiresAt !== undefined
      ? p.expiresAt
      : prev.expiresAt || null;
  const enteringProgress =
    IN_PROGRESS_STAGES.has(stage) &&
    !IN_PROGRESS_STAGES.has(String(prev.stage || "").toLowerCase()) &&
    bookingActive === true;
  if (enteringProgress || (bookingActive === true && IN_PROGRESS_STAGES.has(stage) && !expiresAt)) {
    expiresAt = computeExpiresAt(now);
  }
  if (TERMINAL_COMPLETED_STAGES.has(stage) || stage === "expired" || stage === "cancelled" || stage === "idle") {
    expiresAt = null;
  }

  const bookingId =
    p.bookingId ||
    p.pendingAppointmentId ||
    prev.bookingId ||
    prev.pendingAppointmentId ||
    null;

  const canonicalBooking =
    p.canonicalBooking !== undefined ? p.canonicalBooking : prev.canonicalBooking || null;

  const closedTerminal = TERMINAL_COMPLETED_STAGES.has(stage);
  return {
    ...prev,
    ...p,
    stage,
    selectedSlot: closedTerminal ? null : selectedSlot,
    selectedDate: closedTerminal ? (canonicalBooking?.date || selectedDate) : selectedDate,
    awaitingAction,
    pendingAction: awaitingAction,
    pending_action: awaitingAction,
    bookingActive,
    bookingId,
    slotListId: closedTerminal ? null : slotListId,
    offeredSlots: closedTerminal ? [] : offeredSlots,
    expiresAt,
    canonicalBooking,
    createdAt: prev.createdAt || now,
    updatedAt: now,
  };
}

/**
 * @param {string} message
 * @param {ReturnType<typeof readDurableBookingState>} durableState
 */
function resolvesPendingConfirmation(message, durableState, ctx = {}) {
  if (
    !isBookingConfirmationYesMessage(message, {
      recentTurns: ctx.recentTurns,
      pendingConfirmation: true,
      schedulingOfferPending:
        durableState?.appointmentOfferPending === true ||
        durableState?.awaitingAction === BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
    })
  ) {
    return false;
  }
  if (String(durableState.stage || "") === "expired") return false;
  if (isBookingExpired(durableState)) return false;
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
 * @param {string} message
 * @param {ReturnType<typeof readDurableBookingState>} durableState
 */
function parseSlotFromDurableState(message, durableState) {
  if (!isBookingFlowInProgress({ aiBooking: durableState })) return null;
  if (isBookingExpired(durableState)) return null;
  const slots = Array.isArray(durableState.offeredSlots) ? durableState.offeredSlots : [];
  if (!slots.length) return null;
  const idx = parseSlotListIndexFromMessage(message, slots.length);
  if (idx == null) return null;
  const slot = slots[idx] || null;
  logBookingAuditEvent(BOOKING_AUDIT_EVENTS.SLOT_SELECTION_RESOLVED, {
    slot_selection_text: String(message || "").slice(0, 120),
    parsed_slot_index: idx,
    slot_selection_resolved: !!slot,
    slotCount: slots.length,
  });
  return slot;
}

/**
 * @param {string} message
 * @param {Record<string, unknown>|null|undefined} flags
 */
function shouldExemptBookingMessageFromDedup(message, flags) {
  if (!isBookingFlowInProgress(flags)) return false;
  const d = readDurableBookingState(flags);
  if (isBookingExpired(d)) return false;
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

    const expectedTime = String(slot.time || "").match(/^(\d{1,2}:\d{2})/)?.[1];
    if (expectedTime) {
      const actualTime = formatInTimeZone(new Date(actualTs), tz, "HH:mm");
      const padExpected = expectedTime.length === 4 ? `0${expectedTime}` : expectedTime;
      if (padExpected.slice(-5) !== actualTime) {
        return {
          ok: false,
          reason: "time_mismatch",
          expectedTime: padExpected.slice(-5),
          actualTime,
          expectedStartAt: slot.startAt,
          actualStartAt: startAt,
        };
      }
    }
  } catch {
    /* non-fatal */
  }

  return { ok: true };
}

/**
 * @param {string} eventType
 * @param {Record<string, unknown>} payload
 */
function logBookingAuditEvent(eventType, payload = {}) {
  logBookingAudit({
    auditEvent: eventType,
    ...payload,
  });
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
    slotListId: null,
    expiresAt: null,
  });
  logBookingAuditEvent(BOOKING_AUDIT_EVENTS.BOOKING_EXPIRED, {
    profileId: String(profileId).slice(0, 8),
    priorStage: d.stage,
    slotListId: d.slotListId,
    expiresAt: d.expiresAt,
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
      slotListId: null,
      expiresAt: null,
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
  BOOKING_AUDIT_EVENTS,
  BOOKING_EXPIRY_MS,
  generateSlotListId,
  computeExpiresAt,
  stageToPendingAction,
  readDurableBookingState,
  readCanonicalBooking,
  buildCanonicalBookingRecord,
  buildCanonicalBookingFromAppointment,
  buildCanonicalStatusReply,
  buildPostBookingStaleInputReply,
  buildExpiredBookingReply,
  buildClosedBookingPatch,
  hasCompletedCanonicalBooking,
  isBookingActive,
  isBookingFlowInProgress,
  resolveBookingRouterLock,
  coordinatorRecentlyOfferedScheduling,
  assistantMessageOffersScheduling,
  isSchedulingAcceptanceMessage,
  isBookingStatusInquiry,
  isPostBookingStaleActionMessage,
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
  logBookingAuditEvent,
  applyBookingExpiryIfNeeded,
  isBookingExpired,
};
