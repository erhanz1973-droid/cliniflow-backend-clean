-- Sales-rep KB: demo booking, AI messaging, Georgian intl patients, sales angles.

INSERT INTO clinifly_sales_kb_entries (
  id, topic_id, priority, locales, questions, answer_short, answer_long, proof_points, cta, tags
) VALUES
(
  'sales.demo_booking',
  'demo_booking',
  94,
  '{en,tr,ka}',
  ARRAY[
    'book a demo',
    'see a demo',
    'schedule demo',
    'can i see a demo',
    'demo meeting',
    'randevu',
    'gorusme',
    'დემოს ნახვა',
    'დემო',
    'შემიძლია დემოს ნახვა'
  ],
  'Facts: ~15 min live demo; shows AI assistant, WhatsApp + Messenger integrations, international patient workflow, referral system.',
  'On demo request: confirm yes, state duration, list 4 demo topics, ask day and time — do not give a long product essay.',
  '["demo","meeting","scheduling"]'::jsonb,
  'demo',
  ARRAY['demo', 'meeting', 'booking']
),
(
  'sales.ai_messaging',
  'ai_messaging_sales',
  89,
  '{en,tr,ka}',
  ARRAY[
    'how do ai messages work',
    'ai messages',
    'ai replies',
    'automatic replies',
    '24/7 ai',
    'yapay zeka mesaj',
    'ai nasil calisir',
    'როგორ მუშაობს ai შეტყობინებები',
    'ai შეტყობინებ'
  ],
  'Facts: 24/7 automatic replies on WhatsApp and Messenger; 20+ languages including Georgian; human handoff; qualifies leads and collects files.',
  'Pain: slow replies and missed leads after hours. Benefit: faster response, fewer lost inquiries. CTA: demo or 2-month trial.',
  '["WhatsApp","Messenger","24/7","Georgian"]'::jsonb,
  'demo',
  ARRAY['ai', 'whatsapp', 'messenger', 'multilingual']
),
(
  'acq.international',
  'international_patients',
  90,
  '{en,tr,ka}',
  ARRAY[
    'international patients',
    'foreign patients',
    'health tourism patients',
    'yurtdisi hasta',
    'uluslararasi hasta',
    'dental tourism leads',
    'საერთაშორისო პაციენტ',
    'როგორ დამეხმარება clinifly საერთაშორისო პაციენტების მიღებაში'
  ],
  'Facts: advertising and international campaigns; WhatsApp AI + Messenger AI; referral system; multilingual intake and travel coordination; priority markets UK, Israel, UAE (not exclusive).',
  'Pain: international DMs go cold. Benefit: more booked cross-border patients. CTA: 15-min demo.',
  '["Meta ads","Google ads","referrals","UK","Israel","UAE"]'::jsonb,
  'demo',
  ARRAY['international', 'health_tourism', 'acquisition']
),
(
  'channels.whatsapp_ai',
  'whatsapp_ai',
  88,
  '{en,tr,ka}',
  ARRAY['whatsapp ai', 'whatsapp assistant', 'whatsapp bot'],
  'Facts: WhatsApp AI 24/7; patient language; qualifies leads; collects files; coordinator handoff.',
  'Benefit: capture leads that would be missed after hours.',
  '["24/7","multilingual"]'::jsonb,
  'trial',
  ARRAY['whatsapp', 'ai']
),
(
  'channels.messenger_ai',
  'messenger_ai',
  86,
  '{en,tr,ka}',
  ARRAY['facebook messenger', 'messenger ai', 'meta messenger'],
  'Facts: Facebook Page Messenger with Clinifly AI; staff can pause AI; clinifly_sales mode on brand pages.',
  'Benefit: instant Facebook/Instagram inquiry response.',
  '["Messenger","Facebook"]'::jsonb,
  'demo',
  ARRAY['messenger', 'facebook']
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
  is_active = EXCLUDED.is_active,
  version = clinifly_sales_kb_entries.version + 1,
  updated_at = now();
