#!/usr/bin/env node
"use strict";
/**
 * Batch repair: canonical threads, clinic_id alignment, coordinator profiles.
 *
 * Usage:
 *   node scripts/repair-conversation-canonicalization.cjs [--clinic <uuid>] [--patient <uuid>] [--dry-run]
 *
 * Default clinic: CEM (298a1b77-3257-4c43-8262-e1809b531634)
 */
require("dotenv").config();

const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const {
  getCanonicalThread,
  fetchAllPatientChatThreads,
  isActiveThreadRow,
  mergeDuplicateThreadsAtClinic,
  archiveCrossClinicStaleThreads,
  repairPatientClinicConsistency,
  ensureCoordinatorProfile,
} = require("../lib/canonicalChatThread");
const { backfillLeadCoordinatorHistoryToPatientMessages } = require("../lib/backfillLeadChatMirror");

const CEM_CLINIC_ID = "298a1b77-3257-4c43-8262-e1809b531634";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function short(id) {
  const s = String(id || "").trim();
  return s ? s.slice(0, 8) : "—";
}

function parseArgs() {
  const args = process.argv.slice(2);
  let clinicId = CEM_CLINIC_ID;
  let patientId = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--clinic" && args[i + 1]) {
      clinicId = args[i + 1];
      i += 1;
    } else if (args[i] === "--patient" && args[i + 1]) {
      patientId = args[i + 1];
      i += 1;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { clinicId, patientId, dryRun };
}

async function patientsForClinic(clinicId, patientFilter) {
  if (patientFilter && UUID_RE.test(patientFilter)) return [patientFilter];

  const ids = new Set();

  const { data: threads } = await supabase
    .from("patient_chat_threads")
    .select("patient_id")
    .eq("clinic_id", clinicId)
    .limit(500);
  for (const row of threads || []) {
    if (row?.patient_id) ids.add(String(row.patient_id));
  }

  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("patient_id")
    .eq("clinic_id", clinicId)
    .limit(500);
  for (const row of profiles || []) {
    if (row?.patient_id) ids.add(String(row.patient_id));
  }

  const { data: patients } = await supabase
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .limit(500);
  for (const row of patients || []) {
    if (row?.id) ids.add(String(row.id));
  }

  return [...ids];
}

async function auditPatient(patientId, clinicId, dryRun) {
  const report = {
    patientId: short(patientId),
    clinicId: short(clinicId),
    duplicateMerged: false,
    crossClinicArchived: [],
    clinicRepaired: false,
    profileCreated: false,
    canonicalThreadId: null,
    backfillInserted: 0,
    activeThreadsBefore: [],
    activeThreadsAfter: [],
  };

  const before = await fetchAllPatientChatThreads(patientId);
  report.activeThreadsBefore = before
    .filter(isActiveThreadRow)
    .map((t) => ({
      id: short(t.id),
      clinic: short(t.clinic_id),
      assigned: short(t.assigned_doctor_id),
    }));

  if (dryRun) {
    const dupes = before.filter(
      (t) => String(t.clinic_id || "") === clinicId && isActiveThreadRow(t),
    );
    if (dupes.length > 1) report.duplicateMerged = true;
    const cross = before.filter(
      (t) => String(t.clinic_id || "") !== clinicId && isActiveThreadRow(t),
    );
    report.crossClinicArchived = cross.map((t) => short(t.id));

    const { data: prow } = await supabase
      .from("patients")
      .select("clinic_id")
      .eq("id", patientId)
      .maybeSingle();
    if (String(prow?.clinic_id || "") !== clinicId) report.clinicRepaired = true;

    const { data: prof } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!prof?.id) report.profileCreated = true;

    const canonical = await getCanonicalThread(patientId, clinicId, {
      source: "repair_script_dry_run",
      repairClinic: false,
      ensureProfile: false,
      archiveCrossClinicStale: false,
    });
    report.canonicalThreadId = short(canonical.threadId);
    return report;
  }

  const merge = await mergeDuplicateThreadsAtClinic(patientId, clinicId);
  report.duplicateMerged = merge.merged === true;

  const canonical = await getCanonicalThread(patientId, clinicId, {
    source: "repair_script",
    repairClinic: true,
    ensureProfile: true,
    archiveCrossClinicStale: true,
  });
  report.canonicalThreadId = short(canonical.threadId);
  report.clinicRepaired = canonical.clinicRepaired === true;
  report.profileCreated = canonical.profileCreated === true;

  const cross = await archiveCrossClinicStaleThreads(patientId, clinicId);
  report.crossClinicArchived = (cross.archivedIds || []).map(short);

  if (canonical.profileId) {
    const bf = await backfillLeadCoordinatorHistoryToPatientMessages(patientId, clinicId, {
      limit: 300,
    });
    report.backfillInserted = bf.inserted || 0;
  }

  const after = await fetchAllPatientChatThreads(patientId);
  report.activeThreadsAfter = after
    .filter(isActiveThreadRow)
    .map((t) => ({
      id: short(t.id),
      clinic: short(t.clinic_id),
      assigned: short(t.assigned_doctor_id),
    }));

  return report;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured.");
    process.exit(1);
  }

  const { clinicId, patientId, dryRun } = parseArgs();
  if (!UUID_RE.test(clinicId)) {
    console.error("Invalid --clinic uuid");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        action: dryRun ? "dry_run" : "repair",
        clinic: short(clinicId),
        patientFilter: patientId ? short(patientId) : null,
      },
      null,
      2,
    ),
  );

  const patientIds = await patientsForClinic(clinicId, patientId);
  const results = [];
  let repaired = 0;
  let issues = 0;

  for (const pid of patientIds) {
    if (!UUID_RE.test(pid)) continue;
    try {
      const r = await auditPatient(pid, clinicId, dryRun);
      const hasIssue =
        r.duplicateMerged ||
        r.crossClinicArchived.length > 0 ||
        r.clinicRepaired ||
        r.profileCreated ||
        r.activeThreadsBefore.length > 1 ||
        r.backfillInserted > 0;
      if (hasIssue) {
        issues += 1;
        results.push(r);
        if (!dryRun) repaired += 1;
      }
    } catch (e) {
      results.push({ patientId: short(pid), error: e?.message || String(e) });
      issues += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        patientsScanned: patientIds.length,
        patientsWithIssues: issues,
        patientsRepaired: dryRun ? 0 : repaired,
        dryRun,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
