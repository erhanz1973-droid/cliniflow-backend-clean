-- Threaded chat per treatment offer (patient ↔ doctor). Used by GET/POST /api/offer-messages.

CREATE TABLE IF NOT EXISTS public.offer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.treatment_offers(id) ON DELETE CASCADE,
  sender_id text,
  sender_role text NOT NULL CHECK (sender_role IN ('patient', 'doctor', 'system')),
  sender_name text,
  text text,
  attachment_url text,
  attachment_type text CHECK (
    attachment_type IS NULL OR attachment_type IN ('image', 'xray', 'document')
  ),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_messages_offer_created_idx
  ON public.offer_messages (offer_id, created_at ASC);

COMMENT ON TABLE public.offer_messages IS 'Per-offer chat between patient and doctor (My Requests / doctor requests).';
