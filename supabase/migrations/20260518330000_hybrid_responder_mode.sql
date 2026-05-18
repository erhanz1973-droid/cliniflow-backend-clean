-- Hybrid AI + doctor coordination: explicit responder mode and timeline events.

ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS responder_mode text,
  ADD COLUMN IF NOT EXISTS primary_responder_type text;

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.responder_mode IS
  'AI_ACTIVE | HUMAN_ACTIVE | HYBRID | ESCALATED — who drives patient-facing replies.';

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.primary_responder_type IS
  'ai_coordinator | doctor | shared_queue — operational ownership label for inbox UI.';

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
    'appointment_intent', 'appointment_booked', 'appointment_rescheduled',
    'appointment_cancelled', 'consultation_completed',
    'task_created', 'visit_plan_drafted',
    'xray_uploaded', 'ct_scan_uploaded', 'document_uploaded',
    'doctor_review_requested', 'missing_documents_detected',
    'intake_journey_updated', 'system',
    'doctor_joined', 'ai_paused', 'ai_resumed'
  ));

NOTIFY pgrst, 'reload schema';
