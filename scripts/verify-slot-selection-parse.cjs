#!/usr/bin/env node
/**
 * Slot list index parsing — TR/EN ordinals, satır, seçenek, option N.
 */
const assert = require("assert");
const {
  parseSlotListIndexFromMessage,
  isBareSlotListIndexMessage,
  resolveOfferedSlotByListIndex,
} = require("../lib/slotSelectionParse");

const SLOTS = 5;
const offered = [
  { id: "s1", label: "14:00", startAt: "2026-06-01T11:00:00.000Z" },
  { id: "s2", label: "14:15", startAt: "2026-06-01T11:15:00.000Z" },
  { id: "s3", label: "14:30", startAt: "2026-06-01T11:30:00.000Z" },
  { id: "s4", label: "14:45", startAt: "2026-06-01T11:45:00.000Z" },
  { id: "s5", label: "15:00", startAt: "2026-06-01T12:00:00.000Z" },
];

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

function expectIndex(message, expectedOneBased) {
  const idx = parseSlotListIndexFromMessage(message, SLOTS);
  assert.strictEqual(
    idx,
    expectedOneBased - 1,
    `"${message}" => ${idx} expected ${expectedOneBased - 1}`,
  );
}

console.log("\nSlot selection parse verification\n");

test("bare digits 1-5", () => {
  for (let n = 1; n <= 5; n++) {
    expectIndex(String(n), n);
  }
});

test("dotted numbers 1.-3.", () => {
  expectIndex("1.", 1);
  expectIndex("2.", 2);
  expectIndex("3.", 3);
});

test("Turkish satır variants", () => {
  expectIndex("1. satır", 1);
  expectIndex("2. satır", 2);
  expectIndex("3. satır", 3);
  expectIndex("3. Satır", 3);
  expectIndex("1.satır", 1);
  expectIndex("2.satır", 2);
  expectIndex("3.satır", 3);
});

test("Turkish ordinals", () => {
  expectIndex("birinci", 1);
  expectIndex("ikinci", 2);
  expectIndex("üçüncü", 3);
});

test("English ordinals", () => {
  expectIndex("first", 1);
  expectIndex("second", 2);
  expectIndex("third", 3);
});

test("option / seçenek phrasing", () => {
  expectIndex("option 1", 1);
  expectIndex("option 2", 2);
  expectIndex("option 3", 3);
  expectIndex("seçenek 1", 1);
  expectIndex("seçenek 2", 2);
  expectIndex("seçenek 3", 3);
});

test("resolves offered slot by index", () => {
  const r = resolveOfferedSlotByListIndex("3. Satır", offered);
  assert.strictEqual(r.index, 2);
  assert.strictEqual(r.resolved, true);
  assert.strictEqual(r.slot?.id, "s3");
  assert.strictEqual(r.slot?.label, "14:30");
});

test("isBareSlotListIndexMessage", () => {
  assert.ok(isBareSlotListIndexMessage("3. satır", SLOTS));
  assert.ok(!isBareSlotListIndexMessage("maybe tomorrow", SLOTS));
});

test("out of range rejected", () => {
  assert.strictEqual(parseSlotListIndexFromMessage("6", SLOTS), null);
  assert.strictEqual(parseSlotListIndexFromMessage("0", SLOTS), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
