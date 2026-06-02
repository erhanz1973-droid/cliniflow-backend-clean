-- Clinic invitation codes for premium trial campaigns
CREATE TABLE IF NOT EXISTS invitation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  plan text NOT NULL DEFAULT 'PREMIUM',
  trial_days integer NOT NULL DEFAULT 60 CHECK (trial_days >= 0 AND trial_days <= 3650),
  max_uses integer CHECK (max_uses IS NULL OR max_uses >= 0),
  current_uses integer NOT NULL DEFAULT 0 CHECK (current_uses >= 0),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS redeemed_invitation_code text,
  ADD COLUMN IF NOT EXISTS invitation_redeemed_at timestamptz;

CREATE TABLE IF NOT EXISTS invitation_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_code_id uuid NOT NULL REFERENCES invitation_codes(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code text NOT NULL,
  plan text NOT NULL,
  trial_days integer NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL,
  UNIQUE (clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes (code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_active ON invitation_codes (is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_code_id ON invitation_code_redemptions (invitation_code_id);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_clinic_id ON invitation_code_redemptions (clinic_id);
