-- Super-admin controlled clinic subscription fields
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_starts_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_clinics_subscription_status
  ON clinics (subscription_status);

CREATE INDEX IF NOT EXISTS idx_clinics_trial_ends_at
  ON clinics (trial_ends_at);
