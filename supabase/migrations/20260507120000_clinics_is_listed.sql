-- Public discovery: only clinics with is_listed = true appear on GET /api/discovery/clinics.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS is_listed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clinics.is_listed IS 'When true, clinic may appear on public discovery; set false to hide from directory.';
