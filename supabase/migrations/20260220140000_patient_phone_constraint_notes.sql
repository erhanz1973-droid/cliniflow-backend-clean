-- Documentation-only migration (safe to run):
-- Option A (preferred for multi-tenant SaaS):
--   UNIQUE (phone, clinic_id)  or partial unique per clinic
--   Same phone can exist at different clinics; within one clinic phone is unique.
-- Option B (current / simple global namespace):
--   UNIQUE (phone)
--   One phone = one user globally; simple but blocks same person at two clinics.
-- To move from B → A: backfill clinic_id, drop old unique, create UNIQUE (phone, clinic_id)
--   WHERE ... ; verify no duplicate (phone, clinic_id) pairs first.

COMMENT ON TABLE public.patients IS
  'Phone stored as E.164 (+...). Unique constraint: see Option A vs B in migration 20260220140000.';
