-- Clinic-simple WhatsApp onboarding: pending status until Super Admin completes Meta setup.

ALTER TABLE public.whatsapp_phone_connections
  DROP CONSTRAINT IF EXISTS whatsapp_phone_connections_status_check;

ALTER TABLE public.whatsapp_phone_connections
  ADD CONSTRAINT whatsapp_phone_connections_status_check
    CHECK (status IN ('active', 'disconnected', 'error', 'pending'));

COMMENT ON COLUMN public.whatsapp_phone_connections.phone_number_id IS
  'Meta Cloud API phone_number_id (digits). Pending rows use pending_<uuid> until Super Admin activates.';

COMMENT ON COLUMN public.whatsapp_phone_connections.status IS
  'active = live routing; pending = clinic requested number, awaiting Clinifly Meta setup; disconnected/error = inactive.';
