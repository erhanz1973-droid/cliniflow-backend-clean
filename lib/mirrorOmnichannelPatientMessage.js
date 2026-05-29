/**
 * Mirror Messenger / WhatsApp inbound into patient_messages so doctor app inbox (thread-summary) sees them.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("schema cache") && m.includes("column"))
  );
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^patient_messages\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

/**
 * @param {string} text
 */
function bodyFields(text) {
  const t = String(text || "").trim().slice(0, 8000);
  // Match index.cjs patientMessageBodyFields — no `body` column in production patient_messages.
  return { text: t, message: t, message_text: t, content: t };
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

  const nowIso = new Date().toISOString();
  const messageId = `omni_${channel}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let base = {
    patient_id: patientId,
    clinic_id: clinicId,
    message_id: messageId,
    type: "text",
    from_role: "patient",
    read_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    ...bodyFields(text),
  };

  const fromRoles = ["patient", "PATIENT"];
  let lastError = null;

  for (const from_role of fromRoles) {
    let current = { ...base, from_role };
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const { data, error } = await supabase
        .from("patient_messages")
        .insert(current)
        .select("id, message_id, patient_id, created_at")
        .single();
      if (!error) {
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
        return { ok: true, row: data, channel };
      }
      lastError = error;
      const msg = String(error?.message || "").toLowerCase();
      const code = String(error?.code || "");
      if (
        code === "23514" ||
        code === "22P02" ||
        msg.includes("enum") ||
        msg.includes("check constraint")
      ) {
        break;
      }
      if (!isMissingColumnError(error)) break;
      const col = getMissingColumnName(error);
      if (!col || !(col in current)) break;
      delete current[col];
    }
  }

  if (lastError) {
    console.warn("[mirrorOmnichannelPatientMessage]", channel, lastError.message || lastError);
    return { ok: false, error: lastError.message || String(lastError) };
  }
  return { ok: false, skipped: true, reason: "insert_failed" };
}

module.exports = { mirrorOmnichannelInboundToPatientMessages };
