-- Marketplace: leads → lead_clinics fan-out → offers

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  treatments jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  photo_url text,
  xray_url text,
  image_url text,
  country text,
  city text,
  patient_lat double precision,
  patient_lng double precision,
  price_estimate text,
  is_high_value boolean NOT NULL DEFAULT false,
  source text DEFAULT 'ai_result_offer',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS xray_url text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS patient_lat double precision;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS patient_lng double precision;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS price_estimate text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_high_value boolean;
UPDATE public.leads SET is_high_value = coalesce(is_high_value, false);
ALTER TABLE public.leads ALTER COLUMN is_high_value SET DEFAULT false;

COMMENT ON TABLE public.leads IS 'Patient marketplace lead; distributed via lead_clinics.';

CREATE INDEX IF NOT EXISTS leads_patient_id_idx ON public.leads (patient_id);
CREATE INDEX IF NOT EXISTS leads_country_created_idx ON public.leads (country, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_clinics_status_chk CHECK (status IN ('pending', 'viewed', 'offered', 'dismissed')),
  CONSTRAINT lead_clinics_lead_clinic_unique UNIQUE (lead_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS lead_clinics_clinic_idx ON public.lead_clinics (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_clinics_lead_idx ON public.lead_clinics (lead_id);

CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  price numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_lead_clinic_unique UNIQUE (lead_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS offers_lead_idx ON public.offers (lead_id);
CREATE INDEX IF NOT EXISTS offers_clinic_idx ON public.offers (clinic_id);
