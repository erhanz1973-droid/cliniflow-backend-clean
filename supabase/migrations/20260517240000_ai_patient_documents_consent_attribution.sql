-- Upload consent + attribution (GDPR-ready MVP) + future imaging metadata bucket.

ALTER TABLE public.ai_patient_documents
  ADD COLUMN IF NOT EXISTS uploaded_by_type text NOT NULL DEFAULT 'patient',
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS patient_confirmed_upload_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_data_consent_version text,
  ADD COLUMN IF NOT EXISTS consent_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS storage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_patient_documents_uploaded_by_type_check'
  ) THEN
    ALTER TABLE public.ai_patient_documents
      ADD CONSTRAINT ai_patient_documents_uploaded_by_type_check
      CHECK (uploaded_by_type IN ('patient', 'clinic', 'system'));
  END IF;
END $$;

COMMENT ON COLUMN public.ai_patient_documents.uploaded_by_type IS
  'Who initiated the upload: patient (self-serve), clinic (staff), or system.';

COMMENT ON COLUMN public.ai_patient_documents.patient_confirmed_upload_consent IS
  'Patient attested they may upload medical documents for coordination (not clinical AI).';

COMMENT ON COLUMN public.ai_patient_documents.medical_data_consent_version IS
  'Version string of the consent copy shown at upload time (audit trail).';

COMMENT ON COLUMN public.ai_patient_documents.storage_metadata IS
  'Future imaging pipeline: storage_provider, dicom_series_id, processed_preview_url, ai_processing_status, etc.';
