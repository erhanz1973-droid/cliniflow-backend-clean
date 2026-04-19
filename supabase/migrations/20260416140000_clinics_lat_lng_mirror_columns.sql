-- Optional lat/lng on clinics (APIs may use these names). Safe if latitude/longitude are absent.

ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS lng double precision;

-- Backfill from latitude/longitude only when those columns exist (older DBs may not have them).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'latitude'
  ) THEN
    UPDATE public.clinics SET lat = latitude WHERE lat IS NULL AND latitude IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'longitude'
  ) THEN
    UPDATE public.clinics SET lng = longitude WHERE lng IS NULL AND longitude IS NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.clinics.lat IS 'Latitude (deg); may mirror latitude column or be set by geocoding sync.';
COMMENT ON COLUMN public.clinics.lng IS 'Longitude (deg); may mirror longitude column or be set by geocoding sync.';
