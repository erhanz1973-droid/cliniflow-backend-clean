-- Repair partial apply of 20260518150000 (safe to run even if v2 fully applied).
-- Typical failure: COMMENT ON distance_label when column missing on pre-existing hotels table.

ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS materials_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS logistics_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS payment_policy_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS internal_notes_config jsonb NOT NULL DEFAULT '{}'::jsonb;

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
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS distance_label text;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS price_per_night numeric;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS vip_transfer boolean DEFAULT false;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS currency text DEFAULT 'EUR';
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS transfer_included boolean DEFAULT false;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.clinic_partner_hotels ADD COLUMN IF NOT EXISTS distance_minutes integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'clinic_partner_hotels_clinic_active_idx'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clinic_partner_hotels'
      AND column_name = 'is_active'
  ) THEN
    EXECUTE $q$
      CREATE INDEX clinic_partner_hotels_clinic_active_idx
      ON public.clinic_partner_hotels (
        clinic_id,
        is_active,
        is_preferred DESC,
        sort_order ASC,
        distance_minutes ASC NULLS LAST
      )
    $q$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
