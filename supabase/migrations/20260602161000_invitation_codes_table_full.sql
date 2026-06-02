-- Full bootstrap for invitation_codes table.
-- Run this migration BEFORE any seed inserts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS invitation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  plan text NOT NULL DEFAULT 'PREMIUM',
  trial_days integer NOT NULL DEFAULT 60,
  max_uses integer NULL,
  current_uses integer NOT NULL DEFAULT 0,
  expires_at timestamp NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Idempotent safety for existing partial tables.
ALTER TABLE invitation_codes
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'PREMIUM',
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_uses integer NULL,
  ADD COLUMN IF NOT EXISTS current_uses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at timestamp NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invitation_codes_code_key'
  ) THEN
    ALTER TABLE invitation_codes
      ADD CONSTRAINT invitation_codes_code_key UNIQUE (code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invitation_codes_code
  ON invitation_codes (code);

-- No RLS policy is required for backend service-role usage.
