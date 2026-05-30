/**
 * Mirror Messenger / WhatsApp inbound into patient_messages so doctor app inbox (thread-summary) sees them.
 */

const { supabase, isSupabaseEnabled, insertIntoTableWithColumnPruning } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} text
 */
function bodyFields(text) {
  const t = String(text || "").trim().slice(0, 8000);
  return { text: t, message: t, message_text: t, content: t };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function resolveThreadIdForMirror(patientId, clinicId, channel) {
  const ch = String(channel || "messenger").trim().toLowerCase();
  const source = ch === "whatsapp" ? "whatsapp_inbound" : "messenger_inbound";
  const { getCanonicalThread } = require("./canonicalChatThread");
  const canonical = await getCanonicalThread(patientId, clinicId, {
    source,
    repairClinic: true,
    ensureProfile: true,
    archiveCrossClinicStale: false,
  });
  if (canonical.threadId && UUID_RE.test(canonical.threadId)) {
    return canonical.threadId;
  }
  if (!isSupabaseEnabled()) return null;
  try {
    const { data: thr } = await supabase
      .from("patient_chat_threads")
      .select("id")
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (thr?.id && UUID_RE.test(String(thr.id))) return String(thr.id).trim();
  } catch (_) {
    /* optional */
  }
  return null;
}

/**
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   text: string,
 *   channel?: string,
 *   externalMessageId?: string|null,
 * }} params
 */
async function mirrorOmnichannelInboundToPatientMessages(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const text = String(params.text || "").trim();
  const channel = String(params.channel || "messenger").trim().toLowerCase();
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId) || !text) {
    return { ok: false, skipped: true, reason: "invalid_params" };
  }

  const threadId = await resolveThreadIdForMirror(patientId, clinicId, channel);
  if (!threadId) {
    const { logMessageThreadMissing } = require("./patientMessageThreadGuard");
    logMessageThreadMissing({
      caller: "mirrorOmnichannelInboundToPatientMessages",
      insert_fn: "insertIntoTableWithColumnPruning",
      patient_id: patientId,
      clinic_id: clinicId,
      thread_id: null,
      reason: "canonical_thread_unresolved",
      channel,
    });
    return { ok: false, skipped: true, reason: "thread_id_required" };
  }
  const messageId = `omni_${channel}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const baseRow = {
    patient_id: patientId,
    clinic_id: clinicId,
    thread_id: threadId,
    message_id: messageId,
    chat_id: patientId,
    type: "text",
    read_at: null,
    ...bodyFields(text),
  };

  const fromRoles = ["patient", "PATIENT"];
  let lastError = null;

  for (const from_role of fromRoles) {
    const payloads = [
      { ...baseRow, from_role },
      { ...baseRow, from_role, clinic_id: clinicId },
    ];
    for (const payload of payloads) {
      const pr = await insertIntoTableWithColumnPruning(
        "patient_messages",
        payload,
        "id, message_id, patient_id, created_at",
      );
      if (!pr.error && pr.data) {
        const nowIso = new Date().toISOString();
        void (async () => {
          try {
            await supabase
              .from("patient_chat_threads")
              .update({ updated_at: nowIso, last_message_at: nowIso })
              .eq("patient_id", patientId)
              .eq("clinic_id", clinicId);
          } catch (_) {
            /* optional thread touch */
          }
          try {
            const { bumpDoctorUnreadForOmnichannelInbound } = require("./omnichannelUnreadBump");
            await bumpDoctorUnreadForOmnichannelInbound(patientId, clinicId);
          } catch (_) {
            /* non-fatal */
          }
        })();
        return { ok: true, row: pr.data, channel };
      }
      lastError = pr.error;
      const msg = String(pr.error?.message || "").toLowerCase();
      const code = String(pr.error?.code || "");
      if (
        code === "23514" ||
        code === "22P02" ||
        msg.includes("enum") ||
        msg.includes("check constraint")
      ) {
        break;
      }
    }
  }

  if (lastError) {
    console.warn("[mirrorOmnichannelPatientMessage]", channel, lastError.message || lastError);
    return { ok: false, error: lastError.message || String(lastError) };
  }
  return { ok: false, skipped: true, reason: "insert_failed" };
}

module.exports = { mirrorOmnichannelInboundToPatientMessages };
