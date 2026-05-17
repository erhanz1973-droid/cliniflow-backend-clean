/**
 * ai_patient_documents — persist, list, review.
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { normalizeDocumentType } = require("./aiIntakeFlags");
const {
  DOCUMENT_TYPE_LABELS,
  DEFAULT_MEDICAL_DATA_CONSENT_VERSION,
} = require("./aiPatientDocumentTypes");

const DEFAULT_CONSENT_VERSION =
  String(process.env.CLINIFLY_MEDICAL_DATA_CONSENT_VERSION || "").trim() ||
  DEFAULT_MEDICAL_DATA_CONSENT_VERSION;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IMAGING_TYPES = new Set(["panoramic_xray", "ct_scan"]);

/**
 * @param {Record<string, unknown>} row
 * @returns {import('./aiPatientDocumentTypes').AiPatientDocumentDto}
 */
function mapDocumentRow(row) {
  const tags = row.ai_tags;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id || null,
    leadProfileId: row.lead_profile_id || null,
    sessionId: row.session_id || null,
    documentType: row.document_type,
    fileUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url || null,
    mimeType: row.mime_type || null,
    uploadStatus: row.upload_status || "uploaded",
    reviewStatus: row.review_status || "pending",
    aiTags: Array.isArray(tags) ? tags.map(String) : [],
    aiSummary: row.ai_summary || null,
    requiresDoctorReview: row.requires_doctor_review === true,
    coordinatorNotes: row.coordinator_notes || null,
    uploadedAt: row.uploaded_at,
    reviewedAt: row.reviewed_at || null,
    uploadedByType: row.uploaded_by_type || "patient",
    uploadedByUserId: row.uploaded_by_user_id || null,
    patientConfirmedUploadConsent: row.patient_confirmed_upload_consent === true,
    medicalDataConsentVersion: row.medical_data_consent_version || null,
    consentTimestamp: row.consent_timestamp || null,
    storageMetadata:
      row.storage_metadata && typeof row.storage_metadata === "object"
        ? row.storage_metadata
        : {},
  };
}

/**
 * @param {import('./aiPatientDocumentTypes').AiPatientDocumentDto|null} d
 */
function mapDocumentForApi(d) {
  if (!d) return null;
  return {
    id: d.id,
    documentType: d.documentType,
    documentTypeLabel: DOCUMENT_TYPE_LABELS[d.documentType] || d.documentType,
    fileUrl: d.fileUrl,
    thumbnailUrl: d.thumbnailUrl,
    mimeType: d.mimeType,
    uploadStatus: d.uploadStatus,
    reviewStatus: d.reviewStatus,
    aiTags: d.aiTags,
    aiSummary: d.aiSummary,
    requiresDoctorReview: d.requiresDoctorReview,
    coordinatorNotes: d.coordinatorNotes,
    uploadedAt: d.uploadedAt,
    reviewedAt: d.reviewedAt,
    uploadedByType: d.uploadedByType,
    uploadedByUserId: d.uploadedByUserId,
    patientConfirmedUploadConsent: d.patientConfirmedUploadConsent,
    medicalDataConsentVersion: d.medicalDataConsentVersion,
    consentTimestamp: d.consentTimestamp,
  };
}

/**
 * Parse patient upload consent from multipart body.
 * @param {Record<string, unknown>|undefined} body
 * @returns {{ ok: true, consent: { confirmed: boolean, version: string, timestamp: string } } | { ok: false, error: string }}
 */
function parsePatientUploadConsent(body) {
  const raw =
    body?.uploadConsent ??
    body?.upload_consent ??
    body?.patientConfirmedUploadConsent ??
    body?.patient_confirmed_upload_consent;
  const confirmed =
    raw === true ||
    raw === 1 ||
    String(raw || "")
      .trim()
      .toLowerCase() === "true" ||
    String(raw || "").trim() === "1";

  if (!confirmed) {
    return { ok: false, error: "upload_consent_required" };
  }

  const version = String(
    body?.consentVersion ?? body?.consent_version ?? body?.medicalDataConsentVersion ?? "",
  ).trim();
  const timestampRaw = body?.consentTimestamp ?? body?.consent_timestamp;
  let timestamp = new Date().toISOString();
  if (timestampRaw) {
    const d = new Date(String(timestampRaw));
    if (!Number.isNaN(d.getTime())) timestamp = d.toISOString();
  }

  return {
    ok: true,
    consent: {
      confirmed: true,
      version: version || DEFAULT_CONSENT_VERSION,
      timestamp,
    },
  };
}

