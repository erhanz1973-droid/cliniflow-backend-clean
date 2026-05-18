-- Appointment lifecycle events for coordinator timeline + workspace.

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
    'intake_journey_updated', 'continuity_fallback', 'system'
  ));

NOTIFY pgrst, 'reload schema';
