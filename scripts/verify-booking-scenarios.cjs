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
  patientHasNegativeSchedulingIntent,
  patientBlocksBookingConfirmation,
  isPendingBookingChangeConfirmation,
  isPendingRescheduleConfirmation,
  assistantMessageOffersScheduling,
  coordinatorRecentlyOfferedScheduling,
} = require("../lib/aiBookingState");
const { parsePreferredDateFromMessage } = require("../lib/bookingDateParse");

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
  assert.ok(BOOKING_AUDIT_EVENTS.BOOKING_RESCHEDULE_STARTED);
  assert.ok(BOOKING_AUDIT_EVENTS.BOOKING_RESCHEDULE_CONFIRMED);
  assert.ok(BOOKING_AUDIT_EVENTS.BOOKING_RESCHEDULE_COMPLETED);
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

const CONFIRM_FLAGS = mergeAiBookingPatch({}, {
  stage: "awaiting_slot_confirm",
  bookingActive: true,
  awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
  selectedSlot: {
    startAt: "2026-05-30T11:30:00.000Z",
    dateYmd: "2026-05-30",
    label: "30 May 14:30",
  },
});
const CONFIRM_STATE = readDurableBookingState({ aiBooking: CONFIRM_FLAGS });

const NEGATIVE_SCHEDULING_PHRASES = [
  "I do NOT want Monday.",
  "Pazartesi harici başka bir gün talep ediyorum.",
  "Pazartesi istemiyorum",
  "başka gün",
  "baska gun",
  "başka saat",
  "uygun değil",
  "istemiyorum",
  "harici",
  "different day",
  "another day",
  "not Monday",
  "I want another day other than Monday",
  "Monday doesn't work for me",
  "farklı saat lütfen",
  "alternatif tarih",
];

for (const phrase of NEGATIVE_SCHEDULING_PHRASES) {
  test(`negative scheduling: blocks confirm — ${phrase.slice(0, 48)}`, () => {
    assert.ok(
      patientHasNegativeSchedulingIntent(phrase),
      `expected negative intent for: ${phrase}`,
    );
    assert.ok(
      patientBlocksBookingConfirmation(phrase),
      `expected confirmation block for: ${phrase}`,
    );
    assert.strictEqual(
      isBookingConfirmationYesMessage(phrase, { pendingConfirmation: true }),
      false,
      `confirmation yes must be false for: ${phrase}`,
    );
    assert.strictEqual(
      resolvesPendingConfirmation(phrase, CONFIRM_STATE),
      false,
      `resolvesPendingConfirmation must be false for: ${phrase}`,
    );
  });
}

test("negative scheduling: pure affirmatives still confirm", () => {
  const affirmatives = ["evet", "yes", "tamam", "onaylıyorum", "confirm", "okay"];
  for (const word of affirmatives) {
    assert.strictEqual(patientHasNegativeSchedulingIntent(word), false, word);
    assert.ok(
      isBookingConfirmationYesMessage(word, { pendingConfirmation: true }),
      `expected confirm for: ${word}`,
    );
    assert.ok(resolvesPendingConfirmation(word, CONFIRM_STATE), `pending confirm for: ${word}`);
  }
});

test("reschedule: Evet confirms pending slot change (not stale post-booking)", () => {
  const flags = {
    canonicalBooking: {
      bookingId: "appt-old",
      date: "2026-06-03",
      time: "10:15",
      status: "scheduled",
      startAt: "2026-06-03T07:15:00.000Z",
      label: "3 Jun 10:15",
    },
    activeAppointment: {
      id: "appt-old",
      startAt: "2026-06-03T07:15:00.000Z",
      status: "scheduled",
    },
    aiBooking: mergeAiBookingPatch({}, {
      stage: "awaiting_slot_confirm",
      bookingActive: true,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      selectedSlot: {
        startAt: "2026-05-30T12:45:00.000Z",
        dateYmd: "2026-05-30",
        label: "30 Mayıs Cumartesi at 15:45",
      },
      appointmentOfferPending: true,
    }),
  };
  assert.ok(isPendingBookingChangeConfirmation("Evet", flags));
  assert.strictEqual(
    isPostBookingStaleActionMessage("Evet", flags),
    false,
    "Evet must not be stale while awaiting_slot_confirm",
  );
  assert.ok(resolvesPendingConfirmation("Evet", readDurableBookingState(flags)));
});

test("reschedule: hayır rejects pending reschedule confirm", () => {
  const flags = {
    activeAppointment: {
      id: "appt-old",
      startAt: "2026-06-03T07:15:00.000Z",
      status: "scheduled",
    },
    aiBooking: mergeAiBookingPatch({}, {
      stage: "awaiting_slot_confirm",
      rescheduleMode: true,
      bookingActive: true,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      selectedSlot: {
        startAt: "2026-05-30T12:45:00.000Z",
        dateYmd: "2026-05-30",
        label: "30 May 15:45",
      },
      rescheduleFromSlot: {
        startAt: "2026-06-03T07:15:00.000Z",
        label: "3 Jun 10:15",
      },
    }),
  };
  assert.strictEqual(isPendingRescheduleConfirmation("Evet", flags), true);
  assert.strictEqual(isPendingRescheduleConfirmation("Hayır", flags), false);
  assert.strictEqual(
    isPostBookingStaleActionMessage("Evet", flags),
    false,
    "Evet during reschedule must not hit stale guard",
  );
});

