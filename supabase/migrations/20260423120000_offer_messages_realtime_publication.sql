-- Expose offer_messages to Supabase Realtime (INSERT postgres_changes in mobile app).
-- Idempotent: skip if already in supabase_realtime publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'offer_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.offer_messages;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- Older/local Postgres without supabase_realtime — ignore
    NULL;
END $$;
