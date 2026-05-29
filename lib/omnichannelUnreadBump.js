/**
 * Doctor unread badge after WhatsApp/Messenger mirror into patient_messages.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { resolveLeadRoutingDoctorForMembership } = require("./autoAssignRespondingDoctor");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function bumpDoctorUnreadForOmnichannelInbound(patientId, clinicId) {
  if (!isSupabaseEnabled()) return;
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return;

  let doctorId = null;
  const { data: thread } = await supabase
    .from("patient_chat_threads")
    .select("assigned_doctor_id")
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (thread?.assigned_doctor_id && UUID_RE.test(String(thread.assigned_doctor_id))) {
    doctorId = String(thread.assigned_doctor_id).trim();
  }
  if (!doctorId) {
    doctorId = await resolveLeadRoutingDoctorForMembership(cid);
  }
  if (!doctorId) return;

  try {
    const { error } = await supabase.rpc("increment_doctor_patients_unread", { did: doctorId });
    if (!error) return;
  } catch (_) {
    /* RPC optional */
  }

  try {
    const { data: row } = await supabase
      .from("doctors")
      .select("chat_unread_from_patients")
      .eq("id", doctorId)
      .maybeSingle();
    const prev = Math.max(0, Number(row?.chat_unread_from_patients) || 0);
    await supabase
      .from("doctors")
      .update({ chat_unread_from_patients: Math.min(999999, prev + 1) })
      .eq("id", doctorId);
  } catch (e) {
    console.warn("[omnichannelUnreadBump]", e?.message || e);
  }
}

module.exports = { bumpDoctorUnreadForOmnichannelInbound };
