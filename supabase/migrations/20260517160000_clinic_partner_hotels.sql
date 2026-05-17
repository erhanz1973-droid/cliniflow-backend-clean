-- Partner hotels for dental tourism / AI travel coordinator context.
-- Future: clinic_partner_transfers, clinic_partner_translators, clinic_partner_apartments (not created yet).

CREATE TABLE IF NOT EXISTS public.clinic_partner_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  maps_url text,
  address text,
  price_range text,
  distance_minutes integer,
  transfer_included boolean NOT NULL DEFAULT false,
  breakfast_included boolean NOT NULL DEFAULT false,
  clinic_discount_notes text,
  booking_url text,
  supported_languages text,
  notes text,
  is_preferred boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_partner_hotels_distance_nonneg CHECK (
    distance_minutes IS NULL OR distance_minutes >= 0
  )
);

CREATE INDEX IF NOT EXISTS clinic_partner_hotels_clinic_active_idx
  ON public.clinic_partner_hotels (clinic_id, is_active, is_preferred DESC, sort_order ASC, distance_minutes ASC NULLS LAST);

COMMENT ON TABLE public.clinic_partner_hotels IS
  'Clinic-curated partner hotels for AI medical travel coordinator recommendations.';

COMMENT ON COLUMN public.clinic_partner_hotels.supported_languages IS
  'Comma-separated language codes or names (e.g. en,tr,ru).';
