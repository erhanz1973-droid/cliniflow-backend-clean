-- Super Admin clinic impersonation: sessions + audit log.

CREATE TABLE IF NOT EXISTS public.super_admin_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonated_clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  impersonated_by_user_id UUID,
  impersonated_by_email TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'support' CHECK (mode IN ('support', 'view_only')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sa_impersonation_sessions_clinic
  ON public.super_admin_impersonation_sessions (impersonated_clinic_id);

CREATE INDEX IF NOT EXISTS idx_sa_impersonation_sessions_active
  ON public.super_admin_impersonation_sessions (impersonated_by_email)
  WHERE ended_at IS NULL;

COMMENT ON TABLE public.super_admin_impersonation_sessions IS
  'Temporary super-admin impersonation sessions (Login as Clinic).';

CREATE TABLE IF NOT EXISTS public.super_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.super_admin_impersonation_sessions(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_user_id UUID,
  action TEXT NOT NULL,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sa_audit_log_session ON public.super_admin_audit_log (session_id);
CREATE INDEX IF NOT EXISTS idx_sa_audit_log_clinic ON public.super_admin_audit_log (clinic_id);
CREATE INDEX IF NOT EXISTS idx_sa_audit_log_created ON public.super_admin_audit_log (created_at DESC);

COMMENT ON TABLE public.super_admin_audit_log IS
  'Audit trail for super-admin actions including impersonation start/end and data changes.';
