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
  /[?？]|\b(how|what|why|when|where|who|can|could|would|should|is|are|does|do|did|will|much|many|explain|tell me|როგორ|რა|სად|როდის|შემიძლია|გინდა|ნებას|მინდა|istiyorum|ister misin|var mı|nasıl|nedir|ne kadar|hangi|neden|neler)\b|\bne\b/i;

const VALUE_PROP_RE =
  /(ne işime|işime yarar|yarayabilir|nasıl yardım|size nasıl|how can (clinifly|you) help|what can clinifly|clinifly.*(help|do for|yarar)|clinifly nedir|clinifly ne|faydası ne|ne fayda|რა სარგებელი|როგორ დაგეხმარ|how does clinifly help)/i;

const PATIENT_ACQUISITION_RE =
  /(hasta edin|hasta kazan|patient acquisition|acquire patients?|get more patients?|want (more |additional )?patients?|need more patients?|more patients|grow (my )?patients?|find patients? for me|daha fazla hasta|bring (me )?patients?|yeni hasta|მეტი პაციენტ|პაციენტების მიღებ)/i;

const REGISTRATION_REQUEST_RE =
  /\b(register|sign[- ]?up|signup|kayıt|kayit|how do i (start|join)|get started|how to (start|join)|nasıl kayıt|nasil kayit|kayıt ol|kayit ol|ücretsiz deneme|ucretsiz deneme|başvur|basvur|join clinifly|create (my )?clinic account)\b/i;

/** Assistant already explained acquisition value (not just a CTA). */
const ACQUISITION_VALUE_DELIVERED_RE =
  /international patient|health tourism|whatsapp|messenger|referral|photo|treatment inquir|24\s*\/\s*7|automatically or (your )?staff|marketing and patient|uluslararası|referans|საერთაშორისო|რეფერალი|ფოტო/i;

const HOW_FIND_PATIENTS_RE =
  /(nasıl hasta bul|how (will|do) you find patients?|bana nasıl hasta|how do you get (me )?patients?|where do (the )?patients come from|hastaları nereden|როგორ იპოვით პაციენტ)/i;

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
function isSalesValuePropositionMessage(message) {
  return VALUE_PROP_RE.test(String(message || "").trim());
}

function isSalesPatientAcquisitionMessage(message) {
  const m = String(message || "").trim();
  return PATIENT_ACQUISITION_RE.test(m) || HOW_FIND_PATIENTS_RE.test(m);
}

function isSalesProfileIdentityMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 120) return false;
  if (isSalesGreetingOnlyMessage(m)) return false;
  if (QUESTION_HINT_RE.test(m)) return false;
  if (VALUE_PROP_RE.test(m) || PATIENT_ACQUISITION_RE.test(m) || HOW_FIND_PATIENTS_RE.test(m)) {
    return false;
  }
  if (/clinifly/i.test(m)) return false;
  if (DEMO_INTENT_RE.test(m) || PRICING_RE.test(m) || AI_MESSAGING_RE.test(m) || INTL_PATIENTS_RE.test(m)) {
    return false;
  }

  const wordCount = m.split(/\s+/).filter(Boolean).length;
  if (wordCount > 6) return false;

  const segments = m
    .split(/[.,;|/]+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  if (segments.length >= 2) {
    return segments.every((s) => s.length <= 48) && (CLINIC_NAME_HINT_RE.test(m) || m.length <= 72);
  }
  if (segments.length === 1) {
    if (m.length <= 48 && CLINIC_NAME_HINT_RE.test(m)) return true;
    if (m.length <= 36 && /^[A-Z\u10A0-\u10FF][\w.\s-]{1,30}$/u.test(m)) return true;
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
 * @returns {"demo"|"greeting_qualification"|"visitor_discovery"|"profile_identity"|"value_proposition"|"patient_acquisition"|"ai_messaging"|"international_patients"|"pricing"|"general"}
 */
function detectSalesConversationIntent(message, ctx = {}) {
  const m = String(message || "").trim();
  if (!m) return "general";
  if (DEMO_INTENT_RE.test(m)) return "demo";
  if (isSalesGreetingOnlyMessage(m)) return "greeting_qualification";
  if (isSalesPatientAcquisitionMessage(m)) return "patient_acquisition";
  if (isSalesValuePropositionMessage(m)) return "value_proposition";

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
    !INTL_PATIENTS_RE.test(m) &&
    !VALUE_PROP_RE.test(m) &&
    !PATIENT_ACQUISITION_RE.test(m)
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
Kısa mesaj (örn. "LS Dent. Rozeta.") soru değil — klinik/ad bilgisi. Teşekkür + salesLead kaydı.
YASAK: Mesajı "notunuzu aldım" diye tekrarlama; ürün sorusu gibi cevaplama. Önceki mesajda kayıt linki varsa tekrarlama.`,
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
function buildValuePropositionPlaybook(lang) {
  const key = normalizeLocale(lang);
  const blocks = {
    en: `ACTIVE PLAYBOOK — VALUE PROPOSITION:
The visitor asked what Clinifly can do for them (e.g. "how can Clinifly help me") — NOT profile/identity.
• Answer in 2–3 sentences: patient acquisition channels + WhatsApp/Messenger AI + international patient focus (use KB).
• FORBIDDEN: echoing their message as a "note", "thanks for your note about X", or asking only for role without any value.
• If visitor type unknown: one line of value, then ask clinic representative vs patient.
• NO registration URL this turn.`,
    tr: `ACTIVE PLAYBOOK — DEĞER ÖNERİSİ:
"Clinifly ne işime yarar" gibi soru — kimlik mesajı DEĞİL.
• 2–3 cümle: hasta kazanma kanalları (Meta/Google reklam, sağlık turizmi, referans) + WhatsApp/Messenger AI (KB).
• YASAK: "notunuzu aldım", mesajı alıntılayarak teşekkür, sadece rol sorusu.
• Tip bilinmiyorsa: kısa fayda + klinik temsilcisi mi hasta mı?
• Bu turda kayıt linki YOK.`,
    ka: `ACTIVE PLAYBOOK — ღირებულება:
პროდუქტის კითხვაა — არა პროფილი. მოკლე სარგებელი + საჭიროებისას კლინიკა თუ პაციენტი. რეგისტრაციის ბმული არა.`,
    ru: `ACTIVE PLAYBOOK — ЦЕННОСТЬ:
Вопрос о пользе Clinifly — не контактные данные. 2–3 предложения о пользе + уточните клиника или пациент. Без ссылки регистрации.`,
  };
  return blocks[key] || blocks.en;
}

const PATIENT_ACQUISITION_VALUE_POINTS = `MANDATORY VALUE POINTS (cover in natural prose — sell outcome first):
1) International patients can discover and contact clinics through Clinifly.
2) Patients can send photos and treatment inquiries.
3) AI answers WhatsApp, Messenger, and Clinifly messages 24/7.
4) Clinics choose automatic AI replies or staff-handled conversations.
5) Referral system helps existing patients invite new patients.
6) International patient communication and health-tourism workflows (UK, Israel, UAE when relevant).
7) Marketing and patient-acquisition activities can drive new opportunities to partner clinics.
FORBIDDEN this turn: registration URL, "register free", "no credit card", admin-register.html, or any signup CTA.
Close with ONE soft line: when ready they can ask how to register — do not paste the link until they ask.`;

function buildPatientAcquisitionPlaybook(lang) {
  const key = normalizeLocale(lang);
  const blocks = {
    en: `ACTIVE PLAYBOOK — PATIENT ACQUISITION (VALUE FIRST):
They want more patients or ask HOW Clinifly finds patients.
${PATIENT_ACQUISITION_VALUE_POINTS}
• 4–6 short sentences or bullets; outcome before signup.
• Optional one follow-up: international vs local focus, or ads vs AI replies.`,
    tr: `ACTIVE PLAYBOOK — HASTA KAZANMA (ÖNCE DEĞER):
Daha fazla hasta / nasıl hasta bulursunuz.
${PATIENT_ACQUISITION_VALUE_POINTS}
• 4–6 kısa cümle; kayıt linki ve "ücretsiz kayıt" YASAK bu turda.
• Kapanış: hazır olunca "nasıl kayıt olurum" yazabilirler — link yok.`,
    ka: `ACTIVE PLAYBOOK — პაციენტების მიღება (ჯერ ღირებულება):
${PATIENT_ACQUISITION_VALUE_POINTS}
• რეგისტრაციის ბმული ამ ტურზე არა.`,
    ru: `ACTIVE PLAYBOOK — ПРИВЛЕЧЕНИЕ (СНАЧАЛА ЦЕННОСТЬ):
