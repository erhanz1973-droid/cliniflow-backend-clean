-- Unified chat: persist canonical thread on patient_messages (and messages fallback).
-- Without these columns, insertIntoTableWithColumnPruning drops thread_id and doctor merge breaks.

ALTER TABLE public.patient_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.patient_chat_threads(id) ON DELETE SET NULL;

ALTER TABLE public.patient_messages
  ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.patient_chat_threads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_messages_thread_created
  ON public.patient_messages (thread_id, created_at ASC)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_messages_patient_thread
  ON public.patient_messages (patient_id, thread_id)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON public.messages (thread_id, created_at ASC)
  WHERE thread_id IS NOT NULL;

COMMENT ON COLUMN public.patient_messages.thread_id IS
  'Canonical patient_chat_threads.id for doctor inbox merge and socket room.';

-- Backfill: prefer assigned operational thread per patient.
UPDATE public.patient_messages pm
SET
  thread_id = pct.id,
  clinic_id = COALESCE(pm.clinic_id, pct.clinic_id)
FROM (
  SELECT DISTINCT ON (patient_id)
    patient_id,
    id,
    clinic_id
  FROM public.patient_chat_threads
  ORDER BY
    patient_id,
    (assigned_doctor_id IS NOT NULL) DESC,
    updated_at DESC
) pct
WHERE pm.patient_id = pct.patient_id
  AND pm.thread_id IS NULL;

UPDATE public.messages m
SET thread_id = pct.id
FROM (
  SELECT DISTINCT ON (patient_id)
    patient_id,
    id
  FROM public.patient_chat_threads
  ORDER BY
    patient_id,
    (assigned_doctor_id IS NOT NULL) DESC,
    updated_at DESC
) pct
WHERE m.patient_id = pct.patient_id
  AND m.thread_id IS NULL;
