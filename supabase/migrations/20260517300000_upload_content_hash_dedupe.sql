-- Idempotent AI dental uploads: dedupe by content hash per patient.

ALTER TABLE public.patient_files
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS patient_files_patient_content_hash_idx
  ON public.patient_files (patient_id, content_hash, created_at DESC)
  WHERE content_hash IS NOT NULL AND source = 'ai_upload';

COMMENT ON COLUMN public.patient_files.content_hash IS
  'SHA-256 hex of file bytes — prevents duplicate ai-upload storage for the same image.';
