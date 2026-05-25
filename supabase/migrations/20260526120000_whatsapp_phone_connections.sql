-- WhatsApp Cloud API phone_number_id → clinic mapping.

CREATE TABLE IF NOT EXISTS public.whatsapp_phone_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  display_phone_number text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_phone_connections_status_check
    CHECK (status IN ('active', 'disconnected', 'error')),
  CONSTRAINT whatsapp_phone_connections_phone_number_id_unique UNIQUE (phone_number_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_phone_connections_clinic_status_idx
  ON public.whatsapp_phone_connections (clinic_id, status);

COMMENT ON TABLE public.whatsapp_phone_connections IS
  'WhatsApp Business phone_number_id linked to a clinic for inbound/outbound Cloud API.';
