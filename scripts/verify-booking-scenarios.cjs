#!/usr/bin/env node
/**
 * Scenario tests for durable booking architecture (no Supabase required).
 */
const assert = require("assert");
const {
  BOOKING_PENDING_ACTIONS,
  BOOKING_AUDIT_EVENTS,
  mergeAiBookingPatch,
  readDurableBookingState,
  buildCanonicalBookingRecord,
  buildClosedBookingPatch,
  preserveBookingStateInFlags,
  hasCompletedCanonicalBooking,
  isBookingFlowInProgress,
  resolvesPendingConfirmation,
  parseSlotFromDurableState,
  isPostBookingStaleActionMessage,
  isBookingStatusInquiry,
  applyBookingExpiryIfNeeded,
  computeExpiresAt,
  resolveBookingRouterLock,
  isBookingConfirmationYesMessage,
  assistantMessageOffersScheduling,
  coordinatorRecentlyOfferedScheduling,
} = require("../lib/aiBookingState");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log("\nBooking scenario verification\n");

test("Scenario A: offer slots → select → confirm state chain", () => {
  let ab = {};
  ab = mergeAiBookingPatch(ab, {
    stage: "slots_offered",
    bookingActive: true,
    offeredSlots: [
      { id: "s1", startAt: "2026-05-30T07:15:00.000Z", dateYmd: "2026-05-30", label: "30 May 10:15" },
      { id: "s2", startAt: "2026-05-30T09:00:00.000Z", dateYmd: "2026-05-30", label: "30 May 12:00" },
    ],
    awaitingAction: BOOKING_PENDING_ACTIONS.SELECT_SLOT,
  });
  assert.ok(ab.slotListId, "slotListId assigned");
  assert.ok(ab.expiresAt, "expiresAt assigned");
  assert.strictEqual(ab.bookingActive, true);

  const pick = parseSlotFromDurableState("1", readDurableBookingState({ aiBooking: ab }));
  assert.ok(pick?.startAt.includes("07:15"), "slot 1 bound");

  ab = mergeAiBookingPatch(ab, {
    stage: "awaiting_slot_confirm",
    selectedSlot: pick,
    awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
  });
  const flags = { aiBooking: ab };
  assert.ok(resolvesPendingConfirmation("Evet", readDurableBookingState(flags)));

  const canonical = buildCanonicalBookingRecord({
    bookingId: "appt-123",
    startAt: pick.startAt,
    timezone: "Europe/Istanbul",
    locale: "tr",
    status: "scheduled",
  });
  ab = mergeAiBookingPatch(ab, buildClosedBookingPatch({
    stage: "booked",
    bookingId: "appt-123",
    pendingAppointmentId: "appt-123",
    canonicalBooking: canonical,
  }));
  assert.strictEqual(ab.bookingActive, false);
  assert.strictEqual(ab.pendingAction, null);
  assert.deepStrictEqual(ab.offeredSlots, []);
  assert.strictEqual(ab.slotListId, null);
  assert.ok(ab.canonicalBooking?.bookingId, "canonical record stored");
});

test("Scenario A2: Turkish satır slot pick (3. Satır => slot 3)", () => {
  const ab = mergeAiBookingPatch({}, {
    stage: "slots_offered",
    bookingActive: true,
    offeredSlots: [
      { id: "s1", startAt: "2026-06-01T11:00:00.000Z", dateYmd: "2026-06-01", label: "14:00" },
      { id: "s2", startAt: "2026-06-01T11:15:00.000Z", dateYmd: "2026-06-01", label: "14:15" },
      { id: "s3", startAt: "2026-06-01T11:30:00.000Z", dateYmd: "2026-06-01", label: "14:30" },
    ],
    awaitingAction: BOOKING_PENDING_ACTIONS.SELECT_SLOT,
  });
  const pick = parseSlotFromDurableState("3. Satır", readDurableBookingState({ aiBooking: ab }));
  assert.ok(pick?.startAt.includes("11:30"), "3. Satır selects third slot");
});

test("Scenario B: expired flow rejects confirmation", () => {
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  const flags = {
    aiBooking: {
      stage: "awaiting_slot_confirm",
      bookingActive: false,
      awaitingAction: null,
      pendingAction: null,
      selectedSlot: { startAt: "2026-05-30T07:15:00.000Z", dateYmd: "2026-05-30" },
      expiresAt: expiredAt,
      updatedAt: expiredAt,
    },
  };
  assert.strictEqual(resolvesPendingConfirmation("Evet", readDurableBookingState(flags)), false);
  assert.strictEqual(isBookingFlowInProgress(flags), false);
});

