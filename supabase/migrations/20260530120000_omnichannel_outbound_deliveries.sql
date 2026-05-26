-- Outbound omnichannel delivery audit + state machine (Messenger first).

CREATE TABLE IF NOT EXISTS public.omnichannel_outbound_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE SET NULL,
  channel_message_id uuid,
  patient_message_id text,
  transport text NOT NULL DEFAULT 'messenger',
  page_id text,
  recipient_psid text,
  graph_endpoint text,
  graph_api_url text,
  http_status integer,
  graph_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_message_id text,
  token_source text,
  delivery_status text NOT NULL DEFAULT 'queued',
  error_code integer,
  error_subcode integer,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 1,
  last_delivery_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omnichannel_outbound_deliveries_transport_check
    CHECK (transport IN ('messenger', 'whatsapp', 'instagram')),
  CONSTRAINT omnichannel_outbound_deliveries_status_check
    CHECK (
      delivery_status IN (
        'queued',
        'sending',
        'accepted_by_meta',
        'delivered',
        'failed'
      )
    )
);

CREATE INDEX IF NOT EXISTS omnichannel_outbound_deliveries_clinic_created_idx
  ON public.omnichannel_outbound_deliveries (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS omnichannel_outbound_deliveries_external_mid_idx
  ON public.omnichannel_outbound_deliveries (external_message_id)
  WHERE external_message_id IS NOT NULL AND external_message_id <> '';

CREATE INDEX IF NOT EXISTS omnichannel_outbound_deliveries_patient_msg_idx
  ON public.omnichannel_outbound_deliveries (patient_message_id)
  WHERE patient_message_id IS NOT NULL AND patient_message_id <> '';

COMMENT ON TABLE public.omnichannel_outbound_deliveries IS
  'Per-attempt outbound Graph API audit trail with delivery state machine.';
