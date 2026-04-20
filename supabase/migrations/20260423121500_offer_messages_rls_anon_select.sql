-- Realtime postgres_changes requires the replica role to evaluate rows; with RLS enabled,
-- anon/authenticated need a SELECT policy or no events are delivered to clients using the anon key.
--
-- Tighten this policy in production (e.g. restrict by offer_id / JWT claims) when you add Supabase Auth.

ALTER TABLE public.offer_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev read offer messages" ON public.offer_messages;

CREATE POLICY "dev read offer messages"
  ON public.offer_messages
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON POLICY "dev read offer messages" ON public.offer_messages IS
  'Allows Realtime listeners (anon) to receive INSERT replication events; replace with stricter rules in production.';
