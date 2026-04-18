-- Hasta kaydında klinik kodu isteğe bağlı; clinic_id boş kalabilir (sonradan klinik seçilebilir).
-- Patient self-registration may omit clinic; safe if already nullable.
ALTER TABLE public.patients
  ALTER COLUMN clinic_id DROP NOT NULL;
