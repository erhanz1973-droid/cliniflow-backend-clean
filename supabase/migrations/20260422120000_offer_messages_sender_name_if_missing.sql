-- offer_messages may exist without sender_name if the table was created manually or from an older dump.
ALTER TABLE public.offer_messages ADD COLUMN IF NOT EXISTS sender_name text;

COMMENT ON COLUMN public.offer_messages.sender_name IS 'Display name for offer-thread message (patient or doctor).';
