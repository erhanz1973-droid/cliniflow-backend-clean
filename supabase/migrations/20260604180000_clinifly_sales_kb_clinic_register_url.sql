-- Fix clinic registration URL in Sales KB (admin-register.html, not clinifly.net/sign-up).

INSERT INTO clinifly_sales_kb_entries (
  id, topic_id, priority, locales, questions, answer_short, answer_long, proof_points, cta, tags
) VALUES
(
  'sales.clinic_register',
  'clinic_registration',
  96,
  '{en,tr,ka,ru}',
  ARRAY[
    'register clinic',
    'sign up',
    'join clinifly',
    'create account',
    'how to start',
    'kayit ol',
    'klinik kaydi',
    'რეგისტრაცია',
    'დაწყება',
    'how do i join'
  ],
  'Free clinic registration — no credit card, self-service, start immediately. URL: https://cliniflow-backend-clean-production.up.railway.app/admin-register.html',
  'Never use clinifly.net/sign-up, /sign-up, or clinifly.net/ka for clinic registration. Only admin-register.html.',
  '["free trial","no credit card","self-service"]'::jsonb,
  'trial',
  ARRAY['registration', 'signup', 'onboarding']
)
ON CONFLICT (id) DO UPDATE SET
  topic_id = EXCLUDED.topic_id,
  priority = EXCLUDED.priority,
  locales = EXCLUDED.locales,
  questions = EXCLUDED.questions,
  answer_short = EXCLUDED.answer_short,
  answer_long = EXCLUDED.answer_long,
  proof_points = EXCLUDED.proof_points,
  cta = EXCLUDED.cta,
  tags = EXCLUDED.tags,
  version = clinifly_sales_kb_entries.version + 1,
  updated_at = now();

UPDATE clinifly_sales_kb_entries
SET
  answer_long = 'Pain: slow replies and missed leads. CTA: free registration at https://cliniflow-backend-clean-production.up.railway.app/admin-register.html — no credit card.',
  version = version + 1,
  updated_at = now()
WHERE id = 'sales.ai_messaging';

UPDATE clinifly_sales_kb_entries
SET
  answer_short = 'Register free without a credit card at https://cliniflow-backend-clean-production.up.railway.app/admin-register.html — add your clinic and start immediately.',
  answer_long = 'Never use /sign-up or clinifly.net links for clinic registration.',
  version = version + 1,
  updated_at = now()
WHERE id = 'pricing.no_credit_card';
