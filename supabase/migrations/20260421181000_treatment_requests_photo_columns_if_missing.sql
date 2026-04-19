-- Align with API payloads (POST uses column pruning; adding columns allows URL persistence).

ALTER TABLE public.treatment_requests ADD COLUMN IF NOT EXISTS photo_urls jsonb;
ALTER TABLE public.treatment_requests ADD COLUMN IF NOT EXISTS photos jsonb;
ALTER TABLE public.treatment_requests ADD COLUMN IF NOT EXISTS attachment_urls jsonb;
