/**
 * After doctor AI snooze ends, inbound replies must include live chat the AI missed.
 */

const { getAiSnoozeUntilMs } = require("./aiDelegation");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { RESPONDER_MODE, buildResponderPatch } = require("./responderMode");

const PROFILE_RESUME_SELECT =
  "id, session_id, patient_id, clinic_id, coordination_mode, primary_channel, ai_mode, ai_paused, ai_escalation_required, escalation_flags, operational_intake_flags, conversation_summary, treatment_interest, country, preferred_language, conversation_primary_language, message_count, travel_timeline, urgency, booking_intent, whatsapp_number, whatsapp_verified, whatsapp_collection_stage, whatsapp_consent_at, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at, responder_mode, primary_responder_type, human_takeover_at";

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readOperationalFlags(flags) {
  return flags && typeof flags === "object" ? flags : {};
}

const { hadSnoozeThatExpired } = require("./aiDelegation");

/**
 * Persist AI_ACTIVE after snooze so WhatsApp inbound auto-reply works again.
 * @param {Record<string, unknown>|null|undefined} profileRow
 */
async function maybeAutoResumeAiAfterSnooze(profileRow) {
  if (!isSupabaseEnabled() || !profileRow?.id || !hadSnoozeThatExpired(profileRow)) {
    return profileRow;
  }
  const nowIso = new Date().toISOString();
  const patch = {
    ...buildResponderPatch(RESPONDER_MODE.AI_ACTIVE, {
      primaryResponderType: "ai_coordinator",
    }),
    updated_at: nowIso,
  };
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update(patch)
    .eq("id", String(profileRow.id).trim())
    .select(PROFILE_RESUME_SELECT)
    .maybeSingle();
  if (error) {
    console.warn("[aiSnooze] auto-resume after snooze failed:", error.message);
    return profileRow;
  }
  console.log("[aiSnooze] auto-resumed AI after snooze expired", {
    profileId: String(profileRow.id).slice(0, 8),
  });
  return data || profileRow;
}

/**
 * On read/poll: if snooze timer passed, restore AI_ACTIVE (same as manual "AI devam").
 * @param {Record<string, unknown>|null|undefined} profileRow
 */
async function expireSnoozeAndResumeProfile(profileRow) {
  if (!profileRow?.id) return profileRow;
  if (!hadSnoozeThatExpired(profileRow)) return profileRow;
  return maybeAutoResumeAiAfterSnooze(profileRow);
}

/**
 * After manual resume or snooze expiry — answer the last patient message on WhatsApp/in-app.
 * @param {{ profileId: string, clinicId: string, patientId: string, source?: string }} params
 */
async function triggerSnoozeCatchUpAiReply(params) {
  const profileId = String(params.profileId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId) || !UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
    return { sent: false, reason: "invalid_params" };
  }

  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, last_patient_message, last_patient_message_at, primary_channel, operational_intake_flags",
    )
    .eq("id", profileId)
    .maybeSingle();

  const patientMessage = String(row?.last_patient_message || "").trim();
  if (!patientMessage) {
    return { sent: false, reason: "no_patient_message" };
  }

  const channel = String(row?.primary_channel || "whatsapp").toLowerCase();
  const inboundSource = channel === "whatsapp" ? "whatsapp" : "snooze_resume";

  try {
    const { runAiReplyForClinicInbound } = require("./aiPatientInboundReply");
    return await runAiReplyForClinicInbound({
      patientId,
      clinicId,
      patientMessage,
      source: params.source || inboundSource,
      channel: channel === "whatsapp" ? "whatsapp" : undefined,
      inboundPatientMessageAt: row?.last_patient_message_at || null,
    });
  } catch (e) {
    console.warn("[aiSnooze] catch-up reply failed:", e?.message || e);
    return { sent: false, reason: "catch_up_failed" };
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function needsSnoozeCatchUp(flags) {
  const f = readOperationalFlags(flags);
  if (f.ai_snooze_catchup_done === true || f.aiSnoozeCatchupDone === true) return false;
  const startedRaw = f.ai_snooze_started_at || f.aiSnoozeStartedAt;
  if (!startedRaw) return false;
  const untilMs = getAiSnoozeUntilMs({ operational_intake_flags: f });
  if (untilMs != null && Date.now() < untilMs) return false;
  return true;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function snoozeCatchUpSinceIso(flags) {
  const f = readOperationalFlags(flags);
  const started = f.ai_snooze_started_at || f.aiSnoozeStartedAt;
  return started ? String(started).trim() : null;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {string} [nowIso]
 */
function buildSnoozeCatchUpDoneFlags(flags, nowIso) {
  const f = readOperationalFlags(flags);
  const ts = nowIso || new Date().toISOString();
  return {
    ...f,
    ai_snooze_catchup_done: true,
    ai_snooze_catchup_at: ts,
  };
}

/**
 * @param {Array<{ role: string, text: string, source?: string }>} turns
 * @param {string} [lang]
 */
function buildSnoozeCatchUpPromptBlock(turns, lang = "tr") {
  const list = Array.isArray(turns) ? turns.filter((t) => String(t.text || "").trim()) : [];
  if (!list.length) return "";

  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const header =
    key === "tr"
      ? "ÖNEMLİ — AI susturulduğu sürede doktor ve hasta şunları konuştu (bunu mutlaka oku):"
      : "IMPORTANT — While the AI was paused, the doctor and patient discussed the following (you MUST read this):";

  const lines = list.map((t) => {
    const role = String(t.role || "").toLowerCase();
    const text = String(t.text || "").trim().slice(0, 500);
    if (role === "patient" || role === "user") {
      return key === "tr" ? `Hasta: ${text}` : `Patient: ${text}`;
    }
    if (role === "doctor" || role === "human") {
      return key === "tr" ? `Doktor: ${text}` : `Doctor: ${text}`;
    }
    return key === "tr" ? `Klinik: ${text}` : `Clinic: ${text}`;
  });

  const footer =
    key === "tr"
      ? "Yanıtında bu konuşmayı dikkate al; doktorun söylediklerini tekrarlama, çelişme veya görmezden gelme."
      : "Use this in your reply; do not contradict or ignore what the doctor already told the patient.";

  return `${header}\n${lines.join("\n")}\n\n${footer}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Inbound (WhatsApp etc.): when 5‑min snooze timer ended, restore AI_ACTIVE before dispatch.
 * Catch-up for messages sent only during snooze stays on GET ai-coordination / resume_ai (avoids double reply).
 * @param {{ profileId: string, profileRow?: Record<string, unknown>|null }} params
 */
async function resumeExpiredSnoozeBeforeInboundAi(params) {
  const profileId = String(params.profileId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) {
    return { profileRow: params.profileRow || null, resumed: false };
  }
  let row = params.profileRow || null;
  if (!row?.id) {
    const { data } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select(PROFILE_RESUME_SELECT)
      .eq("id", profileId)
      .maybeSingle();
    row = data || null;
  }
  if (!row || !hadSnoozeThatExpired(row)) {
    return { profileRow: row, resumed: false };
  }
  const resumed = await maybeAutoResumeAiAfterSnooze(row);
  return { profileRow: resumed, resumed: true };
}

module.exports = {
  hadSnoozeThatExpired,
  maybeAutoResumeAiAfterSnooze,
  expireSnoozeAndResumeProfile,
  triggerSnoozeCatchUpAiReply,
  resumeExpiredSnoozeBeforeInboundAi,
  needsSnoozeCatchUp,
  snoozeCatchUpSinceIso,
  buildSnoozeCatchUpDoneFlags,
  buildSnoozeCatchUpPromptBlock,
};
