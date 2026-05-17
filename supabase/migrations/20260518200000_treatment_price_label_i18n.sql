-- Optional multilingual display labels for treatment_prices (AI + patient-facing names).

ALTER TABLE public.treatment_prices
  ADD COLUMN IF NOT EXISTS label_i18n jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.treatment_prices.label_i18n IS
  'Localized treatment display names, e.g. {"en":"Zirconium Crown","tr":"Zirkonyum Kuron","ru":"..."}. Canonical code stays in treatment_code.';

NOTIFY pgrst, 'reload schema';
