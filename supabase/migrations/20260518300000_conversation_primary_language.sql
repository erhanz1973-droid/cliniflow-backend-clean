-- Stable conversation reply language (do not flip language every message).

ALTER TABLE public.ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS conversation_primary_language text;

COMMENT ON COLUMN public.ai_coordinator_lead_profiles.conversation_primary_language IS
  'ISO 639-1 primary language for AI replies in this conversation (tr, en, ru, ka).';

CREATE INDEX IF NOT EXISTS ai_coordinator_lead_profiles_conversation_lang_idx
  ON public.ai_coordinator_lead_profiles (clinic_id, conversation_primary_language)
  WHERE conversation_primary_language IS NOT NULL;

NOTIFY pgrst, 'reload schema';
