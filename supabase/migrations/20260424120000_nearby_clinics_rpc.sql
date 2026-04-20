-- Haversine search for mobile "Yakınımdaki" and GET /api/clinics/nearby.
-- Params match lib/patientClinicListing.cjs: user_lat, user_lng, radius_km

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
  WHERE COALESCE(c.latitude, c.lat) IS NOT NULL
    AND COALESCE(c.longitude, c.lng) IS NOT NULL
    AND (
      6371.0 * 2.0 * asin(
        least(
          1.0::double precision,
          sqrt(
            power(
              sin((radians(COALESCE(c.latitude, c.lat)) - radians(user_lat)) / 2.0),
              2::double precision
            )
            + cos(radians(user_lat)) * cos(radians(COALESCE(c.latitude, c.lat)))
              * power(
                  sin((radians(COALESCE(c.longitude, c.lng)) - radians(user_lng)) / 2.0),
                  2::double precision
                )
          )
        )
      )
    ) <= GREATEST(radius_km, 0.5::double precision);
$$;

COMMENT ON FUNCTION public.nearby_clinics(double precision, double precision, double precision)
  IS 'Returns clinic rows within radius_km (km) of (user_lat, user_lng); uses COALESCE(latitude,lat) and COALESCE(longitude,lng).';