/**
 * Rule-based operational tags (no diagnostic AI).
 * @param {string} documentType
 */
function buildOperationalTags(documentType) {
  const tags = ["intake_upload", documentType];
  if (IMAGING_TYPES.has(documentType)) tags.push("imaging");
  if (documentType === "intraoral_photo" || documentType === "selfie") tags.push("photos");
  return tags;
}

/**
 * @param {string} documentType
 */
function buildOperationalSummary(documentType) {
  const label = DOCUMENT_TYPE_LABELS[documentType] || "Document";
  return `${label} received for operational intake. Clinical evaluation by licensed professionals is required.`;
}

/**
 * Timeline event for upload.
 * @param {string} documentType
 */
function uploadEventType(documentType) {
  if (documentType === "panoramic_xray") return "xray_uploaded";
  if (documentType === "ct_scan") return "ct_scan_uploaded";
  return "document_uploaded";
}

/**
 * @param {string} profileId
 * @param {{ clinicId?: string, patientId?: string, sessionId?: string, limit?: number }} opts
 */
async function listDocumentsForProfile(profileId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) return [];

  let qb = supabase
    .from("ai_patient_documents")
    .select("*")
    .eq("lead_profile_id", profileId)
    .neq("upload_status", "archived")
    .order("uploaded_at", { ascending: false })
    .limit(opts.limit || 50);

  if (opts.clinicId && UUID_RE.test(opts.clinicId)) {
    qb = qb.eq("clinic_id", opts.clinicId);
  }

  const { data, error } = await qb;
  if (error) {
    console.warn("[aiPatientDocuments] list:", error.message);
    return [];
  }
  return (data || []).map(mapDocumentRow);
}

/**
 * @param {string} patientId uuid
 * @param {string} clinicId uuid
 */
async function listDocumentsForPatient(patientId, clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId)) return [];

  let qb = supabase
    .from("ai_patient_documents")
    .select("*")
    .eq("patient_id", patientId)
    .neq("upload_status", "archived")
    .order("uploaded_at", { ascending: false })
    .limit(50);

  if (UUID_RE.test(clinicId)) qb = qb.eq("clinic_id", clinicId);

  const { data, error } = await qb;
  if (error) return [];
  return (data || []).map(mapDocumentRow);
}

/**
 * @param {string[]} profileIds
 * @returns {Promise<Set<string>>}
 */
async function getProfileIdsWithPendingDoctorReview(profileIds) {
  const ids = (profileIds || []).filter((id) => UUID_RE.test(String(id)));
  if (!ids.length || !isSupabaseEnabled()) return new Set();

  const { data } = await supabase
    .from("ai_patient_documents")
    .select("lead_profile_id")
    .in("lead_profile_id", ids)
    .eq("requires_doctor_review", true)
    .eq("review_status", "pending");

  return new Set((data || []).map((r) => r.lead_profile_id).filter(Boolean));
}

/**
 * @param {string} sessionId
 */
async function resolveLeadProfileBySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid || !isSupabaseEnabled()) return null;

  const { data } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, clinic_id, patient_id")
    .eq("session_id", sid)
    .maybeSingle();

  return data || null;
}

/**
 * @param {{
 *   file: { buffer: Buffer, mimetype?: string, originalname?: string, size?: number },
 *   patientId: string,
 *   clinicId: string,
 *   leadProfileId?: string|null,
 *   sessionId?: string|null,
 *   documentType?: string,
 *   publicDir: string,
 *   uploadedByType?: 'patient'|'clinic'|'system',
 *   uploadedByUserId?: string|null,
 *   uploadConsent?: { confirmed: boolean, version: string, timestamp: string }|null,
 * }} params
 */
