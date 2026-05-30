#!/usr/bin/env node
"use strict";
/**
 * CEM clinic thread stabilization report.
 * Detects duplicate active threads and cross-system thread_id mismatches.
 *
 * Usage: node scripts/cem-thread-stabilization-report.cjs [--patient <uuid>]
 */
require("dotenv").config();

const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const { resolveCanonicalChatThread } = require("../lib/canonicalChatThread");

const CEM_CLINIC_ID = "298a1b77-3257-4c43-8262-e1809b531634";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function short(id) {
  const s = String(id || "").trim();
  return s ? s.slice(0, 8) : "—";
}

function isActiveThread(row) {
  if (!row) return false;
  const life = String(row.lifecycle_status || "").trim().toLowerCase();
  if (life === "archived") return false;
  if (row.archived_at != null && String(row.archived_at).trim() !== "") return false;
  const st = String(row.status || "").trim().toLowerCase();
  if (st === "archived" || st === "closed") return false;
  return true;
}

async function countPatientMessages(patientId) {
  const { count, error } = await supabase
    .from("patient_messages")
    .select("*", { count: "exact", head: true })
    .eq("patient_id", patientId);
  return error ? null : count || 0;
}

async function countCoordinatorMessages(patientId, clinicId) {
  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId);
  if (!profiles?.length) return 0;
  let total = 0;
  for (const p of profiles) {
    const { count } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", p.id);
    total += count || 0;
  }
  return total;
}

async function countOfferMessages(patientId, clinicId) {
  const { count } = await supabase
    .from("offer_messages")
    .select("*", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId);
  return count || 0;
}

async function resolveThreadBySource(patientId, assignedDoctorId, clinicId) {
  const sources = [
    "doctor_ui",
    "doctor_get_messages",
    "whatsapp_inbound",
    "socket_emit_fallback",
    "push_notification",
    "outbound_message",
  ];
  const out = {};
  for (const source of sources) {
    const r = await resolveCanonicalChatThread({
      patientId,
      clinicIdHint: clinicId,
      assignedDoctorId,
      source,
      allowPatientClinicFallback: false,
    });
    out[source] = {
      threadId: r.threadId || null,
      reason: r.reason,
      clinicId: r.clinicId || null,
    };
  }
  return out;
}

