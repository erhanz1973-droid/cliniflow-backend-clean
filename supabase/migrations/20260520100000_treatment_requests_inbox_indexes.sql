-- Doctor incoming-requests list: clinic-scoped recent rows + offer joins + unread tally.

CREATE INDEX IF NOT EXISTS idx_treatment_requests_clinic_created
  ON public.treatment_requests (clinic_id, created_at DESC)
  WHERE clinic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_offers_request_id
  ON public.treatment_offers (request_id);

CREATE INDEX IF NOT EXISTS idx_patient_chat_threads_clinic_patient
  ON public.patient_chat_threads (clinic_id, patient_id);
