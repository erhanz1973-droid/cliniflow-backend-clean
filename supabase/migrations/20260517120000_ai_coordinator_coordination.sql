-- AI coordinator: human takeover, unified channels, follow-up prep.

ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS coordination_mode text NOT NULL DEFAULT 'ai_active',
  ADD COLUMN IF NOT EXISTS primary_channel text NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS channel_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_coordinator_id uuid,
  ADD COLUMN IF NOT EXISTS human_takeover_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_ai_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_channel_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS inactivity_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_status text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_profiles_coordination_mode_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_profiles
      ADD CONSTRAINT ai_coordinator_lead_profiles_coordination_mode_check
      CHECK (coordination_mode IN ('ai_active', 'human_active'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_profiles_primary_channel_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_profiles
      ADD CONSTRAINT ai_coordinator_lead_profiles_primary_channel_check
      CHECK (primary_channel IN ('in_app', 'whatsapp', 'instagram', 'messenger'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_profiles_follow_up_status_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_profiles
      ADD CONSTRAINT ai_coordinator_lead_profiles_follow_up_status_check
      CHECK (follow_up_status IN ('none', 'scheduled', 'due', 'paused', 'completed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_clinic_mode_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, coordination_mode, updated_at DESC);

ALTER TABLE public.ai_coordinator_lead_events
  ADD COLUMN IF NOT EXISTS ai_reply text,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS message_role text NOT NULL DEFAULT 'turn';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_events_channel_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_events
      ADD CONSTRAINT ai_coordinator_lead_events_channel_check
      CHECK (channel IN ('in_app', 'whatsapp', 'instagram', 'messenger'));
  END IF;
END $$;

-- Scheduled follow-ups (automation not implemented yet).
CREATE TABLE IF NOT EXISTS public.ai_coordinator_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  trigger_type text NOT NULL DEFAULT 'scheduled',
  message_template text,
  channel text NOT NULL DEFAULT 'in_app',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_coordinator_follow_ups_status_check
    CHECK (status IN ('pending', 'sent', 'cancelled', 'skipped')),
  CONSTRAINT ai_coordinator_follow_ups_channel_check
    CHECK (channel IN ('in_app', 'whatsapp', 'instagram', 'messenger'))
);

CREATE INDEX IF NOT EXISTS ai_coordinator_follow_ups_profile_scheduled_idx
  ON public.ai_coordinator_follow_ups (profile_id, scheduled_for)
  WHERE status = 'pending';

-- Unified thread messages across channels (future WhatsApp / social).
CREATE TABLE IF NOT EXISTS public.ai_coordinator_channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'in_app',
  direction text NOT NULL DEFAULT 'inbound',
  message_role text NOT NULL DEFAULT 'patient',
  body text NOT NULL,
  external_message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_coordinator_channel_messages_channel_check
    CHECK (channel IN ('in_app', 'whatsapp', 'instagram', 'messenger')),
  CONSTRAINT ai_coordinator_channel_messages_direction_check
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT ai_coordinator_channel_messages_role_check
    CHECK (message_role IN ('patient', 'assistant', 'coordinator', 'system'))
);

CREATE INDEX IF NOT EXISTS ai_coordinator_channel_messages_profile_created_idx
  ON public.ai_coordinator_channel_messages (profile_id, created_at DESC);

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.coordination_mode IS
  'ai_active = AI auto-replies; human_active = coordinator takeover (AI paused).';
