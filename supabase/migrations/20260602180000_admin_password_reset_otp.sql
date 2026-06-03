-- Clinic admin password reset OTP sessions + security audit log

CREATE TABLE IF NOT EXISTS admin_password_reset_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  clinic_code text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_password_reset_sessions_email_clinic_unique UNIQUE (email, clinic_code)
);

CREATE INDEX IF NOT EXISTS admin_password_reset_sessions_expires_idx
  ON admin_password_reset_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  email text,
  clinic_code text,
  ip_address text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_security_audit_log_created_idx
  ON admin_security_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_security_audit_log_event_idx
  ON admin_security_audit_log (event_type);
