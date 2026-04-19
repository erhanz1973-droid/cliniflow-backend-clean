-- Prod may have created offer_messages before read_at existed, or table was created manually without this column.

ALTER TABLE public.offer_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

COMMENT ON COLUMN public.offer_messages.read_at IS 'When the other party last marked messages as read (optional).';
