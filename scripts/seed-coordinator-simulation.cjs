#!/usr/bin/env node
/**
 * Seed 20–30 coordinator simulation leads on STAGING Supabase only.
 *
 * Usage:
 *   COORDINATOR_SIM_ALLOW=1 node scripts/seed-coordinator-simulation.cjs --clinic-id=<uuid>
 *   COORDINATOR_SIM_ALLOW=1 node scripts/seed-coordinator-simulation.cjs --clinic-id=<uuid> --dry-run
 *   COORDINATOR_SIM_ALLOW=1 node scripts/seed-coordinator-simulation.cjs --clinic-id=<uuid> --clear
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COORDINATOR_SIM_ALLOW=1
 * Optional: COORDINATOR_SIM_ASSIGNED_ADMIN_ID=<uuid> (marks one lead assigned)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config();

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { SIM, SCENARIOS } = require("./coordinator-simulation-dataset.cjs");
const { buildOperationalIntakeState } = require("../lib/aiIntakeFlags");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const out = { clinicId: "", dryRun: false, clear: false, limit: SCENARIOS.length };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    if (a === "--clear") out.clear = true;
    if (a.startsWith("--clinic-id=")) out.clinicId = a.slice("--clinic-id=".length).trim();
    if (a.startsWith("--limit=")) out.limit = Math.max(1, parseInt(a.slice(8), 10) || SCENARIOS.length);
  }
  return out;
}

function assertAllowed() {
  if (process.env.COORDINATOR_SIM_ALLOW !== "1") {
    console.error(
      "[coordinator-sim] Refusing to run: set COORDINATOR_SIM_ALLOW=1 (staging only).",
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && process.env.COORDINATOR_SIM_FORCE !== "1") {
    console.error(
      "[coordinator-sim] Refusing on NODE_ENV=production unless COORDINATOR_SIM_FORCE=1.",
    );
    process.exit(1);
  }
  if (
    String(process.env.RAILWAY_ENVIRONMENT || "").toLowerCase() === "production" &&
    process.env.COORDINATOR_SIM_FORCE !== "1"
  ) {
    console.error("[coordinator-sim] Refusing on Railway production environment.");
    process.exit(1);
  }
  const url = String(process.env.SUPABASE_URL || "").toLowerCase();
  if (
    url.includes("prod") &&
    process.env.COORDINATOR_SIM_FORCE !== "1"
  ) {
    console.warn(
      "[coordinator-sim] SUPABASE_URL contains 'prod' — aborting. Set COORDINATOR_SIM_FORCE=1 to override.",
    );
    process.exit(1);
  }
}

function hoursAgoIso(hours) {
  if (hours == null || !Number.isFinite(hours)) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function splitName(displayName) {
  const parts = String(displayName || "Sim Patient").trim().split(/\s+/);
  const first = parts[0] || "Sim";
  const last = parts.slice(1).join(" ") || "Patient";
  return { first, last, full: `${first} ${last}`.trim() };
}

/**
 * @param {import('./coordinator-simulation-dataset').SimScenario} scenario
 */
function buildLeadData(scenario) {
  return {
    treatmentInterest: scenario.treatmentInterest || "",
    country: scenario.country || "",
    preferredLanguage: scenario.preferredLanguage || "en",
    patientReportedTags: scenario.patientReportedTags || [],
  };
}

/**
 * @param {import('./coordinator-simulation-dataset').SimDocument[]} docs
 */
function mapDocumentsForFlags(docs) {
  return (docs || []).map((d) => ({
    documentType: d.documentType,
    requiresDoctorReview: !!d.requiresDoctorReview,
    reviewStatus: d.reviewStatus || "pending",
  }));
}

