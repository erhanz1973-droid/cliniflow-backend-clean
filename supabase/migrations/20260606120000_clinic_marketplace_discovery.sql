-- Marketplace-style clinic discovery fields (public directory + profile pages).

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS short_description TEXT,
  ADD COLUMN IF NOT EXISTS about_text TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS google_rating NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS google_review_count INTEGER,
  ADD COLUMN IF NOT EXISTS trustpilot_rating NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS trustpilot_review_count INTEGER,
  ADD COLUMN IF NOT EXISTS trustpilot_url TEXT,
  ADD COLUMN IF NOT EXISTS google_reviews_url TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS technologies TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS working_hours JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS media_gallery JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clinics.short_description IS 'One-line summary for discovery cards.';
COMMENT ON COLUMN public.clinics.about_text IS 'Longer about section on public clinic profile.';
COMMENT ON COLUMN public.clinics.is_verified IS 'Shows verified badge on discovery when true.';
COMMENT ON COLUMN public.clinics.media_gallery IS 'JSON: { photos: [], beforeAfter: [], videos: [] }.';

-- Backfill website_url from legacy website column when present.
UPDATE public.clinics
SET website_url = NULLIF(TRIM(website), '')
WHERE (website_url IS NULL OR website_url = '')
  AND website IS NOT NULL
  AND TRIM(website) <> '';

CREATE INDEX IF NOT EXISTS idx_clinics_discovery_country_listed
  ON public.clinics (country)
  WHERE is_listed = true;

CREATE INDEX IF NOT EXISTS idx_clinics_discovery_verified
  ON public.clinics (is_verified)
  WHERE is_listed = true AND is_verified = true;
