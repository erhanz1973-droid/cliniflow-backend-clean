-- Clinic Operations AI Profile — structured autonomy, escalation, and safety for orchestration.

CREATE TABLE IF NOT EXISTS public.clinic_ai_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  autonomy_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  knowledge_base_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clinic_ai_settings IS
  'Clinic Operations AI Profile — autonomy, SLA, knowledge, safety. Read by AI orchestration before drafts/auto-reply/escalation.';

COMMENT ON COLUMN public.clinic_ai_settings.autonomy_config IS
  'Per-category autonomy: OFF | SUGGEST_ONLY | AUTO_REPLY | FULLY_AUTONOMOUS.';

COMMENT ON COLUMN public.clinic_ai_settings.escalation_config IS
  'SLA timers, business hours, weekend handling, human handoff triggers.';

COMMENT ON COLUMN public.clinic_ai_settings.tone_config IS
  'AI identity: display name, languages, personality, signature style.';

COMMENT ON COLUMN public.clinic_ai_settings.knowledge_base_config IS
  'Structured operational facts (implants, travel, financing) — not vector RAG.';

COMMENT ON COLUMN public.clinic_ai_settings.safety_rules IS
  'Categories that always require human review before patient-facing output.';

COMMENT ON COLUMN public.clinic_ai_settings.communication_policy IS
  'What the AI may discuss or execute (pricing, booking, payment links, medical risk).';

CREATE INDEX IF NOT EXISTS clinic_ai_settings_updated_idx
  ON public.clinic_ai_settings (updated_at DESC);
