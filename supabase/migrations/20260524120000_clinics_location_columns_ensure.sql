-- Ensure location columns exist for admin settings (country / city / city_code).
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS country   TEXT,
  ADD COLUMN IF NOT EXISTS city      TEXT,
  ADD COLUMN IF NOT EXISTS city_code TEXT;

CREATE INDEX IF NOT EXISTS idx_clinics_country ON public.clinics (country);
CREATE INDEX IF NOT EXISTS idx_clinics_city ON public.clinics (city);
CREATE INDEX IF NOT EXISTS idx_clinics_city_code ON public.clinics (city_code);

COMMENT ON COLUMN public.clinics.country IS 'ISO 3166-1 alpha-2 uppercase (e.g. TR, GE)';
COMMENT ON COLUMN public.clinics.city IS 'Display city name for discovery';
COMMENT ON COLUMN public.clinics.city_code IS 'Normalized slug for city filters';
