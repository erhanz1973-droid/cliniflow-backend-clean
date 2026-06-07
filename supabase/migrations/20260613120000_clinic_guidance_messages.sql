-- Clinic Success Center — guidance messages from Super Admin to clinics.

CREATE TABLE IF NOT EXISTS public.clinic_guidance_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'guidance',
  campaign_key TEXT,
  sent_by TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_guidance_messages_clinic_created
  ON public.clinic_guidance_messages (clinic_id, created_at DESC);

COMMENT ON TABLE public.clinic_guidance_messages IS 'Super Admin guidance and future onboarding campaign messages for clinic admins.';
COMMENT ON COLUMN public.clinic_guidance_messages.message_type IS 'guidance | onboarding_campaign';
COMMENT ON COLUMN public.clinic_guidance_messages.campaign_key IS 'Optional key e.g. day3_google_reviews for automated campaigns.';
