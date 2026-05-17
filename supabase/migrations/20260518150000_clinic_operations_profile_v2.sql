-- Clinic Operations Profile v2 — structured knowledge for AI orchestration.

-- Extend settings row with modular JSON sections.
ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS materials_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logistics_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_policy_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS internal_notes_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clinic_ai_settings.materials_config IS
  'Implant brands, zirconium types, lab partners, warranty, sedation.';

COMMENT ON COLUMN public.clinic_ai_settings.logistics_config IS
  'Working hours, weekend, emergency contact, SLA, same-day treatment.';

COMMENT ON COLUMN public.clinic_ai_settings.payment_policy_config IS
  'Deposits, installments, currencies, financing, refund policy.';

COMMENT ON COLUMN public.clinic_ai_settings.internal_notes_config IS
  'Freeform clinic positioning notes for AI (not patient-facing guarantees).';

-- Treatment & pricing catalog (ranges for AI — not exact quotes).
CREATE TABLE IF NOT EXISTS public.clinic_treatment_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  price_min numeric,
  price_max numeric,
  currency text NOT NULL DEFAULT 'EUR',
  duration_label text,
  visit_count integer,
  included_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_notes text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_treatment_catalog_price_range CHECK (
    price_min IS NULL OR price_max IS NULL OR price_min <= price_max
  ),
  CONSTRAINT clinic_treatment_catalog_visit_nonneg CHECK (
    visit_count IS NULL OR visit_count >= 1
  )
);

CREATE INDEX IF NOT EXISTS clinic_treatment_catalog_clinic_active_idx
  ON public.clinic_treatment_catalog (clinic_id, is_active, sort_order ASC, name ASC);

COMMENT ON TABLE public.clinic_treatment_catalog IS
  'Structured treatment + pricing ranges for AI offers and patient Q&A (not binding quotes).';

-- Travel: nightly price for AI coordination copy.
ALTER TABLE public.clinic_partner_hotels
  ADD COLUMN IF NOT EXISTS price_per_night numeric,
  ADD COLUMN IF NOT EXISTS vip_transfer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clinic_partner_hotels.price_per_night IS
  'Typical nightly rate for AI travel replies (clinic currency or EUR).';
