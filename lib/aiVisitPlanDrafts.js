/**
 * Persist & load ai_visit_plan_drafts.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} row
 * @returns {import('./aiVisitPlanTypes').AiVisitPlanDraftDto}
 */
function mapVisitPlanRow(row) {
  const timeline = row.draft_timeline_json;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id || null,
    leadProfileId: row.lead_profile_id || null,
    sessionId: row.session_id || null,
    treatmentType: row.treatment_type || null,
    proposedVisitCount:
      row.proposed_visit_count != null ? Number(row.proposed_visit_count) : null,
    estimatedStayDuration: row.estimated_stay_duration || null,
    draftTimeline: Array.isArray(timeline) ? timeline : [],
    aiSummary: row.ai_summary || null,
    coordinatorNotes: row.coordinator_notes || null,
    status: row.status || "draft",
    generatedAt: row.generated_at,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {string[]} profileIds
 * @returns {Promise<Set<string>>}
 */
async function getProfileIdsWithActiveDrafts(profileIds) {
  const ids = (profileIds || []).filter((id) => UUID_RE.test(String(id)));
  if (!ids.length || !isSupabaseEnabled()) return new Set();

  const { data } = await supabase
    .from("ai_visit_plan_drafts")
    .select("lead_profile_id")
    .in("lead_profile_id", ids)
    .eq("status", "draft");

  return new Set((data || []).map((r) => r.lead_profile_id).filter(Boolean));
}

/**
 * @param {string} profileId
 */
async function getLatestVisitPlanForProfile(profileId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) return null;

  let qb = supabase
    .from("ai_visit_plan_drafts")
    .select("*")
    .eq("lead_profile_id", profileId)
    .order("generated_at", { ascending: false })
    .limit(1);

  if (opts.status) {
    qb = qb.eq("status", opts.status);
  }

  const { data, error } = await qb.maybeSingle();
  if (error || !data) return null;
  return mapVisitPlanRow(data);
}

/**
 * @param {{
 *   clinicId: string,
 *   patientId?: string|null,
 *   leadProfileId?: string|null,
 *   sessionId?: string|null,
 *   treatmentType?: string|null,
 *   proposedVisitCount?: number|null,
 *   estimatedStayDuration?: string|null,
 *   draftTimeline: Array<Record<string, unknown>>,
 *   aiSummary?: string|null,
 * }} params
 */
async function saveVisitPlanDraft(params) {
  if (!isSupabaseEnabled() || !UUID_RE.test(params.clinicId)) {
    return { ok: false, reason: "invalid_clinic" };
  }

  const nowIso = new Date().toISOString();
  const row = {
    clinic_id: params.clinicId,
    patient_id: params.patientId && UUID_RE.test(params.patientId) ? params.patientId : null,
    lead_profile_id:
      params.leadProfileId && UUID_RE.test(params.leadProfileId) ? params.leadProfileId : null,
    session_id: params.sessionId ? String(params.sessionId).trim() : null,
    treatment_type: params.treatmentType ? String(params.treatmentType).trim() : null,
    proposed_visit_count:
      params.proposedVisitCount != null && Number.isFinite(Number(params.proposedVisitCount))
        ? Number(params.proposedVisitCount)
        : null,
    estimated_stay_duration: params.estimatedStayDuration || null,
    draft_timeline_json: params.draftTimeline || [],
    ai_summary: params.aiSummary || null,
    status: "draft",
    generated_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("ai_visit_plan_drafts")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    console.warn("[aiVisitPlanDrafts] save:", error.message);
    return { ok: false, reason: error.message };
  }

  if (params.leadProfileId) {
    await insertTimelineEvent({
      profileId: params.leadProfileId,
      eventType: "visit_plan_drafted",
      eventMetadata: {
        visitPlanId: data.id,
        treatmentType: row.treatment_type,
        proposedVisitCount: row.proposed_visit_count,
        estimatedStayDuration: row.estimated_stay_duration,
      },
    });
  }

  return { ok: true, draft: mapVisitPlanRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} draftId
 * @param {{ status?: string, coordinatorNotes?: string, reviewedBy?: string|null }} patch
 */
async function updateVisitPlanDraft(clinicId, draftId, patch) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const row = { updated_at: new Date().toISOString() };
  if (patch.coordinatorNotes != null) {
    row.coordinator_notes = String(patch.coordinatorNotes).trim() || null;
  }
  if (patch.status) {
    row.status = patch.status;
    if (patch.status === "reviewed" || patch.status === "approved") {
      row.reviewed_at = new Date().toISOString();
      if (patch.reviewedBy && UUID_RE.test(patch.reviewedBy)) {
        row.reviewed_by = patch.reviewedBy;
      }
    }
  }

  const { data, error } = await supabase
    .from("ai_visit_plan_drafts")
    .update(row)
    .eq("id", draftId)
    .eq("clinic_id", clinicId)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, draft: mapVisitPlanRow(data) };
}

/**
 * @param {import('./aiVisitPlanTypes').AiVisitPlanDraftDto|null} d
 */
function mapVisitPlanForApi(d) {
  if (!d) return null;
  return {
    id: d.id,
    clinicId: d.clinicId,
    leadProfileId: d.leadProfileId,
    treatmentType: d.treatmentType,
    proposedVisitCount: d.proposedVisitCount,
    estimatedStayDuration: d.estimatedStayDuration,
    draftTimeline: d.draftTimeline,
    aiSummary: d.aiSummary,
    coordinatorNotes: d.coordinatorNotes,
    status: d.status,
    generatedAt: d.generatedAt,
    reviewedAt: d.reviewedAt,
  };
}

module.exports = {
  mapVisitPlanRow,
  mapVisitPlanForApi,
  getProfileIdsWithActiveDrafts,
  getLatestVisitPlanForProfile,
  saveVisitPlanDraft,
  updateVisitPlanDraft,
};