async function clearSimulation(supabase, clinicId) {
  const { data: profiles, error: listErr } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, session_id, patient_id")
    .eq("clinic_id", clinicId)
    .like("session_id", `${SIM.SESSION_PREFIX}%`);

  if (listErr) throw new Error(listErr.message);

  const ids = (profiles || []).map((p) => p.id);
  const patientIds = [...new Set((profiles || []).map((p) => p.patient_id).filter(Boolean))];

  if (!ids.length) {
    console.log("[coordinator-sim] No simulation profiles to clear.");
    return { profiles: 0, patients: 0 };
  }

  const { error: delProfiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .delete()
    .in("id", ids);
  if (delProfiles) throw new Error(delProfiles.message);

  if (patientIds.length) {
    const { error: delPatients } = await supabase
      .from("patients")
      .delete()
      .in("patient_id", patientIds);
    if (delPatients) {
      console.warn("[coordinator-sim] Patient cleanup warning:", delPatients.message);
    }
  }

  return { profiles: ids.length, patients: patientIds.length };
}

async function main() {
  assertAllowed();
  const args = parseArgs(process.argv.slice(2));

  if (!UUID_RE.test(args.clinicId)) {
    console.error("Usage: COORDINATOR_SIM_ALLOW=1 node scripts/seed-coordinator-simulation.cjs --clinic-id=<uuid>");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[coordinator-sim] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
    process.exit(1);
  }

  const supabase = createClient(url.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, ""), key);
  const assignedAdminId = process.env.COORDINATOR_SIM_ASSIGNED_ADMIN_ID || null;
  const scenarios = SCENARIOS.slice(0, args.limit);

  if (args.clear) {
    if (args.dryRun) {
      console.log("[coordinator-sim] dry-run: would clear simulation profiles for clinic", args.clinicId);
      return;
    }
    const cleared = await clearSimulation(supabase, args.clinicId);
    console.log("[coordinator-sim] Cleared", cleared.profiles, "profiles,", cleared.patients, "patients");
  }

  console.log(
    `[coordinator-sim] Seeding ${scenarios.length} leads for clinic ${args.clinicId}${args.dryRun ? " (dry-run)" : ""}…`,
  );

  const results = [];

  for (const scenario of scenarios) {
    const sessionId = `${SIM.SESSION_PREFIX}${scenario.key}`;
    const profileId = crypto.randomUUID();
    const patientId = crypto.randomUUID();
    const { first, last, full } = splitName(scenario.displayName);
    const email = `coordinator-sim+${scenario.key}@${SIM.PATIENT_EMAIL_DOMAIN}`;

    const ha = scenario.hoursAgo || {};
    const updatedAt = hoursAgoIso(ha.updated ?? 2);
    const lastPatientMessageAt = hoursAgoIso(ha.lastPatientMessage ?? ha.updated ?? 2);
    const lastHumanReplyAt = hoursAgoIso(ha.lastHumanReply);
    const lastAiReplyAt = hoursAgoIso(ha.lastAiReply);

    const leadData = buildLeadData(scenario);
    const docFlags = mapDocumentsForFlags(scenario.documents);
    const flags = buildOperationalIntakeState({
      leadData,
      documents: docFlags,
      patientMessage: scenario.lastPatientMessage || "",
      profile: {
        coordinationMode: scenario.coordinationMode || "ai_active",
        aiUnresolved: !!scenario.aiUnresolved,
        messageCount: scenario.messageCount ?? 3,
        lastHumanReplyAt,
        country: scenario.country,
      },
    });

    const row = {
      id: profileId,
      session_id: sessionId,
      patient_id: patientId,
      clinic_id: args.clinicId,
      treatment_interest: scenario.treatmentInterest || null,
      country: scenario.country || null,
      preferred_language: scenario.preferredLanguage || "en",
      conversation_summary: scenario.conversationSummary || null,
      last_patient_message: scenario.lastPatientMessage || null,
      lead_score: scenario.isHot ? 85 : 40 + Math.floor(Math.random() * 30),
      is_hot: !!scenario.isHot,
      message_count: scenario.messageCount ?? 3,
      source: SIM.SOURCE,
      coordination_mode: scenario.coordinationMode || "ai_active",
      primary_channel: "in_app",
      channel_metadata: {
        simulation: true,
        simVersion: SIM.VERSION,
        scenarioKey: scenario.key,
        observerNote: scenario.observerNote || null,
      },
      assigned_coordinator_id:
        scenario.key === "human_needs_reply_de" && assignedAdminId && UUID_RE.test(assignedAdminId)
          ? assignedAdminId
          : null,
      ai_unresolved: !!scenario.aiUnresolved,
      escalation_flags: scenario.escalationFlags || {},
      operational_intake_flags: flags,
      operational_notes: `COORDINATOR_SIM:${SIM.VERSION}:${scenario.key}`,
      last_patient_message_at: lastPatientMessageAt,
      last_human_reply_at: lastHumanReplyAt,
      last_ai_reply_at: lastAiReplyAt,
      last_channel_message_at: lastPatientMessageAt,
      updated_at: updatedAt,
      created_at: updatedAt,
    };

    if (args.dryRun) {
      results.push({ key: scenario.key, sessionId, flags: flags.journeyStage });
      continue;
    }

    const { error: pErr } = await supabase.from("patients").insert({
      patient_id: patientId,
      clinic_id: args.clinicId,
      first_name: first,
      last_name: last,
      full_name: full,
      name: full,
      email,
      patient_type: "manual",
      notes: `Coordinator simulation ${SIM.VERSION} — safe to delete`,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
    if (pErr) {
      console.warn(`[coordinator-sim] patient ${scenario.key}:`, pErr.message);
    }

    const { error: profErr } = await supabase.from("ai_coordinator_lead_profiles").insert(row);
    if (profErr) {
      console.error(`[coordinator-sim] profile ${scenario.key}:`, profErr.message);
      continue;
    }

    for (const doc of scenario.documents || []) {
      const { error: docErr } = await supabase.from("ai_patient_documents").insert({
        id: crypto.randomUUID(),
        clinic_id: args.clinicId,
        patient_id: patientId,
        lead_profile_id: profileId,
        session_id: sessionId,
        document_type: doc.documentType,
        file_url: `https://staging.invalid/sim/${scenario.key}/${doc.documentType}.jpg`,
        thumbnail_url: null,
        mime_type: "image/jpeg",
        upload_status: "uploaded",
        review_status: doc.reviewStatus || "pending",
        requires_doctor_review: !!doc.requiresDoctorReview,
        ai_summary: "Simulation upload (not a real clinical file).",
        uploaded_at: updatedAt,
        created_at: updatedAt,
        updated_at: updatedAt,
      });
      if (docErr) console.warn(`[coordinator-sim] doc ${scenario.key}:`, docErr.message);
    }

    await supabase.from("ai_coordinator_lead_events").insert({
      id: crypto.randomUUID(),
      profile_id: profileId,
      patient_message: scenario.lastPatientMessage || "Simulation intake message.",
      ai_reply: scenario.coordinationMode === "human_active" ? null : "Simulation AI reply (staging).",
      turn_lead_data: leadData,
      merged_lead_data: leadData,
      channel: "treatment_guide",
      message_role: "turn",
      event_type: "patient_turn",
      event_metadata: { simulation: true, scenarioKey: scenario.key },
      created_at: lastPatientMessageAt || updatedAt,
    });

    results.push({
      key: scenario.key,
      profileId,
      journeyStage: flags.journeyStage,
      waitingParty: flags.missingXray || flags.missingSmilePhotos ? "patient" : flags.doctorReviewNeeded ? "clinic" : "—",
    });
  }

  console.log("\n[coordinator-sim] Done. Open /admin-ai-leads.html and run the workflow stress test.");
  console.log("Observer notes are in channel_metadata.observerNote per lead (detail) or scripts/coordinator-simulation-dataset.cjs\n");
  if (args.dryRun) {
    console.table(results);
    return;
  }
  console.table(
    results.map((r) => ({
      scenario: r.key,
      journey: r.journeyStage,
      profileId: r.profileId?.slice(0, 8) + "…",
    })),
  );
}

main().catch((e) => {
  console.error("[coordinator-sim] Fatal:", e.message || e);
  process.exit(1);
});
