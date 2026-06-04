-- Per Facebook Page AI routing + separate Clinifly sales conversation logging.

ALTER TABLE meta_page_connections
  ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'clinic';

COMMENT ON COLUMN meta_page_connections.ai_mode IS
  'Messenger AI routing: clinic | clinifly_sales | human';

ALTER TABLE ai_coordinator_lead_profiles
  ADD COLUMN IF NOT EXISTS conversation_type text NOT NULL DEFAULT 'clinic';

COMMENT ON COLUMN ai_coordinator_lead_profiles.conversation_type IS
  'Conversation bucket: clinic | clinifly_sales';

CREATE INDEX IF NOT EXISTS idx_ai_coordinator_lead_profiles_conversation_type
  ON ai_coordinator_lead_profiles (conversation_type)
  WHERE conversation_type IS NOT NULL;
