-- Plain-text fallback for doctor spoken languages (mobile profile + AI completeness)
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS languages TEXT;
