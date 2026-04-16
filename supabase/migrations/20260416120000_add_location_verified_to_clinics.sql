-- Optional: track that latitude/longitude were confirmed (migration script or admin).
-- Safe to run once; ignore if column already exists.

alter table public.clinics
  add column if not exists location_verified boolean default false;

comment on column public.clinics.location_verified is 'True when lat/lng were parsed from a verified map URL, geocoded, or set explicitly.';
