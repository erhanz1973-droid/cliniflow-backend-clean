#!/usr/bin/env node
/**
 * Appointment Reliability Test Suite — deterministic booking parsers and guard rules.
 * No Supabase / LLM required. Reference: Thu 2026-05-28, Europe/Istanbul.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const REF_DATE = new Date("2026-05-28T10:00:00+03:00");
const TZ = "Europe/Istanbul";

const { parsePreferredDateFromMessage, inferPreferredDateFromConversation } = require("../lib/bookingDateParse");
const { parseConversationalTimeToMinutes, formatMinutesAsHm } = require("../lib/conversationalTimeParse");
const {
  parseSlotListIndexFromMessage,
  isBareSlotListIndexMessage,
  resolveOfferedSlotByListIndex,
} = require("../lib/slotSelectionParse");
const {
  BOOKING_PENDING_ACTIONS,
  mergeAiBookingPatch,
  readDurableBookingState,
  parseSlotFromDurableState,
  resolvesPendingConfirmation,
  resolveBookingRouterLock,
  isBookingConfirmationYesMessage,
  patientHasNegativeSchedulingIntent,
  patientBlocksBookingConfirmation,
  validateBookingGuardian,
  buildCanonicalBookingRecord,
} = require("../lib/aiBookingState");
const {
  isAvailabilityQueryMessage,
  findExactSlotInList,
} = require("../lib/bookingAvailabilityQuery");
const {
  resolveSlotFromPatientMessage,
  buildSlotFromPreferredDateTime,
  pickSlotMatchingTime,
} = require("../lib/aiAppointmentBooking");

const MOCK_SLOTS = [
  { id: "s1", dateYmd: "2026-06-03", time: "14:00", startAt: "2026-06-03T11:00:00.000Z", label: "14:00" },
  { id: "s2", dateYmd: "2026-06-03", time: "14:15", startAt: "2026-06-03T11:15:00.000Z", label: "14:15" },
  { id: "s3", dateYmd: "2026-06-03", time: "14:30", startAt: "2026-06-03T11:30:00.000Z", label: "14:30" },
];

const STALE_SATURDAY_SLOTS = [
  { id: "x1", dateYmd: "2026-05-30", time: "10:15", startAt: "2026-05-30T07:15:00.000Z", label: "10:15" },
  { id: "x2", dateYmd: "2026-05-30", time: "12:00", startAt: "2026-05-30T09:00:00.000Z", label: "12:00" },
];

const SCHEDULING = {
  timezone: TZ,
  workStartMin: 9 * 60,
  workEndMin: 18 * 60,
  weekendAvailable: false,
};

const BOOKING = { slotStepMinutes: 15, bufferMinutes: 0, lunchBreak: null };

/** @type {Array<{ id: string, category: string, input: string, pass: boolean, error?: string, rootCause?: string, fix?: string }>} */
const results = [];

function record(category, id, input, pass, meta = {}) {
  results.push({
    id,
    category,
    input: String(input),
    pass,
    ...meta,
  });
}

function runCase(category, id, input, fn) {
  try {
    fn();
    record(category, id, input, true);
    console.log(`  ✓ [${category}] ${id}: "${input}"`);
  } catch (e) {
    record(category, id, input, false, {
      error: e.message,
      rootCause: e.rootCause || e.message,
      fix: e.fix || null,
    });
    console.error(`  ✗ [${category}] ${id}: "${input}" — ${e.message}`);
  }
}

function expectDate(input, expectedYmd) {
  const got = parsePreferredDateFromMessage(input, TZ, REF_DATE);
  assert.strictEqual(
    got,
    expectedYmd,
    `date "${input}" => ${got}, expected ${expectedYmd}`,
  );
}

function expectTime(input, expectedMinutes) {
  const got = parseConversationalTimeToMinutes(input);
  assert.strictEqual(
    got,
    expectedMinutes,
    `time "${input}" => ${got}, expected ${expectedMinutes}`,
  );
}

function expectSlotIndex(input, expectedOneBased, slotCount = 3) {
  const idx = parseSlotListIndexFromMessage(input, slotCount);
  assert.strictEqual(idx, expectedOneBased - 1, `slot "${input}" => index ${idx}`);
}

console.log("\n=== Appointment Reliability Test Suite ===\n");
console.log(`Reference date: ${REF_DATE.toISOString()} (${TZ})\n`);

// --- Slot Selection ---
const SLOT_INPUTS = [
  "1", "2", "3",
  "1.", "2.", "3.",
  "1. satır", "2. satır", "3. satır",
  "birinci", "ikinci", "üçüncü",
  "first", "second", "third",
  "option 1", "option 2", "option 3",
  "seçenek 1", "seçenek 2", "seçenek 3",
];

