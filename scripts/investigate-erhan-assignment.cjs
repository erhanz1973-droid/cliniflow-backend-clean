#!/usr/bin/env node
"use strict";

/**
 * Investigate Erhan patient assignment (3 June 10:15 booking).
 * Usage: node scripts/investigate-erhan-assignment.cjs
 */

require("dotenv").config();
const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const { fetchThreadAssignmentChanges } = require("../lib/patientChatThreadAssignmentAudit");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function findDoctorsByNameFragment(fragment) {
  const q = String(fragment || "").trim();
  for (const sel of ["id, doctor_id, full_name, name, clinic_id, status", "id, doctor_id, full_name, name, clinic_id"]) {
    const { data, error } = await supabase
      .from("doctors")
      .select(sel)
      .or(`full_name.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(20);
    if (!error) return data || [];
  }
  return [];
}

async function findPatientsErhan() {
  for (const sel of [
    "id, patient_id, full_name, name, first_name, last_name, phone, clinic_id, primary_doctor_id, created_at, updated_at",
    "id, patient_id, full_name, name, phone, clinic_id, created_at, updated_at",
    "id, full_name, name, phone, clinic_id, created_at, updated_at",
  ]) {
    const { data, error } = await supabase
      .from("patients")
      .select(sel)
      .or("full_name.ilike.%Erhan%,name.ilike.%Erhan%,first_name.ilike.%Erhan%")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (!error) return data || [];
  }
  return [];
}

async function findAppointmentsJune3(patientIds) {
  if (!patientIds.length) return [];
  const start = "2026-06-03T00:00:00.000Z";
  const end = "2026-06-04T00:00:00.000Z";
  for (const table of ["appointments", "admin_calendar_appointments", "clinic_appointments"]) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .in("patient_id", patientIds)
        .gte("scheduled_at", start)
        .lt("scheduled_at", end)
        .limit(20);
      if (!error && data?.length) return { table, rows: data };
    } catch {
      /* table may not exist */
    }
  }
  return { table: null, rows: [] };
}

async function loadThreads(patientIds) {
  const { data, error } = await supabase
    .from("patient_chat_threads")
    .select(
      "id, patient_id, clinic_id, assigned_doctor_id, assigned_at, is_lead, status, lifecycle_status, created_at, updated_at",
    )
    .in("patient_id", patientIds)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadLeadRouting(clinicId) {
  const { data, error } = await supabase
    .from("clinic_lead_routing_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error && String(error.code) !== "42P01") throw error;
  return data;
}

async function loadAssignmentEvents(patientIds) {
  const { data, error } = await supabase
    .from("patient_chat_thread_assignment_events")
    .select("*")
    .in("patient_id", patientIds)
    .order("created_at", { ascending: true });
  if (error) {
    if (String(error.code) === "42P01") return { missing: true, rows: [] };
    throw error;
  }
  return { missing: false, rows: data || [] };
}

async function loadLeadProfiles(patientIds) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, patient_id, clinic_id, assigned_doctor_id, created_at, updated_at, last_patient_message_at")
    .in("patient_id", patientIds)
    .order("updated_at", { ascending: false });
  if (error) return [];
  return data || [];
}

function doctorLabel(row) {
  if (!row) return "?";
  return `${row.full_name || row.name || "?"} (${String(row.id).slice(0, 8)}… / ${row.doctor_id || "no-code"})`;
}

(async () => {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured");
    process.exit(1);
  }

  console.log("=== Doctors: Burhan, Ali Uzun ===");
  const burhanDocs = await findDoctorsByNameFragment("Burhan");
  const aliDocs = await findDoctorsByNameFragment("Ali");
  console.log("Burhan matches:", burhanDocs.map(doctorLabel).join("\n  ") || "(none)");
  console.log("Ali matches:", aliDocs.filter((d) => /uzun/i.test(`${d.full_name || ""} ${d.name || ""}`)).map(doctorLabel).join("\n  ") || aliDocs.slice(0, 5).map(doctorLabel).join("\n  "));

  console.log("\n=== Patients named Erhan ===");
  const patients = await findPatientsErhan();
  if (!patients.length) {
    console.log("(no patients matching Erhan)");
    process.exit(0);
  }
  for (const p of patients) {
    console.log(
      `- ${p.full_name || p.name || p.first_name || "?"} | id=${p.id} | clinic=${p.clinic_id} | primary=${p.primary_doctor_id || "?"}`,
    );
  }

  const patientIds = patients.map((p) => p.id).filter((id) => UUID_RE.test(id));

  console.log("\n=== Appointments 2026-06-03 ===");
  const appt = await findAppointmentsJune3(patientIds);
  if (appt.rows.length) {
    console.log(`Table: ${appt.table}`);
    for (const a of appt.rows) {
      const at = a.scheduled_at || a.start_at || a.startAt;
      console.log(`  patient=${a.patient_id} at=${at} doctor=${a.doctor_id || a.assigned_doctor_id || "?"}`);
    }
  } else {
    console.log("(no June 3 appointments found in common tables — try manual search)");
  }

  console.log("\n=== patient_chat_threads ===");
  const threads = await loadThreads(patientIds);
  for (const t of threads) {
    console.log(
      `  thread=${t.id} patient=${t.patient_id} assigned=${t.assigned_doctor_id} is_lead=${t.is_lead} status=${t.status} updated=${t.updated_at}`,
    );
  }

  const clinicIds = [...new Set(threads.map((t) => t.clinic_id).filter(Boolean))];
  for (const cid of clinicIds) {
    console.log(`\n=== clinic_lead_routing_settings (${cid}) ===`);
    const routing = await loadLeadRouting(cid);
    console.log(routing ? JSON.stringify(routing, null, 2) : "(no row)");
  }

  console.log("\n=== patient_chat_thread_assignment_events ===");
  const ev = await loadAssignmentEvents(patientIds);
  if (ev.missing) {
    console.log("TABLE MISSING — migration 20260529120000 not applied yet");
  } else if (!ev.rows.length) {
    console.log("(no audit events for these patient IDs — audit started after deploy)");
  } else {
    for (const e of ev.rows) {
      console.log(JSON.stringify({
        timestamp: e.created_at,
        thread_id: e.thread_id,
        patient_id: e.patient_id,
        old_assigned_doctor_id: e.old_assigned_doctor_id,
        new_assigned_doctor_id: e.new_assigned_doctor_id,
        reason: e.reason,
        metadata: e.metadata,
      }, null, 2));
    }
  }

  console.log("\n=== ai_coordinator_lead_profiles ===");
  const profiles = await loadLeadProfiles(patientIds);
  for (const pr of profiles) {
    console.log(`  profile=${pr.id} patient=${pr.patient_id} assigned_doctor=${pr.assigned_doctor_id} updated=${pr.updated_at}`);
  }

  // Resolve doctor names for thread assignees
  const doctorUuids = [
    ...new Set([
      ...threads.map((t) => t.assigned_doctor_id),
      ...ev.rows.flatMap((e) => [e.old_assigned_doctor_id, e.new_assigned_doctor_id]),
      ...patients.flatMap((p) => [p.primary_doctor_id].filter(Boolean)),
    ].filter((x) => x && UUID_RE.test(String(x)))),
  ];
  if (doctorUuids.length) {
    const { data: drows } = await supabase.from("doctors").select("id, full_name, name, doctor_id").in("id", doctorUuids);
    console.log("\n=== Doctor UUID resolution ===");
    for (const d of drows || []) console.log(`  ${d.id} → ${d.full_name || d.name} (${d.doctor_id})`);
  }

  process.exit(0);
})().catch((e) => {
  console.error("investigate-erhan-assignment FAILED:", e?.message || e);
  process.exit(1);
});