async function findDuplicateThreadPatients(clinicId) {
  const { data: threads, error } = await supabase
    .from("patient_chat_threads")
    .select(
      "id, patient_id, clinic_id, assigned_doctor_id, status, is_lead, lifecycle_status, archived_at, updated_at",
    )
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  /** @type {Map<string, Array<object>>} */
  const byPatient = new Map();
  for (const t of threads || []) {
    const pid = String(t.patient_id || "").trim();
    if (!UUID_RE.test(pid)) continue;
    if (!byPatient.has(pid)) byPatient.set(pid, []);
    byPatient.get(pid).push(t);
  }

  /** Patients with >1 active thread at CEM OR >1 thread row total across any clinic */
  const dupAtCem = [];
  const dupAnyClinic = [];

  for (const [pid, rows] of byPatient) {
    const active = rows.filter(isActiveThread);
    if (active.length > 1) {
      dupAtCem.push({ patientId: pid, threads: active, count: active.length });
    }
  }

  const { data: allThreads } = await supabase
    .from("patient_chat_threads")
    .select(
      "id, patient_id, clinic_id, assigned_doctor_id, status, lifecycle_status, archived_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(2000);

  /** @type {Map<string, Array<object>>} */
  const globalByPatient = new Map();
  for (const t of allThreads || []) {
    const pid = String(t.patient_id || "").trim();
    if (!UUID_RE.test(pid)) continue;
    if (!globalByPatient.has(pid)) globalByPatient.set(pid, []);
    globalByPatient.get(pid).push(t);
  }

  for (const [pid, rows] of globalByPatient) {
    const active = rows.filter(isActiveThread);
    const clinics = new Set(active.map((r) => String(r.clinic_id || "").trim()).filter(Boolean));
    if (active.length > 1 && clinics.size > 1) {
      const atCem = active.filter((r) => String(r.clinic_id) === clinicId);
      if (atCem.length > 0) {
        dupAnyClinic.push({
          patientId: pid,
          activeCount: active.length,
          clinicCount: clinics.size,
          threads: active,
        });
      }
    }
  }

  return { dupAtCem, dupAnyClinic, cemThreadCount: threads?.length || 0 };
}

async function buildPatientReport(patientId, clinicId) {
  const { data: patient } = await supabase
    .from("patients")
    .select("id, name, full_name, clinic_id, primary_doctor_id, is_lead, status")
    .eq("id", patientId)
    .maybeSingle();

  const { data: threads } = await supabase
    .from("patient_chat_threads")
    .select(
      "id, patient_id, clinic_id, assigned_doctor_id, status, is_lead, lifecycle_status, archived_at, created_at, updated_at",
    )
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false });

  const activeThreads = (threads || []).filter(isActiveThread);
  const assignedThread =
    activeThreads.find((t) => String(t.clinic_id) === clinicId && t.assigned_doctor_id) ||
    activeThreads.find((t) => String(t.clinic_id) === clinicId) ||
    activeThreads[0] ||
    null;

  const assignedDoctorId = assignedThread?.assigned_doctor_id || patient?.primary_doctor_id || null;

  const pmCount = await countPatientMessages(patientId);
  const coordCount = await countCoordinatorMessages(patientId, clinicId);
  const offerCount = await countOfferMessages(patientId, clinicId);

  const canonical = await resolveCanonicalChatThread({
    patientId,
    clinicIdHint: clinicId,
    assignedDoctorId,
    source: "doctor_ui",
    allowPatientClinicFallback: false,
  });

  const bySource = await resolveThreadBySource(patientId, assignedDoctorId, clinicId);

  const doctorThread =
    bySource.doctor_get_messages?.threadId || bySource.doctor_ui?.threadId || null;
  const socketThread = bySource.socket_emit_fallback?.threadId || null;
  const whatsappThread = bySource.whatsapp_inbound?.threadId || null;
  const outboundThread = bySource.outbound_message?.threadId || null;
  const canonicalThread = canonical.threadId || null;

  const threadIds = [
    canonicalThread,
    doctorThread,
    socketThread,
    whatsappThread,
    outboundThread,
  ].filter(Boolean);
  const unique = [...new Set(threadIds.map((t) => String(t).toLowerCase()))];
  const mismatch = unique.length > 1;

  const staleClinicMismatch =
    patient?.clinic_id && String(patient.clinic_id) !== clinicId && UUID_RE.test(String(patient.clinic_id));

  return {
    patient: {
      id: patientId,
      name: patient?.name || patient?.full_name || "—",
      patients_clinic_id: patient?.clinic_id || null,
      primary_doctor_id: patient?.primary_doctor_id || null,
      is_lead: patient?.is_lead,
      status: patient?.status,
    },
    threads: (threads || []).map((t) => ({
      thread_id: t.id,
      clinic_id: t.clinic_id,
      assigned_doctor_id: t.assigned_doctor_id,
      status: t.status,
      active: isActiveThread(t),
      updated_at: t.updated_at,
    })),
    active_thread_count: activeThreads.length,
    assigned_doctor_id: assignedDoctorId,
    message_counts: {
      patient_messages: pmCount,
      coordinator_channel: coordCount,
      offer_messages: offerCount,
      total_visible_estimate: (pmCount || 0) + (coordCount || 0) + (offerCount || 0),
    },
    resolution: {
      canonical: canonicalThread,
      doctor_inbox: doctorThread,
      socket_room: socketThread,
      whatsapp: whatsappThread,
      outbound: outboundThread,
      by_source: bySource,
    },
    mismatch,
    stale_clinic_on_patient_row: staleClinicMismatch,
    split_brain:
      activeThreads.length > 1 ||
      staleClinicMismatch ||
      mismatch,
  };
}

function printReportTable(reports) {
  console.log("\n" + "─".repeat(100));
  console.log(
    "Patient".padEnd(22) +
      "Canonical".padEnd(12) +
      "Doctor".padEnd(12) +
      "Socket".padEnd(12) +
      "WhatsApp".padEnd(12) +
      "Outbound".padEnd(12) +
      "Status",
  );
  console.log("─".repeat(100));
  for (const r of reports) {
    const res = r.resolution;
    const flag = r.mismatch || r.split_brain ? " ⚠ MISMATCH" : " ✓";
    console.log(
      `${short(r.patient.id)} ${(r.patient.name || "").slice(0, 10).padEnd(11)}` +
        `${short(res.canonical).padEnd(12)}` +
        `${short(res.doctor_inbox).padEnd(12)}` +
        `${short(res.socket_room).padEnd(12)}` +
        `${short(res.whatsapp).padEnd(12)}` +
        `${short(res.outbound).padEnd(12)}` +
        flag,
    );
  }
  console.log("─".repeat(100));
}

