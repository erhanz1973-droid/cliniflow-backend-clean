-- One-time timezone canonicalization backfill for existing clinics.
-- Priority:
--   1) keep valid explicit clinics.iana_timezone
--   2) else use valid settings.iana_timezone / settings.timeZone / settings.timezone
--   3) else infer from country defaults
--   4) sync settings.iana_timezone from canonical clinics.iana_timezone
--   5) record unresolved clinics for manual review (no silent guessing)

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS iana_timezone text;

CREATE TABLE IF NOT EXISTS public.clinic_timezone_backfill_ambiguous (
  clinic_id uuid PRIMARY KEY,
  clinic_code text,
  country text,
  city text,
  city_code text,
  reason text NOT NULL DEFAULT 'unresolved_timezone',
  captured_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clinic_timezone_backfill_ambiguous IS
  'Clinics where iana_timezone could not be inferred confidently during one-time backfill.';

WITH base AS (
  SELECT
    c.id,
    nullif(trim(c.iana_timezone), '') AS col_tz_raw,
    nullif(trim(COALESCE(c.settings->>'iana_timezone', c.settings->>'timeZone', c.settings->>'timezone')), '') AS settings_tz_raw,
    upper(trim(COALESCE(c.country, ''))) AS country_iso,
    trim(COALESCE(c.city, '')) AS city_name,
    trim(COALESCE(c.city_code, '')) AS city_code
  FROM public.clinics c
),
resolved AS (
  SELECT
    b.id,
    COALESCE(
      tz_col.name,
      tz_set.name,
      CASE
        WHEN b.country_iso = 'TR' THEN 'Europe/Istanbul'
        WHEN b.country_iso = 'GE' THEN 'Asia/Tbilisi'
        WHEN b.country_iso IN ('UK', 'GB') THEN 'Europe/London'
        WHEN b.country_iso = 'DE' THEN 'Europe/Berlin'
        ELSE NULL
      END
    ) AS canonical_tz
  FROM base b
  LEFT JOIN pg_timezone_names tz_col ON tz_col.name = b.col_tz_raw
  LEFT JOIN pg_timezone_names tz_set ON tz_set.name = b.settings_tz_raw
)
UPDATE public.clinics c
SET iana_timezone = r.canonical_tz
FROM resolved r
WHERE c.id = r.id
  AND r.canonical_tz IS NOT NULL
  AND COALESCE(trim(c.iana_timezone), '') = '';

-- Keep legacy settings readers compatible.
UPDATE public.clinics c
SET settings = jsonb_set(
  COALESCE(c.settings, '{}'::jsonb),
  '{iana_timezone}',
  to_jsonb(c.iana_timezone),
  true
)
WHERE COALESCE(trim(c.iana_timezone), '') <> ''
  AND COALESCE(c.settings->>'iana_timezone', '') IS DISTINCT FROM c.iana_timezone;

-- Record unresolved clinics for manual decision (do not guess silently).
DELETE FROM public.clinic_timezone_backfill_ambiguous;

INSERT INTO public.clinic_timezone_backfill_ambiguous (clinic_id, clinic_code, country, city, city_code, reason)
SELECT
  c.id,
  c.clinic_code,
  c.country,
  c.city,
  c.city_code,
  'unresolved_timezone'
FROM public.clinics c
WHERE COALESCE(trim(c.iana_timezone), '') = '';
