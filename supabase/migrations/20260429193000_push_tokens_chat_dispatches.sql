-- Mobile push registrations (Expo) + server-side dedupe for chat outbound pushes.

CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('patient', 'doctor')),
  owner_id UUID NOT NULL,
  expo_push_token TEXT NOT NULL,
  message_sound BOOLEAN NOT NULL DEFAULT TRUE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_kind, owner_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_owner ON push_tokens (owner_kind, owner_id);

COMMENT ON TABLE push_tokens IS 'Expo push tokens per clinician/patient identity; prefers service-role API writes';

-- One outbound push bundle per originating message row (dedupe across insert/fast-path/fallback handlers).
CREATE TABLE IF NOT EXISTS chat_push_dispatches (
  message_row_id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'chat',
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_push_dispatches_at ON chat_push_dispatches (dispatched_at);
