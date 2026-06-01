-- Clinic invitation membership (QR / invite URL onboarding)
CREATE TABLE IF NOT EXISTS patient_clinic_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  joined_via_invitation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_clinic_links_clinic_id
  ON patient_clinic_links (clinic_id);

CREATE INDEX IF NOT EXISTS idx_patient_clinic_links_patient_id
  ON patient_clinic_links (patient_id);

COMMENT ON TABLE patient_clinic_links IS 'Patient–clinic membership; supports invite onboarding and future referral programs';
