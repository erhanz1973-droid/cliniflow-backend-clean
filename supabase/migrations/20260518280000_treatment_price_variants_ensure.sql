-- Idempotent ensure: treatment_price_variants (admin sync + AI pricing).
-- Safe to re-run if 20260518190000 was skipped or PostgREST cache is stale.

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

ALTER TABLE public.treatment_price_variants
  ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.treatment_price_variants v
SET clinic_id = tp.clinic_id
FROM public.treatment_prices tp
WHERE v.treatment_price_id = tp.id
  AND v.clinic_id IS NULL;

CREATE INDEX IF NOT EXISTS treatment_price_variants_clinic_idx
  ON public.treatment_price_variants (clinic_id, treatment_price_id, is_active, sort_order);

COMMENT ON TABLE public.treatment_price_variants IS
  'Per-brand/material pricing for treatment_prices — admin variant sync + AI coordinator.';

NOTIFY pgrst, 'reload schema';
