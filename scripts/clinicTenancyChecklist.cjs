#!/usr/bin/env node
/**
 * Manual / QA checklist for clinic tenancy (not an automated E2E test).
 * Run: node scripts/clinicTenancyChecklist.cjs
 */
const base = process.env.API_BASE || "http://127.0.0.1:10000";
console.log(`API_BASE=${base}\n`);
const scenarios = [
  "Clinic A admin token → GET /api/admin/patients only returns patients with clinic_id = A (compare ids in JSON).",
  "Clinic B admin token → same path returns no patients from A (no leakage by patient_id or code alone).",
  "POST /api/admin/approve-doctor with a doctor id from clinic A using clinic B token → 404 doctor_not_found_in_clinic.",
  "Token without `role` claim → 403 user_role_not_configured (use an old JWT if you have one).",
  "If patients.role is missing in DB, GET /api/admin/active-patients → 503 patient_role_column_required (no silent fallback).",
  "Doctor/patient token on /api/admin/* → 403 admin_session_required or forbidden (type must be admin, role clinic_admin/super_admin).",
  "Set CLINIC_TENANCY_STRICT=0 only in legacy staging; production should use default strict referrals.",
];
console.log("Scenarios to verify (manual, with two clinics and real tokens):\n");
scenarios.forEach((s, i) => console.log(`${i + 1}. ${s}`));
console.log("\nExample curl (replace TOKEN):\n");
console.log(
  `  curl -sS -H "Authorization: Bearer TOKEN" "${base}/api/admin/patients?page=1&limit=5" | head -c 400; echo\n`
);
