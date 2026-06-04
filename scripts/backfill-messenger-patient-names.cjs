#!/usr/bin/env node
/**
 * Backfill patients.name for Messenger leads stuck on "Messenger User".
 * Usage: node scripts/backfill-messenger-patient-names.cjs [--dry-run] [--clinic-id=UUID] [--limit=100]
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { supabase, isSupabaseEnabled } = require("../lib/supabase");
const { ensureMessengerPatientNameFromGraph } = require("../lib/omnichannel/channelIdentity");
const { isPlaceholderPatientName } = require("../lib/patientNameSync");

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const clinicArg = process.argv.find((a) => a.startsWith("--clinic-id="));
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const clinicId = clinicArg ? clinicArg.split("=")[1].trim() : null;
  const limit = limitArg ? Math.min(500, Math.max(1, parseInt(limitArg.split("=")[1], 10) || 100)) : 100;

  let q = supabase
    .from("channel_identities")
    .select("id, clinic_id, patient_id, external_user_id, display_name, metadata")
    .eq("channel", "messenger")
    .order("updated_at", { ascending: false })
    .limit(limit * 3);
  if (clinicId) q = q.eq("clinic_id", clinicId);

  const { data: identities, error } = await q;
  if (error) throw error;

  const patientIds = [...new Set((identities || []).map((r) => String(r.patient_id || "").trim()).filter(Boolean))];
  if (!patientIds.length) {
    console.log("No messenger identities found.");
    return;
  }

  const { data: patients, error: pErr } = await supabase
    .from("patients")
    .select("id, name, full_name, clinic_id")
    .in("id", patientIds.slice(0, 500));
  if (pErr) throw pErr;

  const patientById = Object.fromEntries((patients || []).map((p) => [String(p.id), p]));
  let synced = 0;
  let skipped = 0;

  for (const ident of identities || []) {
    if (synced >= limit) break;
    const patientId = String(ident.patient_id || "").trim();
    const patient = patientById[patientId];
    if (!patient) continue;

    const current = String(patient.full_name || patient.name || "").trim();
    if (!isPlaceholderPatientName(current)) {
      skipped += 1;
      continue;
    }

    const meta = ident.metadata && typeof ident.metadata === "object" ? ident.metadata : {};
    const pageId = String(meta.page_id || "").trim();
    const psid = String(ident.external_user_id || "").trim();

    console.log(
      dryRun ? "[dry-run]" : "[sync]",
      patientId.slice(0, 8),
      "clinic",
      String(ident.clinic_id || "").slice(0, 8),
      "psid",
      psid ? `${psid.slice(0, 8)}…` : "—",
    );

    if (dryRun) {
      synced += 1;
      continue;
    }

    const result = await ensureMessengerPatientNameFromGraph({
      clinicId: String(ident.clinic_id || patient.clinic_id || ""),
      patientId,
      psid,
      pageId,
      identityId: String(ident.id || ""),
    });
    if (result.synced && result.name) {
      console.log("  →", result.name);
      synced += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`Done. ${synced} synced, ${skipped} skipped (limit ${limit}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
