#!/usr/bin/env node
/**
 * Remove coordinator simulation data for a clinic (staging only).
 *
 *   COORDINATOR_SIM_ALLOW=1 node scripts/clear-coordinator-simulation.cjs --clinic-id=<uuid>
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const { SIM } = require("./coordinator-simulation-dataset.cjs");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  if (process.env.COORDINATOR_SIM_ALLOW !== "1") {
    console.error("Set COORDINATOR_SIM_ALLOW=1");
    process.exit(1);
  }
  const clinicId = (process.argv.find((a) => a.startsWith("--clinic-id=")) || "").slice(
    "--clinic-id=".length,
  );
  if (!UUID_RE.test(clinicId)) {
    console.error("Usage: COORDINATOR_SIM_ALLOW=1 node scripts/clear-coordinator-simulation.cjs --clinic-id=<uuid>");
    process.exit(1);
  }

  const supabase = createClient(
    String(process.env.SUPABASE_URL || "")
      .replace(/\/rest\/v1\/?$/i, "")
      .replace(/\/+$/, ""),
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, patient_id")
    .eq("clinic_id", clinicId)
    .like("session_id", `${SIM.SESSION_PREFIX}%`);

  const ids = (profiles || []).map((p) => p.id);
  const patientIds = [...new Set((profiles || []).map((p) => p.patient_id).filter(Boolean))];

  if (!ids.length) {
    console.log("No simulation profiles found.");
    return;
  }

  const { error } = await supabase.from("ai_coordinator_lead_profiles").delete().in("id", ids);
  if (error) throw error;

  if (patientIds.length) {
    await supabase.from("patients").delete().in("patient_id", patientIds);
  }

  console.log(`Cleared ${ids.length} simulation profiles and ${patientIds.length} patients.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
