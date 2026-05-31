/**
 * Compact responder summary for doctor list UIs (inbox, incoming requests).
 */
const { resolveConversationOwner } = require("./aiDelegation");
const { deriveResponderMode } = require("./responderMode");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROFILE_SELECT_VARIANTS = [
  "patient_id, ai_mode, ai_paused, ai_escalation_required, coordination_mode, operational_intake_flags, primary_responder_type, responder_mode",
  "patient_id, ai_mode, ai_paused, ai_escalation_required, coordination_mode, operational_intake_flags",
  "patient_id, ai_mode, ai_paused, ai_escalation_required, coordination_mode",
];

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} clinicId
 * @param {string[]} patientIds
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
async function batchLoadCoordinationResponderByPatientIds(supabase, clinicId, patientIds) {
  const map = new Map();
  if (!supabase || !clinicId || !UUID_RE.test(String(clinicId).trim()) || !patientIds?.length) {
    return map;
  }
  const cidNorm = String(clinicId).trim();
  const unique = [
    ...new Set(
      patientIds
        .map((p) => String(p || "").trim())
        .filter((id) => UUID_RE.test(id)),
    ),
  ];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    let rows = null;
    for (const sel of PROFILE_SELECT_VARIANTS) {
      const { data, error } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select(sel)
        .eq("clinic_id", cidNorm)
        .in("patient_id", chunk);
      if (!error && Array.isArray(data)) {
        rows = data;
        break;
      }
      const code = String(error?.code || "");
      if (!["42703", "PGRST204"].includes(code)) break;
    }
    for (const row of rows || []) {
      const pid = String(row?.patient_id || "").trim().toLowerCase();
      if (pid) map.set(pid, row);
    }
  }
  return map;
}

/**
 * @param {Record<string, unknown>|null|undefined} profileRow
 */
function buildCoordinationResponderSummary(profileRow) {
  if (!profileRow || typeof profileRow !== "object") return null;
  const conversationOwner = resolveConversationOwner(profileRow);
  const explicitMode = String(profileRow.responder_mode || "").trim();
  const responderMode = explicitMode || deriveResponderMode(profileRow);
  return {
    conversationOwner,
    responderMode,
    aiPaused: profileRow.ai_paused === true,
    aiEscalationRequired: profileRow.ai_escalation_required === true,
  };
}

/**
 * @param {Map<string, Record<string, unknown>>} map
 * @param {string} patientId
 */
function coordinationResponderForPatient(map, patientId) {
  const key = String(patientId || "").trim().toLowerCase();
  if (!key) return null;
  return buildCoordinationResponderSummary(map.get(key));
}

module.exports = {
  batchLoadCoordinationResponderByPatientIds,
  buildCoordinationResponderSummary,
  coordinationResponderForPatient,
};
