-- Audit trail: who lost/gained thread assignment and why (doctor visibility investigations).

CREATE TABLE IF NOT EXISTS public.patient_chat_thread_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  clinic_id uuid,
  old_assigned_doctor_id uuid,
  new_assigned_doctor_id uuid,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_chat_thread_assignment_events_created_idx
  ON public.patient_chat_thread_assignment_events (created_at DESC);

CREATE INDEX IF NOT EXISTS patient_chat_thread_assignment_events_thread_idx
  ON public.patient_chat_thread_assignment_events (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_chat_thread_assignment_events_patient_idx
  ON public.patient_chat_thread_assignment_events (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_chat_thread_assignment_events_old_doctor_idx
  ON public.patient_chat_thread_assignment_events (old_assigned_doctor_id, created_at DESC)
  WHERE old_assigned_doctor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS patient_chat_thread_assignment_events_new_doctor_idx
  ON public.patient_chat_thread_assignment_events (new_assigned_doctor_id, created_at DESC)
  WHERE new_assigned_doctor_id IS NOT NULL;

COMMENT ON TABLE public.patient_chat_thread_assignment_events IS
  'Immutable log when patient_chat_threads.assigned_doctor_id changes — answers whether a doctor lost visibility vs assignment transferred.';

ALTER TABLE public.patient_chat_thread_assignment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_chat_thread_assignment_events_service ON public.patient_chat_thread_assignment_events;
CREATE POLICY patient_chat_thread_assignment_events_service
  ON public.patient_chat_thread_assignment_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
