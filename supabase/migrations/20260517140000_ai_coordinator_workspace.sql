-- Coordinator workspace: SLA timestamps, escalation, operational tasks, timeline event types.

ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS last_patient_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_human_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_unresolved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS operational_notes text;

ALTER TABLE public.ai_coordinator_lead_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'patient_turn',
  ADD COLUMN IF NOT EXISTS event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_events_event_type_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_events
      ADD CONSTRAINT ai_coordinator_lead_events_event_type_check
      CHECK (event_type IN (
        'patient_turn', 'ai_reply', 'human_takeover', 'human_reply',
        'coordination_change', 'escalation_detected', 'follow_up_scheduled',
        'appointment_intent', 'task_created', 'system'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_waiting_human_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, coordination_mode, last_patient_message_at DESC)
  WHERE coordination_mode = 'human_active';

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_ai_unresolved_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, ai_unresolved, updated_at DESC)
  WHERE ai_unresolved = true;

-- Operational tasks (AI-suggested placeholders — not auto-executed).
CREATE TABLE IF NOT EXISTS public.ai_coordinator_operational_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  task_type text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'normal',
  source text NOT NULL DEFAULT 'ai_placeholder',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_coordinator_operational_tasks_status_check
    CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT ai_coordinator_operational_tasks_priority_check
    CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT ai_coordinator_operational_tasks_type_check
    CHECK (task_type IN (
      'xray_request', 'doctor_review', 'travel_coordination',
      'booking_follow_up', 'general_follow_up'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coordinator_operational_tasks_open_uidx
  ON public.ai_coordinator_operational_tasks (profile_id, task_type)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS ai_coordinator_operational_tasks_clinic_status_idx
  ON public.ai_coordinator_operational_tasks (clinic_id, status, updated_at DESC);

COMMENT ON TABLE public.ai_coordinator_operational_tasks IS
  'AI-generated operational task placeholders for coordinators (no automation yet).';
