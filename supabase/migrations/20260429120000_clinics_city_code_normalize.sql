-- Canonical city_code for search/filtering: normalized slug (lowercase, ascii-safe).
-- Drops FK to city_catalog when present so any normalized slug can be stored.

ALTER TABLE public.clinics DROP CONSTRAINT IF EXISTS clinics_city_code_fkey;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS city_code text;

COMMENT ON COLUMN public.clinics.city_code IS
  'Normalized city slug (lowercase, ascii) for browse/search; mirrors user-facing city text in city.';

-- Backfill: ascii slug from display city (aligned with lib/cityCodes.slugifyCatalogCode / normalizeCity).
UPDATE public.clinics c
SET city_code = trimmed.slug
FROM (
  SELECT
    id,
    NULLIF(
      trim(
        both '_'
        FROM regexp_replace(
          lower(trim(coalesce(city, ''))),
          '[^a-z0-9]+',
          '_',
          'g'
        )
      ),
      ''
    ) AS slug
  FROM public.clinics
  WHERE city IS NOT NULL AND trim(city) <> ''
) AS trimmed
WHERE c.id = trimmed.id
  AND (c.city_code IS NULL OR trim(c.city_code) = '')
  AND trimmed.slug IS NOT NULL;

-- Bare slugs already lowercase (no spaces)
UPDATE public.clinics
SET city_code = lower(trim(city))
WHERE (city_code IS NULL OR trim(city_code) = '')
  AND city IS NOT NULL
  AND trim(city) <> ''
  AND lower(trim(city)) !~ '[^a-z0-9_]';
