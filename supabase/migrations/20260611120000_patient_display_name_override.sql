-- Manual display name override for leads/patients (Messenger User, etc.)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS external_name text,
  ADD COLUMN IF NOT EXISTS display_name_override text;

COMMENT ON COLUMN public.patients.external_name IS
  'Original name from channel/source (Messenger, WhatsApp, app). Preserved for audit; not replaced by admin override.';

COMMENT ON COLUMN public.patients.display_name_override IS
  'Clinic admin manual display name. When set, shown in inbox, lists, chat, and coordination center.';

CREATE INDEX IF NOT EXISTS patients_clinic_display_override_idx
  ON public.patients (clinic_id)
  WHERE display_name_override IS NOT NULL;

-- Backfill external_name from current name or channel identity
UPDATE public.patients p
SET external_name = NULLIF(trim(p.name), '')
WHERE p.external_name IS NULL
  AND p.name IS NOT NULL
  AND length(trim(p.name)) > 0;

UPDATE public.patients p
SET external_name = ci.display_name,
    updated_at = NOW()
FROM public.channel_identities ci
WHERE ci.patient_id = p.id
  AND (p.external_name IS NULL OR length(trim(p.external_name)) = 0)
  AND ci.display_name IS NOT NULL
  AND length(trim(ci.display_name)) > 0;
