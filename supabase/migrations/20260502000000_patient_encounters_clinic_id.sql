-- Add clinic_id to patient_encounters for clinic-based filtering.
ALTER TABLE public.patient_encounters
  ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_encounters_clinic_id
  ON public.patient_encounters (clinic_id);
