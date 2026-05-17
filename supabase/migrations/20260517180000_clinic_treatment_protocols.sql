-- Treatment journey protocols for AI operational coordination (not medical diagnosis).
-- Future: procedure_stages, recovery_milestones, medication_reminders, coordinator_checklists.

CREATE TABLE IF NOT EXISTS public.clinic_treatment_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  treatment_type text NOT NULL,
  typical_visit_count integer,
  estimated_stay_duration text,
  second_visit_after text,
  healing_notes text,
  post_op_notes text,
  xray_required boolean NOT NULL DEFAULT false,
  temporary_teeth_possible boolean NOT NULL DEFAULT false,
  languages text,
  ai_notes text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_treatment_protocols_visit_count_nonneg CHECK (
    typical_visit_count IS NULL OR typical_visit_count >= 1
  )
);

CREATE INDEX IF NOT EXISTS clinic_treatment_protocols_clinic_active_idx
  ON public.clinic_treatment_protocols (clinic_id, is_active, sort_order ASC, treatment_type ASC);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_treatment_protocols_clinic_type_uidx
  ON public.clinic_treatment_protocols (clinic_id, treatment_type);

COMMENT ON TABLE public.clinic_treatment_protocols IS
  'Clinic-configured operational treatment journey timelines for AI coordinator (not clinical protocols).';

COMMENT ON COLUMN public.clinic_treatment_protocols.treatment_type IS
  'Slug e.g. implant, full_mouth_implant, veneers, crowns, aligners, whitening.';
