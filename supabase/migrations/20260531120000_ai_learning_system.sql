-- AI Learning System — candidates require admin approval before entering knowledge_base_config.

CREATE TABLE IF NOT EXISTS public.ai_learning_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  candidate_type text NOT NULL,
  value text NOT NULL,
  meaning text,
  confidence numeric(5, 4),
  occurrence_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  source_profile_id uuid REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE SET NULL,
  source_channel text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  rejection_reason text,
  CONSTRAINT ai_learning_candidates_type_check CHECK (
    candidate_type IN (
      'greeting',
      'faq',
      'phrase',
      'failed_reply',
      'user_correction',
      'dissatisfaction'
    )
  ),
  CONSTRAINT ai_learning_candidates_status_check CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT ai_learning_candidates_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

COMMENT ON TABLE public.ai_learning_candidates IS
  'AI-detected conversation patterns awaiting admin review. Never auto-applied to booking/calendar/pricing rules.';

CREATE INDEX IF NOT EXISTS ai_learning_candidates_clinic_status_idx
  ON public.ai_learning_candidates (clinic_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS ai_learning_candidates_type_idx
  ON public.ai_learning_candidates (clinic_id, candidate_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS ai_learning_candidates_pending_dedup_idx
  ON public.ai_learning_candidates (
    clinic_id,
    candidate_type,
    lower(trim(value))
  )
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.ai_learning_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.ai_learning_candidates(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_admin_id uuid,
  actor_role text NOT NULL DEFAULT 'admin',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_learning_audit_action_check CHECK (
    action IN (
      'analyze_detect',
      'analyze_skip',
      'approve',
      'reject',
      'apply_knowledge',
      'increment_count'
    )
  )
);

COMMENT ON TABLE public.ai_learning_audit_logs IS
  'Immutable audit trail for AI learning candidate lifecycle.';

CREATE INDEX IF NOT EXISTS ai_learning_audit_logs_clinic_created_idx
  ON public.ai_learning_audit_logs (clinic_id, created_at DESC);
