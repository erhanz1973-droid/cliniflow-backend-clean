-- AI patient document intake (operational coordination — not diagnostic storage).

CREATE TABLE IF NOT EXISTS public.ai_patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  lead_profile_id uuid REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE SET NULL,
  session_id text,
  document_type text NOT NULL,
  file_url text NOT NULL,
  thumbnail_url text,
  mime_type text,
  upload_status text NOT NULL DEFAULT 'uploaded',
  review_status text NOT NULL DEFAULT 'pending',
  ai_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_summary text,
  requires_doctor_review boolean NOT NULL DEFAULT false,
  coordinator_notes text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_patient_documents_document_type_check
    CHECK (document_type IN (
      'panoramic_xray', 'ct_scan', 'selfie', 'intraoral_photo',
      'bloodwork_pdf', 'treatment_report', 'other'
    )),
  CONSTRAINT ai_patient_documents_upload_status_check
    CHECK (upload_status IN ('pending', 'uploaded', 'failed', 'archived')),
  CONSTRAINT ai_patient_documents_review_status_check
    CHECK (review_status IN ('pending', 'reviewed', 'approved', 'rejected', 'archived'))
);

CREATE INDEX IF NOT EXISTS ai_patient_documents_clinic_patient_idx
  ON public.ai_patient_documents (clinic_id, patient_id, uploaded_at DESC)
  WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_patient_documents_lead_profile_idx
  ON public.ai_patient_documents (lead_profile_id, uploaded_at DESC)
  WHERE lead_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_patient_documents_review_idx
  ON public.ai_patient_documents (clinic_id, requires_doctor_review, review_status)
  WHERE requires_doctor_review = true;

COMMENT ON TABLE public.ai_patient_documents IS
  'Treatment-related patient uploads for AI coordinator intake — operational only, not diagnostic AI.';

-- Operational intake flags on CRM lead profiles (missing-info intelligence).
ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS operational_intake_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.operational_intake_flags IS
  'Rule-based missing intake signals (x-ray, travel, treatment preference, medical history).';

-- Timeline event types for document workflow.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_events_event_type_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_events
      DROP CONSTRAINT ai_coordinator_lead_events_event_type_check;
  END IF;
END $$;

ALTER TABLE public.ai_coordinator_lead_events
  ADD CONSTRAINT ai_coordinator_lead_events_event_type_check
  CHECK (event_type IN (
    'patient_turn', 'ai_reply', 'human_takeover', 'human_reply',
    'coordination_change', 'escalation_detected', 'follow_up_scheduled',
    'appointment_intent', 'task_created', 'visit_plan_drafted',
    'xray_uploaded', 'ct_scan_uploaded', 'document_uploaded',
    'doctor_review_requested', 'missing_documents_detected', 'system'
  ));
