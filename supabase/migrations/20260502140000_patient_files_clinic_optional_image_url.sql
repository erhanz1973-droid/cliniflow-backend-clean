-- Intraoral / AI uploads: patients may not have selected a clinic yet.
ALTER TABLE public.patient_files
  ALTER COLUMN clinic_id DROP NOT NULL;

-- Optional stable image URL column (mirrors file_url for image rows when set by API).
ALTER TABLE public.patient_files
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.patient_files.image_url IS 'Image URL (often same as file_url); set for AI/storage-backed uploads';

-- API uses SUPABASE_SERVICE_ROLE_KEY server-side (bypasses RLS). Direct client inserts need matching RLS policies.
