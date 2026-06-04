-- Sales KB: default CTA is self-service free signup, not demo.

UPDATE clinifly_sales_kb_entries
SET
  answer_long = 'Pain: slow replies and missed leads. CTA: free registration at https://cliniflow-backend-clean-production.up.railway.app/admin-register.html — no credit card.',
  cta = 'trial',
  version = version + 1,
  updated_at = now()
WHERE id = 'sales.ai_messaging';

UPDATE clinifly_sales_kb_entries
SET
  answer_long = 'Only when visitor explicitly asks for demo: confirm yes, ~15 min, list topics, ask day and time.',
  version = version + 1,
  updated_at = now()
WHERE id = 'sales.demo_booking';

UPDATE clinifly_sales_kb_entries
SET
  answer_long = 'Pain: international DMs go cold. Benefit: more booked cross-border patients. CTA: free signup, try yourself.',
  cta = 'trial',
  version = version + 1,
  updated_at = now()
WHERE id = 'acq.international';
