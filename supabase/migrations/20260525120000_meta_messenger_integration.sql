-- Meta Messenger / omnichannel foundation (Phase 1).

CREATE TABLE IF NOT EXISTS public.meta_page_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text,
  page_access_token_enc text NOT NULL,
  token_expires_at timestamptz,
  webhook_subscribed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  connected_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_page_connections_status_check
    CHECK (status IN ('active', 'disconnected', 'error')),
  CONSTRAINT meta_page_connections_page_id_unique UNIQUE (page_id)
);

CREATE INDEX IF NOT EXISTS meta_page_connections_clinic_status_idx
  ON public.meta_page_connections (clinic_id, status);

COMMENT ON TABLE public.meta_page_connections IS
  'Facebook Page linked to a clinic for Messenger (Page access token stored encrypted).';

CREATE TABLE IF NOT EXISTS public.channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  channel text NOT NULL,
  external_user_id text NOT NULL,
  external_thread_id text,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE SET NULL,
  display_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_identities_channel_check
    CHECK (channel IN ('messenger', 'instagram', 'whatsapp', 'sms', 'email', 'web_chat')),
  CONSTRAINT channel_identities_clinic_channel_user_unique
    UNIQUE (clinic_id, channel, external_user_id)
);

CREATE INDEX IF NOT EXISTS channel_identities_patient_idx
  ON public.channel_identities (patient_id);

CREATE INDEX IF NOT EXISTS channel_identities_profile_idx
  ON public.channel_identities (profile_id)
  WHERE profile_id IS NOT NULL;

COMMENT ON TABLE public.channel_identities IS
  'Maps external channel user ids (e.g. Messenger PSID) to Clinifly patient + lead profile.';

CREATE TABLE IF NOT EXISTS public.meta_webhook_events (
  event_id text PRIMARY KEY,
  page_id text,
  event_type text NOT NULL DEFAULT 'message',
  payload_hash text,
  status text NOT NULL DEFAULT 'processed',
  error text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_webhook_events_status_check
    CHECK (status IN ('processed', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS meta_webhook_events_processed_at_idx
  ON public.meta_webhook_events (processed_at DESC);

CREATE TABLE IF NOT EXISTS public.meta_oauth_states (
  state_token text PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  redirect_uri text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_oauth_states_expires_idx
  ON public.meta_oauth_states (expires_at);

-- Dedupe outbound/inbound Messenger rows by Meta message id when present.
CREATE UNIQUE INDEX IF NOT EXISTS ai_coordinator_channel_messages_external_mid_idx
  ON public.ai_coordinator_channel_messages (external_message_id)
  WHERE external_message_id IS NOT NULL AND external_message_id <> '';
