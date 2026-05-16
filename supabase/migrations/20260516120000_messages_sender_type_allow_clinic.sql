-- insertMessageToSupabase sets sender_type = 'clinic' for non-patient outbound rows.
-- Legacy CHECK only allowed patient/admin/doctor → 23514 on clinic attachment sends.

ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_sender_type_check;

ALTER TABLE public.messages
ADD CONSTRAINT messages_sender_type_check
CHECK (
  sender_type IN (
    'patient',
    'PATIENT',
    'doctor',
    'DOCTOR',
    'clinic',
    'CLINIC',
    'admin',
    'ADMIN'
  )
);
