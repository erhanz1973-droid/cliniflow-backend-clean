-- Repair partial invitation_codes deploy: redemption table + clinics columns.
-- Safe to re-run (IF NOT EXISTS / idempotent).

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS redeemed_invitation_code text,
  ADD COLUMN IF NOT EXISTS invitation_redeemed_at timestamptz;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_starts_at timestamptz;

CREATE TABLE IF NOT EXISTS public.invitation_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_code_id uuid NOT NULL REFERENCES public.invitation_codes(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL,
  plan text NOT NULL,
  trial_days integer NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL,
  UNIQUE (clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_code_id
  ON public.invitation_code_redemptions (invitation_code_id);

CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_clinic_id
  ON public.invitation_code_redemptions (clinic_id);

CREATE INDEX IF NOT EXISTS idx_clinics_subscription_status
  ON public.clinics (subscription_status);

CREATE INDEX IF NOT EXISTS idx_clinics_trial_ends_at
  ON public.clinics (trial_ends_at);

-- Common typo alias: CLINIFLY2016 → same 60-day Premium trial as CLINIFLY2026
INSERT INTO public.invitation_codes (code, description, plan, trial_days, max_uses, is_active)
VALUES
  ('CLINIFLY2016', 'Clinifly launch campaign (2016 typo alias)', 'PREMIUM', 60, NULL, true)
ON CONFLICT (code) DO UPDATE
SET
  description = EXCLUDED.description,
  plan = EXCLUDED.plan,
  trial_days = EXCLUDED.trial_days,
  is_active = EXCLUDED.is_active,
  updated_at = now();
