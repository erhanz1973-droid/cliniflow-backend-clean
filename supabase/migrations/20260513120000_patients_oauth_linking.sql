-- OAuth (Google/Apple) → Clinifly JWT bridge: link Supabase Auth users to public.patients
-- Mobile obtains Supabase session after signInWithIdToken / OAuth; backend validates access_token.

alter table public.patients
  add column if not exists auth_user_id uuid unique;

alter table public.patients
  add column if not exists auth_provider text;

alter table public.patients
  add column if not exists provider_subject text;

alter table public.patients
  add column if not exists avatar_url text;

comment on column public.patients.auth_user_id is 'Supabase auth.users.id — stable primary link for OAuth bridge.';
comment on column public.patients.auth_provider is 'google | apple (identity provider slug).';
comment on column public.patients.provider_subject is 'OIDC sub / provider identity id — used when Apple omits email on repeat sign-in.';
comment on column public.patients.avatar_url is 'Profile image URL from OAuth provider metadata when available.';

-- Optional FK: keeps orphans out; drop if your project disallows cross-schema FK from public.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'patients_auth_user_id_fkey'
  ) then
    alter table public.patients
      add constraint patients_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users (id) on delete set null;
  end if;
exception
  when undefined_object or invalid_schema_name or insufficient_privilege then
    null;
end $$;

create unique index if not exists patients_oauth_provider_subject_uniq
  on public.patients (auth_provider, provider_subject)
  where auth_provider is not null and provider_subject is not null and length(trim(provider_subject)) > 0;

create index if not exists patients_auth_user_id_idx
  on public.patients (auth_user_id)
  where auth_user_id is not null;
