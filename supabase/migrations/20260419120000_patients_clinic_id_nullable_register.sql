-- Patient self-registration may omit clinic until DEFAULT_CLINIC_* is set or user picks a clinic later.
-- Safe if already nullable (PostgreSQL allows DROP NOT NULL on nullable column).
ALTER TABLE public.patients
  ALTER COLUMN clinic_id DROP NOT NULL;
