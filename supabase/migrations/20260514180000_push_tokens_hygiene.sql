-- Push token hygiene: index for scheduled stale/orphan sweeps.
-- Destructive cleanup (DELETE invalid/orphan rows) is documented in PRODUCTION_HARDENING_REPORT.md
-- and should be run explicitly in Supabase SQL editor or pg_cron after review.

create index if not exists push_tokens_updated_at_idx
  on public.push_tokens (updated_at desc);

comment on index public.push_tokens_updated_at_idx is
  'Supports stale-token sweeps (e.g. DELETE WHERE updated_at < now() - interval ''180 days'').';
