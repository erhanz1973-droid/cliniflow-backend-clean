-- Add price_text as a free-form text field (replaces price_range validation logic).
-- price_range is kept for backward compatibility with existing data.
ALTER TABLE public.treatment_offers
  ADD COLUMN IF NOT EXISTS price_text text;

-- Migrate existing price_range values into price_text
UPDATE public.treatment_offers
  SET price_text = price_range
  WHERE price_text IS NULL AND price_range IS NOT NULL;

COMMENT ON COLUMN public.treatment_offers.price_text IS
  'Free-form price text entered by doctor (e.g. "5000-7000 TL" or "muayene sonrası netleşir").';
