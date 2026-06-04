-- Marketing & patient acquisition KB (authoritative copy sync).

INSERT INTO clinifly_sales_kb_entries (
  id, topic_id, priority, locales, questions, answer_short, answer_long, proof_points, cta, tags
) VALUES
(
  'acq.overview',
  'patient_acquisition',
  92,
  '{en,tr}',
  ARRAY[
    'how do you help clinics get patients',
    'how can clinifly help me get patients',
    'hasta kazandir',
    'hasta kazanma',
    'patient acquisition',
    'bring more patients',
    'nasil hasta kazandirir'
  ],
  'Clinifly helps clinics grow through multiple acquisition channels — paid social and search, health-tourism campaigns, referrals, content marketing, WhatsApp and Messenger conversion, landing pages, and organic partnerships — with AI and coordinators turning interest into booked conversations.',
  'Marketing activities evolve over time based on clinic demand, campaign performance, and expansion plans. Ask our team what is live for your specialty and market.',
  '["multi-channel acquisition","WhatsApp AI","Messenger AI","referrals","health tourism"]'::jsonb,
  'demo',
  ARRAY['acquisition', 'patients', 'growth', 'marketing']
),
(
  'acq.marketing_channels',
  'marketing_patient_acquisition',
  91,
  '{en,tr}',
  ARRAY[
    'marketing and patient acquisition',
    'patient acquisition channels',
    'how does clinifly market',
    'facebook instagram advertising',
    'google advertising',
    'social media content marketing',
    'organic traffic',
    'partnerships',
    'pazarlama',
    'hasta kazandirma kanallari',
    'reklam kanallari'
  ],
  'Clinifly uses multiple patient acquisition channels: Facebook and Instagram advertising, Google advertising, international health tourism campaigns, referral programs, social media content marketing, WhatsApp and Messenger lead conversion, clinic landing pages, and organic traffic and partnerships.',
  'Marketing activities evolve over time based on clinic demand, campaign performance, and expansion plans — not every channel runs in every market at once.',
  '["Meta ads","Google ads","health tourism","referrals","WhatsApp","Messenger","landing pages"]'::jsonb,
  'demo',
  ARRAY['marketing', 'acquisition', 'channels', 'campaigns']
),
(
  'markets.priority',
  'priority_markets',
  80,
  '{en,tr}',
  ARRAY[
    'priority markets',
    'which countries',
    'which markets',
    'uk israel uae',
    'hangi ulkeler',
    'which regions do you cover',
    'international markets'
  ],
  'Current priority markets include the United Kingdom, Israel, and the UAE — but Clinifly is not limited to these countries and may run campaigns in additional markets.',
  'Market focus shifts with clinic demand, campaign performance, and expansion plans. Our team can share what is active for your clinic on a short call.',
  '["UK","Israel","UAE","expandable markets"]'::jsonb,
  'human',
  ARRAY['markets', 'uk', 'israel', 'uae', 'international', 'campaigns']
),
(
  'markets.uk',
  'markets_campaigns',
  78,
  '{en,tr}',
  ARRAY[
    'united kingdom',
    'uk patients',
    'london patients',
    'ingiltere',
    'british patients',
    'uk marketing'
  ],
  'The United Kingdom is a current priority market for Clinifly patient-education and clinic-discovery activities (campaign mix varies by season). We are not limited to the UK — our team can share live UK programs and fit for your clinic on a short call.',
  NULL,
  '["UK","dental tourism","discovery"]'::jsonb,
  'human',
  ARRAY['uk', 'marketing', 'campaigns']
),
(
  'markets.israel',
  'markets_campaigns',
  78,
  '{en,tr}',
  ARRAY[
    'israel',
    'israeli patients',
    'tel aviv',
    'israil',
    'israilli hasta'
  ],
  'Israel is a current priority market: we support clinics engaging Israeli patients through discovery and multilingual AI. Campaigns evolve with demand and performance — our team can outline what is live for your specialty and location.',
  NULL,
  '["Israel","multilingual"]'::jsonb,
  'human',
  ARRAY['israel', 'marketing', 'campaigns']
),
(
  'markets.uae',
  'markets_campaigns',
  78,
  '{en,tr}',
  ARRAY[
    'uae',
    'dubai patients',
    'abu dhabi',
    'birlesik arap emirlikleri',
    'emirlik hasta'
  ],
  'The UAE is a current priority market for Gulf travellers — discovery touchpoints plus AI lead capture in Arabic and English. Clinifly may run campaigns in other countries too; ask us for current UAE/Gulf options for your clinic.',
  NULL,
  '["UAE","Arabic","discovery"]'::jsonb,
  'human',
  ARRAY['uae', 'marketing', 'campaigns']
),
(
  'service.landing_page',
  'landing_page_service',
  76,
  '{en,tr}',
  ARRAY[
    'landing page',
    'clinic landing page',
    'website service',
    'web sayfasi',
    'landing page service'
  ],
  'Clinic landing pages are one Clinifly acquisition channel — conversion-focused pages connected to paid and organic campaigns so clicks enter WhatsApp, Messenger, or a tracked funnel instead of a generic contact form.',
  NULL,
  '["landing page","conversion"]'::jsonb,
  'human',
  ARRAY['landing_page', 'marketing', 'service']
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
