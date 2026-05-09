-- Clinic-level intake routing for NEW lead threads (patient_chat_threads insert path).
-- Legacy clinics.settings JSON auto-assign applies only when no row exists here.

CREATE TABLE IF NOT EXISTS public.clinic_lead_routing_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  auto_routing_enabled boolean NOT NULL DEFAULT false,
  routing_mode text NOT NULL DEFAULT 'manual_only'
    CHECK (routing_mode IN ('manual_only', 'fixed_doctor', 'round_robin', 'balanced')),
  fixed_doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  round_robin_last_doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  updated_by text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clinic_lead_routing_settings IS
  'Per-clinic rules for assigning assigned_doctor_id when a new lead thread is created; manual admin assign unchanged.';

CREATE INDEX IF NOT EXISTS clinic_lead_routing_settings_fixed_doctor_idx
  ON public.clinic_lead_routing_settings (fixed_doctor_id)
  WHERE fixed_doctor_id IS NOT NULL;
