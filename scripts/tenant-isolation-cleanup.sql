-- Audits & manual steps for cross-clinic patient data (read-only queries).
-- Application policy: new registrations create a new patients row per clinic; never move identity across clinic_id.

-- 1) Patients with missing clinic
-- SELECT id, email, phone, created_at FROM public.patients WHERE clinic_id IS NULL;

-- 2) Find emails appearing under more than one clinic (should be valid after per-clinic rows exist)
-- SELECT email, count(DISTINCT clinic_id) AS c FROM public.patients WHERE email IS NOT NULL GROUP BY email HAVING count(DISTINCT clinic_id) > 1;

-- 3) Encounters that do not match patient.clinic_id (stale)
-- SELECT pe.id, pe.patient_id, pe.clinic_id AS e_c, p.clinic_id AS p_c
-- FROM public.patient_encounters pe
-- JOIN public.patients p ON p.id = pe.patient_id
-- WHERE pe.clinic_id IS NOT NULL AND p.clinic_id IS NOT NULL AND pe.clinic_id <> p.clinic_id;

-- 4) Reassign example (DANGEROUS — run in transaction after duplicating patients rows, not blind UPDATE):
-- UPDATE public.patient_encounters SET clinic_id = p.clinic_id
-- FROM public.patients p
-- WHERE p.id = patient_encounters.patient_id AND patient_encounters.clinic_id IS DISTINCT FROM p.clinic_id;
