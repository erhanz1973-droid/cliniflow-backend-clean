/**
 * Clinifly Sales AI — conversation intent playbooks (PBSC: Problem → Benefit → Solution → CTA).
 */

const { getCliniflyClinicRegisterUrl } = require("./cliniflyClinicRegisterUrl");

/**
 * @param {string} raw
 */
function normalizeLocale(raw) {
  const base = String(raw || "en")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return base || "en";
}

const DEMO_INTENT_RE =
  /(demo|demonstration|see a demo|book a demo|schedule a demo|live demo|trial call|consultation call|zoom call|calendly|gorusme|randevu|görüşme|tanitim|tanıtım|sunum|დემო|დემოს|შეხვედრა|შეხვედრ|გაცნობ|გაცნობა|დემოს ნახვა)/i;

const AI_MESSAGING_RE =
  /(ai message|ai messages|ai reply|ai replies|ai assistant|ai chatbot|automatic repl|24\s*\/\s*7|how does (the )?ai work|yapay zeka mesaj|ai nasil|შეტყობინებ|ხელოვნური ინტელექტ|ავტომატურ პასუხ)/i;

const INTL_PATIENTS_RE =
  /(international patient|foreign patient|health tourism|dental tourism|cross[- ]border|yurtdisi hasta|uluslararasi hasta|საერთაშორისო|გლობალურ პაციენტ)/i;

const PRICING_RE =
  /\b(price|pricing|cost|how much|fee|subscription|plan|pro plan|trial|ucret|fiyat|ფას|ღირებულებ|ტარიფ)\b/i;

/** Messages that look like questions — not bare clinic/name identity. */
const QUESTION_HINT_RE =
  /[?？]|\b(how|what|why|when|where|who|can|could|would|should|is|are|does|do|did|will|much|many|explain|tell me|როგორ|რა|სად|როდის|შემიძლია|გინდა|ნებას|მინდა|istiyorum|ister misin|var mı|nasıl|nedir|ne kadar)\b/i;

const CLINIC_NAME_HINT_RE =
  /\b(dent|dental|clinic|klinik|kliniği|smile|center|centre|ltd|llc|inc|studio|lab|დენტ|კლინიკ|стоматолог)\b/i;

const PRICING_DISCUSSION_RE =
  /(\$29|\$89|2[\s-]?month|60[\s-]?day|pro plan|premium|free trial|no credit card|ფას|fiyat|ucret|pricing|trial)/i;

const GREETING_TOKEN_RE =
  /^(hello|hi|hey|hola|merhaba|selam|salem|salam|salaam|greetings|good morning|good afternoon|good evening|გამარჯობა|სალამი|სალამ|halito|privet|здравствуйте|привет|добрый|iyi gunler|iyi akşamlar)([!.,\s👋🙂😊]*|$)/i;

const VISITOR_PATIENT_RE =
  /(patient|hasta|pazient|paziente|პაციენტ|i am a patient|i'm a patient)/i;

const VISITOR_CLINIC_RE =
  /(clinic owner|clinic manager|clinic representative|clinic staff|dental clinic|dentist|doctor|manager|owner|klinik|kliniğ|yönetici|mudur|sahibi|diş|dis hekimi|კლინიკ|წარმომადგენელი|სტომატოლოგ|მენეჯერი|კლინიკის)/i;

const VISITOR_PARTNER_RE =
  /(partner|agency|distributor|reseller|ortak|iş ortağı|პარტნიორ|partnership)/i;

/**
 * @param {string} message
 */
function isSalesGreetingOnlyMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 48) return false;
  if (QUESTION_HINT_RE.test(m)) return false;
  if (PRICING_RE.test(m) || DEMO_INTENT_RE.test(m) || AI_MESSAGING_RE.test(m)) return false;

  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim();
  if (!stripped) return true;
  if (GREETING_TOKEN_RE.test(stripped)) return true;

  const tokens = stripped.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const greetingWords = new Set([
    "hello",
    "hi",
    "hey",
    "merhaba",
    "selam",
    "salam",
    "salaam",
    "greetings",
    "გამარჯობა",
    "სალამი",
    "სალამ",
    "halito",
    "privet",
    "здравствуйте",
    "привет",
  ]);
  if (tokens.length <= 3 && tokens.every((t) => greetingWords.has(t))) return true;
  return false;
}

