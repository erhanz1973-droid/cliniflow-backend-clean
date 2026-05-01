-- Sticky inbound chat assignment: remember last doctor assigned for a patient (per clinic flow uses patients row).
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS last_assigned_doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS patients_last_assigned_doctor_id_idx
  ON public.patients (last_assigned_doctor_id)
  WHERE last_assigned_doctor_id IS NOT NULL;

COMMENT ON COLUMN public.patients.last_assigned_doctor_id IS 'Last doctor assigned to this patient (inbound chat sticky routing; clinic-driven).';
