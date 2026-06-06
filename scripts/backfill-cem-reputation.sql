-- One-time: CEM Clinic reputation (run in Supabase SQL Editor if admin Save still blocked).
-- Replace values if you update them in Public Directory Profile.

UPDATE public.clinics
SET
  google_reviews_url = 'https://share.google/28q0IjJD1XzXICQc8',
  google_rating = 4.9,
  google_review_count = 28,
  updated_at = NOW()
WHERE id = '298a1b77-3257-4c43-8262-e1809b531634'
   OR UPPER(TRIM(clinic_code)) = 'CEM';

-- Verify:
-- SELECT clinic_code, google_reviews_url, google_rating, google_review_count
-- FROM public.clinics WHERE UPPER(TRIM(clinic_code)) = 'CEM';
