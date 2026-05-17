-- Layered AI delegation per inquiry (human-controlled; no silent takeover).

ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS assigned_doctor_id uuid,
  ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'AI_ASSISTED',
  ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_escalation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_autonomy_level text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_coordinator_lead_profiles_ai_mode_check'
  ) THEN
    ALTER TABLE public.ai_coordinator_lead_profiles
      ADD CONSTRAINT ai_coordinator_lead_profiles_ai_mode_check
      CHECK (ai_mode IN (
        'HUMAN_ONLY',
        'AI_DRAFT',
        'AI_ASSISTED',
        'AI_ACTIVE',
        'ESCALATION_REQUIRED'
      ));
  END IF;
END $$;

-- Backfill from legacy coordination_mode + escalation flags.
UPDATE public.ai_coordinator_lead_profiles
SET
  ai_mode = CASE
    WHEN coordination_mode = 'human_active' THEN 'HUMAN_ONLY'
    WHEN COALESCE((escalation_flags->>'emergency')::boolean, false) THEN 'ESCALATION_REQUIRED'
    ELSE 'AI_ASSISTED'
  END,
  ai_paused = (coordination_mode = 'human_active'),
  ai_escalation_required = COALESCE(
    (escalation_flags->>'emergency')::boolean,
    false
  )
;

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_clinic_ai_mode_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, ai_mode, updated_at DESC);

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.ai_mode IS
  'HUMAN_ONLY | AI_DRAFT | AI_ASSISTED | AI_ACTIVE | ESCALATION_REQUIRED — inquiry-level delegation; clinic policy is ceiling.';
COMMENT ON COLUMN public.ai_coordinator_lead_profiles.ai_paused IS
  'When true, patient-facing auto-replies are paused (coordinator/doctor control).';
COMMENT ON COLUMN public.ai_coordinator_lead_profiles.ai_escalation_required IS
  'When true, AI must not auto-reply; human review required.';
