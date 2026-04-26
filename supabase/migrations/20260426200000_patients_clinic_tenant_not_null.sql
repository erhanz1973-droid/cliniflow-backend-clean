-- Strict tenant: patients must belong to exactly one clinic.
-- Run ONLY after backfilling all NULL clinic_id values (and reviewing scripts/tenant-isolation-cleanup.sql).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.patients WHERE clinic_id IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'patients.clinic_id has NULLs — backfill clinic_id for every row, then re-run this migration';
  END IF;
  ALTER TABLE public.patients
    ALTER COLUMN clinic_id SET NOT NULL;
END $$;

-- Allow same email/phone in different clinics (Postgres: drop old uniques if they exist, then per-clinic uniques)
-- NOTE: names may differ per DB — adjust after querying pg_constraint
-- ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_email_key;
-- CREATE UNIQUE INDEX IF NOT EXISTS patients_email_per_clinic ON public.patients (clinic_id, email);
-- CREATE UNIQUE INDEX IF NOT EXISTS patients_phone_per_clinic ON public.patients (clinic_id, phone) WHERE phone IS NOT NULL;
