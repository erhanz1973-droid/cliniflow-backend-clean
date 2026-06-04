-- Clinifly Sales AI knowledge base (Phase 1 — structured FAQ, no embeddings).

CREATE TABLE IF NOT EXISTS clinifly_sales_kb_entries (
  id text PRIMARY KEY,
  topic_id text NOT NULL,
  priority int NOT NULL DEFAULT 50,
  locales text[] NOT NULL DEFAULT '{en,tr}',
  questions text[] NOT NULL,
  answer_short text NOT NULL,
  answer_long text,
  proof_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta text,
  tags text[] NOT NULL DEFAULT '{}',
  forbidden_phrases text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz,
  valid_to timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE clinifly_sales_kb_entries IS
  'Structured FAQ for Clinifly Sales AI (Messenger clinifly_sales pages). Pricing and product facts live here.';

CREATE INDEX IF NOT EXISTS idx_clinifly_sales_kb_entries_topic
  ON clinifly_sales_kb_entries (topic_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_clinifly_sales_kb_entries_tags
  ON clinifly_sales_kb_entries USING gin (tags);

-- Seed (idempotent)
INSERT INTO clinifly_sales_kb_entries (
  id, topic_id, priority, locales, questions, answer_short, answer_long, proof_points, cta, tags
) VALUES
(
  'overview.platform',
  'platform_overview',
  95,
  '{en,tr}',
  ARRAY[
    'what is clinifly',
    'clinifly nedir',
    'tell me about clinifly',
    'clinifly hakkinda',
    'what does clinifly do'
  ],
  'Clinifly is a patient-growth and communication platform for dental clinics — not traditional clinic management software. We help you capture leads on WhatsApp and Messenger, nurture them with AI in 20+ languages, run referrals, and coordinate international patients through one inbox.',
  'Clinifly combines discovery, omnichannel AI assistants, mobile apps for patients and staff, referral mechanics, and health-tourism coordination. Clinics keep clinical systems; Clinifly wins the front door and ongoing patient dialogue.',
  '["patient acquisition","omnichannel AI","referrals","health tourism"]'::jsonb,
  'demo',
  ARRAY['overview', 'platform', 'positioning']
),
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
  'acq.international',
  'international_patients',
  90,
  '{en,tr}',
  ARRAY[
    'international patients',
    'foreign patients',
    'health tourism patients',
    'yurtdisi hasta',
    'uluslararasi hasta',
    'dental tourism leads'
  ],
  'For international patients, Clinifly AI handles first questions in the patient''s language, collects photos and documents, and supports travel-and-stay coordination so your team focuses on treatment planning — not chasing messages across apps.',
  NULL,
  '["multilingual AI","document intake","travel coordination"]'::jsonb,
  'demo',
  ARRAY['international', 'health_tourism', 'acquisition']
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
  'channels.whatsapp_ai',
  'whatsapp_ai',
  88,
  '{en,tr}',
  ARRAY[
    'whatsapp ai',
    'whatsapp assistant',
    'whatsapp bot',
    'whatsapp otomasyon',
    'ai on whatsapp'
  ],
  'Clinifly''s WhatsApp AI replies 24/7 in the patient''s language, qualifies leads, collects files, and hands off to your coordinator when needed — all threads stay in one Clinifly inbox with human takeover controls.',
  NULL,
  '["24/7","handoff","multilingual"]'::jsonb,
  'trial',
  ARRAY['whatsapp', 'ai', 'channels']
),
(
  'channels.messenger_ai',
  'messenger_ai',
  86,
  '{en,tr}',
  ARRAY[
    'facebook messenger',
    'messenger ai',
    'messenger bot',
    'facebook page messages',
    'meta messenger'
  ],
  'Connect your Facebook Page to Clinifly: AI can answer product or clinic inquiries on Messenger (including a dedicated Clinifly Sales mode for your brand page). Staff see every thread and can pause AI anytime.',
  NULL,
  '["Facebook Page","Sales mode","human takeover"]'::jsonb,
  'demo',
  ARRAY['messenger', 'facebook', 'ai']
),
(
  'referral.system',
  'referral_system',
  84,
  '{en,tr}',
  ARRAY[
    'referral system',
    'refer a friend',
    'patient referrals',
    'referans sistemi',
    'arkadasini getir',
    'word of mouth'
  ],
  'Clinifly includes a built-in referral program: patients share invite links or codes, you approve referrals, and growth is tracked in admin — stronger than informal "tell a friend" messages alone.',
  NULL,
  '["invite links","tracking","campaigns on Premium"]'::jsonb,
  'trial',
  ARRAY['referral', 'growth']
),
(
  'pricing.trial',
  'free_trial',
  93,
  '{en,tr}',
  ARRAY[
    'free trial',
    'trial period',
    'ucretsiz deneme',
    '2 month trial',
    '2 ay deneme',
    '60 day trial'
  ],
  'Clinifly offers a 2-month full-feature premium trial for qualifying clinics — explore WhatsApp AI, Messenger, referrals, and international workflows with real patients before you commit.',
  NULL,
  '["60 days","full features"]'::jsonb,
  'trial',
  ARRAY['trial', 'pricing', 'premium']
),
(
  'pricing.pro_29',
  'pro_plan',
  91,
  '{en,tr}',
  ARRAY[
    'pro plan',
    'pro price',
    '29 dollars',
    '29 usd',
    '29 dolar',
    'how much does clinifly cost',
    'clinifly fiyat'
  ],
  'After trial, the popular Pro plan is $29/month (USD) for growing clinics — custom branding, referrals, analytics, and email support. Patient and clinic apps remain free to download; you pay for the growth platform.',
  NULL,
  '["$29/month","Pro tier"]'::jsonb,
  'trial',
  ARRAY['pricing', 'pro', '29']
),
(
  'pricing.premium',
  'premium_plan',
  85,
  '{en,tr}',
  ARRAY[
    'premium plan',
    'premium price',
    '89 dollars',
    'unlimited patients',
    'enterprise plan',
    'kurumsal paket'
  ],
  'Premium is for larger clinics needing unlimited active patients, advanced referral campaigns, priority support, and dedicated onboarding — listed at $89/month on our pricing page. We can recommend Pro vs Premium on a quick call.',
  NULL,
  '["$89/month","unlimited patients"]'::jsonb,
  'human',
  ARRAY['pricing', 'premium', 'enterprise']
),
(
  'pricing.no_credit_card',
  'no_credit_card',
  90,
  '{en,tr}',
  ARRAY[
    'credit card required',
    'need credit card',
    'kredi karti gerekli mi',
    'no credit card',
    'kredi karti olmadan'
  ],
  'You can start the Clinifly trial without a credit card — register your clinic, connect channels, and test with real workflows first. We only discuss paid plans when you choose to continue after trial.',
  NULL,
  '["no card for trial"]'::jsonb,
  'trial',
  ARRAY['trial', 'no_credit_card', 'pricing']
),
(
  'lang.multilingual',
  'multilingual',
  87,
  '{en,tr,ru,ka}',
  ARRAY[
    'multilingual',
    'languages supported',
    'georgian language',
    'gurcuce',
    '20 languages',
    'cevirici',
    'which languages'
  ],
  'Clinifly AI replies in the patient''s language — 20+ languages including English, Turkish, Russian, Arabic, German, French, and Georgian (including Georgian script and common transliterations). Your team can still use the admin UI in EN/TR/RU/KA.',
  NULL,
  '["Georgian","Arabic","auto-detect"]'::jsonb,
  'demo',
  ARRAY['multilingual', 'languages', 'georgian']
),
(
  'tourism.workflow',
  'health_tourism',
  88,
  '{en,tr}',
  ARRAY[
    'health tourism',
    'dental tourism workflow',
    'travel and treatment',
    'otel ucak',
    'hotel flight transfer',
    'antalya treatment trip',
    'medical tourism'
  ],
  'Health-tourism workflows cover multilingual intake, large file/photo upload, travel timeline questions, stay duration, and coordinator handoff — without treating every message as a generic FAQ. Clinifly is built for cross-border dental journeys, not only local check-ups.',
  NULL,
  '["travel","stay duration","files"]'::jsonb,
  'demo',
  ARRAY['health_tourism', 'travel', 'international']
),
(
  'diff.vs_clinic_software',
  'vs_clinic_software',
  89,
  '{en,tr}',
  ARRAY[
    'clinic management software',
    'emr',
    'dentrix',
    'practice management',
    'different from crm',
    'klinik yazilimi fark',
    'why not use our current software'
  ],
  'Traditional clinic software focuses on charts, billing, and internal scheduling. Clinifly focuses on winning and nurturing patients: Meta/WhatsApp AI, mobile engagement, referrals, and international coordination — complementary, not a replacement EMR.',
  NULL,
  '["front door vs back office"]'::jsonb,
  'demo',
  ARRAY['comparison', 'emr', 'differentiation']
),
(
  'partner.growth',
  'premium_growth_partner',
  80,
  '{en,tr}',
  ARRAY[
    'growth partner',
    'premium growth partner',
    'marketing partner',
    'patient growth partner',
    'buyukyume ortagi'
  ],
  'Premium Growth Partner is a higher-touch Clinifly offering: strategic support on patient acquisition, campaign alignment (including international markets), and optimization of your AI + referral stack. Ask our team for eligibility and scope.',
  NULL,
  '["strategy","campaigns"]'::jsonb,
  'human',
  ARRAY['growth_partner', 'premium', 'services']
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
),
(
  'obj.already_have_software',
  'objections',
  82,
  '{en,tr}',
  ARRAY[
    'we already have software',
    'already use whatsapp',
    'dont need another tool',
    'zaten yazilimimiz var',
    'extra tool'
  ],
  'Many clinics keep their EMR and add Clinifly for growth: practices that only use WhatsApp on phones often lose leads after hours. Clinifly centralizes AI + humans + referrals without forcing you to change charting software.',
  NULL,
  '[]'::jsonb,
  'demo',
  ARRAY['objection', 'software']
),
(
  'obj.patients_wont_use_app',
  'objections',
  80,
  '{en,tr}',
  ARRAY[
    'patients wont use app',
    'patients do not download app',
    'hastalar uygulamayi indirmez',
    'app adoption'
  ],
  'Patients can start on WhatsApp or Messenger without installing anything; the app deepens engagement after they are already talking to you. AI handles first touch — app is for continuity, documents, and treatment steps.',
  NULL,
  '[]'::jsonb,
  'trial',
  ARRAY['objection', 'app']
),
(
  'obj.ai_replaces_staff',
  'objections',
  81,
  '{en,tr}',
  ARRAY[
    'replace my staff',
    'ai replace humans',
    'lose personal touch',
    'yapay zeka insanlarin yerine mi'
  ],
  'Clinifly AI handles repetitive first questions and after-hours messages; your team stays in control with human takeover, approval flows, and escalation. AI augments coordinators, it does not remove them.',
  NULL,
  '[]'::jsonb,
  'demo',
  ARRAY['objection', 'ai', 'trust']
),
(
  'obj.too_expensive',
  'objections',
  83,
  '{en,tr}',
  ARRAY[
    'too expensive',
    'cost concern',
    'pahali mi',
    'budget',
    'worth the price'
  ],
  'Start with a 2-month trial at no credit card, then Pro at $29/month — compare that to one recovered international implant case. We can walk through ROI on a short demo.',
  NULL,
  '["trial","$29"]'::jsonb,
  'trial',
  ARRAY['objection', 'pricing']
),
(
  'obj.data_privacy',
  'objections',
  75,
  '{en,tr}',
  ARRAY[
    'gdpr',
    'data privacy',
    'kvkk',
    'patient data safe',
    'veri guvenligi'
  ],
  'Clinifly is designed for clinic-operated patient communication with access controls and audit-friendly workflows. For DPA or hosting questions, our team provides details during onboarding — do not share real patient PHI in this chat.',
  NULL,
  '[]'::jsonb,
  'human',
  ARRAY['objection', 'privacy', 'compliance']
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