for (const input of SLOT_INPUTS) {
  const n = input.match(/\d/) ? Number(input.match(/\d/)[0]) : input.includes("birinci") || input === "first" ? 1 : input.includes("ikinci") || input === "second" ? 2 : 3;
  runCase("slot_selection", `slot-${input}`, input, () => {
    expectSlotIndex(input, n);
    const resolved = resolveOfferedSlotByListIndex(input, MOCK_SLOTS);
    assert.strictEqual(resolved.resolved, true);
    assert.strictEqual(resolved.slot?.id, MOCK_SLOTS[n - 1].id);
  });
}

runCase("slot_selection", "slot-3-satir-capital", "3. Satır", () => {
  expectSlotIndex("3. Satır", 3);
});

// --- Confirmation ---
const CONFIRM_INPUTS = ["evet", "tamam", "onaylıyorum", "yes", "confirm", "okay"];
for (const input of CONFIRM_INPUTS) {
  runCase("confirmation", `confirm-${input}`, input, () => {
    const flags = mergeAiBookingPatch({}, {
      stage: "awaiting_slot_confirm",
      bookingActive: true,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      selectedSlot: MOCK_SLOTS[1],
    });
    assert.ok(
      isBookingConfirmationYesMessage(input, { pendingConfirmation: true }),
      `isBookingConfirmationYesMessage failed for "${input}"`,
    );
    assert.ok(
      resolvesPendingConfirmation(input, readDurableBookingState({ aiBooking: flags })),
      `resolvesPendingConfirmation failed for "${input}"`,
    );
  });
}

const NEGATIVE_CONFIRM_PHRASES = [
  "I do NOT want Monday.",
  "Pazartesi harici başka bir gün talep ediyorum.",
  "Pazartesi istemiyorum",
  "başka gün",
  "başka saat",
  "uygun değil",
  "istemiyorum",
  "harici",
  "different day",
  "another day",
  "not Monday",
];
const NEG_CONFIRM_FLAGS = mergeAiBookingPatch({}, {
  stage: "awaiting_slot_confirm",
  bookingActive: true,
  awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
  selectedSlot: MOCK_SLOTS[1],
});
for (const phrase of NEGATIVE_CONFIRM_PHRASES) {
  runCase("negative_scheduling", `neg-${phrase.slice(0, 24)}`, phrase, () => {
    assert.ok(patientHasNegativeSchedulingIntent(phrase), `negative intent: ${phrase}`);
    assert.strictEqual(
      isBookingConfirmationYesMessage(phrase, { pendingConfirmation: true }),
      false,
      `must not confirm: ${phrase}`,
    );
    assert.strictEqual(
      resolvesPendingConfirmation(phrase, readDurableBookingState({ aiBooking: NEG_CONFIRM_FLAGS })),
      false,
      `must not resolve pending: ${phrase}`,
    );
  });
}

runCase("negative_scheduling", "exclude-monday-date-parse", "Pazartesi harici", () => {
  const d = parsePreferredDateFromMessage(
    "Pazartesi harici başka bir gün talep ediyorum",
    TZ,
    REF_DATE,
  );
  assert.strictEqual(d, null);
});

// --- Date Inputs ---
const DATE_CASES = [
  ["yarın", "2026-05-29"],
  ["bugün", "2026-05-28"],
  ["çarşamba", "2026-06-03"],
  ["cuma", "2026-05-29"],
  ["3 haziran", "2026-06-03"],
  ["30 mayıs", "2026-05-30"],
  ["next Wednesday", "2026-06-03"],
  ["tomorrow", "2026-05-29"],
];

for (const [input, expected] of DATE_CASES) {
  runCase("date_input", `date-${input}`, input, () => expectDate(input, expected));
}

// --- Time Inputs ---
const TIME_CASES = [
  ["14:15", 14 * 60 + 15],
  ["saat 14:15", 14 * 60 + 15],
  ["14.15", 14 * 60 + 15],
  ["2:15 pm", 14 * 60 + 15],
  ["öğleden sonra 2", 14 * 60],
];

for (const [input, expected] of TIME_CASES) {
  runCase("time_input", `time-${input}`, input, () => expectTime(input, expected));
}

