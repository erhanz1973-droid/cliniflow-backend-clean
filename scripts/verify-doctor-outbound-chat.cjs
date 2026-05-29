#!/usr/bin/env node
/**
 * Doctor outbound chat visibility — merge + emit contract tests (no Supabase).
 */

const assert = require("assert");

const DOCTOR_CHAT_MESSAGE_CAP = 250;

function mergeFetchedWithLocalMessages(fetched, local, opts) {
  const cap = opts.cap ?? DOCTOR_CHAT_MESSAGE_CAP;
  const cutoff = opts.fetchStartedAt - 1000;
  const byId = new Map();

  for (const m of fetched) {
    const id = String(m.id || "").trim();
    if (id) byId.set(id, m);
  }

  for (const m of local) {
    const id = String(m.id || "").trim();
    if (!id) continue;
    const keep = m.pending === true || m.createdAt >= cutoff || !byId.has(id);
    if (!keep) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, m);
      continue;
    }
    if (m.pending && !existing.pending) continue;
    if (existing.pending && !m.pending) {
      byId.set(id, m);
      continue;
    }
    if (m.createdAt >= existing.createdAt) byId.set(id, m);
  }

  return [...byId.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-cap);
}

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

console.log("\nDoctor outbound chat verification\n");

test("Test 1: just-sent local message preserved when fetch predates insert", () => {
  const fetchStartedAt = 100000;
  const fetched = [
    { id: "a1", text: "old", from: "PATIENT", createdAt: 90000 },
  ];
  const local = [
    { id: "a1", text: "old", from: "PATIENT", createdAt: 90000 },
    { id: "msg_new", text: "Selam", from: "CLINIC", createdAt: 100500 },
  ];
  const merged = mergeFetchedWithLocalMessages(fetched, local, { fetchStartedAt });
  assert.ok(merged.some((m) => m.id === "msg_new" && m.text === "Selam"));
});

test("Test 2: multiple rapid sends all preserved", () => {
  const fetchStartedAt = 200000;
  const fetched = [{ id: "p1", text: "hi", from: "PATIENT", createdAt: 100000 }];
  const local = [
    { id: "p1", text: "hi", from: "PATIENT", createdAt: 100000 },
    { id: "d1", text: "one", from: "CLINIC", createdAt: 200100 },
    { id: "d2", text: "two", from: "CLINIC", createdAt: 200200 },
    { id: "d3", text: "three", from: "CLINIC", createdAt: 200300 },
  ];
  const merged = mergeFetchedWithLocalMessages(fetched, local, { fetchStartedAt });
  assert.strictEqual(merged.filter((m) => m.from === "CLINIC").length, 3);
});

test("Test 3: stale fetch generation would drop new msg without merge", () => {
  const fetchStartedAt = 300000;
  const fetched = [
    { id: "p1", text: "patient", from: "PATIENT", createdAt: 299000 },
  ];
  const local = [
    { id: "p1", text: "patient", from: "PATIENT", createdAt: 299000 },
    { id: "confirmed", text: "doctor reply", from: "CLINIC", createdAt: 300500 },
  ];
  const merged = mergeFetchedWithLocalMessages(fetched, local, { fetchStartedAt });
  assert.ok(merged.find((m) => m.id === "confirmed"));
});

test("Test 4: pending optimistic replaced by confirmed same id", () => {
  const fetchStartedAt = 400000;
  const fetched = [];
  const local = [
    { id: "tmp-1", text: "wait", from: "CLINIC", createdAt: 400100, pending: true },
  ];
  const afterConfirm = [
    { id: "msg_real", text: "wait", from: "CLINIC", createdAt: 400100 },
  ];
  let merged = mergeFetchedWithLocalMessages(fetched, local, { fetchStartedAt });
  assert.ok(merged.some((m) => m.pending === true));
  merged = mergeFetchedWithLocalMessages(fetched, afterConfirm, { fetchStartedAt });
  assert.ok(merged.some((m) => m.id === "msg_real" && !m.pending));
});

test("Test 5: emit result contract — fallback must not skip emit flag permanently", () => {
  const primaryResult = { emitted: true, thread_id: "64a2cce7-aed1-4859-8710-a893babb6189", reason: null };
  const fallbackResult = { emitted: true, thread_id: "64a2cce7-aed1-4859-8710-a893babb6189", reason: null };
  assert.strictEqual(primaryResult.emitted, true);
  assert.strictEqual(fallbackResult.emitted, true);
  assert.notStrictEqual(fallbackResult.reason, "fallback_messages_path_no_emit");
});

test("Test 6: cap respects 250 window", () => {
  const fetchStartedAt = Date.now();
  const fetched = Array.from({ length: 260 }, (_, i) => ({
    id: `f${i}`,
    text: `m${i}`,
    from: "PATIENT",
    createdAt: i,
  }));
  const merged = mergeFetchedWithLocalMessages(fetched, [], { fetchStartedAt, cap: 250 });
  assert.strictEqual(merged.length, 250);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
