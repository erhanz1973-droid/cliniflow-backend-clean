-- Link Stripe Customer (cus_...) from Checkout / Customer Portal webhooks.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

COMMENT ON COLUMN public.clinics.stripe_customer_id IS 'Stripe Customer id (cus_...) when known from Checkout or billing.';

CREATE INDEX IF NOT EXISTS clinics_stripe_customer_id_idx
  ON public.clinics (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL AND btrim(stripe_customer_id) <> '';
