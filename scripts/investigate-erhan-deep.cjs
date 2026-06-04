#!/usr/bin/env node
"use strict";
require("dotenv").config();
const { supabase } = require("../lib/supabase");

const ERHAN_PID = "eb437baa-bdc1-41ad-a3a6-3bbf23787012";
const BURHAN_IDS = ["d47caed0-f561-4d8d-8275-d82c9e25ad03", "bb522151-0000-0000-0000-000000000000"];
const ALI_ID = "6f13a0e7-0000-0000-0000-000000000000";

async function q(table, sel, filters) {
  try {
    let qb = supabase.from(table).select(sel);
    for (const [k, v] of Object.entries(filters || {})) {
      if (k.endsWith("_gte")) qb = qb.gte(k.slice(0, -4), v);
      else if (k.endsWith("_lte")) qb = qb.lte(k.slice(0, -4), v);
      else if (k.endsWith("_in")) qb = qb.in(k.slice(0, -3), v);
      else qb = qb.eq(k, v);
    }
    const { data, error } = await qb.limit(50);
    return { data: data || [], error: error?.message || null };
  } catch (e) {
    return { data: [], error: String(e.message || e) };
  }
}

(async () => {
  const { data: docs } = await supabase.from("doctors").select("id, full_name, name, doctor_id, clinic_id").or("full_name.ilike.%Burhan%,full_name.ilike.%Ali Uzun%,name.ilike.%Burhan%,name.ilike.%Ali%");
  console.log("=== Doctors ===");
  for (const d of docs || []) console.log(d.id, d.full_name || d.name, d.doctor_id, "clinic", d.clinic_id);

  const ali = (docs || []).find((d) => /ali/i.test(d.full_name || d.name || "") && /uzun/i.test(d.full_name || d.name || ""));
  const burhan = (docs || []).find((d) => (d.full_name || d.name || "").includes("Burhan Zorlu")) || (docs || []).find((d) => (d.full_name || d.name || "") === "Burhan");

  console.log("\n=== Erhan patient row ===");
  const { data: patient } = await supabase.from("patients").select("*").eq("id", ERHAN_PID).maybeSingle();
  console.log(JSON.stringify(patient, null, 2));

  const clinicId = patient?.clinic_id;
  console.log("\n=== Clinic settings ===");
  const { data: clinic } = await supabase.from("clinics").select("id, name, clinic_code, settings").eq("id", clinicId).maybeSingle();
  console.log(clinic?.name, clinic?.clinic_code);
  console.log("settings:", JSON.stringify(clinic?.settings, null, 2));

  console.log("\n=== All threads for Erhan ===");
  const { data: threads } = await supabase.from("patient_chat_threads").select("*").eq("patient_id", ERHAN_PID);
  console.log(JSON.stringify(threads, null, 2));

  console.log("\n=== Lead routing (Erhan clinic) ===");
  const { data: routing } = await supabase.from("clinic_lead_routing_settings").select("*").eq("clinic_id", clinicId).maybeSingle();
  console.log(JSON.stringify(routing, null, 2));

  console.log("\n=== Lead profile ===");
  const { data: prof } = await supabase.from("ai_coordinator_lead_profiles").select("*").eq("patient_id", ERHAN_PID).maybeSingle();
  console.log(JSON.stringify(prof, null, 2));

  console.log("\n=== Appointments search (patient) ===");
  for (const table of ["appointments", "admin_calendar_events", "calendar_appointments", "clinic_calendar_appointments"]) {
    const r = await q(table, "*", { patient_id: ERHAN_PID });
    if (r.data.length) {
      console.log(`\n${table}:`, JSON.stringify(r.data, null, 2));
    }
  }

  console.log("\n=== operational_intake_flags / booking (lead events) ===");
  const { data: events } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id, event_type, event_metadata, patient_message, ai_reply, created_at")
    .eq("profile_id", prof?.id || "00000000-0000-0000-0000-000000000000")
    .order("created_at", { ascending: true })
    .limit(40);
  if (prof?.id) {
    for (const e of events || []) {
      const meta = e.event_metadata || {};
      if (JSON.stringify(e).includes("06-03") || JSON.stringify(e).includes("10:15") || meta.kind === "booking") {
        console.log(e.created_at, e.event_type, JSON.stringify(meta).slice(0, 200));
      }
    }
    console.log("(total events:", (events || []).length, ")");
  }

  console.log("\n=== Search appointments 2026-06-03 10:15 across DB ===");
  const { data: appts } = await supabase
    .from("appointments")
    .select("id, patient_id, doctor_id, assigned_doctor_id, scheduled_at, status, procedure_type, clinic_id")
    .gte("scheduled_at", "2026-06-03T07:00:00.000Z")
    .lt("scheduled_at", "2026-06-03T08:30:00.000Z")
    .limit(30);
  for (const a of appts || []) {
    const { data: p } = await supabase.from("patients").select("full_name, name").eq("id", a.patient_id).maybeSingle();
    const name = p?.full_name || p?.name || "?";
    console.log(a.scheduled_at, name, "patient", a.patient_id, "doctor", a.doctor_id || a.assigned_doctor_id);
  }

  console.log("\n=== Threads ever assigned to Ali Uzun for Erhan-like patients ===");
  if (ali?.id) {
    const { data: aliThreads } = await supabase
      .from("patient_chat_threads")
      .select("id, patient_id, clinic_id, assigned_doctor_id, updated_at, is_lead")
      .eq("assigned_doctor_id", ali.id)
      .limit(20);
    for (const t of aliThreads || []) {
      const { data: p } = await supabase.from("patients").select("full_name, name").eq("id", t.patient_id).maybeSingle();
      if (/erhan/i.test(p?.full_name || p?.name || "")) {
        console.log("MATCH:", t, p?.full_name || p?.name);
      }
    }
  }

  console.log("\n=== Timeline: thread assignment changes in lead_events (if any) ===");
  if (prof?.id) {
    const { data: assignEv } = await supabase
      .from("ai_coordinator_lead_events")
      .select("*")
      .eq("profile_id", prof.id)
      .in("event_type", ["assignment", "doctor_assigned", "human_reply", "system"])
      .order("created_at", { ascending: true });
    console.log(JSON.stringify(assignEv, null, 2));
  }
})().catch((e) => { console.error(e); process.exit(1); });
