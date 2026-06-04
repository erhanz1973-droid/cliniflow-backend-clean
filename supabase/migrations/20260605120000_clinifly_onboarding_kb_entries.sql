-- Clinifly clinic onboarding & support KB (admin UI help, not Sales product FAQ).

CREATE TABLE IF NOT EXISTS clinifly_onboarding_kb_entries (
  id text PRIMARY KEY,
  screen_key text NOT NULL,
  topic_id text NOT NULL,
  priority int NOT NULL DEFAULT 50,
  locales text[] NOT NULL DEFAULT '{en,tr}',
  questions text[] NOT NULL,
  user_explanation text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_support_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE clinifly_onboarding_kb_entries IS
  'User-facing Clinifly admin onboarding/support KB (registration, login, settings, channels).';

CREATE INDEX IF NOT EXISTS idx_clinifly_onboarding_kb_screen
  ON clinifly_onboarding_kb_entries (screen_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_clinifly_onboarding_kb_tags
  ON clinifly_onboarding_kb_entries USING gin (tags);

-- Note: Full content ships in lib/cliniflyOnboardingKbBundled.js until rows are seeded.
-- Run: node scripts/seed-clinifly-onboarding-kb.cjs (optional) or rely on bundled fallback at runtime.
