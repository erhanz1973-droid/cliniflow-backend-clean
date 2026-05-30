/**
 * Phase 4 — unified doctor conversation timeline (patient + AI + doctor messages).
 * Hot path is read-only; repairs run via script / ?repair=1 only.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getCanonicalThread, CANONICAL_THREAD_READ_OPTS } = require("./canonicalChatThread");
const { backfillLeadCoordinatorHistoryToPatientMessages } = require("./backfillLeadChatMirror");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read-only resolve for doctor GET/send — no merge, archive, clinic repair, or backfill.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ source?: string }} [opts]
 */
async function resolveDoctorConversationRead(patientId, clinicId, opts = {}) {
  const t0 = Date.now();
  const pid = String(patientId || "").trim();
  let cid = String(clinicId || "").trim();
  const source = String(opts.source || "doctor_timeline_read").trim();

  if (!isSupabaseEnabled() || !UUID_RE.test(pid)) {
    return { ok: false, threadId: null, clinicId: cid || null, readOnly: true };
  }

  const canonical = await getCanonicalThread(pid, UUID_RE.test(cid) ? cid : null, {
    ...CANONICAL_THREAD_READ_OPTS,
    source,
  });

  if (canonical.clinicId && UUID_RE.test(canonical.clinicId)) cid = canonical.clinicId;

  const ms = Date.now() - t0;
  if (ms >= 50) {
    console.log(
      "[PERF_TIMELINE_PREP]",
      JSON.stringify({
        at: new Date().toISOString(),
        ms,
        readOnly: true,
        source,
        patient_id: pid.slice(0, 8),
        thread_id: canonical.threadId ? String(canonical.threadId).slice(0, 8) : null,
      }),
    );
  }

  return {
    ok: !!canonical.threadId,
    threadId: canonical.threadId || null,
    clinicId: cid,
    profileId: canonical.profileId || null,
    readOnly: true,
    canonical,
  };
}

/**
 * Repair mode — migration / cron / manual script / ?repair=1 only.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ source?: string, backfillLimit?: number }} [opts]
 */
async function prepareDoctorConversationAccess(patientId, clinicId, opts = {}) {
  if (opts.repair !== true) {
    return resolveDoctorConversationRead(patientId, clinicId, opts);
  }

  const t0 = Date.now();
  const pid = String(patientId || "").trim();
  let cid = String(clinicId || "").trim();
  const source = String(opts.source || "doctor_timeline_repair").trim();

  if (!isSupabaseEnabled() || !UUID_RE.test(pid)) {
    return { ok: false, threadId: null, clinicId: cid || null, backfill: { inserted: 0 } };
  }

  const canonical = await getCanonicalThread(pid, UUID_RE.test(cid) ? cid : null, {
    source,
    readOnly: false,
    repairClinic: true,
    ensureProfile: true,
    archiveCrossClinicStale: true,
    mergeDuplicates: true,
  });

  if (canonical.clinicId && UUID_RE.test(canonical.clinicId)) cid = canonical.clinicId;
  const threadId = canonical.threadId || null;

  let coordinatorMessageCount = 0;
  if (canonical.profileId) {
    const { count } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", canonical.profileId);
    coordinatorMessageCount = count || 0;
  }

  let backfill = { inserted: 0, skipped: true };
  if (UUID_RE.test(cid) && (coordinatorMessageCount > 0 || canonical.profileCreated)) {
    const tBf = Date.now();
    backfill = await backfillLeadCoordinatorHistoryToPatientMessages(pid, cid, {
      limit: opts.backfillLimit || 250,
    });
    backfill.skipped = false;
    console.log(
      "[PERF_BACKFILL]",
      JSON.stringify({
        at: new Date().toISOString(),
        ms: Date.now() - tBf,
        patient_id: pid.slice(0, 8),
        inserted: backfill.inserted || 0,
        source,
      }),
    );
  }

  console.log(
    "[PERF_TIMELINE_PREP]",
    JSON.stringify({
      at: new Date().toISOString(),
      ms: Date.now() - t0,
      readOnly: false,
      repair: true,
      source,
      patient_id: pid.slice(0, 8),
      thread_id: threadId ? String(threadId).slice(0, 8) : null,
      backfill_inserted: backfill.inserted || 0,
    }),
  );

  return {
    ok: !!threadId,
    threadId,
    clinicId: cid,
    profileId: canonical.profileId || null,
    coordinatorMessageCount,
    backfill,
    canonical,
  };
}

module.exports = {
  resolveDoctorConversationRead,
  prepareDoctorConversationAccess,
};
