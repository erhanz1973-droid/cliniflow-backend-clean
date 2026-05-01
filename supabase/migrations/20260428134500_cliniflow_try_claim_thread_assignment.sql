-- Atomic conditional claim for inbound auto-assignment (race-safe at DB row level).
-- Returns true if one row was updated (was unassigned), false if no row matched (already assigned or missing).

CREATE OR REPLACE FUNCTION public.cliniflow_try_claim_thread_assignment(
  p_thread_id uuid,
  p_doctor_id uuid,
  p_assigned_at timestamptz,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.patient_chat_threads
  SET
    status = 'assigned'::text,
    assigned_doctor_id = p_doctor_id,
    assigned_at = p_assigned_at,
    updated_at = COALESCE(p_updated_at, p_assigned_at)
  WHERE id = p_thread_id
    AND assigned_doctor_id IS NULL;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.cliniflow_try_claim_thread_assignment(uuid, uuid, timestamptz, timestamptz) IS
  'Sets lead thread doctor only when still unassigned; avoids lost updates under concurrent assigns.';

REVOKE ALL ON FUNCTION public.cliniflow_try_claim_thread_assignment(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliniflow_try_claim_thread_assignment(uuid, uuid, timestamptz, timestamptz) TO service_role;
