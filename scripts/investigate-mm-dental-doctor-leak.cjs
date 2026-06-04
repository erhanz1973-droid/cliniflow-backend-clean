#!/usr/bin/env node
/**
 * Investigate "Dr. nikolozi" showing on MM Dental calendar.
 *
 * Usage (from cliniflow-backend-clean/):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/investigate-mm-dental-doctor-leak.cjs
 *   node scripts/investigate-mm-dental-doctor-leak.cjs --clinic-code MMDENT
 *   node scripts/investigate-mm-dental-doctor-leak.cjs --clinic-name "MM Dental"
 */

const { createClient } = require("@supabase/supabase-js");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const out = { clinicCode: "", clinicName: "MM Dental", doctorNeedle: "nikolozi" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--clinic-code" && argv[i + 1]) {
      out.clinicCode = String(argv[++i]).trim().toUpperCase();
    } else if (argv[i] === "--clinic-name" && argv[i + 1]) {
      out.clinicName = String(argv[++i]).trim();
    } else if (argv[i] === "--doctor" && argv[i + 1]) {
      out.doctorNeedle = String(argv[++i]).trim();
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "",
  ).trim();

  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const needle = args.doctorNeedle.toLowerCase();

  console.log("\n=== 1) Resolve MM Dental clinic ===\n");
  let clinic = null;
  if (args.clinicCode) {
    const { data } = await supabase
      .from("clinics")
      .select("id, clinic_code, name, email")
      .eq("clinic_code", args.clinicCode)
      .maybeSingle();
    clinic = data;
  } else {
    const { data: rows } = await supabase
      .from("clinics")
      .select("id, clinic_code, name, email")
      .ilike("name", `%${args.clinicName}%`)
      .limit(10);
    clinic = (rows || [])[0] || null;
    if ((rows || []).length > 1) {
      console.log("Multiple name matches:", rows);
    }
  }

  if (!clinic?.id) {
    console.log("Clinic not found. Try --clinic-code YOUR_CODE");
    process.exit(2);
  }
  const cid = String(clinic.id);
  const ccode = String(clinic.clinic_code || "");
  console.log(clinic);

  console.log("\n=== 2) Doctors registered at this clinic ===\n");
  const { data: clinicDocs } = await supabase
    .from("doctors")
    .select("id, doctor_id, name, full_name, email, clinic_id, status")
    .eq("clinic_id", cid);
  console.log(`count=${(clinicDocs || []).length}`);
  const nikInClinic = (clinicDocs || []).filter((d) =>
    `${d.name || ""} ${d.full_name || ""}`.toLowerCase().includes(needle),
  );
  console.log("nikolozi in clinic doctors:", nikInClinic);

  console.log("\n=== 3) Any doctor named nikolozi (all clinics) ===\n");
  const { data: allNik } = await supabase
    .from("doctors")
    .select("id, doctor_id, name, full_name, email, clinic_id, status")
    .or(`name.ilike.%${needle}%,full_name.ilike.%${needle}%`);
  for (const d of allNik || []) {
    const { data: owner } = await supabase
      .from("clinics")
      .select("id, clinic_code, name")
      .eq("id", d.clinic_id)
      .maybeSingle();
    console.log({ doctor: d, ownerClinic: owner });
  }

  console.log("\n=== 4) Patients registered at MM Dental ===\n");
  const { data: pts } = await supabase
    .from("patients")
    .select("id, patient_id, name, clinic_id")
    .eq("clinic_id", cid)
    .limit(500);
  const patientIds = new Set();
  for (const p of pts || []) {
    if (p.id) patientIds.add(String(p.id));
    if (p.patient_id) patientIds.add(String(p.patient_id));
  }
  console.log(`patient count=${patientIds.size}`);

  console.log("\n=== 5) encounter_treatments → nikolozi (likely calendar source) ===\n");
  const { data: encClinic } = await supabase
    .from("patient_encounters")
    .select("id, patient_id, clinic_id")
    .eq("clinic_id", cid)
    .limit(3000);
  const encIdsClinic = new Set((encClinic || []).map((e) => String(e.id)));

  const { data: encByPatient } = await supabase
    .from("patient_encounters")
    .select("id, patient_id, clinic_id")
    .in("patient_id", [...patientIds].slice(0, 200))
    .limit(3000);

  const suspectEnc = new Map();
  for (const e of encByPatient || []) {
    const eid = String(e.id);
    const rowClinic = String(e.clinic_id || "");
    if (rowClinic && rowClinic !== cid) {
      suspectEnc.set(eid, { ...e, leak: "other_clinic_encounter_via_patient_id" });
    } else if (!rowClinic) {
      suspectEnc.set(eid, { ...e, leak: "null_clinic_id_encounter" });
    }
  }

  const allEncIds = [...new Set([...encIdsClinic, ...suspectEnc.keys()])].filter(Boolean);
  console.log(`encounters clinic-scoped=${encIdsClinic.size} suspect cross/null=${suspectEnc.size}`);

  if (allNik?.length) {
    const docIds = allNik.map((d) => String(d.id));
    for (let i = 0; i < allEncIds.length; i += 80) {
      const chunk = allEncIds.slice(i, i + 80);
      const { data: etRows } = await supabase
        .from("encounter_treatments")
        .select(
          "id, encounter_id, scheduled_at, status, procedure_type, chair, tooth_number, assigned_doctor_id, created_by_doctor_id",
        )
        .in("encounter_id", chunk)
        .not("scheduled_at", "is", null)
        .or(
          `assigned_doctor_id.in.(${docIds.join(",")}),created_by_doctor_id.in.(${docIds.join(",")})`,
        )
        .order("scheduled_at", { ascending: false })
        .limit(50);

      for (const et of etRows || []) {
        const enc = suspectEnc.get(String(et.encounter_id)) ||
          (encClinic || []).find((x) => String(x.id) === String(et.encounter_id));
        const doc =
          allNik.find((d) => String(d.id) === String(et.assigned_doctor_id || et.created_by_doctor_id)) ||
          null;
        console.log({
          source: "encounter_treatments",
          appointmentId: et.id,
          encounter_id: et.encounter_id,
          scheduled_at: et.scheduled_at,
          status: et.status,
          procedure_type: et.procedure_type,
          chair: et.chair,
          tooth_number: et.tooth_number,
          assigned_doctor_id: et.assigned_doctor_id,
          created_by_doctor_id: et.created_by_doctor_id,
          doctor_row: doc,
          encounter: enc,
        });
      }
    }
  }

  console.log("\n=== 6) appointments table rows with nikolozi doctor_id ===\n");
  if (allNik?.length) {
    const docIds = allNik.map((d) => String(d.id));
    const { data: appts } = await supabase
      .from("appointments")
      .select("*")
      .in("doctor_id", docIds)
      .order("start_time", { ascending: false })
      .limit(30);
    for (const a of appts || []) {
      const belongs = String(a.clinic_id || "") === cid;
      console.log({
        source: "appointments",
        appointmentId: a.id,
        clinic_id: a.clinic_id,
        belongs_to_mm_dental: belongs,
        patient_id: a.patient_id,
        doctor_id: a.doctor_id,
        doctor_name: a.doctor_name,
        start_time: a.start_time || a.startTime,
        status: a.status,
        procedure: a.procedure,
        chair: a.chair || a.chair_number,
      });
    }
  }

  console.log("\n=== 7) SQL to run in Supabase (replace :mm_clinic_id) ===\n");
  console.log(`-- clinic_id = ${cid}  clinic_code = ${ccode}`);
  console.log(`
-- A) MM Dental doctors
SELECT id, doctor_id, name, full_name, clinic_id, status
FROM doctors
WHERE clinic_id = '${cid}';

-- B) nikolozi doctor(s) anywhere
SELECT d.*, c.clinic_code, c.name AS clinic_name
FROM doctors d
LEFT JOIN clinics c ON c.id = d.clinic_id
WHERE lower(coalesce(d.name,'') || ' ' || coalesce(d.full_name,'')) LIKE '%${needle}%';

-- C) encounter_treatments shown on calendar (Muayene + tooth 11 pattern)
SELECT et.id AS appointment_row_id,
       et.encounter_id,
       et.scheduled_at,
       et.status,
       et.procedure_type,
       et.chair,
       et.tooth_number,
       et.assigned_doctor_id,
       et.created_by_doctor_id,
       pe.patient_id,
       pe.clinic_id AS encounter_clinic_id,
       d.name AS doctor_name,
       d.clinic_id AS doctor_clinic_id,
       c2.clinic_code AS doctor_owner_clinic
FROM encounter_treatments et
JOIN patient_encounters pe ON pe.id = et.encounter_id
LEFT JOIN doctors d ON d.id = COALESCE(et.assigned_doctor_id, et.created_by_doctor_id)
LEFT JOIN clinics c2 ON c2.id = d.clinic_id
WHERE lower(coalesce(d.name,'') || ' ' || coalesce(d.full_name,'')) LIKE '%${needle}%'
  AND (
    pe.clinic_id = '${cid}'
    OR pe.patient_id IN (SELECT id FROM patients WHERE clinic_id = '${cid}')
  )
ORDER BY et.scheduled_at DESC
LIMIT 20;

-- D) appointments table (if used)
SELECT a.*
FROM appointments a
JOIN doctors d ON d.id = a.doctor_id
WHERE lower(coalesce(d.name,'') || ' ' || coalesce(d.full_name,'')) LIKE '%${needle}%'
  AND (a.clinic_id = '${cid}' OR a.patient_id IN (SELECT id FROM patients WHERE clinic_id = '${cid}'))
ORDER BY a.start_time DESC NULLS LAST
LIMIT 20;
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
