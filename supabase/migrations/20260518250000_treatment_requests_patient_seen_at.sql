-- Patient has opened My Requests after clinic answered (badge clear).

ALTER TABLE public.treatment_requests
  ADD COLUMN IF NOT EXISTS patient_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_treatment_requests_patient_unseen_answered
  ON public.treatment_requests (patient_id, status, patient_seen_at)
  WHERE patient_seen_at IS NULL AND status = 'answered';

COMMENT ON COLUMN public.treatment_requests.patient_seen_at IS
  'Set when patient opens My Requests and marks answered requests as seen.';
