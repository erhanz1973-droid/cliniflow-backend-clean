#!/usr/bin/env node
"use strict";

/**
 * Print thread assignment changes for the last N days (default 7).
 *
 * Usage:
 *   node scripts/report-thread-assignment-changes.cjs
 *   node scripts/report-thread-assignment-changes.cjs --days=14 --clinicId=...
 *   node scripts/report-thread-assignment-changes.cjs --doctorId=...
 */

require("dotenv").config();

const { fetchThreadAssignmentChanges } = require("../lib/patientChatThreadAssignmentAudit");

function parseArgs(argv) {
  const out = { days: 7, clinicId: null, patientId: null, threadId: null, doctorId: null, limit: 500 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--days=")) out.days = parseInt(arg.slice(7), 10) || 7;
    else if (arg.startsWith("--clinicId=")) out.clinicId = arg.slice(11) || null;
    else if (arg.startsWith("--patientId=")) out.patientId = arg.slice(12) || null;
    else if (arg.startsWith("--threadId=")) out.threadId = arg.slice(11) || null;
    else if (arg.startsWith("--doctorId=")) out.doctorId = arg.slice(11) || null;
    else if (arg.startsWith("--limit=")) out.limit = parseInt(arg.slice(8), 10) || 500;
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv);
  const result = await fetchThreadAssignmentChanges(args);

  if (!result.ok) {
    console.error("report-thread-assignment-changes FAILED:", result.error || "unknown");
    if (result.error === "table_missing") {
      console.error("Apply migration: supabase/migrations/20260529120000_patient_chat_thread_assignment_audit.sql");
    }
    process.exit(1);
  }

  console.log(`# Thread assignment changes since ${result.since} (${result.days} days)`);
  console.log(`# Total events: ${result.count}\n`);

  for (const ev of result.events || []) {
    console.log(
      [
        ev.created_at,
        `thread=${ev.thread_id}`,
        `patient=${ev.patient_id}`,
        `old=${ev.old_assigned_doctor_id || "null"}`,
        `new=${ev.new_assigned_doctor_id || "null"}`,
        `reason=${ev.reason}`,
      ].join(" | "),
    );
  }

  if (!result.count) {
    console.log("(no assignment changes recorded in this window — audit starts after deploy + migration)");
  }
})().catch((e) => {
  console.error("report-thread-assignment-changes crash:", e?.message || e);
  process.exit(1);
});
