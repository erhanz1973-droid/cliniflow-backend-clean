-- Expose public.messages to Supabase Realtime so mobile patient screen receives
-- INSERT events (clinic/doctor → patient direction) via postgres_changes.
--
-- Pattern mirrors 20260423120000_offer_messages_realtime_publication.sql +
--                20260423121500_offer_messages_rls_anon_select.sql.
--
-- RLS note: Supabase Realtime evaluates row-level security using the replica identity.
-- anon/authenticated must have a SELECT policy or events are silently dropped.
-- Tighten the USING clause when Supabase Auth is adopted (e.g. check patient_id = auth.uid()).

-- 1. Add messages to realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- Older/local Postgres without supabase_realtime publication — ignore
    NULL;
END $$;

-- 2. Enable RLS on messages (idempotent — safe to re-run)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 3. SELECT policy: anon + authenticated may read all rows so Realtime delivers events.
DROP POLICY IF EXISTS "dev read messages realtime" ON public.messages;

CREATE POLICY "dev read messages realtime"
  ON public.messages
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON POLICY "dev read messages realtime" ON public.messages IS
  'Allows Supabase Realtime listeners (anon key) to receive INSERT events for clinic→patient messages. Tighten in production.';
