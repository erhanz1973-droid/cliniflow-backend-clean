-- One push per recipient × message × notification type (prevents duplicate Expo deliveries).

CREATE TABLE IF NOT EXISTS public.chat_push_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL,
  message_row_id text NOT NULL,
  recipient_kind text,
  recipient_id uuid,
  notification_type text NOT NULL DEFAULT 'chat_message',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_push_dispatches_dedupe_key_uidx
  ON public.chat_push_dispatches (dedupe_key);

CREATE INDEX IF NOT EXISTS chat_push_dispatches_message_row_id_idx
  ON public.chat_push_dispatches (message_row_id);

CREATE INDEX IF NOT EXISTS chat_push_dispatches_created_at_idx
  ON public.chat_push_dispatches (created_at DESC);

-- Legacy installs: table existed with only message_row_id unique
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chat_push_dispatches'
  ) THEN
    ALTER TABLE public.chat_push_dispatches ADD COLUMN IF NOT EXISTS dedupe_key text;
    ALTER TABLE public.chat_push_dispatches ADD COLUMN IF NOT EXISTS recipient_kind text;
    ALTER TABLE public.chat_push_dispatches ADD COLUMN IF NOT EXISTS recipient_id uuid;
    ALTER TABLE public.chat_push_dispatches ADD COLUMN IF NOT EXISTS notification_type text DEFAULT 'chat_message';
    UPDATE public.chat_push_dispatches
    SET dedupe_key = COALESCE(dedupe_key, 'legacy:' || message_row_id)
    WHERE dedupe_key IS NULL OR dedupe_key = '';
    ALTER TABLE public.chat_push_dispatches ALTER COLUMN dedupe_key SET NOT NULL;
  END IF;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;
