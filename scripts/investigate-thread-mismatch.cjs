#!/usr/bin/env node
"use strict";
/**
 * Thread mismatch report for production patients.
 * Usage: node scripts/investigate-thread-mismatch.cjs [patientId...]
 */
require("dotenv").config();

const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const {
  fetchAllPatientChatThreads,
  resolveCanonicalChatThread,
} = require("../lib/canonicalChatThread");

const DEFAULT_PIDS = [
  "eb437baa-bdc1-41ad-a3a6-3bbf23787012",
  "8365f9d9-903f-4b29-9079-d50c44e28dfa",
];

async function section(title) {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

async function investigatePatient(patientId) {
  await section(`Patient ${patientId}`);

  if (!isSupabaseEnabled()) {
    console.log("Supabase not configured — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
    return;
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .maybeSingle();
  console.log("\n--- patients row ---");
  if (patient) {
    console.log(
      JSON.stringify({
        id: patient.id,
        name: patient.name || patient.full_name,
        clinic_id: patient.clinic_id,
        primary_doctor_id: patient.primary_doctor_id,
        is_lead: patient.is_lead,
        status: patient.status,
      }),
    );
  } else {
    console.log("null");
  }

  const threads = await fetchAllPatientChatThreads(patientId);
  console.log(`\n--- patient_chat_threads (${threads.length} rows) ---`);
  for (const t of threads) {
    console.log(
      JSON.stringify({
        thread_id: t.id,
        patient_id: t.patient_id,
        clinic_id: t.clinic_id,
        assigned_doctor_id: t.assigned_doctor_id,
        status: t.status,
        is_lead: t.is_lead,
        created_at: t.created_at,
        updated_at: t.updated_at,
        assigned_at: t.assigned_at,
      }),
    );
  }

  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, clinic_id, patient_id, updated_at")
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false });
  console.log("\n--- ai_coordinator_lead_profiles ---");
  for (const p of profiles || []) {
    console.log(JSON.stringify({ id: p.id, clinic_id: p.clinic_id, updated_at: p.updated_at }));
  }

  const sources = [
    "doctor_ui",
    "whatsapp_inbound",
    "socket_emit_fallback",
    "push_notification",
    "doctor_get_messages",
  ];
  console.log("\n--- canonical resolution by source ---");
  for (const source of sources) {
    const leadClinic = profiles?.[0]?.clinic_id || patient?.clinic_id || null;
    const r = await resolveCanonicalChatThread({
      patientId,
      clinicIdHint: leadClinic,
      assignedDoctorId: threads.find((t) => t.assigned_doctor_id)?.assigned_doctor_id || null,
      source,
    });
    console.log(
      source,
      "→",
      r.threadId ? r.threadId.slice(0, 8) : null,
      `(${r.reason})`,
      r.clinicId ? `clinic=${String(r.clinicId).slice(0, 8)}` : "",
    );
  }

  const { data: pmSample } = await supabase
    .from("patient_messages")
    .select("id, patient_id, from_role, created_at, offer_id, text")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(8);
  console.log("\n--- recent patient_messages (no thread_id column in prod) ---");
  for (const m of pmSample || []) {
    console.log(
      String(m.created_at || "").slice(0, 19),
      m.from_role,
      String(m.text || "").slice(0, 40),
    );
  }

  const profileId = profiles?.[0]?.id;
  if (profileId) {
    const { data: ch } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("id, message_role, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(3);
    console.log(
      "\n--- recent ai_coordinator_channel_messages (profile",
      String(profileId).slice(0, 8),
      ") ---",
    );
    console.log("count sample:", (ch || []).length);
  }
}

(async () => {
  const pids = process.argv.slice(2).filter(Boolean);
  const targets = pids.length ? pids : DEFAULT_PIDS;
  for (const pid of targets) {
    await investigatePatient(pid);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
