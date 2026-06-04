/**
 * Bundled Clinifly Sales KB — used when DB table is not yet migrated or empty.
 * Keep in sync with supabase/migrations/20260604140000_clinifly_sales_kb_entries.sql
 */

/** @returns {Array<import('./cliniflySalesKnowledge').mapKbRow extends never ? never : ReturnType<typeof mapKbRow>>} */
function getBundledCliniflySalesKb() {
  const rows = [
    ["overview.platform", "platform_overview", 95, ["en", "tr"], ["what is clinifly", "clinifly nedir", "clinifly hakkinda"], "Clinifly is a patient-growth and communication platform for dental clinics — not traditional clinic management software. We help you capture leads on WhatsApp and Messenger, nurture them with AI in 20+ languages, run referrals, and coordinate international patients through one inbox.", "demo", ["overview", "platform"]],
    ["acq.overview", "patient_acquisition", 92, ["en", "tr"], ["hasta kazandir", "hasta kazanma", "patient acquisition", "nasil hasta kazandirir", "how can clinifly help me get patients"], "Clinifly helps clinics grow through multiple acquisition channels — paid social and search, health-tourism campaigns, referrals, content marketing, WhatsApp and Messenger conversion, landing pages, and organic partnerships — with AI and coordinators turning interest into booked conversations.", "demo", ["acquisition", "patients", "marketing"]],
    ["acq.marketing_channels", "marketing_patient_acquisition", 91, ["en", "tr"], ["marketing and patient acquisition", "patient acquisition channels", "facebook instagram advertising", "google advertising", "social media content marketing", "organic traffic", "partnerships", "pazarlama", "reklam kanallari"], "Clinifly uses multiple patient acquisition channels: Facebook and Instagram advertising, Google advertising, international health tourism campaigns, referral programs, social media content marketing, WhatsApp and Messenger lead conversion, clinic landing pages, and organic traffic and partnerships. Marketing activities evolve based on clinic demand, campaign performance, and expansion plans.", "demo", ["marketing", "acquisition", "channels"]],
    ["acq.international", "international_patients", 90, ["en", "tr"], ["international patients", "yurtdisi hasta", "uluslararasi hasta", "health tourism patients"], "For international patients, Clinifly AI handles first questions in the patient's language, collects photos and documents, and supports travel-and-stay coordination so your team focuses on treatment planning.", "demo", ["international", "health_tourism"]],
    ["markets.priority", "priority_markets", 80, ["en", "tr"], ["priority markets", "which countries", "uk israel uae", "hangi ulkeler", "international markets"], "Current priority markets include the United Kingdom, Israel, and the UAE — but Clinifly is not limited to these countries and may run campaigns in additional markets.", "human", ["markets", "uk", "israel", "uae"]],
    ["markets.uk", "markets_campaigns", 78, ["en", "tr"], ["united kingdom", "uk patients", "ingiltere", "uk marketing"], "The United Kingdom is a current priority market for Clinifly patient-education and clinic-discovery activities (campaign mix varies by season). We are not limited to the UK — our team can share live UK programs on a short call.", "human", ["uk", "marketing"]],
    ["markets.israel", "markets_campaigns", 78, ["en", "tr"], ["israel", "israeli patients", "israil"], "Israel is a current priority market: we support clinics engaging Israeli patients through discovery and multilingual AI. Campaigns evolve with demand and performance — ask what is live for your clinic.", "human", ["israel", "marketing"]],
    ["markets.uae", "markets_campaigns", 78, ["en", "tr"], ["uae", "dubai patients", "birlesik arap emirlikleri"], "The UAE is a current priority market for Gulf travellers — discovery plus AI lead capture in Arabic and English. Clinifly may run campaigns in other countries too; ask for current UAE/Gulf options.", "human", ["uae", "marketing"]],
    ["channels.whatsapp_ai", "whatsapp_ai", 88, ["en", "tr"], ["whatsapp ai", "whatsapp assistant", "whatsapp bot"], "Clinifly's WhatsApp AI replies 24/7 in the patient's language, qualifies leads, collects files, and hands off to your coordinator when needed.", "trial", ["whatsapp", "ai"]],
    ["channels.messenger_ai", "messenger_ai", 86, ["en", "tr"], ["facebook messenger", "messenger ai", "meta messenger"], "Connect your Facebook Page to Clinifly: AI answers inquiries on Messenger, with a dedicated Clinifly Sales mode for your brand page. Staff can pause AI anytime.", "demo", ["messenger", "facebook"]],
    ["referral.system", "referral_system", 84, ["en", "tr"], ["referral system", "referans sistemi", "refer a friend"], "Clinifly includes a built-in referral program with invite links, approval flows, and tracking in admin.", "trial", ["referral"]],
    ["pricing.trial", "free_trial", 93, ["en", "tr"], ["free trial", "2 month trial", "ucretsiz deneme", "2 ay deneme"], "Clinifly offers a 2-month full-feature premium trial for qualifying clinics — test WhatsApp AI, Messenger, referrals, and international workflows with real patients.", "trial", ["trial", "pricing"]],
    ["pricing.pro_29", "pro_plan", 91, ["en", "tr"], ["pro plan", "29 dollars", "29 dolar", "clinifly fiyat", "how much does clinifly cost"], "After trial, Pro is $29/month (USD) for growing clinics — custom branding, referrals, analytics, and email support. Patient apps are free to download.", "trial", ["pricing", "pro", "29"]],
    ["pricing.premium", "premium_plan", 85, ["en", "tr"], ["premium plan", "89 dollars", "unlimited patients", "kurumsal paket"], "Premium is for larger clinics: unlimited active patients, advanced referral campaigns, priority support, and dedicated onboarding — $89/month on our pricing page.", "human", ["pricing", "premium"]],
    ["pricing.no_credit_card", "no_credit_card", 90, ["en", "tr"], ["credit card required", "kredi karti gerekli mi", "no credit card"], "Start the Clinifly trial without a credit card — register, connect channels, and test with real workflows first.", "trial", ["trial", "no_credit_card"]],
    ["lang.multilingual", "multilingual", 87, ["en", "tr", "ru", "ka"], ["multilingual", "georgian", "gurcuce", "20 languages", "which languages"], "Clinifly AI replies in 20+ languages including English, Turkish, Russian, Arabic, German, French, and Georgian.", "demo", ["multilingual", "georgian"]],
    ["tourism.workflow", "health_tourism", 88, ["en", "tr"], ["health tourism", "dental tourism", "otel ucak", "medical tourism"], "Health-tourism workflows cover multilingual intake, large file upload, travel timeline, and coordinator handoff — built for cross-border dental journeys.", "demo", ["health_tourism", "travel"]],
    ["diff.vs_clinic_software", "vs_clinic_software", 89, ["en", "tr"], ["clinic management software", "emr", "klinik yazilimi fark", "different from crm"], "Traditional clinic software focuses on charts and billing. Clinifly focuses on winning and nurturing patients: Meta/WhatsApp AI, mobile engagement, referrals, and international coordination.", "demo", ["comparison", "emr"]],
    ["partner.growth", "premium_growth_partner", 80, ["en", "tr"], ["growth partner", "premium growth partner", "marketing partner"], "Premium Growth Partner is higher-touch Clinifly support on patient acquisition, campaigns, and optimizing your AI + referral stack. Ask our team for scope.", "human", ["growth_partner"]],
    ["service.landing_page", "landing_page_service", 76, ["en", "tr"], ["landing page", "clinic landing page", "web sayfasi"], "Clinic landing pages are one Clinifly acquisition channel — conversion-focused pages connected to paid and organic campaigns so clicks enter WhatsApp, Messenger, or a tracked funnel.", "human", ["landing_page", "marketing"]],
    ["obj.already_have_software", "objections", 82, ["en", "tr"], ["we already have software", "zaten yazilimimiz var", "already use whatsapp"], "Many clinics keep their EMR and add Clinifly for growth; we centralize AI + humans + referrals without changing charting software.", "demo", ["objection"]],
    ["obj.patients_wont_use_app", "objections", 80, ["en", "tr"], ["patients wont use app", "hastalar uygulamayi indirmez"], "Patients can start on WhatsApp or Messenger without installing anything; the app deepens engagement after they are already talking to you.", "trial", ["objection", "app"]],
    ["obj.ai_replaces_staff", "objections", 81, ["en", "tr"], ["ai replace humans", "yapay zeka insanlarin yerine mi"], "Clinifly AI handles repetitive first questions; your team stays in control with human takeover and escalation.", "demo", ["objection", "ai"]],
    ["obj.too_expensive", "objections", 83, ["en", "tr"], ["too expensive", "pahali mi", "budget"], "Start with a 2-month trial at no credit card, then Pro at $29/month — we can walk through ROI on a short demo.", "trial", ["objection", "pricing"]],
    ["obj.data_privacy", "objections", 75, ["en", "tr"], ["gdpr", "kvkk", "data privacy"], "Clinifly is designed for clinic-operated communication with access controls. For DPA or hosting details, our team provides information during onboarding.", "human", ["objection", "privacy"]],
  ];

  return rows.map(
    ([id, topicId, priority, locales, questions, answerShort, cta, tags]) => ({
      id,
      topicId,
      priority,
      locales,
      questions,
      answerShort,
      answerLong: null,
      proofPoints: [],
      cta,
      tags,
      forbiddenPhrases: [],
    }),
  );
}

module.exports = { getBundledCliniflySalesKb };
