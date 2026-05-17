-- Treatment proposal / quote workflow — operational states beyond conversation continuity.

ALTER TABLE public.treatment_requests
  ADD COLUMN IF NOT EXISTS proposal_status text,
  ADD COLUMN IF NOT EXISTS proposal_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS proposal_waiting_since timestamptz,
  ADD COLUMN IF NOT EXISTS proposal_draft jsonb,
  ADD COLUMN IF NOT EXISTS proposal_escalation_level smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.treatment_requests.proposal_status IS
  'waiting_for_quote | quote_in_progress | doctor_review_required | ready_to_send | quote_sent';
COMMENT ON COLUMN public.treatment_requests.proposal_draft IS
  'AI-assisted draft estimate structure; human approves before offer is sent.';
COMMENT ON COLUMN public.treatment_requests.proposal_escalation_level IS
  '0=none, 1=coordinator reminder, 2=doctor reminder, 3=escalated';

CREATE INDEX IF NOT EXISTS idx_treatment_requests_proposal_queue
  ON public.treatment_requests (clinic_id, proposal_status, proposal_waiting_since DESC)
  WHERE proposal_status IS NOT NULL;
