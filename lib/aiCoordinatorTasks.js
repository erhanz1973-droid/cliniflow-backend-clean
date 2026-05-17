/**
 * Operational task placeholders (prep layer — no automation).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

/** @typedef {'xray_request'|'doctor_review'|'travel_coordination'|'booking_follow_up'|'general_follow_up'} TaskType */

const TASK_DEFS = {
  xray_request: "Request patient X-ray / imaging",
  doctor_review: "Doctor clinical review needed",
  travel_coordination: "Travel coordination needed",
  booking_follow_up: "Booking follow-up needed",
  general_follow_up: "General patient follow-up",
};

/**
 * AI placeholder extraction from lead + message (rules-based MVP).
 * @param {import('./leadIntelligence').LeadData} leadData
 * @param {string} [message]
 * @returns {Array<{ taskType: string, title: string, priority: string }>}
 */
function inferTaskPlaceholders(leadData, message) {
  const out = [];
  const msg = String(message || "").toLowerCase();
  const ti = String(leadData?.treatmentInterest || "").toLowerCase();

  if (/x-?ray|panoramic|cbct|scan|imaging/.test(msg) || /implant|extraction/.test(ti)) {
    out.push({ taskType: "xray_request", title: TASK_DEFS.xray_request, priority: "high" });
  }
  if (leadData?.bookingIntent === "high" || /book|appointment|consultation|schedule/.test(msg)) {
    out.push({ taskType: "booking_follow_up", title: TASK_DEFS.booking_follow_up, priority: "high" });
  }
  if (leadData?.travelTimeline || /travel|flight|hotel|visit/.test(msg)) {
    out.push({ taskType: "travel_coordination", title: TASK_DEFS.travel_coordination, priority: "normal" });
  }
  if (/pain|swell|doctor|review|second opinion/.test(msg) || leadData?.urgency === "high") {
    out.push({ taskType: "doctor_review", title: TASK_DEFS.doctor_review, priority: "high" });
  }
  if (!out.length && leadData?.treatmentInterest) {
    out.push({
      taskType: "general_follow_up",
      title: TASK_DEFS.general_follow_up,
      priority: "normal",
    });
  }

  const seen = new Set();
  return out.filter((t) => {
    if (seen.has(t.taskType)) return false;
    seen.add(t.taskType);
    return true;
  });
}

/**
 * @param {{ profileId: string, clinicId?: string|null, tasks: Array<{ taskType: string, title: string, priority?: string }> }} params
 */
async function upsertTaskPlaceholders(params) {
  if (!isSupabaseEnabled() || !params.profileId || !params.tasks?.length) return;

  const nowIso = new Date().toISOString();
  for (const task of params.tasks) {
    const row = {
      profile_id: params.profileId,
      clinic_id: params.clinicId || null,
      task_type: task.taskType,
      title: task.title,
      status: "pending",
      priority: task.priority || "normal",
      source: "ai_placeholder",
      updated_at: nowIso,
    };

    const { data: existing } = await supabase
      .from("ai_coordinator_operational_tasks")
      .select("id")
      .eq("profile_id", params.profileId)
      .eq("task_type", task.taskType)
      .in("status", ["pending", "in_progress"])
      .maybeSingle();

    if (existing?.id) {
      await supabase.from("ai_coordinator_operational_tasks").update(row).eq("id", existing.id);
    } else {
      row.created_at = nowIso;
      await supabase.from("ai_coordinator_operational_tasks").insert(row);
    }
  }
}

/**
 * @param {string} profileId
 */
async function listTasksForProfile(profileId) {
  if (!isSupabaseEnabled()) return [];
  const { data } = await supabase
    .from("ai_coordinator_operational_tasks")
    .select("id, task_type, title, status, priority, source, created_at, updated_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(20);
  return data || [];
}

module.exports = {
  TASK_DEFS,
  inferTaskPlaceholders,
  upsertTaskPlaceholders,
  listTasksForProfile,
};