test("Scenario C: post-booking numeric input is stale action", () => {
  const flags = {
    canonicalBooking: {
      bookingId: "appt-1",
      date: "2026-05-30",
      time: "10:15",
      status: "scheduled",
      startAt: "2026-05-30T07:15:00.000Z",
      label: "30 May at 10:15",
    },
    aiBooking: { stage: "booked", bookingActive: false },
    activeAppointment: { id: "appt-1", startAt: "2026-05-30T07:15:00.000Z", status: "scheduled" },
  };
  assert.ok(hasCompletedCanonicalBooking(flags));
  assert.ok(isPostBookingStaleActionMessage("1"));
  assert.strictEqual(parseSlotFromDurableState("1", readDurableBookingState(flags)), null);
});

test("Scenario D: status inquiry detected", () => {
  assert.ok(isBookingStatusInquiry("What time is my appointment?"));
  assert.ok(isBookingStatusInquiry("Randevum ne zaman?"));
});

test("Scenario E: intake sync preserves booking state", () => {
  const prev = {
    aiBooking: { stage: "booked", bookingActive: false, canonicalBooking: { bookingId: "x" } },
    canonicalBooking: { bookingId: "x", date: "2026-05-30", time: "10:15", status: "scheduled" },
    activeAppointment: { id: "x", startAt: "2026-05-30T07:15:00.000Z" },
  };
  const next = preserveBookingStateInFlags(
    { missingXray: true, journeyStage: "intake" },
    prev,
  );
  assert.deepStrictEqual(next.aiBooking, prev.aiBooking);
  assert.deepStrictEqual(next.canonicalBooking, prev.canonicalBooking);
  assert.deepStrictEqual(next.activeAppointment, prev.activeAppointment);
});

test("Audit event constants exported", () => {
  assert.ok(BOOKING_AUDIT_EVENTS.BOOKING_STARTED);
  assert.ok(BOOKING_AUDIT_EVENTS.BOOKING_CREATED);
  assert.ok(BOOKING_AUDIT_EVENTS.BOOKING_EXPIRED);
});

test("expiresAt computed for in-progress booking", () => {
  const ab = mergeAiBookingPatch({}, { stage: "slots_offered", bookingActive: true, offeredSlots: [{ id: "1" }] });
  assert.ok(ab.expiresAt);
  assert.ok(Date.parse(ab.expiresAt) > Date.now());
});

test("P0: router lock when bookingActive + confirm_booking", () => {
  const flags = {
    aiBooking: {
      stage: "awaiting_slot_confirm",
      bookingActive: true,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      selectedSlot: { startAt: "2026-05-30T07:15:00.000Z", dateYmd: "2026-05-30", label: "30 May 10:15" },
    },
  };
  const lock = resolveBookingRouterLock(flags);
  assert.strictEqual(lock.locked, true);
  assert.ok(isBookingFlowInProgress(flags));
});

test("P0: router lock when pendingAction confirm_booking even if bookingActive false", () => {
  const flags = {
    aiBooking: {
      stage: "awaiting_slot_confirm",
      bookingActive: false,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      selectedSlot: { startAt: "2026-05-30T07:15:00.000Z", dateYmd: "2026-05-30" },
    },
  };
  assert.strictEqual(resolveBookingRouterLock(flags).locked, true);
  assert.ok(isBookingFlowInProgress(flags));
});

test("P0: Yes schedule it resolves as confirmation after scheduling offer", () => {
  const recentTurns = [
    { role: "assistant", text: "I can schedule your appointment." },
  ];
  assert.ok(assistantMessageOffersScheduling("I can schedule your appointment."));
  assert.ok(coordinatorRecentlyOfferedScheduling(recentTurns));
  const flags = {
    appointmentOfferPending: true,
    aiBooking: {
      stage: "awaiting_patient_confirm",
      bookingActive: true,
      awaitingAction: BOOKING_PENDING_ACTIONS.SELECT_SLOT,
    },
  };
  assert.ok(
    isBookingConfirmationYesMessage("Yes, schedule it.", {
      recentTurns,
      schedulingOfferPending: true,
    }),
  );
  assert.strictEqual(resolveBookingRouterLock(flags).locked, true);
});

test("P0: appointmentOfferPending alone engages router lock", () => {
  const flags = {
    appointmentOfferPending: true,
    aiBooking: { stage: "awaiting_patient_confirm", bookingActive: true },
  };
  assert.strictEqual(resolveBookingRouterLock(flags).locked, true);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
