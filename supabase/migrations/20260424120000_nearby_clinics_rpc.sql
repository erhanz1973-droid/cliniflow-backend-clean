-- Haversine search for mobile nearby list and GET /api/clinics/nearby.
-- Params match lib/patientClinicListing.cjs: user_lat, user_lng, radius_km
--
-- Clinics may use (latitude, longitude) OR (lat, lng) only. Referencing a missing
-- column in COALESCE(c.latitude, c.lat) still errors (42703). We read coords via
-- to_jsonb(c) so only existing keys are used.
--
-- If an older nearby_clinics existed with a different return type, CREATE OR REPLACE is not enough (42P13).

DROP FUNCTION IF EXISTS public.nearby_clinics(double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.nearby_clinics(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 10
)
RETURNS SETOF public.clinics
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.*
  FROM public.clinics c
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(
        NULLIF((to_jsonb(c)->>'latitude'), '')::double precision,
        NULLIF((to_jsonb(c)->>'lat'), '')::double precision
      ) AS plat,
      COALESCE(
        NULLIF((to_jsonb(c)->>'longitude'), '')::double precision,
        NULLIF((to_jsonb(c)->>'lng'), '')::double precision
      ) AS plng
  ) AS g
  WHERE g.plat IS NOT NULL
    AND g.plng IS NOT NULL
    AND (
      6371.0 * 2.0 * asin(
        least(
          1.0::double precision,
          sqrt(
            power(
              sin((radians(g.plat) - radians(user_lat)) / 2.0),
              2::double precision
            )
            + cos(radians(user_lat)) * cos(radians(g.plat))
              * power(
                  sin((radians(g.plng) - radians(user_lng)) / 2.0),
                  2::double precision
                )
          )
        )
      )
    ) <= GREATEST(radius_km, 0.5::double precision);
$$;

COMMENT ON FUNCTION public.nearby_clinics(double precision, double precision, double precision)
  IS 'Clinics within radius_km of (user_lat,user_lng). Coords: latitude/lat and longitude/lng via to_jsonb (missing columns ignored).';
