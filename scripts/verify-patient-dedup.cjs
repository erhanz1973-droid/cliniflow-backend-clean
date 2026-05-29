#!/usr/bin/env node
"use strict";

const {
  detectDuplicatePatientInbound,
  findRecentDuplicateWithAssistantReply,
  patientMessagesNearDuplicate,
  DUPLICATE_QUESTION_WINDOW_MS,
} = require("../lib/patientInboundDedup");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const now = Date.now();
  const recentTurns = [
    {
      role: "user",
      text: "İmplant fiyatları nedir?",
      at: new Date(now - 10_000).toISOString(),
    },
    {
      role: "assistant",
      text: "İmplant fiyatları markaya göre değişir; Straumann yaklaşık 800–950 EUR.",
      at: new Date(now - 9_000).toISOString(),
    },
  ];

  const reuse = findRecentDuplicateWithAssistantReply(
    recentTurns,
    "İmplant fiyatları nedir?",
    DUPLICATE_QUESTION_WINDOW_MS,
  );
  assert(reuse?.reply?.includes("Straumann"), "should find prior assistant reply within 30s");
  assert(
    patientMessagesNearDuplicate("İmplant fiyatları nedir?", "İmplant fiyatları nedir?"),
    "exact duplicate detection",
  );

  const dup = await detectDuplicatePatientInbound({
    profileRow: { id: "00000000-0000-4000-8000-000000000001" },
    patientId: "00000000-0000-4000-8000-000000000002",
    clinicId: "00000000-0000-4000-8000-000000000003",
    message: "İmplant fiyatları nedir?",
    recentTurns,
  });
  assert(dup.duplicate === true, "detectDuplicate should flag duplicate");
  assert(dup.reuseReply?.includes("Straumann"), "detectDuplicate should include reuseReply within 30s");
  assert(dup.reason === "same_question_within_30s", "reason should be 30s window");

  const oldTurns = [
    {
      role: "user",
      text: "İmplant fiyatları nedir?",
      at: new Date(now - 120_000).toISOString(),
    },
    {
      role: "assistant",
      text: "Eski cevap",
      at: new Date(now - 119_000).toISOString(),
    },
  ];
  const noReuse = findRecentDuplicateWithAssistantReply(
    oldTurns,
    "İmplant fiyatları nedir?",
    DUPLICATE_QUESTION_WINDOW_MS,
  );
  assert(!noReuse, "outside 30s window should not reuse");

  console.log("verify-patient-dedup: all passed");
})().catch((e) => {
  console.error("verify-patient-dedup FAILED:", e.message || e);
  process.exit(1);
});
