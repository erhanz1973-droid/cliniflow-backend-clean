-- Ensure clinic_treatment_protocols exists (idempotent).
-- Safe when 20260517180000 never ran on production. Matches backend clinicTreatmentProtocols.js.

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
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Extended workflow fields (optional; UI/orchestration may adopt gradually).
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS treatment_name text;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS protocol_type text;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS min_stay_days integer;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS max_stay_days integer;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS visit_count integer;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS healing_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS second_visit_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS workflow_notes text;
ALTER TABLE public.clinic_treatment_protocols ADD COLUMN IF NOT EXISTS ai_workflow_notes text;

-- Backfill display name + visit_count from legacy columns when present.
UPDATE public.clinic_treatment_protocols
SET treatment_name = initcap(replace(treatment_type, '_', ' '))
WHERE treatment_name IS NULL AND treatment_type IS NOT NULL;

UPDATE public.clinic_treatment_protocols
SET visit_count = typical_visit_count
WHERE visit_count IS NULL AND typical_visit_count IS NOT NULL;

UPDATE public.clinic_treatment_protocols
SET workflow_notes = COALESCE(workflow_notes, healing_notes)
WHERE workflow_notes IS NULL AND healing_notes IS NOT NULL;

UPDATE public.clinic_treatment_protocols
SET ai_workflow_notes = COALESCE(ai_workflow_notes, ai_notes)
WHERE ai_workflow_notes IS NULL AND ai_notes IS NOT NULL;

-- Constraints (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_treatment_protocols_visit_count_nonneg'
  ) THEN
    ALTER TABLE public.clinic_treatment_protocols
      ADD CONSTRAINT clinic_treatment_protocols_visit_count_nonneg CHECK (
        typical_visit_count IS NULL OR typical_visit_count >= 1
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_treatment_protocols_visit_count_alt_nonneg'
  ) THEN
    ALTER TABLE public.clinic_treatment_protocols
      ADD CONSTRAINT clinic_treatment_protocols_visit_count_alt_nonneg CHECK (
        visit_count IS NULL OR visit_count >= 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clinic_treatment_protocols_clinic_idx
  ON public.clinic_treatment_protocols (clinic_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS clinic_treatment_protocols_clinic_active_idx
  ON public.clinic_treatment_protocols (clinic_id, is_active, sort_order ASC, treatment_type ASC);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_treatment_protocols_clinic_type_uidx
  ON public.clinic_treatment_protocols (clinic_id, treatment_type);

COMMENT ON TABLE public.clinic_treatment_protocols IS
  'Clinic-configured operational treatment journey / workflow knowledge for AI coordinator (not clinical diagnosis).';

COMMENT ON COLUMN public.clinic_treatment_protocols.treatment_type IS
  'Slug e.g. implant, veneers (primary key for app CRUD).';

COMMENT ON COLUMN public.clinic_treatment_protocols.treatment_name IS
  'Human-readable treatment label (optional display name).';

-- Refresh PostgREST schema cache (Supabase API).
NOTIFY pgrst, 'reload schema';
