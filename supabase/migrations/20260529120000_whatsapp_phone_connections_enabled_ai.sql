-- Clinic-controlled WhatsApp routing toggle + per-connection AI mode.

ALTER TABLE public.whatsapp_phone_connections
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'AI_ACTIVE';

COMMENT ON COLUMN public.whatsapp_phone_connections.is_enabled IS
  'When false, webhooks are still received/audited but inbox routing, AI auto-reply, and outbound sends are paused.';

COMMENT ON COLUMN public.whatsapp_phone_connections.ai_mode IS
  'Per-number AI mode: AI_ACTIVE | HUMAN_ONLY | AI_DRAFT | AI_ASSISTED (require human approval).';

ALTER TABLE public.whatsapp_phone_connections
  DROP CONSTRAINT IF EXISTS whatsapp_phone_connections_ai_mode_check;

ALTER TABLE public.whatsapp_phone_connections
  ADD CONSTRAINT whatsapp_phone_connections_ai_mode_check
  CHECK (
    ai_mode IN ('AI_ACTIVE', 'HUMAN_ONLY', 'AI_DRAFT', 'AI_ASSISTED', 'ESCALATION_REQUIRED')
  );

UPDATE public.whatsapp_phone_connections
SET is_enabled = true
WHERE is_enabled IS NULL;
