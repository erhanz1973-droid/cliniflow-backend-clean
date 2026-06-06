-- CEM Clinic: marketplace social + reputation (Supabase SQL Editor).
-- Run once, then verify in app (Expo: npx expo start -c).

UPDATE public.clinics
SET
  website_url = 'https://www.moonsmileclinic.com',
  website = 'https://www.moonsmileclinic.com',
  facebook_url = 'https://www.facebook.com/profile.php?id=61587279717657',
  youtube_url = 'https://www.youtube.com/@Clinifly',
  google_maps_url = 'https://maps.app.goo.gl/jWUBQU245kep7BnSA',
  google_reviews_url = 'https://share.google/28q0IjJD1XzXICQc8',
  google_rating = 4.9,
  google_review_count = 28,
  updated_at = NOW()
WHERE id = '298a1b77-3257-4c43-8262-e1809b531634'
   OR UPPER(TRIM(clinic_code)) = 'CEM';

-- Verify:
-- SELECT clinic_code, website_url, facebook_url, youtube_url, google_maps_url,
--        google_rating, google_review_count, google_reviews_url
-- FROM public.clinics WHERE UPPER(TRIM(clinic_code)) = 'CEM';
