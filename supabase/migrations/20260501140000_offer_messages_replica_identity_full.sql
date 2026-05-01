-- offer_messages: set REPLICA IDENTITY FULL so Supabase Realtime column filters work
-- (offer_id=eq.{uuid} filter requires offer_id to be in the replica identity)
ALTER TABLE public.offer_messages REPLICA IDENTITY FULL;
