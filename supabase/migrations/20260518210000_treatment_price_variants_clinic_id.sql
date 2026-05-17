-- Denormalize clinic_id on treatment_price_variants for clinic-scoped queries and AI indexes.

ALTER TABLE public.treatment_price_variants
  ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.treatment_price_variants v
SET clinic_id = tp.clinic_id
FROM public.treatment_prices tp
WHERE v.treatment_price_id = tp.id
  AND v.clinic_id IS NULL;

CREATE INDEX IF NOT EXISTS treatment_price_variants_clinic_idx
  ON public.treatment_price_variants (clinic_id, treatment_price_id, is_active, sort_order);

NOTIFY pgrst, 'reload schema';
