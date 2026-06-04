-- Self-managed marketplace profile fields + cover image.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS years_in_operation INTEGER,
  ADD COLUMN IF NOT EXISTS cover_photo_url TEXT;

COMMENT ON COLUMN public.clinics.years_in_operation IS 'Clinic-reported years operating (public directory profile).';
COMMENT ON COLUMN public.clinics.cover_photo_url IS 'Hero/cover image URL for public clinic profile page.';
