-- Clinic tenancy: patients.doctor_id + profiles for auth-linked users
-- Re-run safe: uses IF NOT EXISTS

-- 1) patients.doctor_id — assigning doctor (align with app convention; may reference doctors.id where applicable)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS doctor_id uuid;

COMMENT ON COLUMN public.patients.doctor_id IS
  'Doctor or creator user UUID; backfilled from primary_doctor_id when possible.';

UPDATE public.patients p
SET doctor_id = p.primary_doctor_id
WHERE p.doctor_id IS NULL
  AND p.primary_doctor_id IS NOT NULL;

-- 2) profiles — one row per auth user; NOT NULL clinic_id and role
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics (id) ON DELETE RESTRICT,
  role text NOT NULL,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'clinic_admin', 'doctor')),
  CONSTRAINT profiles_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_clinic_id ON public.profiles (clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id);

COMMENT ON TABLE public.profiles IS
  'Clinic staff profiles; reject API access when role or clinic_id would be null.';
