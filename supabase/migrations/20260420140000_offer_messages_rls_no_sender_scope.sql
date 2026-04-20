-- offer_messages: thread = all rows for offer_id. SELECT policies that restrict rows to
-- sender_id = auth.uid() (or similar) hide the other party's messages.
-- API uses service_role (bypasses RLS); this fixes PostgREST/Realtime/anon clients if misconfigured.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'offer_messages'
      AND cmd = 'SELECT'
      AND policyname IS NOT NULL
      AND lower(coalesce(qual::text, '')) LIKE '%sender_id%'
      AND lower(coalesce(qual::text, '')) LIKE '%auth%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.offer_messages', r.policyname);
    RAISE NOTICE 'Dropped offer_messages SELECT policy (sender-scoped): %', r.policyname;
  END LOOP;
END $$;