/**
 * @param {string} message
 * @returns {"clinic"|"patient"|"partner"|null}
 */
function detectVisitorTypeFromMessage(message) {
  const m = String(message || "").trim();
  if (!m) return null;
  if (VISITOR_PATIENT_RE.test(m)) return "patient";
  if (VISITOR_PARTNER_RE.test(m)) return "partner";
  if (VISITOR_CLINIC_RE.test(m)) return "clinic";
  return null;
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string|null|undefined} conversationSummary
 * @param {Record<string, unknown>|null|undefined} channelMetadata
 */
function conversationNeedsVisitorDiscovery(recentTurns, conversationSummary, channelMetadata) {
  const lead =
    channelMetadata?.clinifly_sales_lead && typeof channelMetadata.clinifly_sales_lead === "object"
      ? channelMetadata.clinifly_sales_lead
      : null;
  if (lead?.visitorType) return false;

  const summary = String(conversationSummary || "");
  if (/\bvisitorType\b|clinic representative|clinic owner|identified as patient/i.test(summary)) {
    return false;
  }

  const assistantTurns = (recentTurns || []).filter((t) => t.role === "assistant");
  return assistantTurns.some((t) =>
    /clinic representative|წარმომადგენელი|klinik temsilcisi|patient\?|პაციენტი\?/i.test(String(t.text || "")),
  );
}

/**
 * @param {string} lang
 */
function buildGreetingQualificationReply(lang) {
  const key = normalizeLocale(lang);
  if (key === "ka") {
    return "გამარჯობა 👋 კეთილი იყოს თქვენი მობრძანება Clinifly-ში.\n\nკლინიკის წარმომადგენელი ხართ თუ პაციენტი?";
  }
  if (key === "tr") {
    return "Merhaba 👋 Clinifly'e hoş geldiniz.\n\nBir klinik temsilcisi misiniz, yoksa hasta mısınız?";
  }
  if (key === "ru") {
    return "Здравствуйте 👋 Добро пожаловать в Clinifly.\n\nВы представитель клиники или пациент?";
  }
  return "Hello 👋 Welcome to Clinifly.\n\nAre you a clinic representative or a patient?";
}

/**
 * Short message that is clinic and/or contact name — not a product question.
 * @param {string} message
 */
function isSalesProfileIdentityMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 120) return false;
  if (isSalesGreetingOnlyMessage(m)) return false;
  if (QUESTION_HINT_RE.test(m)) return false;
  if (DEMO_INTENT_RE.test(m) || PRICING_RE.test(m) || AI_MESSAGING_RE.test(m) || INTL_PATIENTS_RE.test(m)) {
    return false;
  }
  if (m.length <= 90 && /[a-zA-Z\u10A0-\u10FF\u0400-\u04FF]{2,}/.test(m)) {
    return true;
  }
  return false;
}

/**
 * @param {string} message
 * @returns {{ clinicName?: string, contactName?: string, notes?: string }|null}
 */
