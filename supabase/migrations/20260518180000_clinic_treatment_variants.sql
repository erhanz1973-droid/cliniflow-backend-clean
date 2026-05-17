-- Brand / material pricing variants per treatment catalog item (dental tourism).

CREATE TABLE IF NOT EXISTS public.clinic_treatment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_catalog_id uuid NOT NULL
    REFERENCES public.clinic_treatment_catalog(id) ON DELETE CASCADE,
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
  CONSTRAINT clinic_treatment_variants_price_range CHECK (
    price_min IS NULL OR price_max IS NULL OR price_min <= price_max
  ),
  CONSTRAINT clinic_treatment_variants_brand_nonempty CHECK (btrim(brand_name) <> '')
);

CREATE INDEX IF NOT EXISTS clinic_treatment_variants_catalog_idx
  ON public.clinic_treatment_variants (treatment_catalog_id, is_active, sort_order ASC, brand_name ASC);

CREATE INDEX IF NOT EXISTS clinic_treatment_variants_catalog_default_idx
  ON public.clinic_treatment_variants (treatment_catalog_id)
  WHERE is_default = true;

COMMENT ON TABLE public.clinic_treatment_variants IS
  'Brand/material-specific price ranges for a catalog treatment — AI uses “typically from” language, not guarantees.';

COMMENT ON COLUMN public.clinic_treatment_variants.brand_name IS
  'Implant or material brand (e.g. Straumann, Megagen, Katana).';

COMMENT ON COLUMN public.clinic_treatment_variants.tier IS
  'Segment: premium, standard, mid_range, budget — for AI comparisons.';

COMMENT ON COLUMN public.clinic_treatment_variants.is_default IS
  'Default option when patient does not specify a brand preference.';

NOTIFY pgrst, 'reload schema';
