-- Smile Score Facebook share reward (once per patient account)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS bonus_smile_analyses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smile_facebook_share_reward_at timestamptz;

COMMENT ON COLUMN public.patients.bonus_smile_analyses IS
  'Extra AI smile analyses granted via share rewards or promotions. Consumed before AI cost limit blocks analysis.';

COMMENT ON COLUMN public.patients.smile_facebook_share_reward_at IS
  'When the one-time Facebook Smile Score share reward was granted (null = not yet claimed).';
