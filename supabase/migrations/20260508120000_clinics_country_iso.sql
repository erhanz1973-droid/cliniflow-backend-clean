-- Discovery: store clinics.country as ISO 3166-1 alpha-2 (uppercase) so .eq('country', 'TR') matches reliably.

UPDATE public.clinics
SET country = upper(trim(country))
WHERE country IS NOT NULL AND btrim(country) <> '';

-- Legacy full names → ISO (safe idempotent updates)
UPDATE public.clinics SET country = 'TR' WHERE lower(btrim(country)) IN ('turkey', 'türkiye', 'turkiye');
UPDATE public.clinics SET country = 'GE' WHERE lower(btrim(country)) IN ('georgia', 'sakartvelo');
UPDATE public.clinics SET country = 'DE' WHERE lower(btrim(country)) IN ('germany', 'deutschland');

COMMENT ON COLUMN public.clinics.country IS 'ISO 3166-1 alpha-2 uppercase (e.g. TR, GE, DE) for discovery / geo filters.';
