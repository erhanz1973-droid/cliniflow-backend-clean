-- Expose public.patient_messages to Supabase Realtime.
-- Patient messages (from_role='patient') are inserted here; the doctor screen
-- subscribes via Socket.IO but the patient screen (when Supabase is configured)
-- may also benefit from watching this table for inbound clinic replies.
--
-- Also needed for the thread_id fallback in emitRealtimeChatMessageToThread:
-- even without Socket.IO, Supabase Realtime can deliver events to both sides.

-- 1. Add patient_messages to realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'patient_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_messages;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

-- 2. Enable RLS (idempotent)
ALTER TABLE public.patient_messages ENABLE ROW LEVEL SECURITY;

-- 3. SELECT policy for Realtime delivery
DROP POLICY IF EXISTS "dev read patient_messages realtime" ON public.patient_messages;

CREATE POLICY "dev read patient_messages realtime"
  ON public.patient_messages
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON POLICY "dev read patient_messages realtime" ON public.patient_messages IS
  'Allows Supabase Realtime listeners (anon key) to receive INSERT events. Tighten in production.';
