-- Extended marketplace trust signals + patient save/follow foundation.
-- Run after 20260606120000_clinic_marketplace_discovery.sql

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS international_patient_count INTEGER,
  ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS awards TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS listing_tier TEXT NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.clinics.youtube_url IS 'YouTube channel or clinic video page for discovery profile.';
COMMENT ON COLUMN public.clinics.international_patient_count IS 'Approximate international patients treated (clinic-reported or verified).';
COMMENT ON COLUMN public.clinics.certifications IS 'e.g. ISO, JCI, national dental board accreditations.';
COMMENT ON COLUMN public.clinics.awards IS 'Awards and recognitions shown on marketplace profile.';
COMMENT ON COLUMN public.clinics.listing_tier IS 'standard | featured | sponsored — controls directory prominence.';

CREATE INDEX IF NOT EXISTS idx_clinics_discovery_featured
  ON public.clinics (country, is_featured)
  WHERE is_listed = true AND is_featured = true;

-- Patient saved / followed clinics (compare shortlist + favorites).
CREATE TABLE IF NOT EXISTS public.patient_clinic_saved (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  notify_updates BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_clinic_saved_patient
  ON public.patient_clinic_saved (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_clinic_saved_clinic
  ON public.patient_clinic_saved (clinic_id);

COMMENT ON TABLE public.patient_clinic_saved IS 'Patient favorites / follow list for marketplace compare and re-engagement.';
