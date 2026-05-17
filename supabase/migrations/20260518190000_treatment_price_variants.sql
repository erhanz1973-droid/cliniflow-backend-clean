-- Brand/material variants for clinic treatment_prices (canonical operational + AI pricing).

CREATE TABLE IF NOT EXISTS public.treatment_price_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_price_id uuid NOT NULL
    REFERENCES public.treatment_prices(id) ON DELETE CASCADE,
  variant_name text,
  brand_name text NOT NULL,
  origin_country text,
  material_type text,
  tier text,
  price_min numeric,
  price_max numeric,
  currency text NOT NULL DEFAULT 'EUR',
  ai_notes text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treatment_price_variants_price_range CHECK (
    price_min IS NULL OR price_max IS NULL OR price_min <= price_max
  ),
  CONSTRAINT treatment_price_variants_brand_nonempty CHECK (btrim(brand_name) <> '')
);

CREATE INDEX IF NOT EXISTS treatment_price_variants_price_idx
  ON public.treatment_price_variants (treatment_price_id, is_active, sort_order ASC, brand_name ASC);

COMMENT ON TABLE public.treatment_price_variants IS
  'Per-brand/material pricing options for a treatment_prices row — used by appointments and AI (non-binding estimates).';

NOTIFY pgrst, 'reload schema';
