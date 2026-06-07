-- Facebook recommendation reputation + structured reputation_sources JSONB.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS facebook_page_url TEXT,
  ADD COLUMN IF NOT EXISTS facebook_recommendation_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS facebook_recommendation_count INTEGER,
  ADD COLUMN IF NOT EXISTS reputation_sources JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clinics.facebook_page_url IS 'Facebook Page URL for reviews/recommendations (may differ from facebook_url social link).';
COMMENT ON COLUMN public.clinics.facebook_recommendation_score IS 'Facebook recommendation score 0–100 (e.g. 96%).';
COMMENT ON COLUMN public.clinics.facebook_recommendation_count IS 'Facebook recommendation/review count.';
COMMENT ON COLUMN public.clinics.reputation_sources IS 'Structured reputation: google, facebook, trustpilot — url, rating/score, reviewCount, lastUpdatedAt.';

-- Backfill facebook_page_url from social facebook_url when reputation page empty
UPDATE public.clinics
SET facebook_page_url = NULLIF(TRIM(facebook_url), '')
WHERE (facebook_page_url IS NULL OR TRIM(facebook_page_url) = '')
  AND facebook_url IS NOT NULL
  AND TRIM(facebook_url) <> '';
