-- Expand whatsapp_phone_connections for multi-clinic admin + embedded signup prep.

ALTER TABLE public.whatsapp_phone_connections
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS connected_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS access_token_enc text;

COMMENT ON COLUMN public.whatsapp_phone_connections.access_token_enc IS
  'Optional per-number token (encrypted). When null, server uses WHATSAPP_ACCESS_TOKEN.';

CREATE TABLE IF NOT EXISTS public.omnichannel_connection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  event_type text NOT NULL,
  connection_id uuid,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  external_id text,
  actor text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS omnichannel_connection_audit_channel_created_idx
  ON public.omnichannel_connection_audit (channel, created_at DESC);

CREATE INDEX IF NOT EXISTS omnichannel_connection_audit_clinic_idx
  ON public.omnichannel_connection_audit (clinic_id, created_at DESC);
