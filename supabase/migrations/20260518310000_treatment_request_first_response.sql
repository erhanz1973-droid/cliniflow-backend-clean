-- Conversation-aware lifecycle: first clinic-side reply timestamp.

ALTER TABLE public.treatment_requests
  ADD COLUMN IF NOT EXISTS first_clinic_response_at timestamptz;

COMMENT ON COLUMN public.treatment_requests.first_clinic_response_at IS
  'When the clinic first engaged (AI continuity, coordinator, or doctor) — drives patient status responded.';

CREATE INDEX IF NOT EXISTS idx_treatment_requests_first_response
  ON public.treatment_requests (clinic_id, first_clinic_response_at DESC)
  WHERE first_clinic_response_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
