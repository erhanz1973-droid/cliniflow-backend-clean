-- Expo push tokens for doctor-clean / cliniflow-app (Railway backend registerExpoTokenEntry).
-- Required columns match index.cjs upsert: owner_kind, owner_id, expo_push_token, message_sound, platform, updated_at
-- onConflict: owner_kind, owner_id, expo_push_token

create extension if not exists pgcrypto;

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('doctor', 'patient')),
  owner_id uuid not null,
  expo_push_token text not null,
  message_sound boolean not null default true,
  platform text,
  updated_at timestamptz not null default now()
);

create unique index if not exists push_tokens_owner_kind_owner_id_expo_token_key
  on public.push_tokens (owner_kind, owner_id, expo_push_token);

create index if not exists push_tokens_owner_idx
  on public.push_tokens (owner_kind, owner_id);

comment on table public.push_tokens is 'Expo device tokens; backend uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).';
