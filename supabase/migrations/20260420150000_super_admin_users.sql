-- Platform super-admin credentials (separate from Supabase Auth and clinic admins).
-- Backend: POST /api/super-admin/login uses this table when SUPER_ADMIN_* env vars are unset.

CREATE TABLE IF NOT EXISTS public.super_admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'super_admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT super_admin_users_role_check CHECK (role = 'super_admin')
);

CREATE INDEX IF NOT EXISTS idx_super_admin_users_email_lower ON public.super_admin_users (lower(email));

-- Seed: password is 123456 (bcrypt, cost 10). Change hash after first login in production.
INSERT INTO public.super_admin_users (email, password_hash, role)
VALUES (
  'admin@clinifly.com',
  '$2b$10$Jbzlz0enRSeTxEiGsPsNhOsVp8iE8CuadybYhprABaRjVy2PKEp3O',
  'super_admin'
)
ON CONFLICT (email) DO NOTHING;

ALTER TABLE public.super_admin_users ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated cannot read; service role bypasses RLS for the API.

COMMENT ON TABLE public.super_admin_users IS 'Clinifly platform super-admin login (bcrypt); used when SUPER_ADMIN_EMAIL/PASSWORD env are not set.';