async function savePatientDocumentUpload(params) {
  if (!isSupabaseEnabled() || !UUID_RE.test(params.patientId) || !UUID_RE.test(params.clinicId)) {
    return { ok: false, error: "invalid_ids" };
  }

  const file = params.file;
  if (!file?.buffer?.length) return { ok: false, error: "no_file" };

  const mime = String(file.mimetype || "").toLowerCase();
  const isImg = mime.startsWith("image/");
  const isPdf = mime.includes("pdf");

  let ext = path.extname(file.originalname || "").toLowerCase();
  if (!ext) ext = isImg ? ".jpg" : isPdf ? ".pdf" : ".bin";

  const documentType = normalizeDocumentType(params.documentType);
  const requiresDoctorReview = IMAGING_TYPES.has(documentType);
  const uploadedByType = ["patient", "clinic", "system"].includes(params.uploadedByType)
    ? params.uploadedByType
    : "patient";
  const uploadedByUserId =
    params.uploadedByUserId && UUID_RE.test(params.uploadedByUserId)
      ? params.uploadedByUserId
      : null;
  const consent = params.uploadConsent;

  if (uploadedByType === "patient") {
    if (!consent?.confirmed) {
      return { ok: false, error: "upload_consent_required" };
    }
  }

  const folderKey = params.patientId;
  const safeName = `${folderKey}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  const uploadDir = path.join(params.publicDir, "uploads", "patient", folderKey);
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const diskPath = path.join(uploadDir, safeName);
  fs.writeFileSync(diskPath, file.buffer);

  const fileUrl = `/uploads/patient/${encodeURIComponent(folderKey)}/${encodeURIComponent(safeName)}`;
  const thumbnailUrl = isImg ? fileUrl : null;
  const nowIso = new Date().toISOString();

  const row = {
    clinic_id: params.clinicId,
    patient_id: params.patientId,
    lead_profile_id:
      params.leadProfileId && UUID_RE.test(params.leadProfileId) ? params.leadProfileId : null,
    session_id: params.sessionId ? String(params.sessionId).trim() : null,
    document_type: documentType,
    file_url: fileUrl,
    thumbnail_url: thumbnailUrl,
    mime_type: mime || null,
    upload_status: "uploaded",
    review_status: "pending",
    ai_tags: buildOperationalTags(documentType),
    ai_summary: buildOperationalSummary(documentType),
    requires_doctor_review: requiresDoctorReview,
    uploaded_by_type: uploadedByType,
    uploaded_by_user_id: uploadedByUserId,
    patient_confirmed_upload_consent: consent?.confirmed === true,
    medical_data_consent_version: consent?.version || null,
    consent_timestamp: consent?.timestamp || null,
    storage_metadata: {},
    uploaded_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("ai_patient_documents")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    console.warn("[aiPatientDocuments] insert:", error.message);
    return { ok: false, error: error.message };
  }

  const draft = mapDocumentRow(data);

  if (params.leadProfileId) {
    const evType = uploadEventType(documentType);
    await insertTimelineEvent({
      profileId: params.leadProfileId,
      eventType: evType,
      eventMetadata: {
        documentId: draft.id,
        documentType,
        fileUrl,
      },
    });
    if (requiresDoctorReview) {
      await insertTimelineEvent({
        profileId: params.leadProfileId,
        eventType: "doctor_review_requested",
        eventMetadata: { documentId: draft.id, documentType },
      });
    }
  }

  return { ok: true, document: draft };
}

/**
 * @param {string} clinicId
 * @param {string} documentId
 * @param {{ reviewStatus?: string, coordinatorNotes?: string, reviewedBy?: string|null }} patch
 */
async function updateDocumentReview(clinicId, documentId, patch) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const row = { updated_at: new Date().toISOString() };
  if (patch.coordinatorNotes != null) {
    row.coordinator_notes = String(patch.coordinatorNotes).trim() || null;
  }
  if (patch.reviewStatus) {
    row.review_status = patch.reviewStatus;
    if (["reviewed", "approved", "rejected"].includes(patch.reviewStatus)) {
      row.reviewed_at = new Date().toISOString();
      if (patch.reviewedBy && UUID_RE.test(patch.reviewedBy)) {
        row.reviewed_by = patch.reviewedBy;
      }
    }
  }

  const { data, error } = await supabase
    .from("ai_patient_documents")
    .update(row)
    .eq("id", documentId)
    .eq("clinic_id", clinicId)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, document: mapDocumentRow(data) };
}

module.exports = {
  mapDocumentRow,
  mapDocumentForApi,
  parsePatientUploadConsent,
  listDocumentsForProfile,
  listDocumentsForPatient,
  getProfileIdsWithPendingDoctorReview,
  resolveLeadProfileBySession,
  savePatientDocumentUpload,
  updateDocumentReview,
  DEFAULT_CONSENT_VERSION,
};
