-- AI coordinator lead pipeline (CRM): merged profile + per-message snapshots.

CREATE TABLE IF NOT EXISTS public.ai_coordinator_lead_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  treatment_interest text,
  country text,
  preferred_language text,
  travel_timeline text,
  urgency text CHECK (urgency IS NULL OR urgency IN ('low', 'medium', 'high')),
  booking_intent text CHECK (booking_intent IS NULL OR booking_intent IN ('low', 'medium', 'high')),
  budget_signal text CHECK (
    budget_signal IS NULL OR budget_signal IN ('low', 'medium', 'high', 'not_discussed')
  ),
  conversation_summary text,
  last_patient_message text,
  lead_score smallint NOT NULL DEFAULT 0,
  is_hot boolean NOT NULL DEFAULT false,
  message_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ai_coordinator_chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_coordinator_lead_profiles_session_id_key UNIQUE (session_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_patient_clinic_uidx
  ON public.ai_coordinator_lead_profiles (patient_id, clinic_id)
  WHERE patient_id IS NOT NULL AND clinic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_clinic_hot_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, is_hot DESC, updated_at DESC)
  WHERE clinic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_updated_idx
  ON public.ai_coordinator_lead_profiles (updated_at DESC);

COMMENT ON TABLE public.ai_coordinator_lead_profiles IS
  'Merged AI coordinator lead intelligence per chat session (CRM profile).';

CREATE TABLE IF NOT EXISTS public.ai_coordinator_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE CASCADE,
  turn_lead_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_lead_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  patient_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_events_profile_created_idx
  ON public.ai_coordinator_lead_events (profile_id, created_at DESC);

COMMENT ON TABLE public.ai_coordinator_lead_events IS
  'Per-turn AI lead extraction snapshots for analytics and audit.';
