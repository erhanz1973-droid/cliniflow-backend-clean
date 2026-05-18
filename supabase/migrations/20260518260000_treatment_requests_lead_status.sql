-- Lead lifecycle on quote/inquiry rows — separate from clinic membership (patients.clinic_id).

ALTER TABLE public.treatment_requests
  ADD COLUMN IF NOT EXISTS lead_status text;

COMMENT ON COLUMN public.treatment_requests.lead_status IS
  'inquiry | quoted | negotiating | booked | converted_to_patient | archived — NOT clinic membership';

CREATE INDEX IF NOT EXISTS idx_treatment_requests_clinic_lead_status
  ON public.treatment_requests (clinic_id, lead_status, created_at DESC)
  WHERE lead_status IS NOT NULL;
