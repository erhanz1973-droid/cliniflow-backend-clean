/**
 * Phase 4 — unified doctor conversation timeline (patient + AI + doctor messages).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getCanonicalThread } = require("./canonicalChatThread");
const { backfillLeadCoordinatorHistoryToPatientMessages } = require("./backfillLeadChatMirror");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ensure coordinator profile + mirror AI history before doctor fetch merge.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ source?: string, backfillLimit?: number }} [opts]
 */
async function prepareDoctorConversationAccess(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  let cid = String(clinicId || "").trim();
  const source = String(opts.source || "doctor_timeline").trim();

  if (!isSupabaseEnabled() || !UUID_RE.test(pid)) {
    return { ok: false, threadId: null, clinicId: cid || null, backfill: { inserted: 0 } };
  }

  const canonical = await getCanonicalThread(pid, UUID_RE.test(cid) ? cid : null, {
    source,
    repairClinic: true,
    ensureProfile: true,
    archiveCrossClinicStale: true,
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
    backfill = await backfillLeadCoordinatorHistoryToPatientMessages(pid, cid, {
      limit: opts.backfillLimit || 250,
    });
    backfill.skipped = false;
  }

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
  prepareDoctorConversationAccess,
};
