-- IANA timezone for appointment bucketing / display (clinic canonical).
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS iana_timezone text;

COMMENT ON COLUMN public.clinics.iana_timezone IS
  'IANA TZ for schedules (e.g. Europe/Istanbul). Dashboard today/tomorrow use this before device TZ.';

UPDATE public.clinics
SET iana_timezone = 'Europe/Istanbul'
WHERE upper(trim(coalesce(clinic_code, ''))) = 'CEM'
  AND coalesce(trim(iana_timezone), '') = '';
