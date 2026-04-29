-- Canonical city slugs + pending manual input (Cliniflow city normalization)

CREATE TABLE IF NOT EXISTS public.city_catalog (
  code text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.city_catalog (code) VALUES ('tbilisi')
  ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.city_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_input text NOT NULL,
  patient_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'mapped', 'dismissed')),
  mapped_to_code text REFERENCES public.city_catalog (code) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_city_suggestions_status_created
  ON public.city_suggestions (status, created_at DESC);

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS city_code text REFERENCES public.city_catalog (code);

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS pending_city_raw text;

COMMENT ON COLUMN public.clinics.city IS 'Deprecated: free text. Prefer city_code (canonical slug). Mirrored for legacy readers.';
COMMENT ON COLUMN public.clinics.city_code IS 'Canonical city slug from city_catalog (single source of truth for filters).';
COMMENT ON COLUMN public.clinics.pending_city_raw IS 'Unrecognized manual city text; cleared when admin maps to city_code.';
COMMENT ON TABLE public.city_suggestions IS 'Patient-submitted city strings pending admin mapping into city_catalog.';
