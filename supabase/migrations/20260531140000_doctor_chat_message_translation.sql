-- Doctor chat: per-message translation cache + doctor UI language preference

ALTER TABLE public.patient_messages
  ADD COLUMN IF NOT EXISTS translation jsonb;

COMMENT ON COLUMN public.patient_messages.translation IS
  'Cached chat translations keyed by target language, e.g. {"byTarget":{"tr":{"sourceLanguage","targetLanguage","translatedText","translatedAt"}}}';

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS preferred_language varchar(12);

COMMENT ON COLUMN public.doctors.preferred_language IS
  'Doctor app UI + chat translation target language (tr, en, ka, ru, de, fr, ar)';
