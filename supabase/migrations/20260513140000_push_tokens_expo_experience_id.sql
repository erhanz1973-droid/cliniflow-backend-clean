-- Tag each Expo device token with its Expo experience (@owner/slug) so we never mix
-- @erhanzorlu/doctor-clean and @erhanzorlu/clinifly-new in one push/send batch (PUSH_TOO_MANY_EXPERIENCE_IDS).

alter table public.push_tokens
  add column if not exists expo_experience_id text;

create index if not exists push_tokens_owner_experience_idx
  on public.push_tokens (owner_kind, owner_id, expo_experience_id);

comment on column public.push_tokens.expo_experience_id is 'Expo app scope, e.g. @erhanzorlu/doctor-clean — from client Constants.expoConfig.originalFullName; required to filter mixed-app token rows.';

-- Optional cleanup when a patient-app token was registered under a doctor JWT:
-- delete from public.push_tokens
-- where owner_kind = 'doctor' and expo_experience_id = '@erhanzorlu/clinifly-new';
