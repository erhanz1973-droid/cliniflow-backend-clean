-- Clinic Operations Profile v2 — idempotent; safe on fresh / partial / production DBs.
-- Does not assume 20260517160000 (travel) or 20260518130000 (ai settings) already ran.

-- ─── clinic_ai_settings (bootstrap + v2 columns) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinic_ai_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  autonomy_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  knowledge_base_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS materials_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logistics_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_policy_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS internal_notes_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE public.clinic_ai_settings IS
  'Clinic Operations AI Profile — autonomy, SLA, knowledge, safety. Read by AI orchestration.';

COMMENT ON COLUMN public.clinic_ai_settings.materials_config IS
  'Implant brands, zirconium types, lab partners, warranty, sedation.';

COMMENT ON COLUMN public.clinic_ai_settings.logistics_config IS
  'Working hours, weekend, emergency contact, SLA, same-day treatment.';

COMMENT ON COLUMN public.clinic_ai_settings.payment_policy_config IS
  'Deposits, installments, currencies, financing, refund policy.';

COMMENT ON COLUMN public.clinic_ai_settings.internal_notes_config IS
  'Freeform clinic positioning notes for AI (not patient-facing guarantees).';

CREATE INDEX IF NOT EXISTS clinic_ai_settings_updated_idx
  ON public.clinic_ai_settings (updated_at DESC);

-- ─── clinic_treatment_catalog ──────────────────────────────────────────────────
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

-- ─── clinic_partner_hotels (bootstrap + full extension) ─────────────────────────
-- Minimal bootstrap when travel migration never ran. Column "name" = hotel display name.
CREATE TABLE IF NOT EXISTS public.clinic_partner_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  distance_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy alias: if an old stub used hotel_name only, backfill name once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clinic_partner_hotels' AND column_name = 'hotel_name'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clinic_partner_hotels' AND column_name = 'name'
  ) THEN
    EXECUTE $q$
      UPDATE public.clinic_partner_hotels
      SET name = hotel_name
      WHERE (name IS NULL OR btrim(name) = '') AND hotel_name IS NOT NULL
    $q$;
  END IF;
END $$;

-- App + travel UI columns (from 20260517160000), added only if missing.
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS maps_url text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS price_range text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS distance_minutes integer;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS breakfast_included boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS clinic_discount_notes text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS booking_url text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS supported_languages text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Ops profile v2 + user-requested travel fields.
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS price_per_night numeric;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS vip_transfer boolean DEFAULT false;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS currency text DEFAULT 'EUR';
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS transfer_included boolean DEFAULT false;

-- Ensure NOT NULL defaults where safe (no-op if already constrained).
ALTER TABLE public.clinic_partner_hotels
  ALTER COLUMN vip_transfer SET DEFAULT false;

ALTER TABLE public.clinic_partner_hotels
  ALTER COLUMN transfer_included SET DEFAULT false;

ALTER TABLE public.clinic_partner_hotels
  ALTER COLUMN currency SET DEFAULT 'EUR';

-- Distance constraint (ignore if already present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_partner_hotels_distance_nonneg'
  ) THEN
    ALTER TABLE public.clinic_partner_hotels
      ADD CONSTRAINT clinic_partner_hotels_distance_nonneg CHECK (
        distance_minutes IS NULL OR distance_minutes >= 0
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clinic_partner_hotels_clinic_idx
  ON public.clinic_partner_hotels (clinic_id);

CREATE INDEX IF NOT EXISTS clinic_partner_hotels_clinic_active_idx
  ON public.clinic_partner_hotels (
    clinic_id,
    is_active,
    is_preferred DESC,
    sort_order ASC,
    distance_minutes ASC NULLS LAST
  );

COMMENT ON TABLE public.clinic_partner_hotels IS
  'Clinic-curated partner hotels for AI medical travel coordinator recommendations.';

COMMENT ON COLUMN public.clinic_partner_hotels.name IS
  'Hotel display name (e.g. Grand Vita Hotel).';

COMMENT ON COLUMN public.clinic_partner_hotels.distance_label IS
  'Human-readable distance label when distance_minutes is unknown (e.g. 5 min walk).';

COMMENT ON COLUMN public.clinic_partner_hotels.price_per_night IS
  'Typical nightly rate for AI travel replies.';

COMMENT ON COLUMN public.clinic_partner_hotels.currency IS
  'Currency for price_per_night (default EUR).';
