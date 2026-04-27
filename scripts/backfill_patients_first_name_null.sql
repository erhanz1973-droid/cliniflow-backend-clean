-- One-time data fix: satisfy patients.first_name NOT NULL where legacy rows are NULL.
-- Run manually in Supabase SQL editor (or your migration pipeline) when ready.
-- Review row counts in staging before production.

UPDATE patients
SET first_name = 'Unknown'
WHERE first_name IS NULL;