// --- Rule 1: User-selected day must never change ---
runCase("rule_date_preserved", "wednesday-not-saturday", "14:15 after Wednesday context", () => {
  const recentTurns = [
    { role: "patient", text: "çarşamba" },
    { role: "assistant", text: "Çarşamba için uygun saatler." },
  ];
  const state = { offeredSlots: STALE_SATURDAY_SLOTS, preferredDateYmd: null };
  const slot = resolveSlotFromPatientMessage(
    "14:15",
    state,
    null,
    14 * 60 + 15,
    SCHEDULING,
    BOOKING,
    "Consultation",
    "tr",
    recentTurns,
    REF_DATE,
  );
  assert.ok(slot, "expected slot built from conversation date");
  assert.strictEqual(slot.dateYmd, "2026-06-03", `got date ${slot.dateYmd}, expected Wednesday 2026-06-03`);
  assert.notStrictEqual(slot.dateYmd, "2026-05-30", "must not use stale Saturday catalog date");
});

// --- Rule 2: User-selected time must never change ---
runCase("rule_time_preserved", "1415-not-1015", "14:15", () => {
  const slot = buildSlotFromPreferredDateTime(
    "2026-06-03",
    14 * 60 + 15,
    SCHEDULING,
    BOOKING,
    "Consultation",
    "tr",
  );
  assert.strictEqual(slot.time, "14:15");
  assert.strictEqual(formatMinutesAsHm(14 * 60 + 15), "14:15");
  const fuzzy = pickSlotMatchingTime(STALE_SATURDAY_SLOTS, 14 * 60 + 15, { exactOnly: true });
  assert.strictEqual(fuzzy, null, "must not fuzzy-match 10:15 for explicit 14:15");
});

// --- Rule 3: Router lock on confirm_booking ---
runCase("rule_router_lock", "confirm-no-pricing", "evet during confirm_booking", () => {
  const flags = {
    aiBooking: {
      stage: "awaiting_slot_confirm",
      bookingActive: true,
      awaitingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      pendingAction: BOOKING_PENDING_ACTIONS.CONFIRM_BOOKING,
      selectedSlot: MOCK_SLOTS[1],
    },
  };
  const lock = resolveBookingRouterLock(flags);
  assert.strictEqual(lock.locked, true, "router must lock pricing/FAQ/KB");
});

// --- Rule 4: Slot selections resolved before LLM ---
runCase("rule_slot_pre_llm", "bare-index-pre-llm", "2", () => {
  assert.ok(isBareSlotListIndexMessage("2", 3));
  const ab = mergeAiBookingPatch({}, {
    stage: "slots_offered",
    bookingActive: true,
    offeredSlots: MOCK_SLOTS,
    awaitingAction: BOOKING_PENDING_ACTIONS.SELECT_SLOT,
  });
  const picked = parseSlotFromDurableState("2", readDurableBookingState({ aiBooking: ab }));
  assert.strictEqual(picked?.id, "s2");
});

// --- Rule 5: Availability query — no silent substitution ---
runCase("rule_availability_query", "is-1415-available", "14:15 müsait mi?", () => {
  assert.ok(isAvailabilityQueryMessage("14:15 müsait mi?"));
  const exact = findExactSlotInList("2026-06-03", 14 * 60 + 15, MOCK_SLOTS);
  assert.ok(exact?.time === "14:15");
  const wrong = findExactSlotInList("2026-06-03", 14 * 60 + 15, STALE_SATURDAY_SLOTS);
  assert.strictEqual(wrong, null, "must not substitute Saturday 10:15");
});

runCase("rule_availability_query_en", "is-1415-available-en", "Is 14:15 available?", () => {
  assert.ok(isAvailabilityQueryMessage("Is 14:15 available on Wednesday?"));
});

// --- Rule 6: Guardian blocks date/time mismatches ---
runCase("rule_guardian_date", "guardian-date-mismatch", "Wednesday vs Saturday", () => {
  const selected = { startAt: "2026-06-03T11:15:00.000Z", dateYmd: "2026-06-03", time: "14:15" };
  const saved = "2026-05-30T07:15:00.000Z";
  const g = validateBookingGuardian({ selectedSlot: selected, startAt: saved, timezone: TZ });
  assert.strictEqual(g.ok, false);
  assert.ok(g.reason === "date_mismatch" || g.reason === "start_at_mismatch" || g.reason === "time_mismatch");
});

runCase("rule_guardian_time", "guardian-time-mismatch", "14:15 vs 10:15", () => {
  const selected = { startAt: "2026-06-03T11:15:00.000Z", dateYmd: "2026-06-03", time: "14:15" };
  const saved = "2026-06-03T07:15:00.000Z";
  const g = validateBookingGuardian({ selectedSlot: selected, startAt: saved, timezone: TZ });
  assert.strictEqual(g.ok, false);
  assert.ok(
    g.reason === "time_mismatch" || g.reason === "start_at_mismatch",
    `expected time/start mismatch, got ${g.reason}`,
  );
});

