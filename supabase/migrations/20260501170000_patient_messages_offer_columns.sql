-- Add offer_id and offer_message_id columns to patient_messages so that
-- the offer-mirror insert does not require column-pruning retries.
-- These columns are optional (nullable) and only populated when a doctor
-- sends a message inside an offer thread.

ALTER TABLE public.patient_messages
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.treatment_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_message_id uuid REFERENCES public.offer_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS patient_messages_offer_id_idx
  ON public.patient_messages (offer_id)
  WHERE offer_id IS NOT NULL;

COMMENT ON COLUMN public.patient_messages.offer_id IS
  'Populated when this record mirrors a doctor message sent inside an offer thread.';
COMMENT ON COLUMN public.patient_messages.offer_message_id IS
  'FK to the source offer_messages row that was mirrored here.';
