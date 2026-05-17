/**
 * AI patient document intake — types & constants.
 */

const DOCUMENT_TYPES = [
  "panoramic_xray",
  "ct_scan",
  "selfie",
  "intraoral_photo",
  "bloodwork_pdf",
  "treatment_report",
  "other",
];

const DOCUMENT_TYPE_LABELS = {
  panoramic_xray: "Panoramic X-ray",
  ct_scan: "CT scan",
  selfie: "Selfie",
  intraoral_photo: "Intraoral photo",
  bloodwork_pdf: "Bloodwork / PDF",
  treatment_report: "Treatment report",
  other: "Document",
};

const UPLOADED_BY_TYPES = ["patient", "clinic", "system"];

/** Default consent copy version — override via CLINIFLY_MEDICAL_DATA_CONSENT_VERSION. */
const DEFAULT_MEDICAL_DATA_CONSENT_VERSION = "2026-05-intake-v1";

/** Future-ready metadata keys (not implemented yet). */
const FUTURE_DOCUMENT_FEATURES = [
  "dicom",
  "multi_image_series",
  "annotations",
  "coordinator_notes_extended",
  "doctor_notes",
  "smile_simulation_assets",
];

/** Keys reserved in storage_metadata jsonb for future imaging pipeline. */
const FUTURE_STORAGE_METADATA_KEYS = [
  "storage_provider",
  "dicom_series_id",
  "processed_preview_url",
  "ai_processing_status",
];

/**
 * @typedef {Object} AiPatientDocumentDto
 * @property {string} id
 * @property {string} clinicId
 * @property {string|null} patientId
 * @property {string|null} leadProfileId
 * @property {string|null} sessionId
 * @property {string} documentType
 * @property {string} fileUrl
 * @property {string|null} thumbnailUrl
 * @property {string|null} mimeType
 * @property {string} uploadStatus
 * @property {string} reviewStatus
 * @property {string[]} aiTags
 * @property {string|null} aiSummary
 * @property {boolean} requiresDoctorReview
 * @property {string|null} coordinatorNotes
 * @property {string} uploadedAt
 * @property {string|null} reviewedAt
 * @property {'patient'|'clinic'|'system'} uploadedByType
 * @property {string|null} uploadedByUserId
 * @property {boolean} patientConfirmedUploadConsent
 * @property {string|null} medicalDataConsentVersion
 * @property {string|null} consentTimestamp
 * @property {Record<string, unknown>} storageMetadata
 */

/**
 * @typedef {Object} OperationalIntakeFlags
 * @property {boolean} missingXray
 * @property {boolean} missingTravelTimeline
 * @property {boolean} missingTreatmentPreference
 * @property {boolean} missingMedicalHistory
 * @property {boolean} doctorReviewNeeded
 * @property {string[]} [missingDocumentTypes]
 */

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  UPLOADED_BY_TYPES,
  DEFAULT_MEDICAL_DATA_CONSENT_VERSION,
  FUTURE_DOCUMENT_FEATURES,
  FUTURE_STORAGE_METADATA_KEYS,
};
