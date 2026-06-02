-- Default invitation campaign codes (Premium 60-day trial)
-- Must run AFTER invitation_codes table migration.
INSERT INTO invitation_codes (code, description, plan, trial_days, max_uses, is_active)
VALUES
  ('WELCOME60', 'Welcome campaign: 60-day Premium trial', 'PREMIUM', 60, NULL, true),
  ('CLINIFLY2026', 'Clinifly 2026 launch campaign', 'PREMIUM', 60, NULL, true),
  ('MEDSMILE60', 'MedSmile partner campaign', 'PREMIUM', 60, NULL, true),
  ('GEORGIA60', 'Georgia regional campaign', 'PREMIUM', 60, NULL, true)
ON CONFLICT (code) DO UPDATE
SET
  description = EXCLUDED.description,
  plan = EXCLUDED.plan,
  trial_days = EXCLUDED.trial_days,
  is_active = EXCLUDED.is_active,
  updated_at = now();
