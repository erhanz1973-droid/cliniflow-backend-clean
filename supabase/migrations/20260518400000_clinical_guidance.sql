-- Doctor-supervised clinical guidance → patient communication (internal only until expanded).

CREATE TABLE IF NOT EXISTS public.clinical_guidance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.patient_chat_threads(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  author_id uuid,
  author_role text NOT NULL DEFAULT 'doctor'
    CHECK (author_role IN ('doctor', 'coordinator', 'admin')),
  intent_tags text[] NOT NULL DEFAULT '{}',
  intent_text text NOT NULL DEFAULT '',
  constraints text[] NOT NULL DEFAULT '{}',
  communication_goals text[] NOT NULL DEFAULT '{}',
  never_patient_visible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_guidance_profile_created_idx
  ON public.clinical_guidance (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS clinical_guidance_patient_clinic_idx
  ON public.clinical_guidance (patient_id, clinic_id, created_at DESC);

COMMENT ON TABLE public.clinical_guidance IS
  'Internal clinical direction for AI expansion — never sent verbatim to patients.';

CREATE TABLE IF NOT EXISTS public.clinical_communication_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guidance_id uuid NOT NULL REFERENCES public.clinical_guidance(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.ai_coordinator_lead_profiles(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  draft_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'discarded')),
  message_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  rewrite_actions text[] NOT NULL DEFAULT '{}',
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  patient_message_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_communication_drafts_guidance_idx
  ON public.clinical_communication_drafts (guidance_id, created_at DESC);

COMMENT ON TABLE public.clinical_communication_drafts IS
  'Patient-facing drafts from clinical guidance — require doctor approval before send.';

NOTIFY pgrst, 'reload schema';
