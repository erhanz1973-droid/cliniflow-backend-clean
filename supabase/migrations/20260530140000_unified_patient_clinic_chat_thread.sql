-- Unified conversation: one thread per (patient_id, clinic_id).
-- patient_chat_threads is the canonical chat_threads table; treatment_requests and offer_messages link to it.

-- ── Thread metadata (patient_chat_threads = chat_threads) ─────────────────────
ALTER TABLE public.patient_chat_threads
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

COMMENT ON TABLE public.patient_chat_threads IS
  'Canonical chat_threads: one persistent conversation per patient+clinic (UNIQUE patient_id, clinic_id).';

COMMENT ON COLUMN public.patient_chat_threads.last_message_at IS
  'Updated when a message is sent in offer_messages / patient_messages for this thread.';

CREATE INDEX IF NOT EXISTS patient_chat_threads_clinic_last_message_idx
  ON public.patient_chat_threads (clinic_id, last_message_at DESC NULLS LAST);

-- Compatibility view (optional name for docs / future clients)
CREATE OR REPLACE VIEW public.chat_threads AS
SELECT
  id,
  patient_id,
  clinic_id,
  status,
  assigned_doctor_id,
  assigned_at,
  is_lead,
  last_message_at,
  created_at,
  updated_at
FROM public.patient_chat_threads;

COMMENT ON VIEW public.chat_threads IS
  'Alias for patient_chat_threads — one row per patient+clinic pair.';

-- ── treatment_requests → thread ─────────────────────────────────────────────
ALTER TABLE public.treatment_requests
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.patient_chat_threads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_requests_thread_id
  ON public.treatment_requests (thread_id)
  WHERE thread_id IS NOT NULL;

COMMENT ON COLUMN public.treatment_requests.thread_id IS
  'Persistent patient+clinic conversation; multiple requests share one thread.';

-- ── offer_messages → thread + optional request context ──────────────────────
ALTER TABLE public.offer_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.patient_chat_threads(id) ON DELETE SET NULL;

ALTER TABLE public.offer_messages
  ADD COLUMN IF NOT EXISTS treatment_request_id uuid REFERENCES public.treatment_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS offer_messages_thread_created_idx
  ON public.offer_messages (thread_id, created_at ASC)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS offer_messages_treatment_request_idx
  ON public.offer_messages (treatment_request_id, created_at DESC)
  WHERE treatment_request_id IS NOT NULL;

COMMENT ON COLUMN public.offer_messages.thread_id IS
  'Denormalized from patient_chat_threads for unified inbox / history queries.';

COMMENT ON COLUMN public.offer_messages.treatment_request_id IS
  'Optional UI grouping (implant vs veneers request) within the same thread.';

-- ── Backfill thread_id on treatment_requests ────────────────────────────────
INSERT INTO public.patient_chat_threads (patient_id, clinic_id, status, is_lead, created_at, updated_at)
SELECT DISTINCT tr.patient_id, tr.clinic_id, 'unassigned', true, now(), now()
FROM public.treatment_requests tr
WHERE tr.patient_id IS NOT NULL
  AND tr.clinic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.patient_chat_threads pct
    WHERE pct.patient_id = tr.patient_id
      AND pct.clinic_id = tr.clinic_id
  )
ON CONFLICT (patient_id, clinic_id) DO NOTHING;

UPDATE public.treatment_requests tr
SET thread_id = pct.id
FROM public.patient_chat_threads pct
WHERE tr.thread_id IS NULL
  AND tr.patient_id = pct.patient_id
  AND tr.clinic_id = pct.clinic_id;

-- ── Backfill offer_messages.thread_id from offer → request → thread ─────────
UPDATE public.offer_messages om
SET
  thread_id = tr.thread_id,
  treatment_request_id = COALESCE(om.treatment_request_id, tr.id)
FROM public.treatment_offers o
INNER JOIN public.treatment_requests tr ON tr.id = o.request_id
WHERE om.offer_id = o.id
  AND om.thread_id IS NULL
  AND tr.thread_id IS NOT NULL;

-- ── Backfill last_message_at on threads ─────────────────────────────────────
UPDATE public.patient_chat_threads pct
SET last_message_at = sub.max_at
FROM (
  SELECT thread_id, max(created_at) AS max_at
  FROM public.offer_messages
  WHERE thread_id IS NOT NULL
  GROUP BY thread_id
) sub
WHERE pct.id = sub.thread_id
  AND (pct.last_message_at IS NULL OR pct.last_message_at < sub.max_at);

-- ── RLS (direct Supabase client access; Railway API uses service role) ───────
ALTER TABLE public.patient_chat_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_chat_threads_service_all ON public.patient_chat_threads;
CREATE POLICY patient_chat_threads_service_all ON public.patient_chat_threads
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS patient_chat_threads_patient_read ON public.patient_chat_threads;
CREATE POLICY patient_chat_threads_patient_read ON public.patient_chat_threads
  FOR SELECT
  USING (patient_id = auth.uid());

ALTER TABLE public.offer_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offer_messages_service_all ON public.offer_messages;
CREATE POLICY offer_messages_service_all ON public.offer_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS offer_messages_thread_patient_read ON public.offer_messages;
CREATE POLICY offer_messages_thread_patient_read ON public.offer_messages
  FOR SELECT
  USING (
    thread_id IN (
      SELECT id FROM public.patient_chat_threads WHERE patient_id = auth.uid()
    )
  );
