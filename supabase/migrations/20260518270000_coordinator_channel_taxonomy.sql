-- Expand coordinator channel CHECK constraints for offer_chat, patient_chat, AI continuity, etc.
-- Must match lib/coordinatorChannels.js COORDINATOR_CHANNELS

DO $$
DECLARE
  allowed text[] := ARRAY[
    'in_app',
    'whatsapp',
    'instagram',
    'messenger',
    'sms',
    'email',
    'offer_chat',
    'patient_chat',
    'treatment_guide',
    'coordinator',
    'ai_continuity',
    'clinic_ai'
  ];
  allowed_sql text;
BEGIN
  SELECT string_agg(quote_literal(c), ', ') INTO allowed_sql
  FROM unnest(allowed) AS c;

  EXECUTE 'ALTER TABLE public.ai_coordinator_lead_profiles
    DROP CONSTRAINT IF EXISTS ai_coordinator_lead_profiles_primary_channel_check';
  EXECUTE format(
    'ALTER TABLE public.ai_coordinator_lead_profiles
      ADD CONSTRAINT ai_coordinator_lead_profiles_primary_channel_check
      CHECK (primary_channel IN (%s))',
    allowed_sql
  );

  EXECUTE 'ALTER TABLE public.ai_coordinator_lead_events
    DROP CONSTRAINT IF EXISTS ai_coordinator_lead_events_channel_check';
  EXECUTE format(
    'ALTER TABLE public.ai_coordinator_lead_events
      ADD CONSTRAINT ai_coordinator_lead_events_channel_check
      CHECK (channel IN (%s))',
    allowed_sql
  );

  EXECUTE 'ALTER TABLE public.ai_coordinator_follow_ups
    DROP CONSTRAINT IF EXISTS ai_coordinator_follow_ups_channel_check';
  EXECUTE format(
    'ALTER TABLE public.ai_coordinator_follow_ups
      ADD CONSTRAINT ai_coordinator_follow_ups_channel_check
      CHECK (channel IN (%s))',
    allowed_sql
  );

  EXECUTE 'ALTER TABLE public.ai_coordinator_channel_messages
    DROP CONSTRAINT IF EXISTS ai_coordinator_channel_messages_channel_check';
  EXECUTE format(
    'ALTER TABLE public.ai_coordinator_channel_messages
      ADD CONSTRAINT ai_coordinator_channel_messages_channel_check
      CHECK (channel IN (%s))',
    allowed_sql
  );
END $$;

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.primary_channel IS
  'Operational channel: offer_chat, patient_chat, coordinator, in_app, whatsapp, etc.';
