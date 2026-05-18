-- Progressive WhatsApp collection on AI coordinator lead profiles.

ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS whatsapp_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_collection_stage text,
  ADD COLUMN IF NOT EXISTS whatsapp_consent_at timestamptz;

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.whatsapp_number IS
  'Patient WhatsApp (E.164 or digits) for operational follow-up — collected progressively, not at first touch.';

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.whatsapp_collection_stage IS
  'Progressive collection: early | quote_requested | responded | appointment_planning | travel_coordination | collected | declined';

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_clinic_whatsapp_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, whatsapp_collection_stage)
  WHERE clinic_id IS NOT NULL AND whatsapp_number IS NULL;
