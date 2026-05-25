-- WhatsApp Cloud API: phone_number_id → clinic mapping + Clinifly seed.

CREATE TABLE IF NOT EXISTS public.whatsapp_phone_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_phone_connections_phone_number_id_unique UNIQUE (phone_number_id),
  CONSTRAINT whatsapp_phone_connections_status_check
    CHECK (status IN ('active', 'disconnected', 'error'))
);

CREATE INDEX IF NOT EXISTS whatsapp_phone_connections_clinic_status_idx
  ON public.whatsapp_phone_connections (clinic_id, status);

COMMENT ON TABLE public.whatsapp_phone_connections IS
  'WhatsApp Business phone_number_id linked to a clinic for inbound/outbound Cloud API.';

INSERT INTO public.whatsapp_phone_connections (clinic_id, phone_number_id, status)
VALUES (
  '54cc940e-72c3-43b1-b0ee-c82a545e50d9'::uuid,
  '1123564784177382',
  'active'
)
ON CONFLICT (phone_number_id) DO UPDATE SET
  clinic_id = EXCLUDED.clinic_id,
  status = 'active';
