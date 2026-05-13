-- Repair: prod may have auth_user_id only; linking insert expects auth_provider / provider_subject / avatar_url.
-- Idempotent (IF NOT EXISTS).

alter table public.patients
  add column if not exists auth_provider text;

alter table public.patients
  add column if not exists provider_subject text;

alter table public.patients
  add column if not exists avatar_url text;

comment on column public.patients.auth_provider is 'google | apple (identity provider slug).';
comment on column public.patients.provider_subject is 'OIDC sub / provider identity id — used when Apple omits email on repeat sign-in.';
comment on column public.patients.avatar_url is 'Profile image URL from OAuth provider metadata when available.';

create unique index if not exists patients_oauth_provider_subject_uniq
  on public.patients (auth_provider, provider_subject)
  where auth_provider is not null
    and provider_subject is not null
    and length(trim(provider_subject)) > 0;
