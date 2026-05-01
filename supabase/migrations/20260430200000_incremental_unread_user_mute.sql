-- Incremental chat unread buckets (cheap badge on push paths; synced from merge counts on GET unread endpoints).
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS chat_unread_from_clinic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS chat_unread_from_patients INTEGER NOT NULL DEFAULT 0;

-- Global mute preference for this user identity (suppresses outbound Expo for all tokens on that user).
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN patients.notifications_muted IS 'When true: skip Expo delivery for chat (per user). message_sound stays per-device (push_tokens).';
COMMENT ON COLUMN patients.chat_unread_from_clinic IS 'Bumped when clinic sends message; synced from merged tally on unread-count GET.';

-- Atomic increments (avoid read-modify-write races from concurrent messages)
CREATE OR REPLACE FUNCTION increment_patient_clinic_unread(pid UUID)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE patients
  SET chat_unread_from_clinic = LEAST(999999, COALESCE(chat_unread_from_clinic, 0) + 1)
  WHERE id = pid;
$$;

CREATE OR REPLACE FUNCTION increment_doctor_patients_unread(did UUID)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE doctors
  SET chat_unread_from_patients = LEAST(999999, COALESCE(chat_unread_from_patients, 0) + 1)
  WHERE id = did;
$$;