// --- Rule 7: Booking success verification ---
runCase("rule_booking_verify", "selected-equals-saved", "canonical match", () => {
  const selected = MOCK_SLOTS[1];
  const canonical = buildCanonicalBookingRecord({
    bookingId: "appt-test",
    startAt: selected.startAt,
    timezone: TZ,
    locale: "tr",
    status: "scheduled",
  });
  assert.strictEqual(canonical.date, selected.dateYmd);
  assert.strictEqual(canonical.time, selected.time);
  const g = validateBookingGuardian({
    selectedSlot: selected,
    startAt: selected.startAt,
    timezone: TZ,
  });
  assert.strictEqual(g.ok, true);
});

// --- Conversation date inference ---
runCase("rule_conversation_date", "infer-wednesday-from-turns", "assistant çarşamba", () => {
  const d = inferPreferredDateFromConversation(
    [{ role: "assistant", text: "Çarşamba günü için randevu." }],
    TZ,
    REF_DATE,
  );
  assert.strictEqual(d, "2026-06-03");
});

// --- Report ---
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
const total = results.length;

const byCategory = {};
for (const r of results) {
  if (!byCategory[r.category]) byCategory[r.category] = { pass: 0, fail: 0, total: 0 };
  byCategory[r.category].total += 1;
  if (r.pass) byCategory[r.category].pass += 1;
  else byCategory[r.category].fail += 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  referenceDate: REF_DATE.toISOString(),
  timezone: TZ,
  summary: { total, passed, failed: failed.length, passRate: `${((passed / total) * 100).toFixed(1)}%` },
  coverageByCategory: byCategory,
  failures: failed.map((f) => ({
    id: f.id,
    category: f.category,
    input: f.input,
    error: f.error,
    rootCause: f.rootCause,
    fix: f.fix,
  })),
  allResults: results,
};

const reportDir = path.join(__dirname, "..", "reports");
fs.mkdirSync(reportDir, { recursive: true });
const jsonPath = path.join(reportDir, "appointment-reliability-report.json");
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const mdLines = [
  "# Appointment Reliability Report",
  "",
  `Generated: ${report.generatedAt}`,
  `Reference: ${REF_DATE.toISOString()} (${TZ})`,
  "",
  "## Summary",
  "",
  `| Metric | Value |`,
  `|--------|-------|`,
  `| Total tests | ${total} |`,
  `| Passed | ${passed} |`,
  `| Failed | ${failed.length} |`,
  `| Pass rate | ${report.summary.passRate} |`,
  "",
  "## Coverage by category",
  "",
  "| Category | Pass | Fail | Total |",
  "|----------|------|------|-------|",
];

for (const [cat, stats] of Object.entries(byCategory)) {
  mdLines.push(`| ${cat} | ${stats.pass} | ${stats.fail} | ${stats.total} |`);
}

if (failed.length) {
  mdLines.push("", "## Failed tests", "");
  for (const f of failed) {
    mdLines.push(`### ${f.id}`);
    mdLines.push(`- **Category:** ${f.category}`);
    mdLines.push(`- **Input:** \`${f.input}\``);
    mdLines.push(`- **Error:** ${f.error}`);
    mdLines.push(`- **Root cause:** ${f.rootCause || "unknown"}`);
    if (f.fix) mdLines.push(`- **Fix required:** ${f.fix}`);
    mdLines.push("");
  }
} else {
  mdLines.push("", "## Failed tests", "", "None — all tests passed.");
}

mdLines.push("", "## Fixes required for 100% pass rate", "");
if (failed.length) {
  mdLines.push("Implement fixes for each failure above before production booking rollout.");
} else {
  mdLines.push("No fixes required — suite at 100% pass rate.");
}

const mdPath = path.join(reportDir, "appointment-reliability-report.md");
fs.writeFileSync(mdPath, mdLines.join("\n"));

console.log(`\n=== Results: ${passed}/${total} passed (${report.summary.passRate}) ===`);
console.log(`Report: ${jsonPath}`);
console.log(`Report: ${mdPath}\n`);

if (failed.length) {
  console.log("Failed tests:");
  for (const f of failed) {
    console.log(`  - [${f.category}] ${f.id}: ${f.error}`);
  }
  console.log("");
}

process.exit(failed.length > 0 ? 1 : 0);
