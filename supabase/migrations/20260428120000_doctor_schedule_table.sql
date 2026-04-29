-- Weekly doctor hours for GET /api/doctor/me (schedule field).
-- Fixes: "Could not find the table 'public.doctor_schedule' in the schema cache"
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.doctor_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES public.doctors (id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time time WITHOUT TIME ZONE NOT NULL,
  end_time time WITHOUT TIME ZONE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doctor_schedule_doctor_weekday UNIQUE (doctor_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_doctor_schedule_doctor_id ON public.doctor_schedule (doctor_id);

COMMENT ON TABLE public.doctor_schedule IS
  'Per-doctor weekly availability; optional data — app tolerates empty schedule.';
