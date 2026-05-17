-- Archive lifecycle when patient leaves clinic (active roster vs preserved history).

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

COMMENT ON COLUMN public.patients.archived_at IS
  'Set when patient unlinks from clinic; active doctor roster excludes non-null.';

ALTER TABLE public.patient_chat_threads
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

COMMENT ON COLUMN public.patient_chat_threads.lifecycle_status IS
  'active | archived — archived threads are read-only for clinic messaging.';

CREATE INDEX IF NOT EXISTS patient_chat_threads_clinic_active_idx
  ON public.patient_chat_threads (clinic_id, updated_at DESC)
  WHERE lifecycle_status = 'active' AND archived_at IS NULL;
