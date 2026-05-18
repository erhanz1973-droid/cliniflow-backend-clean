-- Repair event_type CHECK after partial apply or legacy rows (e.g. continuity_fallback).
-- Safe to run if 20260518330000 failed on ADD CONSTRAINT.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_events_event_type_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_events
      DROP CONSTRAINT ai_coordinator_lead_events_event_type_check;
  END IF;
END $$;

UPDATE public.ai_coordinator_lead_events e
SET
  event_metadata = COALESCE(e.event_metadata, '{}'::jsonb)
    || jsonb_build_object('legacy_event_type', e.event_type),
  event_type = 'system'
WHERE e.event_type IS NULL
   OR btrim(e.event_type) = ''
   OR e.event_type NOT IN (
    'patient_turn', 'ai_reply', 'human_takeover', 'human_reply',
    'coordination_change', 'escalation_detected', 'follow_up_scheduled',
    'appointment_intent', 'appointment_booked', 'appointment_rescheduled',
    'appointment_cancelled', 'consultation_completed',
    'task_created', 'visit_plan_drafted',
    'xray_uploaded', 'ct_scan_uploaded', 'document_uploaded',
    'doctor_review_requested', 'missing_documents_detected',
    'intake_journey_updated', 'continuity_fallback', 'system',
    'doctor_joined', 'ai_paused', 'ai_resumed'
  );

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
    'intake_journey_updated', 'continuity_fallback', 'system',
    'doctor_joined', 'ai_paused', 'ai_resumed'
  ));

NOTIFY pgrst, 'reload schema';
