-- Stripe subscription Checkout: persist subscription id after webhook upgrades plan.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

COMMENT ON COLUMN public.clinics.stripe_subscription_id IS 'Stripe Subscription id (sub_...) after successful Checkout subscription.';