${PATIENT_ACQUISITION_VALUE_POINTS}
• Без ссылки регистрации в этом ответе.`,
  };
  return blocks[key] || blocks.en;
}

/**
 * Deterministic value-first reply when acquisition intent must not jump to signup.
 * @param {string} lang
 */
function buildPatientAcquisitionValueFirstReply(lang) {
  const key = normalizeLocale(lang);
  if (key === "tr") {
    return (
      "Harika soru — önce Clinifly kliniklere nasıl hasta kazandırır:\n\n" +
      "• Uluslararası hastalar Clinifly üzerinden kliniğinizi keşfedip doğrudan iletişime geçebilir.\n" +
      "• Hastalar fotoğraf ve tedavi talebi gönderebilir; lead’leri daha hızlı değerlendirirsiniz.\n" +
      "• Yapay zeka WhatsApp, Messenger ve Clinifly mesajlarına 7/24 yanıt verir.\n" +
      "• AI’nın otomatik yanıt vermesini veya ekibinizin konuşmaları yönetmesini siz seçersiniz.\n" +
      "• Referans sistemi mevcut hastaların yeni hasta davet etmesine yardımcı olur.\n" +
      "• Uluslararası hasta iletişimi ve sağlık turizmi süreçlerini destekleriz.\n" +
      "• Pazarlama ve hasta kazanma faaliyetleri ortak kliniklere yeni fırsatlar getirebilir.\n\n" +
      "Kliniğiniz için denemeye hazır olduğunuzda «nasıl kayıt olurum» yazmanız yeterli — ücretsiz self-servis kayıt (kredi kartı gerekmez)."
    );
  }
  if (key === "ka") {
    return (
      "კარგი კითხვაა — ჯერ როგორ ეხმარება Clinifly კლინიკას მეტი პაციენტის მიღებაში:\n\n" +
      "• საერთაშორისო პაციენტები Clinifly-ით აღმოაჩენენ თქვენს კლინიკას და დაგიკავშირდებიან.\n" +
      "• პაციენტები ფოტოს და მკურნალობის მოთხოვნას გამოგიგზავნიან.\n" +
      "• AI პასუხობს WhatsApp, Messenger და Clinifly შეტყობინებებს 24/7.\n" +
      "• ირჩევთ ავტომატურ AI პასუხს თუ თქვენი გუნდი მართავს საუბრებს.\n" +
      "• რეფერალური სისტემა არსებულ პაციენტებს ახალი პაციენტის მოწვევაში ეხმარება.\n" +
      "• საერთაშორისო პაციენტების კომუნიკაცია და სამედიცინო ტურიზმი.\n" +
      "• მარკეტინგი და პაციენტების მიღება ახალ შესაძლებლობებს აძლევს პარტნიორ კლინიკებს.\n\n" +
      "როცა მზად იქნებით, დაწერეთ «როგორ დავრეგისტრირდე» — უფასო რეგისტრაცია, საკრედიტო ბარათის გარეშე."
    );
  }
  if (key === "ru") {
    return (
      "Вот как Clinifly помогает клиникам получать больше пациентов:\n\n" +
      "• Международные пациенты находят клинику через Clinifly и пишут напрямую.\n" +
      "• Можно отправить фото и запрос на лечение.\n" +
      "• AI отвечает в WhatsApp, Messenger и Clinifly 24/7.\n" +
      "• Вы выбираете автоответы AI или работу сотрудников.\n" +
      "• Реферальная система приглашает новых пациентов через существующих.\n" +
      "• Поддержка международной коммуникации и медицинского туризма.\n" +
      "• Маркетинг и привлечение пациентов дают новые возможности партнёр-клиникам.\n\n" +
      "Когда будете готовы — напишите «как зарегистрироваться»; регистрация бесплатная, без карты."
    );
  }
  return (
    "Here's how Clinifly helps clinics get more patients:\n\n" +
    "• Clinifly helps patients discover your clinic and contact you directly.\n" +
    "• Our goal is not only messages — we help turn inquiries into appointments.\n" +
    "• The AI assistant answers patient questions, requests photos, shares treatment information, and replies 24/7.\n" +
    "• Your team can join or take over conversations whenever they want.\n" +
    "• Clinifly AI communicates in 20+ languages — great for international patients.\n" +
    "• Patients get immediate answers; your staff spends less time on repetitive questions.\n" +
    "• International patients can ask questions, send photos, and get information before they travel.\n\n" +
    "When you're ready to try this with your clinic, say \"how do I register\" — free signup, no credit card required."
  );
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function assistantRecentlyDeliveredAcquisitionValue(recentTurns) {
  return (recentTurns || [])
    .filter((t) => t.role === "assistant")
    .slice(-3)
    .some((t) => ACQUISITION_VALUE_DELIVERED_RE.test(String(t.text || "")));
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string} message
 */
function visitorRequestedRegistration(message) {
  return REGISTRATION_REQUEST_RE.test(String(message || "").trim());
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string} message
 */
function shouldUsePatientAcquisitionValueFirstReply(recentTurns, message) {
  if (visitorRequestedRegistration(message)) return false;
  if (assistantRecentlyDeliveredAcquisitionValue(recentTurns)) return false;
  return true;
}

/**
 * @param {string} replyText
 */
function replyContainsRegistrationCta(replyText) {
  const text = String(replyText || "");
  const url = getCliniflyClinicRegisterUrl();
  if (text.includes("admin-register")) return true;
  if (url && text.includes(url.replace(/^https?:\/\//i, ""))) return true;
  return /\b(register (your )?clinic|free registration|sign[- ]?up|kayıt ol|ücretsiz kayıt|no credit card)\b/i.test(
    text,
  );
}

/**
 * Strip registration URLs and signup CTAs from a reply (value-first enforcement).
 * @param {string} replyText
 */
function stripRegistrationCtaFromReply(replyText) {
  const url = getCliniflyClinicRegisterUrl();
  let out = String(replyText || "");
  if (url) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "");
  }
  out = out.replace(/https?:\/\/[^\s]*admin-register[^\s]*/gi, "");
  out = out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[-•]\s*.*\b(register|kayıt|sign[- ]?up|no credit card|ücretsiz kayıt)[^\n]*\n?/gim, "")
    .trim();
  return out.trim();
}

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
  if (intent === "value_proposition") {
    return buildValuePropositionPlaybook(lang);
  }
  if (intent === "patient_acquisition") {
    return buildPatientAcquisitionPlaybook(lang);
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
Solution: Clinifly helps clinics get more patient inquiries through discovery, fast replies on WhatsApp and Messenger, referrals, and support for international patients. Current focus markets: UK, Israel, UAE (not exclusive).
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
Problem: slow replies and missed messages cost appointments.
Benefit: low-risk test then predictable monthly cost.
Solution: 2-month full trial, no credit card; Pro $29/mo; Premium for larger clinics (KB facts).
After answering pricing once, on follow-up turns do NOT repeat the same price list — advance naturally (see PRICING FOLLOW-UP if present).
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
  const skipPrimaryCta =
    intent === "demo" ||
    intent === "greeting_qualification" ||
    intent === "visitor_discovery" ||
    intent === "value_proposition" ||
    intent === "patient_acquisition";
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
1. Problem — one short line: what pain the clinic owner faces (slow replies, missed messages, lost international patients, too much repetitive chat).
2. Benefit — one short line: business outcome (more patient inquiries, faster responses, more appointments, less staff workload).
3. Clinifly solution — 1–2 lines: weave ONLY facts from the KB block. Example style: "Clinifly can answer WhatsApp, Messenger, and Clinifly messages 24/7, helping you turn more inquiries into appointments." Do NOT use jargon (no omnichannel, workflow automation, ecosystem, SaaS).
4. CTA — default: free clinic registration at the canonical admin-register.html URL (no credit card, immediate access). Use the exact link from CLINIC REGISTRATION URL rules — never /sign-up or clinifly.net/ka.

Stages 1–2: do NOT use the PBSC framework. Keep replies under ~50 words unless the visitor asked a specific question.

CTA RULES (critical):
• Do NOT ask for a demo, meeting, day/time, or phone call after every answer.
• Do NOT repeat the same registration URL/CTA on back-to-back replies — skip the link if you already sent it last turn (see CTA GUARD).
• Do NOT aggressively schedule meetings or push live demos.
• Position Clinifly as easy to try: free trial, no credit card, self-service onboarding, immediate access.
• Offer a live demo ONLY when the visitor explicitly asks for a demo/meeting — then use the DEMO playbook.

VALUE / ACQUISITION QUESTIONS (critical):
• "Clinifly ne işime yarar", "how can Clinifly help", "I want more patients", "hasta edinmek istiyorum" are product questions — NOT profile identity. Never reply with "thanks for your note about …".
• Patient acquisition: sell the outcome first (international discovery, photos/inquiries, 24/7 AI on WhatsApp/Messenger/Clinifly, staff vs auto, referrals, health tourism, marketing). Registration URL ONLY after value was explained OR visitor explicitly asks how to register.

PROFILE / IDENTITY MESSAGES (critical):
• Short messages like "LS Dent. Rozeta." are clinic name + contact name — NOT questions. Do not reply with a full product explanation.
• Save clinicName and contactName in salesLead; thank them briefly.
• If they send only a name or only a clinic name, treat the same way — update salesLead, acknowledge, one light follow-up.

SALES REP RULES:
• You are a Clinifly sales representative, NOT a documentation bot.
• Never open with "Clinifly is a platform…" or repeat the same generic paragraph across turns.
• Lead with outcomes (more inquiries, appointments, faster replies), not feature lists or platform terminology.
• Match the visitor's language exactly (including Georgian).
• Messenger length: about 3–5 short sentences; include registration link when giving PRIMARY CTA.
• Use the ACTIVE SALES PLAYBOOK section when present — it overrides generic tone for that turn.`;

module.exports = {
  detectSalesConversationIntent,
  isSalesGreetingOnlyMessage,
  isSalesValuePropositionMessage,
  isSalesPatientAcquisitionMessage,
  isSalesProfileIdentityMessage,
  buildPatientAcquisitionValueFirstReply,
  shouldUsePatientAcquisitionValueFirstReply,
  visitorRequestedRegistration,
  replyContainsRegistrationCta,
  stripRegistrationCtaFromReply,
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
