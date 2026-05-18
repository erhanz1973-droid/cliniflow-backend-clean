/**
 * Persistence for clinical_guidance and clinical_communication_drafts.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { normalizeIntentTags, normalizeStringList } = require("./clinicalGuidanceTypes");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} row
 */
function mapGuidanceRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    profileId: row.profile_id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    authorId: row.author_id,
    authorRole: row.author_role,
    intentTags: row.intent_tags || [],
    intentText: row.intent_text,
    constraints: row.constraints || [],
    communicationGoals: row.communication_goals || [],
    neverPatientVisible: row.never_patient_visible !== false,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
function mapDraftRow(row) {
  return {
    id: row.id,
    guidanceId: row.guidance_id,
    profileId: row.profile_id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    draftText: row.draft_text,
    status: row.status,
    messageProvenance: row.message_provenance || {},
    safetyReport: row.safety_report || {},
    confidence: row.confidence,
    rewriteActions: row.rewrite_actions || [],
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    patientMessageRef: row.patient_message_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {{
 *   profileId?: string|null,
 *   threadId?: string|null,
 *   patientId: string,
 *   clinicId: string,
 *   authorId: string,
 *   authorRole: string,
 *   intentTags?: string[],
 *   intentText: string,
 *   constraints?: string[],
 *   communicationGoals?: string[],
 * }} input
 */
async function createClinicalGuidance(input) {
  const now = new Date().toISOString();
  const row = {
    profile_id: input.profileId || null,
    thread_id: input.threadId || null,
    patient_id: input.patientId,
    clinic_id: input.clinicId,
    author_id: input.authorId,
    author_role: input.authorRole,
    intent_tags: normalizeIntentTags(input.intentTags),
    intent_text: String(input.intentText || "").trim(),
    constraints: normalizeStringList(input.constraints),
    communication_goals: normalizeStringList(input.communicationGoals),
    never_patient_visible: true,
    version: 1,
    updated_at: now,
  };
  const { data, error } = await supabase.from("clinical_guidance").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return mapGuidanceRow(data);
}

/**
 * @param {string} id
 */
async function getClinicalGuidanceById(id) {
  const { data, error } = await supabase.from("clinical_guidance").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapGuidanceRow(data) : null;
}

/**
 * @param {{
 *   guidanceId: string,
 *   profileId?: string|null,
 *   patientId: string,
 *   clinicId: string,
 *   draftText: string,
 *   messageProvenance?: Record<string, unknown>,
 *   safetyReport?: Record<string, unknown>,
 *   confidence?: number|null,
 *   rewriteActions?: string[],
 * }} input
 */
async function createCommunicationDraft(input) {
  const now = new Date().toISOString();
  const row = {
    guidance_id: input.guidanceId,
    profile_id: input.profileId || null,
    patient_id: input.patientId,
    clinic_id: input.clinicId,
    draft_text: String(input.draftText || "").trim(),
    status: "draft",
    message_provenance: input.messageProvenance || {},
    safety_report: input.safetyReport || {},
    confidence: input.confidence ?? null,
    rewrite_actions: input.rewriteActions || [],
    updated_at: now,
  };
  const { data, error } = await supabase
    .from("clinical_communication_drafts")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDraftRow(data);
}

/**
 * @param {string} draftId
 */
async function getDraftById(draftId) {
  const { data, error } = await supabase
    .from("clinical_communication_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDraftRow(data) : null;
}

/**
 * @param {string} draftId
 * @param {Record<string, unknown>} patch
 */
async function updateDraft(draftId, patch) {
  const { data, error } = await supabase
    .from("clinical_communication_drafts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDraftRow(data);
}

/**
 * @param {string} clinicId
 * @param {string} patientId
 */
async function resolveThreadId(clinicId, patientId) {
  const { data } = await supabase
    .from("patient_chat_threads")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

module.exports = {
  UUID_RE,
  isSupabaseEnabled,
  mapGuidanceRow,
  mapDraftRow,
  createClinicalGuidance,
  getClinicalGuidanceById,
  createCommunicationDraft,
  getDraftById,
  updateDraft,
  resolveThreadId,
};