(async () => {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured");
    process.exit(1);
  }

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id, name, clinic_code")
    .eq("id", CEM_CLINIC_ID)
    .maybeSingle();

  console.log("\n" + "=".repeat(72));
  console.log("CEM THREAD STABILIZATION REPORT");
  console.log("=".repeat(72));
  console.log("Clinic:", clinic?.name || "CEM", clinic?.clinic_code || "", CEM_CLINIC_ID);

  const patientArgIdx = process.argv.indexOf("--patient");
  const singlePatient =
    patientArgIdx >= 0 ? String(process.argv[patientArgIdx + 1] || "").trim() : null;

  if (singlePatient && UUID_RE.test(singlePatient)) {
    const report = await buildPatientReport(singlePatient, CEM_CLINIC_ID);
    console.log("\n--- DETAIL ---");
    console.log(JSON.stringify(report, null, 2));
    printReportTable([report]);
    process.exit(report.mismatch || report.split_brain ? 2 : 0);
  }

  console.log("\n## 1. DUPLICATE ACTIVE THREAD DETECTION @ CEM");
  const { dupAtCem, dupAnyClinic, cemThreadCount } = await findDuplicateThreadPatients(CEM_CLINIC_ID);
  console.log(`CEM patient_chat_threads rows scanned: ${cemThreadCount}`);
  console.log(`Patients with >1 active thread @ CEM clinic: ${dupAtCem.length}`);
  console.log(`Patients with active threads at multiple clinics (incl. CEM): ${dupAnyClinic.length}`);

  if (dupAtCem.length) {
    console.log("\nDuplicate active threads @ CEM:");
    for (const d of dupAtCem) {
      console.log(`  patient ${short(d.patientId)} — ${d.count} active threads`);
      for (const t of d.threads) {
        console.log(
          `    thread ${short(t.id)} assigned=${short(t.assigned_doctor_id)} status=${t.status}`,
        );
      }
    }
  }

  if (dupAnyClinic.length) {
    console.log("\nCross-clinic split-brain (CEM involved):");
    for (const d of dupAnyClinic) {
      console.log(`  patient ${short(d.patientId)} — ${d.activeCount} threads across ${d.clinicCount} clinics`);
      for (const t of d.threads) {
        const cem = String(t.clinic_id) === CEM_CLINIC_ID ? " [CEM]" : " [OTHER]";
        console.log(
          `    thread ${short(t.id)} clinic=${short(t.clinic_id)}${cem} assigned=${short(t.assigned_doctor_id)}`,
        );
      }
    }
  }

  console.log("\n## 2. PROBLEMATIC PATIENTS — thread + message counts");
  const investigateIds = new Set([
    ...dupAtCem.map((d) => d.patientId),
    ...dupAnyClinic.map((d) => d.patientId),
    "eb437baa-bdc1-41ad-a3a6-3bbf23787012",
    "8365f9d9-903f-4b29-9079-d50c44e28dfa",
  ]);

  const { data: assignedAtCem } = await supabase
    .from("patient_chat_threads")
    .select("patient_id, assigned_doctor_id")
    .eq("clinic_id", CEM_CLINIC_ID)
    .not("assigned_doctor_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(80);

  for (const row of assignedAtCem || []) {
    if (row?.patient_id) investigateIds.add(String(row.patient_id));
  }

  const reports = [];
  for (const pid of investigateIds) {
    if (!UUID_RE.test(pid)) continue;
    try {
      reports.push(await buildPatientReport(pid, CEM_CLINIC_ID));
    } catch (e) {
      console.warn("report failed", short(pid), e?.message || e);
    }
  }

  reports.sort((a, b) => {
    if (a.split_brain && !b.split_brain) return -1;
    if (!a.split_brain && b.split_brain) return 1;
    return (b.message_counts.total_visible_estimate || 0) - (a.message_counts.total_visible_estimate || 0);
  });

  console.log("\n## 3–5. THREAD ALIGNMENT REPORT");
  printReportTable(reports);

  const mismatched = reports.filter((r) => r.mismatch || r.split_brain);
  if (mismatched.length) {
    console.log(`\n⚠ ${mismatched.length} patient(s) with split-brain or resolution mismatch:\n`);
    for (const r of mismatched) {
      console.log(`Patient: ${r.patient.name} (${r.patient.id})`);
      console.log(`  patients.clinic_id: ${short(r.patient.patients_clinic_id)}${r.stale_clinic_on_patient_row ? " ← STALE (≠ CEM)" : ""}`);
      console.log(`  Active threads: ${r.active_thread_count}`);
      for (const t of r.threads.filter((x) => x.active)) {
        console.log(
          `    ${short(t.thread_id)} @ clinic ${short(t.clinic_id)} doctor=${short(t.assigned_doctor_id)} msgs≈${r.message_counts.patient_messages}pm +${r.message_counts.coordinator_channel}ai`,
        );
      }
      console.log(`  Canonical:  ${r.resolution.canonical}`);
      console.log(`  Doctor UI:  ${r.resolution.doctor_inbox}`);
      console.log(`  Socket:     ${r.resolution.socket_room}`);
      console.log(`  WhatsApp:   ${r.resolution.whatsapp}`);
      console.log(`  Outbound:   ${r.resolution.outbound}`);
      console.log(
        `  Messages: patient_messages=${r.message_counts.patient_messages} coordinator=${r.message_counts.coordinator_channel} offer=${r.message_counts.offer_messages}`,
      );
      console.log("");
    }
  } else {
    console.log("\n✓ No resolution mismatches among investigated patients.");
  }

  console.log("\n## ROOT CAUSE SUMMARY");
  console.log(
    "Doctor visibility requires: (1) same thread_id for GET /doctor/messages + socket join + emit,",
  );
  console.log(
    "(2) archive merge uses CEM clinic_id not patients.clinic_id, (3) AI history in coordinator tables merged on fetch.",
  );
  console.log(
    "Split-brain: patients.clinic_id at wrong clinic creates stale thread; doctor joins assigned thread while emit/push hit stale thread → ROOM SIZE 0.",
  );

  process.exit(mismatched.length ? 2 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
