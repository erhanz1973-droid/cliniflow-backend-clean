-- offer_messages: real chat rows per treatment offer thread.
-- API reads/writes via service role; list scope is offer_id only.

CREATE TABLE IF NOT EXISTS public.offer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL,
  sender_id text NOT NULL DEFAULT '',
  sender_role text NOT NULL DEFAULT 'patient',
  sender_name text,
  text text,
  attachment_url text,
  attachment_type text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_messages_offer_id_created_at_idx
  ON public.offer_messages (offer_id, created_at ASC);

COMMENT ON TABLE public.offer_messages IS 'Per-offer chat; GET /api/offer-messages loads by offer_id only.';