test("date parse: Pazartesi harici does not select Monday", () => {
  const ref = new Date("2026-05-29T12:00:00.000Z");
  const mondayDirect = parsePreferredDateFromMessage("pazartesi", "Europe/Istanbul", ref);
  assert.ok(mondayDirect, "plain pazartesi should parse");
  const excluded = parsePreferredDateFromMessage(
    "Pazartesi harici başka bir gün talep ediyorum",
    "Europe/Istanbul",
    ref,
  );
  assert.strictEqual(excluded, null, "excluded weekday must not become preferred date");
});

const {
  hasReschedulableActiveAppointment,
  patientRescheduleIntent,
  buildRescheduleConfirmDirectReply,
  buildRescheduleRejectedReply,
  resolveRescheduleTargetSlot,
} = require("../lib/aiBookingReschedule");
const { buildSlotFromPreferredDateTime } = require("../lib/aiAppointmentBooking");

const ACTIVE_APPT_FLAGS = {
  activeAppointment: {
    id: "appt-old-1",
    startAt: "2026-06-03T07:15:00.000Z",
    status: "scheduled",
    treatmentLabel: "Filling",
  },
  canonicalBooking: {
    bookingId: "appt-old-1",
    startAt: "2026-06-03T07:15:00.000Z",
    date: "2026-06-03",
    time: "10:15",
    status: "scheduled",
    label: "3 Jun 10:15",
  },
  aiBooking: { stage: "booked", bookingActive: false },
};

test("reschedule: detects active appointment", () => {
  assert.ok(hasReschedulableActiveAppointment(ACTIVE_APPT_FLAGS));
});

test("reschedule: time change intent", () => {
  assert.ok(
    patientRescheduleIntent("15:45 olsun", ACTIVE_APPT_FLAGS, {
      scheduling: { timezone: "Europe/Istanbul" },
    }),
  );
  assert.ok(
    patientRescheduleIntent("make it 15:45", ACTIVE_APPT_FLAGS, {
      scheduling: { timezone: "Europe/Istanbul" },
    }),
  );
});

test("reschedule: date change intent", () => {
  assert.ok(
    patientRescheduleIntent("çarşamba olsun", ACTIVE_APPT_FLAGS, {
      scheduling: { timezone: "Europe/Istanbul" },
    }),
  );
  assert.ok(
    patientRescheduleIntent("different day", ACTIVE_APPT_FLAGS, {
      scheduling: { timezone: "Europe/Istanbul" },
    }),
  );
});

test("reschedule: explicit move/reschedule intent", () => {
  assert.ok(patientRescheduleIntent("move appointment", ACTIVE_APPT_FLAGS));
  assert.ok(patientRescheduleIntent("reschedule appointment", ACTIVE_APPT_FLAGS));
  assert.ok(patientRescheduleIntent("başka saat", ACTIVE_APPT_FLAGS));
});

test("reschedule: resolves target time on same day", () => {
  const existing = {
    startAt: "2026-06-03T07:15:00.000Z",
    dateYmd: "2026-06-03",
    time: "10:15",
  };
  const scheduling = { timezone: "Europe/Istanbul" };
  const slot = resolveRescheduleTargetSlot(
    "15:45 olsun",
    existing,
    scheduling,
    [],
    (dateYmd, timeMin) =>
      buildSlotFromPreferredDateTime(
        dateYmd,
        timeMin,
        scheduling,
        { defaultDurationMinutes: 30, bufferMinutes: 10 },
        "Filling",
        "tr",
      ),
  );
  assert.ok(slot?.startAt, "expected target slot");
  assert.ok(String(slot.time || "").startsWith("15:45"), `expected 15:45 got ${slot.time}`);
  assert.strictEqual(slot.dateYmd, "2026-06-03");
});

test("reschedule: resolves date change keeping same clock time", () => {
  const existing = {
    startAt: "2026-06-03T07:15:00.000Z",
    dateYmd: "2026-06-03",
    time: "10:15",
  };
  const scheduling = { timezone: "Europe/Istanbul" };
  const slot = resolveRescheduleTargetSlot(
    "30 mayıs olsun",
    existing,
    scheduling,
    [],
    (dateYmd, timeMin) =>
      buildSlotFromPreferredDateTime(
        dateYmd,
        timeMin,
        scheduling,
        { defaultDurationMinutes: 30, bufferMinutes: 10 },
        "Filling",
        "tr",
      ),
  );
  assert.ok(slot?.dateYmd, "expected date on target slot");
  assert.strictEqual(slot.dateYmd, "2026-05-30");
  assert.ok(String(slot.time || "").startsWith("10:15"), `keeps clock time, got ${slot.time}`);
});

test("reschedule: confirm prompt mentions from and to", () => {
  const reply = buildRescheduleConfirmDirectReply(
    "tr",
    "3 Haziran 10:15",
    "3 Haziran 15:45",
    "Dolgu",
  );
  assert.ok(reply.includes("3 Haziran 10:15"));
  assert.ok(reply.includes("3 Haziran 15:45"));
  assert.ok(/Evet/i.test(reply));
});

test("reschedule: rejection reply keeps existing time", () => {
  const reply = buildRescheduleRejectedReply("tr", "3 Haziran 10:15");
  assert.ok(reply.includes("3 Haziran 10:15"));
  assert.ok(/kal/i.test(reply));
});

test("reschedule: pure evet is not new reschedule intent", () => {
  assert.strictEqual(patientRescheduleIntent("Evet", ACTIVE_APPT_FLAGS), false);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
