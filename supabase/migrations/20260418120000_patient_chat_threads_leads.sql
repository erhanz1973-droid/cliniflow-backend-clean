-- Lead / unassigned patient chat: one thread per patient+clinic; admin assigns a doctor.

CREATE TABLE IF NOT EXISTS public.patient_chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned')),
  assigned_doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  admin_notes text,
  is_lead boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_chat_threads_patient_clinic UNIQUE (patient_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS patient_chat_threads_clinic_unassigned_lead_idx
  ON public.patient_chat_threads (clinic_id, created_at DESC)
  WHERE assigned_doctor_id IS NULL AND is_lead = true;

CREATE INDEX IF NOT EXISTS patient_chat_threads_assigned_doctor_lead_idx
  ON public.patient_chat_threads (assigned_doctor_id, updated_at DESC)
  WHERE is_lead = true;

COMMENT ON TABLE public.patient_chat_threads IS 'Chat assignment for lead (guest) contacts; admin assigns exactly one doctor.';

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_lead boolean NOT NULL DEFAULT false;
