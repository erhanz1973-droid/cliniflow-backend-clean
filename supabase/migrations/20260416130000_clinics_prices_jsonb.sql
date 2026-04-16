-- Per-clinic treatment price map for AI-driven estimates (GET /api/patient/price-estimate).
-- Example: {"cleaning": 50, "whitening": 120, "implant": 800}

alter table public.clinics
  add column if not exists prices jsonb default '{}'::jsonb;

comment on column public.clinics.prices is 'Map of treatment_key -> numeric price (same keys as AI treatments array).';