function parseProfileIdentityFromMessage(message) {
  const m = String(message || "").trim();
  if (!m) return null;

  const parts = m
    .split(/[.,;|/]+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  if (parts.length >= 2) {
    const first = parts[0];
    const second = parts[1];
    if (CLINIC_NAME_HINT_RE.test(first)) {
      return { clinicName: first, contactName: second, notes: m };
    }
    if (CLINIC_NAME_HINT_RE.test(second)) {
      return { clinicName: second, contactName: first, notes: m };
    }
    return { clinicName: first, contactName: second, notes: m };
  }

  if (parts.length === 1) {
    const single = parts[0];
    if (CLINIC_NAME_HINT_RE.test(single)) return { clinicName: single, contactName: null, notes: m };
    return { contactName: single, clinicName: null, notes: m };
  }

  return { notes: m };
}

/**
 * @param {string} message
 * @param {{ recentTurns?: Array<{ role: string, text: string }>, conversationSummary?: string, channelMetadata?: Record<string, unknown> }} [ctx]
 * @returns {"demo"|"greeting_qualification"|"visitor_discovery"|"profile_identity"|"ai_messaging"|"international_patients"|"pricing"|"general"}
 */
function detectSalesConversationIntent(message, ctx = {}) {
  const m = String(message || "").trim();
  if (!m) return "general";
  if (DEMO_INTENT_RE.test(m)) return "demo";
  if (isSalesGreetingOnlyMessage(m)) return "greeting_qualification";

  const visitorType = detectVisitorTypeFromMessage(m);
  if (visitorType) return "visitor_discovery";
  if (
    conversationNeedsVisitorDiscovery(
      ctx.recentTurns,
      ctx.conversationSummary,
      ctx.channelMetadata,
    ) &&
    m.length < 120 &&
    !PRICING_RE.test(m) &&
    !AI_MESSAGING_RE.test(m) &&
    !INTL_PATIENTS_RE.test(m)
  ) {
    return "visitor_discovery";
  }

  if (isSalesProfileIdentityMessage(m)) return "profile_identity";
  if (AI_MESSAGING_RE.test(m) || (/ai/i.test(m) && /შეტყობინებ/i.test(m))) return "ai_messaging";
  if (INTL_PATIENTS_RE.test(m)) return "international_patients";
  if (PRICING_RE.test(m)) return "pricing";
  return "general";
}

/**
 * @param {string} message
 * @param {string|null|undefined} profileLang
 */
function inferSalesConversationLanguage(message, profileLang) {
  const m = String(message || "");
  if (/[\u10A0-\u10FF]/.test(m)) return "ka";
  if (/[а-яё]/i.test(m)) return "ru";
  if (/[ğüşöçıİ]/i.test(m)) return "tr";
  const fromProfile = normalizeLocale(profileLang);
  if (fromProfile && fromProfile !== "en") return fromProfile;
  return "en";
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function assistantRecentlyUsedRegistrationCta(recentTurns) {
  const url = getCliniflyClinicRegisterUrl();
  const needle = url.replace(/^https?:\/\//i, "").split("/")[0];
  return (recentTurns || [])
    .filter((t) => t.role === "assistant")
    .slice(-2)
    .some((t) => {
      const text = String(t.text || "");
      return text.includes("admin-register") || (needle && text.includes(needle));
    });
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function buildCtaRepeatGuard(recentTurns) {
  if (!assistantRecentlyUsedRegistrationCta(recentTurns)) return "";
  return (
    "CTA GUARD: Your previous reply already included the clinic registration link. " +
    "Do NOT repeat the same URL or full registration CTA block this turn. " +
    "Acknowledge their message, add one short helpful line, and ask at most one light follow-up — or move to the next sales topic without re-pasting the link."
  );
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string|null|undefined} conversationSummary
 */
function buildPricingFollowUpHint(recentTurns, conversationSummary) {
  const summary = String(conversationSummary || "");
  const patientTurns = (recentTurns || []).filter((t) => t.role === "user").slice(-4);
  const assistantTurns = (recentTurns || []).filter((t) => t.role === "assistant").slice(-2);

  const hadPricingQuestion = patientTurns.some((t) => PRICING_RE.test(String(t.text || "")));
  const hadPricingAnswer = assistantTurns.some((t) => PRICING_DISCUSSION_RE.test(String(t.text || "")));
  const summaryMentionsPricing = PRICING_DISCUSSION_RE.test(summary) || PRICING_RE.test(summary);

  if (!hadPricingQuestion && !hadPricingAnswer && !summaryMentionsPricing) return "";

  return (
    "PRICING FOLLOW-UP: Pricing/trial was already discussed. Do NOT repeat the same price table or trial bullets. " +
    "Advance naturally: one concrete ROI angle (e.g. one extra international patient vs monthly cost), " +
    "then a soft next step. Include the registration link only if your previous reply did not already include it."
  );
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function buildAntiRepeatHint(recentTurns) {
  const assistantSnippets = (recentTurns || [])
    .filter((t) => t.role === "assistant")
    .map((t) => String(t.text || "").trim())
    .filter(Boolean)
    .slice(-2);
  if (!assistantSnippets.length) return "";
  const combined = assistantSnippets.join(" ").slice(0, 400);
  return (
    "ANTI-REPETITION: Your previous reply already covered: \"" +
    combined +
    "\". Do NOT repeat the same opening, platform definition, bullet list, or registration CTA. " +
    "Answer ONLY what the visitor needs now, with fresh wording. Never push demo or meeting scheduling unless they explicitly requested a demo."
  );
}

/**
 * @param {string} message
 * @param {string} lang
 */
function buildProfileIdentityPlaybook(message, lang) {
  const key = normalizeLocale(lang);
  const parsed = parseProfileIdentityFromMessage(message);
  const parsedLine = parsed
    ? `Extract to salesLead: contactName=${parsed.contactName || "null"}, clinicName=${parsed.clinicName || "null"}, notes=${parsed.notes || message}.`
    : "";

  const templates = {
    en: `ACTIVE PLAYBOOK — PROFILE IDENTITY (not a product question):
The visitor sent clinic and/or contact details only (e.g. "LS Dent. Rozeta."). Treat as lead profile info — NOT a question to answer with a full product pitch.
• Warmly acknowledge their name/clinic; confirm you saved it in salesLead.
• 1–2 short sentences max; no PBSC essay.
• Do NOT repeat the registration link if your last message already had it.
• Optional light follow-up: country/city OR "ready to register when you are" — not both registration URL and demo.`,
    ka: `ACTIVE PLAYBOOK — პროფილის მონაცემები:
მოკლე შეტყობინება (მაგ. "LS Dent. Rozeta.") — კლინიკის/სახელის მონაცემებია, არა პროდუქტის კითხვა.
• მადლობა + დაადასტურეთ რომ ჩაწერეთ კლინიკა/სახელი salesLead-ში.
• არ გაიმეოროთ რეგისტრაციის ბმული, თუ უკვე გაგზავნეთ წინა პასუხში.`,
    tr: `ACTIVE PLAYBOOK — KİMLİK BİLGİSİ:
Kısa mesaj (örn. "LS Dent. Rozeta.") soru değil — klinik/ad bilgisi. Teşekkür + salesLead kaydı. Önceki mesajda kayıt linki varsa tekrarlama.`,
    ru: `ACTIVE PLAYBOOK — КОНТАКТНЫЕ ДАННЫЕ:
Короткое сообщение — имя/клиника, не вопрос о продукте. Поблагодарите, сохраните в salesLead. Не повторяйте ссылку регистрации, если уже отправляли.`,
  };

  return `ACTIVE SALES PLAYBOOK (profile_identity):\n${templates[key] || templates.en}\n${parsedLine}`;
}

/**
 * Default CTA: free self-service clinic registration (not demo).
 * @param {string} lang
 */
function buildPrimaryCtaGuidance(lang) {
  const key = normalizeLocale(lang);
  const url = getCliniflyClinicRegisterUrl();

  if (key === "ka") {
    return `PRIMARY CTA (use when closing — do NOT ask for demo or meeting time unless visitor explicitly asked for a demo):
თქვენ შეგიძლიათ უფასოდ დაარეგისტრიროთ თქვენი კლინიკა საკრედიტო ბარათის გარეშე:

${url}

რეგისტრაციას მხოლოდ რამდენიმე წუთი სჭირდება.
Emphasize: free registration, no credit card, add clinic and start using the platform immediately.`;
  }
  if (key === "tr") {
    return `PRIMARY CTA (default — no demo push):
Kliniğinizi ücretsiz kaydedin — kredi kartı gerekmez; hemen kullanmaya başlayın.
${url}
Kayıt birkaç dakika sürer.`;
  }
  if (key === "ru") {
    return `PRIMARY CTA (default — no demo push):
Зарегистрируйте клинику бесплатно без карты и начните сразу:
${url}
Регистрация занимает несколько минут.`;
  }
  return `PRIMARY CTA (default — do NOT ask for demo or meeting unless visitor explicitly requested a demo):
Register your clinic free — no credit card — and start using Clinifly immediately.
${url}
Registration takes only a few minutes.`;
}

/**
 * @param {string} lang
 * @param {"clinic"|"patient"|"partner"|null} visitorType
 */
function buildVisitorDiscoveryPlaybook(lang, visitorType) {
  const key = normalizeLocale(lang);
  if (visitorType === "patient") {
    return `ACTIVE PLAYBOOK — VISITOR DISCOVERY (patient):
Stage 2 only. Visitor is a patient — NOT a clinic buyer.
• Warm, brief. Do NOT pitch Clinifly platform, pricing, registration, WhatsApp AI, or referrals.
• Tell them to contact their dental clinic directly or use the Clinifly patient app with the clinic code their clinic gave them.
• 1–2 sentences. Set salesLead.visitorType=patient.`;
  }
  if (visitorType === "partner") {
    return `ACTIVE PLAYBOOK — VISITOR DISCOVERY (partner):
Stage 2. They may be a partner/agency.
• Thank them; ask what kind of partnership they have in mind (one short question).
• No long product list yet. Set salesLead.visitorType=partner.`;
  }
  if (visitorType === "clinic") {
    return `ACTIVE PLAYBOOK — VISITOR DISCOVERY (clinic):
Stage 2. Visitor is from a clinic.
• Thank them; ask ONE discovery question: what they want help with (patient acquisition, WhatsApp/Messenger AI, international patients, pricing, or getting started).
• Do NOT dump all features in one message. No registration URL yet unless they asked how to start.
• Set salesLead.visitorType=clinic.`;
  }
  const generic = {
    en: `ACTIVE PLAYBOOK — VISITOR DISCOVERY (Stage 2):
Qualification was sent; reply is still unclear.
• Ask who they are: clinic owner/manager/dentist, patient, or partner — and what they need in one short message.
• No product pitch, no pricing, no registration link yet.`,
    ka: `ACTIVE PLAYBOOK — აღმოჩენა (ეტაპი 2):
კვლავ გაარკვიეთ: კლინიკის წარმომადგენელი, პაციენტი თუ პარტნიორი — და რა გჭირდებათ. პროდუქტის გრძელი აღწერა არა.`,
    tr: `ACTIVE PLAYBOOK — KEŞİF (Aşama 2):
Klinik temsilcisi mi, hasta mı, ortak mı — ve neye ihtiyaçları var? Uzun satış konuşması yok.`,
    ru: `ACTIVE PLAYBOOK — DISCOVERY (Этап 2):
Уточните: клиника, пациент или партнёр — и что нужно. Без длинного питча.`,
  };
  return `ACTIVE SALES PLAYBOOK (visitor_discovery):\n${generic[key] || generic.en}`;
}

/**
 * @param {string} lang
 */
function buildGreetingQualificationPlaybook(lang) {
  const key = normalizeLocale(lang);
  const blocks = {
    en: `ACTIVE PLAYBOOK — GREETING QUALIFICATION (Stage 1 ONLY):
The visitor only said hello / hi / salam — NOT a product question.
• Reply with 1–2 short sentences: welcome + ask if they are a clinic representative or a patient (or how you can help).
• FORBIDDEN this turn: product features, AI, WhatsApp, Messenger, referrals, pricing, registration URL, PBSC framework, demos.
• Max ~40 words. Set salesLead.notes to include stage=qualification.`,
    ka: `ACTIVE PLAYBOOK — მისალმება (მხოლოდ ეტაპი 1):
მომხმარებელმა მხოლოდ გამარჯობა/სალამი თქვა.
• მოკლე მისალმება + კითხვა: კლინიკის წარმომადგენელი ხართ თუ პაციენტი?
• აკრძალული: პროდუქტი, AI, WhatsApp, ფასები, რეგისტრაციის ბმული, გრძელი საუბარი.`,
    tr: `ACTIVE PLAYBOOK — SELAMLAMA (Aşama 1):
Sadece merhaba/selam.
• Kısa karşılama + klinik temsilcisi mi hasta mı?
• Yasak: ürün listesi, fiyat, kayıt linki.`,
    ru: `ACTIVE PLAYBOOK — ПРИВЕТСТВИЕ (Этап 1):
Только приветствие.
• Коротко поприветствуйте + клиника или пациент?
• Запрещено: питч, цены, ссылка на регистрацию.`,
  };
  return blocks[key] || blocks.en;
}

/**
 * @param {string} intent
 * @param {string} lang
 * @param {string} [message]
 */
function buildSalesPlaybookBlock(intent, lang, message = "") {
  if (intent === "greeting_qualification") {
    return buildGreetingQualificationPlaybook(lang);
  }
  if (intent === "visitor_discovery") {
    return buildVisitorDiscoveryPlaybook(lang, detectVisitorTypeFromMessage(message));
  }
  if (intent === "profile_identity") {
    return buildProfileIdentityPlaybook(message, lang);
  }

  const key = normalizeLocale(lang);
  /** @type {Record<string, Record<string, string>>} */
  const playbooks = {
    demo: {
      en: `ACTIVE PLAYBOOK — DEMO BOOKING (priority: skip long product pitch):
Problem: n/a — visitor is ready.
Benefit: 15-minute live walkthrough tailored to their clinic.
Solution to mention briefly: AI assistant, WhatsApp + Messenger integrations, international patient workflow, referral system.
CTA: Move directly to scheduling. Ask which day and time work. Set demoInterest=high and meetingInterest=true.`,
      ka: `ACTIVE PLAYBOOK — DEMO BOOKING:
დაიწყეთ დემოს დაჯავშნით — არ გაიმეოროთ პლატფორმის აღწერა.
მაგალითის სტილი: "დიახ, სიამოვნებით. დემო დაახლოებით 15 წუთს გრძელდება. გაჩვენებთ AI ასისტენტს, WhatsApp და Messenger ინტეგრაციებს, საერთაშორისო პაციენტების პროცესს და Referral სისტემას. რომელ დღეს და საათზე იქნებით ხელმისაწვდომი?"
CTA: დღე + საათი. demoInterest=high, meetingInterest=true.`,
      tr: `ACTIVE PLAYBOOK — DEMO:
Kısa onay → ~15 dk demo: AI asistan, WhatsApp/Messenger, uluslararası hasta akışı, referans sistemi. Hangi gün ve saat uygunsunuz? demoInterest=high.`,
      ru: `ACTIVE PLAYBOOK — DEMO:
Коротко подтвердите ~15‑мин демо: AI, WhatsApp/Messenger, международные пациенты, рефералы. Спросите день и время. demoInterest=high.`,
    },
    ai_messaging: {
      en: `ACTIVE PLAYBOOK — AI MESSAGING:
Problem: leads message after hours; staff cannot reply instantly → missed inquiries.
Benefit: faster responses, fewer lost leads, more booked conversations without hiring overnight staff.
Solution: 24/7 AI on WhatsApp + Messenger; 20+ languages including Georgian; human handoff when needed.
CTA: Use PRIMARY CTA — free self-service signup, no credit card. Do NOT offer demo unless asked.`,
      ka: `ACTIVE PLAYBOOK — AI შეტყობინებები:
პრობლემა: ნელი პასუხი → კარგავთ ლიდებს.
სარგებელი: 24/7 პასუხი, სწრაფი რეაგირება, ნაკლები გამოტოვებული შეტყობინება.
გადაწყვეტა: WhatsApp + Messenger AI, 20+ ენა (ქართულიც).
CTA: PRIMARY CTA — უფასო რეგისტრაცია, საკრედიტო ბარათის გარეშე. დემო მხოლოდ მაშინ, თუ თვითონ ითხოვენ.`,
      tr: `ACTIVE PLAYBOOK — AI MESAJ:
Problem: geç cevap → kaçan lead. Fayda: 7/24 yanıt. Çözüm: WhatsApp+Messenger AI, 20+ dil. CTA: PRIMARY CTA — ücretsiz kayıt, kredi kartı yok.`,
      ru: `ACTIVE PLAYBOOK — AI:
Проблема: медленные ответы → потеря лидов. Решение: WhatsApp+Messenger AI, 20+ языков. CTA: PRIMARY CTA — бесплатная регистрация без карты.`,
    },
    international_patients: {
      en: `ACTIVE PLAYBOOK — INTERNATIONAL PATIENTS:
Problem: international interest arrives via ads/DMs but clinics lose leads without fast multilingual follow-up.
Benefit: more international patients booked; structured intake instead of scattered chats.
Solution: Clinifly helps clinics attract more patients via advertising, international acquisition campaigns, WhatsApp AI, Messenger AI, and referral system. Current focus markets: UK, Israel, UAE (not exclusive).
CTA: PRIMARY CTA — try free yourself; no demo push.`,
      ka: `ACTIVE PLAYBOOK — საერთაშორისო პაციენტები:
პრობლემა: საერთაშორისო ინტერესი ეკლება, თუ პასუხი ნელია.
სარგებელი: მეტი საერთაშორისო პაციენტი, ნაკლები დაკარგული შეტყობინება.
გადაწყვეტა: რეკლამა, საერთაშორისო პაციენტების მიღება, WhatsApp AI, Messenger AI, Referral; ფოკუს ბაზრები: UK, Israel, UAE.
CTA: PRIMARY CTA — უფასო თვითსერვისი რეგისტრაცია.`,
      tr: `ACTIVE PLAYBOOK — ULUSLARARASI:
Problem: yurtdışı lead kaçıyor. Çözüm: reklam, WhatsApp/Messenger AI, referans; UK, İsrail, BAE. CTA: PRIMARY CTA.`,
      ru: `ACTIVE PLAYBOOK — МЕЖДУНАРОДНЫЕ:
Проблема: теряются иностранные лиды. Решение: реклама, WhatsApp/Messenger AI; UK, Израиль, ОАЭ. CTA: PRIMARY CTA.`,
    },
    pricing: {
      en: `ACTIVE PLAYBOOK — PRICING (first time explaining prices):
Problem: unclear ROI vs cost of missed leads.
Benefit: low-risk test then predictable monthly cost.
Solution: 2-month full trial, no credit card; Pro $29/mo; Premium for larger clinics (KB facts).
After answering pricing once, on follow-up turns do NOT repeat the same price list — advance with ROI and one next step (see PRICING FOLLOW-UP if present).
CTA: registration link only if you have not sent it in your previous reply.`,
      ka: `ACTIVE PLAYBOOK — ფასი: პრობლემა — ბიუჯეტი; გადაწყვეტა — უფასო ტესტი, Pro $29. შემდეგ ტურზე ფასების სია არ გაიმეოროთ — ბუნებრივად გადაინაცვლეთ ROI-ზე.`,
      tr: `ACTIVE PLAYBOOK — FİYAT: 2 ay deneme, kredi kartı yok; Pro 29$/ay. Sonraki mesajlarda fiyat tablosunu tekrarlama — ROI ile ilerle.`,
      ru: `ACTIVE PLAYBOOK — ЦЕНА: 2 мес trial, Pro $29. Не повторяйте прайс в следующих репликах — двигайте к ROI.`,
    },
    general: {
      en: `ACTIVE PLAYBOOK — GENERAL SALES:
Anchor every reply on clinic growth and patient acquisition (not feature documentation).
PBSC: (1) Pain (2) Business benefit (3) Clinifly solution from KB (4) PRIMARY CTA — self-service free signup.
Do NOT ask for demo, meeting, day/time, or phone call unless the visitor explicitly asked for a demo.`,
      ka: `ACTIVE PLAYBOOK: პრობლემა → სარგებელი → Clinifly გადაწყვეტა → PRIMARY CTA (უფასო რეგისტრაცია). დემო/შეხვედრა მხოლოდ მაშინ, თუ თვითონ ითხოვენ.`,
      tr: `ACTIVE PLAYBOOK: Problem → fayda → çözüm → PRIMARY CTA. Demo yalnızca açıkça istenirse.`,
      ru: `ACTIVE PLAYBOOK: Проблема → выгода → решение → PRIMARY CTA. Демо только по запросу.`,
    },
  };

  const block = playbooks[intent]?.[key] || playbooks[intent]?.en || playbooks.general.en;
  let out = `ACTIVE SALES PLAYBOOK (${intent}):\n${block}`;
  const skipPrimaryCta = intent === "demo" || intent === "greeting_qualification" || intent === "visitor_discovery";
  if (!skipPrimaryCta) {
    out += `\n\n${buildPrimaryCtaGuidance(lang)}`;
  }
  return out;
}

const SALES_STAGES_GUIDE = `CONVERSATION STAGES (follow in order):
Stage 1 — Qualification: pure hello/hi/salam only → welcome + ask clinic representative vs patient (or how can we help). NO product pitch.
Stage 2 — Discovery: learn visitor type (clinic owner, dentist, manager, patient, partner) and what they need. ONE question at a time. NO long feature lists.
Stage 3 — Sales: only after visitor type is clear (especially clinic/partner) → use PBSC, KB facts, registration CTA when appropriate.

If visitor is a patient → never sell the clinic platform; redirect to their clinic or patient app with clinic code.`;

const SALES_REPLY_FRAMEWORK = `${SALES_STAGES_GUIDE}

MANDATORY REPLY FRAMEWORK (Stage 3 — clinic/partner sales only):
1. Problem — one short line: what pain the clinic owner faces (lost leads, slow replies, no international funnel, etc.).
2. Benefit — one short line: business outcome (more patients, faster response, fewer missed DMs).
3. Clinifly solution — 1–2 lines: weave ONLY facts from the KB block; connect channels to growth (ads, WhatsApp/Messenger AI, referrals, UK/Israel/UAE when relevant).
4. CTA — default: free clinic registration at the canonical admin-register.html URL (no credit card, immediate access). Use the exact link from CLINIC REGISTRATION URL rules — never /sign-up or clinifly.net/ka.

Stages 1–2: do NOT use the PBSC framework. Keep replies under ~50 words unless the visitor asked a specific question.

CTA RULES (critical):
• Do NOT ask for a demo, meeting, day/time, or phone call after every answer.
• Do NOT repeat the same registration URL/CTA on back-to-back replies — skip the link if you already sent it last turn (see CTA GUARD).
• Do NOT aggressively schedule meetings or push live demos.
• Position Clinifly as easy to try: free trial, no credit card, self-service onboarding, immediate access.
• Offer a live demo ONLY when the visitor explicitly asks for a demo/meeting — then use the DEMO playbook.

PROFILE / IDENTITY MESSAGES (critical):
• Short messages like "LS Dent. Rozeta." are clinic name + contact name — NOT questions. Do not reply with a full product explanation.
• Save clinicName and contactName in salesLead; thank them briefly.
• If they send only a name or only a clinic name, treat the same way — update salesLead, acknowledge, one light follow-up.

SALES REP RULES:
• You are a Clinifly sales representative, NOT a documentation bot.
• Never open with "Clinifly is a platform…" or repeat the same generic paragraph across turns.
• Lead with outcomes (patients, revenue, booked conversations), not feature lists.
• Match the visitor's language exactly (including Georgian).
• Messenger length: about 3–5 short sentences; include registration link when giving PRIMARY CTA.
• Use the ACTIVE SALES PLAYBOOK section when present — it overrides generic tone for that turn.`;

module.exports = {
  detectSalesConversationIntent,
  isSalesGreetingOnlyMessage,
  isSalesProfileIdentityMessage,
  detectVisitorTypeFromMessage,
  conversationNeedsVisitorDiscovery,
  buildGreetingQualificationReply,
  parseProfileIdentityFromMessage,
  inferSalesConversationLanguage,
  buildAntiRepeatHint,
  buildCtaRepeatGuard,
  buildPricingFollowUpHint,
  buildSalesPlaybookBlock,
  buildPrimaryCtaGuidance,
  SALES_REPLY_FRAMEWORK,
  SALES_STAGES_GUIDE,
  getCliniflyClinicRegisterUrl,
};
