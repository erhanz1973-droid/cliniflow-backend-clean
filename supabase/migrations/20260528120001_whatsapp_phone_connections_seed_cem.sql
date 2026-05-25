-- CEM Clinic WhatsApp production mapping (replaces prior seed clinic if present).

INSERT INTO public.whatsapp_phone_connections (
  clinic_id,
  phone_number_id,
  display_name,
  status,
  waba_id,
  connected_by,
  updated_at
)
VALUES (
  '298a1b77-3257-4c43-8262-e1809b531634'::uuid,
  '1123564784177382',
  'CEM Clinic WhatsApp',
  'active',
  NULL,
  'migration_seed',
  now()
)
ON CONFLICT (phone_number_id) DO UPDATE SET
  clinic_id = EXCLUDED.clinic_id,
  display_name = COALESCE(EXCLUDED.display_name, whatsapp_phone_connections.display_name),
  status = 'active',
  connected_by = EXCLUDED.connected_by,
  updated_at = now();
