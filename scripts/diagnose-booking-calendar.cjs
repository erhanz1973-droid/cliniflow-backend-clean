#!/usr/bin/env node
/**
 * Diagnose AI booking vs admin calendar — find missing encounter_treatments rows.
 *
 * Usage:
 *   node scripts/diagnose-booking-calendar.cjs --profile d99a8515
 *   node scripts/diagnose-booking-calendar.cjs --patient eb437baa --date 2026-06-03
 *   node scripts/diagnose-booking-calendar.cjs --profile d99a8515 --reconcile
 */
require("dotenv").config();
const { formatInTimeZone } = require("date-fns-tz");
const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const { readDurableBookingState, readCanonicalBooking } = require("../lib/aiBookingState");
const {
  reconcileAiBookingToAdminCalendar,
  resolveClinicIanaTimezone,
  toStartIso,
} = require("../lib/appointmentCoordinationSync");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

async function resolveProfile(profileNeedle, patientNeedle) {
  if (UUID_RE.test(profileNeedle)) {
    const { data } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id, patient_id, clinic_id, operational_intake_flags, treatment_interest")
      .eq("id", profileNeedle)
      .maybeSingle();
    return data;
  }
  let q = supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, patient_id, clinic_id, operational_intake_flags, treatment_interest")
    .limit(5);
  if (patientNeedle) {
    if (UUID_RE.test(patientNeedle)) q = q.eq("patient_id", patientNeedle);
    else q = q.ilike("patient_id", `${patientNeedle}%`);
  } else if (profileNeedle) {
    q = q.ilike("id", `${profileNeedle}%`);
  }
  const { data } = await q;
  return Array.isArray(data) && data.length === 1 ? data[0] : data?.[0] || null;
}

async function listEncounterTreatments(patientId, dateYmd, tz) {
  const { data: encRows } = await supabase
    .from("patient_encounters")
    .select("id, clinic_id")
    .eq("patient_id", patientId)
    .limit(20);
  const encIds = (encRows || []).map((e) => e.id).filter(Boolean);
  if (!encIds.length) return [];

  const { data: etRows } = await supabase
    .from("encounter_treatments")
    .select("id, scheduled_at, status, procedure_type, chair, assigned_doctor_id")
    .in("encounter_id", encIds)
    .order("scheduled_at", { ascending: false })
    .limit(40);

  return (etRows || []).filter((row) => {
    if (!dateYmd || !row.scheduled_at) return true;
    const d = formatInTimeZone(new Date(row.scheduled_at), tz, "yyyy-MM-dd");
    return d === dateYmd;
  });
}

async function listAppointments(patientId, dateYmd, tz) {
  for (const table of ["appointments", "appointment_requests"]) {
    try {
      const { data } = await supabase.from(table).select("*").eq("patient_id", patientId).limit(30);
      return (data || [])
        .map((row) => {
          const start =
            toStartIso(row.start_at) ||
            toStartIso(row.start_time) ||
            toStartIso(row.startTime) ||
            (row.date && row.time ? toStartIso(`${row.date}T${row.time}`) : null);
          return { table, id: row.id, startAt: start, status: row.status, row };
        })
        .filter((r) => {
          if (!dateYmd || !r.startAt) return true;
          return formatInTimeZone(new Date(r.startAt), tz, "yyyy-MM-dd") === dateYmd;
        });
    } catch {
      /* table may not exist */
    }
  }
  return [];
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const profileNeedle = arg("profile") || "d99a8515";
  const patientNeedle = arg("patient") || "";
  const dateYmd = arg("date") || "2026-06-03";
  const doReconcile = process.argv.includes("--reconcile");

  const profile = await resolveProfile(profileNeedle, patientNeedle);
  if (!profile?.patient_id) {
    console.error("Profile not found for", profileNeedle || patientNeedle);
    process.exit(1);
  }

  const flags =
    profile.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};
  const durable = readDurableBookingState(flags);
  const canonical = readCanonicalBooking(flags);
  const tz = await resolveClinicIanaTimezone(profile.clinic_id);

  console.log("\n=== Booking calendar diagnosis ===\n");
  console.log("Profile:", profile.id);
  console.log("Patient:", profile.patient_id);
  console.log("Clinic:", profile.clinic_id);
  console.log("Timezone:", tz);
  console.log("Filter date:", dateYmd);
  console.log("\n--- aiBooking state ---");
  console.log(JSON.stringify({
    stage: durable.stage,
    bookingActive: durable.bookingActive,
    adminCalendarPersisted: durable.adminCalendarPersisted,
    calendarPersisted: durable.calendarPersisted,
    pendingAppointmentId: durable.pendingAppointmentId,
    selectedSlot: durable.selectedSlot,
    canonicalBooking: canonical,
    activeAppointment: flags.activeAppointment || null,
  }, null, 2));

  const startAt =
    canonical?.startAt ||
    durable.selectedSlot?.startAt ||
    flags.activeAppointment?.startAt ||
    null;

  const et = await listEncounterTreatments(profile.patient_id, dateYmd, tz);
  const appts = await listAppointments(profile.patient_id, dateYmd, tz);

  console.log("\n--- encounter_treatments (admin calendar source) ---");
  if (!et.length) console.log("(none for this date)");
  else et.forEach((r) => console.log(`  ${r.id?.slice(0, 8)} | ${r.scheduled_at} | ${r.status} | ${r.procedure_type}`));

  console.log("\n--- appointments / appointment_requests ---");
  if (!appts.length) console.log("(none for this date)");
  else appts.forEach((r) => console.log(`  [${r.table}] ${String(r.id).slice(0, 8)} | ${r.startAt} | ${r.status}`));

  const onCalendar = et.length > 0;
  const flagsSayBooked =
    durable.adminCalendarPersisted === true ||
    String(durable.stage) === "booked" ||
    !!canonical?.bookingId;

  console.log("\n--- Verdict ---");
  if (onCalendar) {
    console.log("Admin calendar row EXISTS for", dateYmd);
  } else if (flagsSayBooked || startAt) {
    console.log("PROBLEM: Patient was told booking succeeded but NO encounter_treatments on", dateYmd);
    if (startAt) {
      console.log("Expected startAt:", startAt);
      console.log("Local time:", formatInTimeZone(new Date(startAt), tz, "yyyy-MM-dd HH:mm"));
    }
    if (durable.adminCalendarPersisted !== true) {
      console.log("Root cause: adminCalendarPersisted=false (encounter_treatments write failed)");
    }
  } else {
    console.log("No booking flags and no calendar rows for this date.");
  }

  if (doReconcile && startAt && !onCalendar) {
    console.log("\n--- Reconcile (backfill encounter_treatments) ---");
    const result = await reconcileAiBookingToAdminCalendar({
      patientId: profile.patient_id,
      clinicId: profile.clinic_id,
      startAt,
      status: canonical?.status === "pending" ? "pending" : "scheduled",
      timezone: tz,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
      console.log("\nBackfill OK — refresh admin calendar for", dateYmd);
    }
  } else if (!onCalendar && startAt) {
    console.log("\nRun with --reconcile to backfill encounter_treatments for this slot.");
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
