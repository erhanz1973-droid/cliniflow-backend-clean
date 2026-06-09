/**
 * Clinifly Sales AI — conversation intent playbooks (PBSC: Problem → Benefit → Solution → CTA).
 */

const {
  getCliniflyClinicRegisterUrl,
  getCliniflyTutorialYoutubeUrl,
} = require("./cliniflyClinicRegisterUrl");
const {
  detectMessageLanguage,
  looksClearlyEnglish,
  normalizeLangCode,
} = require("./conversationLanguage");

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
  /[?？]|\b(how|what|why|when|where|who|can|could|would|should|is|are|does|do|did|will|much|many|explain|tell me|როგორ|რა|სად|როდის|შემიძლია|გინდა|ნებას|მინდა|istiyorum|ister misin|var mı|nasıl|nedir|ne kadar|hangi|neden|niye|neler)\b|\bne\b/i;

const VALUE_PROP_RE =
  /(ne işime|işime yarar|yarayabilir|nasıl yardım|size nasıl|how can (clinifly|you) help|what can clinifly|clinifly.*(help|do for|yarar)|clinifly nedir|clinifly ne|faydası ne|ne fayda|რა სარგებელი|როგორ დაგეხმარ|how does clinifly help)/i;

const PATIENT_ACQUISITION_RE =
  /(hasta edin|hasta kazan|patient acquisition|acquire patients?|get more patients?|want (more |additional )?patients?|need more patients?|more patients|grow (my )?patients?|find patients? for me|daha fazla hasta|bring (me )?patients?|yeni hasta|მეტი პაციენტ|პაციენტების მიღებ)/i;

const REGISTRATION_REQUEST_RE =
  /\b(register|sign[- ]?up|signup|kayıt|kayit|how do i (start|join)|get started|how to (start|join)|nasıl kayıt|nasil kayit|kayıt ol|kayit ol|ücretsiz deneme|ucretsiz deneme|başvur|basvur|join clinifly|create (my )?clinic account)\b/i;

const TUTORIAL_VIDEO_RE =
  /(how to use|tutorial|training video|usage video|instructional video|egitim video|eğitim video|egitici video|eğitici video|kullanim video|kullanım video|kullan.*video|video.*kullan|nasıl kullan|nasil kullan|video var|videolar|videolarınız|videolariniz|do you have.*video|any video|youtube|izle|watch.*video)/i;

/** Visitor asks to switch reply language (e.g. "Can you answer in English"). */
const SALES_LANGUAGE_SWITCH_RE =
  /\b(in english|answer in english|speak english|reply in english|write in english|talk in english|english please|can you (answer|reply|speak|write) (in )?english|could you (answer|reply|speak|write) (in )?english|can't you answer in english|cant you answer in english|do you speak english|ingilizce|türkçe|turkce|in turkish|in georgian|in russian|in arabic|arabic please|بالعربية|العربية|عربي|на русском|по-русски|ქართულად)\b/i;

/**
 * @param {string} message
 * @returns {"en"|"tr"|"ka"|"ru"|"ar"|null}
 */
function detectSalesRequestedLanguage(message) {
  const m = String(message || "").trim();
  if (!m || !SALES_LANGUAGE_SWITCH_RE.test(m)) return null;
  if (/\b(turkish|türkçe|turkce|in turkish)\b/i.test(m)) return "tr";
  if (/\b(georgian|ქართ|kartuli|in georgian)\b/i.test(m)) return "ka";
  if (/\b(russian|русск|на русском|по-русски|in russian)\b/i.test(m)) return "ru";
  if (/\b(arabic|in arabic|arabic please|بالعربية|العربية|عربي)\b/i.test(m) || /بالعربية|العربية/.test(m)) {
    return "ar";
  }
  return "en";
}

/**
 * @param {string} message
 */
function isSalesLanguageSwitchMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 120) return false;
  return Boolean(detectSalesRequestedLanguage(m));
}

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

/** Short agreement / acknowledgment — must not restart Stage 1 qualification mid-chat. */
const ACKNOWLEDGMENT_PHRASE_RE =
  /^(mantıklı|mantikli|bence de|bencede|evet|tamam|olur|peki|haklısın|haklisin|doğru|dogru|kesinlikle|süper|super|harika|güzel|guzel|anladım|anladim|tabii|tabi|ok|okay|yes|yeah|yep|sure|right|exactly|agreed|makes sense|logical|i think so too|me too|thanks|thank you|teşekkür|tesekkur|sağol|sagol|thx|cool|nice|great|perfect|fair enough|sounds good|that makes sense|კარგი|სწორია|თანახმა|დიახ|ხო|სწორედ|ჰო|да|согласен|верно|хорошо|ок|ага)([!.,\s👍🙂😊]*|$)/i;

/** Visitor already said we repeated ourselves — continue topic, never restart Stage 1. */
const REPETITION_COMPLAINT_RE =
  /^(söylemiştin|soylemistin|söyledin|soyledin|demiştin|demistin|zaten söyledin|zaten soyledin|bunu söyledin|bunu soyledin|tekrar etme|tekrar ettin|yine aynı|aynı şey|ayni sey|you already said|already told|said that already|you said that|told me already|repeat(ing)?|გაიმეორე|უკვე მითხარი|уже говорил|уже сказал)([!.,\s]*|$)/i;

/** Short visitor-type answer only (Stage 2 identity). */
const VISITOR_TYPE_ONLY_RE =
  /^(sahibi|sahibiyim|owner|manager|yönetici|yonetici|mudur|müdür|dentist|doctor|hekim|diş hekimi|dis hekimi|klinik sahibi|clinic owner|clinic manager|patient|hasta|hastayım|hastayim|partner|ortak|წარმომადგენელი|მენეჯერი|პაციენტ)([!.,\s]*|$)/i;

/**
 * Message must not be parsed as a person's name or clinic identity.
 * @param {string} message
 */
function isSalesReservedPhraseMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 48) return false;
  if (
    isSalesRepetitionComplaintMessage(m) ||
    isSalesQualificationWhyMessage(m) ||
    isSalesVisitorTypeOnlyMessage(m) ||
    isSalesAcknowledgmentMessage(m)
  ) {
    return true;
  }
  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim()
    .toLowerCase();
  return SALES_RESERVED_PHRASE_RE.test(stripped);
}

/**
 * LLM echoed the visitor's message as if it were their name.
 * @param {string} message
 * @param {string} reply
 */
function looksLikeSalesMisnamedReply(message, reply) {
  const msg = String(message || "").trim();
  const text = String(reply || "").trim();
  if (!msg || !text || msg.length > 40) return false;
  if (!isSalesReservedPhraseMessage(msg) && !isSalesQualificationWhyMessage(msg)) return false;
  const escaped = msg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(escaped, "i").test(text) && /notunuzu|not aldım|not aldim|I've noted|saved it|kaydettim|aldım|aldim/i.test(text)) {
    return true;
  }
  if (/^merhaba\s+/i.test(text) && new RegExp(`merhaba\\s+${escaped}\\b`, "i").test(text)) {
    return true;
  }
  return false;
}

/**
 * @param {string} message
 */
function isSalesTutorialVideoQuery(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 180) return false;
  if (DEMO_INTENT_RE.test(m) && !/\bvideo\b|youtube|izle/i.test(m)) return false;
  return TUTORIAL_VIDEO_RE.test(m);
}

/**
 * @param {string} reply
 */
function looksLikeDeniesTutorialVideos(reply) {
  const text = String(reply || "").trim();
  if (!text) return false;
  return /(?:video.*(?:yok|yoktur|bulunmuyor|mevcut değil|mevcut degil)|(?:yok|don't have|do not have|no ).*(?:video|tutorial)|şu anda.*video.*yok|su anda.*video.*yok|we don't have.*video|no usage video|no tutorial|videolarımız yok|videolarimiz yok)/i.test(
    text,
  );
}

/**
 * @param {string} lang
 */
function buildTutorialVideosReply(lang) {
  const url = getCliniflyTutorialYoutubeUrl();
  const key = normalizeLocale(lang);
  if (key === "ka") {
    return `დიახ — Clinifly-ის გამოყენებისა და სასწავლო ვიდეოები ჩვენს YouTube არხზეა: ${url}\n\nიქ ნახავთ კლინიკის რეგისტრაციას, AI პარამეტრებს, WhatsApp/Messenger-ის დაკავშირებასა და ადმინ პანელის ნაბიჯებს. კონკრეტული თემა გაქვთ — დაწერეთ, შესაბამის ვიდეოს მივუთითებ.`;
  }
  if (key === "tr") {
    return `Evet — Clinifly kullanım ve eğitim videoları YouTube kanalımızda: ${url}\n\nOrada klinik kaydı, AI ayarları, WhatsApp/Messenger bağlantısı ve admin paneli adımlarını bulabilirsiniz. Belirli bir konu varsa yazın, ilgili videoyu işaret edelim.`;
  }
  if (key === "ru") {
    return `Да — у Clinifly есть обучающие видео на YouTube: ${url}\n\nТам регистрация клиники, настройки AI, подключение WhatsApp/Messenger и шаги в админ-панели. Напишите тему — подскажу нужное видео.`;
  }
  return `Yes — Clinifly has official how-to and training videos on our YouTube channel: ${url}\n\nYou'll find clinic registration, AI settings, WhatsApp/Messenger setup, and admin panel walkthroughs. Tell me your topic and I'll point you to the right video.`;
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function recentTurnsMentionTutorialVideos(recentTurns) {
  return (recentTurns || []).some((t) => {
    const text = String(t.text || "");
    if (t.role === "user" && isSalesTutorialVideoQuery(text)) return true;
    if (
      t.role === "assistant" &&
      (looksLikeDeniesTutorialVideos(text) || /\b(video|youtube|tutorial|eğitim|egitim)\b/i.test(text))
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Pushback after bot wrongly denied tutorial videos (e.g. "Neden yok. Olmalı").
 * @param {string} message
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function isSalesTutorialVideoPushbackMessage(message, recentTurns = []) {
  const m = String(message || "").trim();
  if (!m || m.length > 96) return false;
  if (!recentTurnsMentionTutorialVideos(recentTurns)) return false;
  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim()
    .toLowerCase();
  if (/^(neden yok|niye yok|olmalı|olmalıydı|olmali|olmali|there should|should have|why not|why no|yok dedin|videolar.*olmal)/i.test(stripped)) {
    return true;
  }
  if (/\b(neden|niye|why)\b/.test(stripped) && /\b(yok|no|not)\b/.test(stripped)) return true;
  if (/^(olmalı|olmali|there should|should exist|must have)/i.test(stripped)) return true;
  return false;
}

/**
 * @param {string} lang
 */
function buildTutorialVideoCorrectionReply(lang) {
  const url = getCliniflyTutorialYoutubeUrl();
  const key = normalizeLocale(lang);
  if (key === "ka") {
    return `სამართალი ხართ — ბოდიშით, არასწორად გითხარით. Clinifly-ის სასწავლო ვიდეოები აქ არის: ${url}`;
  }
  if (key === "tr") {
    return `Haklısınız, özür dilerim — yanlış bilgi verdim. Clinifly kullanım ve eğitim videolarımız YouTube kanalımızda: ${url}\n\nKlinik kaydı, AI ayarları ve WhatsApp/Messenger kurulumu için oradaki videolara bakabilirsiniz.`;
  }
  if (key === "ru") {
    return `Вы правы — извините за ошибку. Обучающие видео Clinifly здесь: ${url}`;
  }
  return `You're right — sorry for the wrong info. Clinifly tutorial videos are here: ${url}`;
}

/**
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function conversationHasPriorAssistantExchange(recentTurns) {
  return (recentTurns || []).some(
    (t) => t.role === "assistant" && String(t.text || "").trim().length > 20,
  );
}

/**
 * @param {string} reply
 */
function looksLikeGreetingQualificationRestartReply(reply) {
  const text = String(reply || "").trim();
  if (!text) return false;
  const asksRole =
    /temsilcisi misiniz|klinik temsilcisi|clinic representative|representative or a patient|წარმომადგენელი.*პაციენტ|patient\?/i.test(
      text,
    );
  if (!asksRole) return false;
  if (/merhaba|hello|welcome|hoş geldin|Öncelikle|first of all|daha iyi yönlendir|guide you better|Bir klinik temsilcisi/i.test(text)) {
    return true;
  }
  return /Size nasıl yardımcı olabilirim/i.test(text);
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string|null|undefined} conversationSummary
 * @param {Record<string, unknown>|null|undefined} channelMetadata
 */
function shouldBlockQualificationRestartReply(recentTurns, conversationSummary, channelMetadata) {
  return (
    conversationHasPriorAssistantExchange(recentTurns) ||
    conversationPastQualificationStage(recentTurns, conversationSummary, channelMetadata)
  );
}

/**
 * @param {string} lang
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function buildMidChatContinuationReply(lang, recentTurns = []) {
  const key = normalizeLocale(lang);
  if (recentTurnsMentionTutorialVideos(recentTurns)) {
    return buildTutorialVideoCorrectionReply(lang);
  }
  if (key === "ka") {
    return "ბოდიშით — საუბარს თავიდან არ უნდა დავიწყებდე. რით დაგეხმაროთ: ვიდეოები, რეგისტრაცია, WhatsApp/Messenger თუ სხვა თემა?";
  }
  if (key === "tr") {
    return "Özür dilerim — sohbeti baştan açmama gerek yoktu. Size nasıl yardımcı olayım: eğitim videoları, kayıt, WhatsApp/Messenger veya başka bir konu?";
  }
  if (key === "ru") {
    return "Извините — не нужно было начинать диалог заново. Чем помочь: видео, регистрация, WhatsApp/Messenger или другая тема?";
  }
  return "Sorry — I shouldn't have restarted the conversation. What would you like help with: tutorial videos, registration, WhatsApp/Messenger, or something else?";
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string|null|undefined} conversationSummary
 * @param {Record<string, unknown>|null|undefined} channelMetadata
 */
function buildPastQualificationHint(recentTurns, conversationSummary, channelMetadata) {
  if (!shouldBlockQualificationRestartReply(recentTurns, conversationSummary, channelMetadata)) {
    return "";
  }
  return (
    "CRITICAL — ONGOING CONVERSATION: Do NOT greet with Merhaba/Hello again. " +
    "Do NOT ask clinic representative vs patient again. Continue the SAME topic from recent messages."
  );
}

/**
 * Deterministic reply for reserved visitor phrases — bypasses LLM.
 * @param {string} message
 * @param {string} lang
 * @param {Record<string, unknown>|null|undefined} [channelMetadata]
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function resolveSalesDirectReply(message, lang, channelMetadata, recentTurns = []) {
  const m = String(message || "").trim();
  if (!m) return null;
  const requestedLang = detectSalesRequestedLanguage(m);
  if (requestedLang) {
    return {
      reply: buildSalesLanguageSwitchAckReply(requestedLang, recentTurns),
      intent: "language_switch",
      visitorType: null,
    };
  }
  if (isSalesTutorialVideoQuery(m)) {
    return { reply: buildTutorialVideosReply(lang), intent: "tutorial_videos", visitorType: null };
  }
  if (isSalesTutorialVideoPushbackMessage(m, recentTurns)) {
    return { reply: buildTutorialVideoCorrectionReply(lang), intent: "tutorial_videos", visitorType: null };
  }
  if (isSalesRepetitionComplaintMessage(m)) {
    return { reply: buildRepetitionComplaintReply(lang), intent: "general", visitorType: null };
  }
  if (isSalesVisitorTypeOnlyMessage(m)) {
    const visitorType = detectVisitorTypeFromMessage(m);
    return {
      reply: buildVisitorTypeAckReply(lang, visitorType),
      intent: "visitor_discovery",
      visitorType,
    };
  }
  if (isSalesQualificationWhyMessage(m)) {
    const lead =
      channelMetadata?.clinifly_sales_lead && typeof channelMetadata.clinifly_sales_lead === "object"
        ? channelMetadata.clinifly_sales_lead
        : null;
    const fromHistory = [...(recentTurns || [])]
      .reverse()
      .find((t) => t.role === "user" && detectVisitorTypeFromMessage(String(t.text || "")));
    const visitorType =
      detectVisitorTypeFromMessage(m) ||
      (lead?.visitorType ? String(lead.visitorType) : null) ||
      (fromHistory ? detectVisitorTypeFromMessage(String(fromHistory.text || "")) : null);
    return {
      reply: buildQualificationWhyReply(lang, visitorType),
      intent: "visitor_discovery",
      visitorType,
    };
  }
  return null;
}

const SUBSTANTIVE_ASSISTANT_RE =
  /whatsapp|messenger|international|referral|24\s*\/\s*7|yapay zeka|\bai\b|kayıt|register|admin-register|fiyat|pricing|\$29|premium|hasta kazan|patient acquisition|clinifly|yönetici|klinik sahibi|დემო|რეგისტრ/i;

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
 * @param {string} message
 */
function isSalesRepetitionComplaintMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 72) return false;
  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim()
    .toLowerCase();
  if (!stripped) return false;
  if (REPETITION_COMPLAINT_RE.test(stripped)) return true;
  return /\b(zaten|already|again|tekrar|repeat|yine aynı|ayni sey|you said)\b/i.test(stripped) && stripped.length <= 48;
}

/**
 * @param {string} message
 */
function isSalesVisitorTypeOnlyMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 40) return false;
  if (QUESTION_HINT_RE.test(m)) return false;
  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim()
    .toLowerCase();
  return (
    VISITOR_TYPE_ONLY_RE.test(stripped) ||
    (Boolean(detectVisitorTypeFromMessage(m)) && stripped.split(/\s+/).length <= 3)
  );
}

/** Pushback on why we ask clinic vs patient (after qualification question). */
const QUALIFICATION_WHY_RE =
  /^(niye ki|niye|neden ki|neden|why though|why ask|why do you ask|why does it matter|რატომ|зачем|почему)([!.,\s?]*|$)/i;

/** Must never be stored or echoed as contactName (roles, fillers, pushback). */
const SALES_RESERVED_PHRASE_RE =
  /^(sahibi|sahibiyim|owner|manager|yönetici|yonetici|mudur|müdür|dentist|doctor|hekim|diş hekimi|dis hekimi|klinik sahibi|clinic owner|clinic manager|patient|hasta|hastayım|hastayim|partner|ortak|niye|neden|niye ki|neden ki|tamam|evet|olur|peki|merhaba|selam|hello|hi|ok|okay|yes|söylemiştin|soylemistin|tekrar|why though|why)([!.,\s?]*|$)/i;

/**
 * @param {string} message
 */
function isSalesQualificationWhyMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 48) return false;
  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim()
    .toLowerCase();
  return QUALIFICATION_WHY_RE.test(stripped);
}

function isSalesAcknowledgmentMessage(message) {
  const m = String(message || "").trim();
  if (!m || m.length > 56) return false;
  if (isSalesRepetitionComplaintMessage(m)) return true;
  if (QUESTION_HINT_RE.test(m)) return false;
  if (isSalesGreetingOnlyMessage(m)) return false;
  if (PRICING_RE.test(m) || DEMO_INTENT_RE.test(m) || VALUE_PROP_RE.test(m)) return false;
  if (PATIENT_ACQUISITION_RE.test(m) || AI_MESSAGING_RE.test(m) || INTL_PATIENTS_RE.test(m)) return false;
  if (detectVisitorTypeFromMessage(m) && !isSalesVisitorTypeOnlyMessage(m)) return false;

  const stripped = m
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF}]/gu, "")
    .replace(/[!.,?]+/g, " ")
    .trim();
  if (!stripped) return false;
  if (ACKNOWLEDGMENT_PHRASE_RE.test(stripped)) return true;

  const tokens = stripped.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length <= 3) {
    const ackWords = new Set([
      "mantıklı",
      "mantikli",
      "bence",
      "de",
      "evet",
      "tamam",
      "olur",
      "peki",
      "ok",
      "okay",
      "yes",
      "yeah",
      "sure",
      "thanks",
      "thank",
      "you",
      "teşekkürler",
      "tesekkurler",
      "sağol",
      "sagol",
      "anladım",
      "anladim",
      "haklısın",
      "haklisin",
      "doğru",
      "dogru",
      "super",
      "süper",
      "harika",
      "güzel",
      "guzel",
      "logical",
      "agreed",
      "exactly",
      "right",
      "კარგი",
      "სწორია",
      "თანახმა",
      "დიახ",
      "ხო",
    ]);
    if (tokens.every((t) => ackWords.has(t))) return true;
  }
  return false;
}

/**
 * True once qualification is done and the chat has moved to product/sales topics.
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string|null|undefined} conversationSummary
 * @param {Record<string, unknown>|null|undefined} channelMetadata
 */
function conversationPastQualificationStage(recentTurns, conversationSummary, channelMetadata) {
  const lead =
    channelMetadata?.clinifly_sales_lead && typeof channelMetadata.clinifly_sales_lead === "object"
      ? channelMetadata.clinifly_sales_lead
      : null;
  if (lead?.visitorType) return true;

  if (
    channelMetadata?.clinifly_sales_kb &&
    typeof channelMetadata.clinifly_sales_kb === "object" &&
    channelMetadata.clinifly_sales_kb.sales_intent
  ) {
    return true;
  }

  const summary = String(conversationSummary || "").trim();
  if (summary.length > 60) return true;
  if (
    /\bvisitorType\b|clinic representative|clinic owner|identified as patient|whatsapp|pricing|registration|patient acquisition|demo/i.test(
      summary,
    )
  ) {
    return true;
  }

  const assistantTurns = (recentTurns || []).filter((t) => t.role === "assistant");
  if (assistantTurns.length >= 2) return true;
  if (assistantTurns.some((t) => SUBSTANTIVE_ASSISTANT_RE.test(String(t.text || "")))) return true;
  if (assistantTurns.some((t) => String(t.text || "").trim().length >= 100)) return true;

  const userTurns = (recentTurns || []).filter((t) => t.role === "user");
  if (userTurns.some((t) => isSalesRepetitionComplaintMessage(String(t.text || "")))) return true;
  if (userTurns.some((t) => isSalesTutorialVideoQuery(String(t.text || ""))) && assistantTurns.length >= 1) {
    return true;
  }
  if (assistantTurns.some((t) => looksLikeDeniesTutorialVideos(String(t.text || "")))) return true;
  if (userTurns.length >= 2) {
    if (
      userTurns.some(
        (t) =>
          QUESTION_HINT_RE.test(String(t.text || "")) ||
          VALUE_PROP_RE.test(String(t.text || "")) ||
          AI_MESSAGING_RE.test(String(t.text || "")) ||
          PATIENT_ACQUISITION_RE.test(String(t.text || "")),
      )
    ) {
      return true;
    }
  }
  return false;
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

  if (conversationPastQualificationStage(recentTurns, conversationSummary, channelMetadata)) {
    return false;
  }

  const assistantTurns = (recentTurns || []).filter((t) => t.role === "assistant");
  if (!assistantTurns.length) return false;

  const lastAssistant = assistantTurns[assistantTurns.length - 1];
  return /clinic representative|წარმომადგენელი|klinik temsilcisi|patient\?|პაციენტი\?/i.test(
    String(lastAssistant.text || ""),
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
 * @param {string} lang
 */
function buildRepetitionComplaintReply(lang) {
  const key = normalizeLocale(lang);
  if (key === "ka") {
    return "სამართალი ხართ — ბოდიშით, არ უნდა გამეორებინა. რით შემიძლია დაგეხმაროთ: მეტი პაციენტის მოთხოვნა, WhatsApp/Messenger პასუხები, საერთაშორისო პაციენტები თუ რეგისტრაცია?";
  }
  if (key === "tr") {
    return "Haklısınız, özür dilerim — tekrar etmem gerekmezdi. Az önce paylaştıklarım geçerli; kayıt ücretsiz ve kredi kartı gerekmiyor. Başka hangi konuda yardımcı olayım: hasta talebi, WhatsApp/Messenger yanıtları, uluslararası hastalar veya kayıt?";
  }
  if (key === "ru") {
    return "Вы правы — извините, не нужно было повторять. Регистрация по-прежнему бесплатна, карта не нужна. Чем ещё помочь: больше заявок, WhatsApp/Messenger, международные пациенты или регистрация?";
  }
  return "You're right — sorry for repeating myself. Registration is still free with no credit card. What would you like help with next: patient inquiries, WhatsApp/Messenger replies, international patients, or signing up?";
}

/**
 * @param {string} lang
 * @param {"clinic"|"patient"|"partner"|null} visitorType
 */
function buildVisitorTypeAckReply(lang, visitorType) {
  const key = normalizeLocale(lang);
  if (visitorType === "patient") {
    if (key === "tr") {
      return "Anladım — hasta olarak size yardımcı olabilirim. Diş kliniğinize doğrudan ulaşmanız veya kliniğinizin verdiği Clinifly kodu ile uygulamaya kaydolmanız gerekir.";
    }
    if (key === "ka") {
      return "გასაგებია — პაციენტი ხართ. გთხოვთ, დაუკავშირდეთ თქვენს კლინიკას ან Clinifly აპში კლინიკის კოდით.";
    }
    return "Got it — as a patient, please contact your dental clinic directly or use the Clinifly app with your clinic's code.";
  }
  if (visitorType === "partner") {
    if (key === "tr") {
      return "Teşekkürler — ortaklık tarafından yazıyorsunuz. Kısaca ne tür bir iş birliği düşünüyorsunuz?";
    }
    return "Thanks — sounds like a partnership inquiry. What kind of collaboration do you have in mind?";
  }
  if (key === "ka") {
    return "მადლობა — კლინიკის წარმომადგენელი ხართ. რით დაგეხმაროთ: მეტი პაციენტის მოთხოვნა, WhatsApp/Messenger AI, საერთაშორისო პაციენტები თუ რეგისტრაცია?";
  }
  if (key === "tr") {
    return "Teşekkürler — klinik sahibi olarak size yardımcı olabilirim. En çok hangi konuda destek istersiniz: hasta talebi, WhatsApp/Messenger AI, uluslararası hastalar veya kayıt süreci?";
  }
  if (key === "ru") {
    return "Спасибо — вы из клиники. Чем помочь: больше заявок, WhatsApp/Messenger AI, международные пациенты или регистрация?";
  }
  return "Thanks — as a clinic representative, what would you like help with: patient inquiries, WhatsApp/Messenger AI, international patients, or getting started?";
}

/**
 * @param {string} lang
 * @param {"clinic"|"patient"|"partner"|null} [visitorType]
 */
function buildQualificationWhyReply(lang, visitorType) {
  const key = normalizeLocale(lang);
  if (visitorType === "clinic") {
    if (key === "tr") {
      return "Kısaca doğru yönlendirme için soruyorum: hasta iseniz kliniğinize yönlendiririz; klinik sahibi iseniz Clinifly'nin size nasıl yardım edebileceğini anlatırız. Siz klinik sahibisiniz — ne konuda yardım istersiniz?";
    }
    if (key === "ka") {
      return "მოკლედ, სწორი მიმართულებისთვის ვკითხულობ: პაციენტი თუ კლინიკის წარმომადგენელი. თქვენ კლინიკის მხრიდან ხართ — რით დაგეხმაროთ?";
    }
    return "I ask so I can route you correctly: patients go to their clinic; clinic owners hear how Clinifly helps. You're from a clinic — what would you like help with?";
  }
  if (key === "tr") {
    return "Kısaca yönlendirme için soruyorum: hasta iseniz kliniğinize yönlendiririm; klinik sahibi/yöneticiseniz Clinifly'nin size nasıl yardımcı olabileceğini anlatırım. Hangi taraftansınız?";
  }
  if (key === "ka") {
    return "მოკლედ, პაციენტი თუ კლინიკის წარმომადგენელი — სწორი პასუხისთვის ვკითხულობ. რომელი მხარე ხართ?";
  }
  if (key === "ru") {
    return "Спрашиваю, чтобы направить вас правильно: пациентам — к их клинике, владельцам клиник — про Clinifly. Кто вы?";
  }
  return "I ask so I can route you correctly — patients vs clinic owners get different help. Which are you?";
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
  if (isSalesReservedPhraseMessage(m)) return false;
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
  if (!m || isSalesReservedPhraseMessage(m)) return null;

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
  if (isSalesTutorialVideoQuery(m)) return "tutorial_videos";
  if (DEMO_INTENT_RE.test(m)) return "demo";
  if (isSalesRepetitionComplaintMessage(m)) return "general";
  if (isSalesQualificationWhyMessage(m)) return "visitor_discovery";
  if (isSalesVisitorTypeOnlyMessage(m)) return "visitor_discovery";
  if (isSalesAcknowledgmentMessage(m)) return "general";
  if (
    isSalesGreetingOnlyMessage(m) &&
    !conversationPastQualificationStage(ctx.recentTurns, ctx.conversationSummary, ctx.channelMetadata)
  ) {
    return "greeting_qualification";
  }
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
    !isSalesAcknowledgmentMessage(m) &&
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
 * @param {string} lang
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function buildSalesLanguageSwitchAckReply(lang, recentTurns = []) {
  const key = normalizeLocale(lang);
  const hadSubstantiveChat = (recentTurns || []).some(
    (t) =>
      t.role === "user" &&
      String(t.text || "").trim().length >= 24 &&
      !isSalesLanguageSwitchMessage(String(t.text || "")),
  );
  if (key === "ka") {
    return hadSubstantiveChat
      ? "რა თქმა უნდა — ახლიდან ქართულად გიპასუხებთ. რით დაგეხმაროთ თქვენს სტომატოლოგიურ კლინიკაში: მეტი პაციენტის მოთხოვნა, WhatsApp/Messenger AI, საერთაშორისო პაციენტები თუ რეგისტრაცია?"
      : "რა თქმა უნდა — ახლიდან ქართულად გიპასუხებთ. Clinifly-სთან დაკავშირებით რით შემიძლია დაგეხმაროთ?";
  }
  if (key === "tr") {
    return hadSubstantiveChat
      ? "Tabii — bundan sonra Türkçe devam edeceğim. Diş kliniğiniz için hangi konuda yardımcı olayım: hasta talebi, WhatsApp/Messenger AI, uluslararası hastalar veya kayıt?"
      : "Tabii — bundan sonra Türkçe devam edeceğim. Clinifly hakkında size nasıl yardımcı olabilirim?";
  }
  if (key === "ru") {
    return hadSubstantiveChat
      ? "Конечно — дальше отвечаю по-русски. Чем помочь вашей стоматологической клинике: больше заявок, WhatsApp/Messenger AI, международные пациенты или регистрация?"
      : "Конечно — дальше отвечаю по-русски. Чем могу помочь по Clinifly?";
  }
  if (key === "ar") {
    return hadSubstantiveChat
      ? "بالتأكيد — سأرد بالعربية من الآن. كيف يمكنني مساعدة عيادتكم: المزيد من الاستفسارات، ذكاء WhatsApp/Messenger، المرضى الدوليون أم التسجيل؟"
      : "بالتأكيد — سأرد بالعربية من الآن. كيف يمكنني مساعدتك بخصوص Clinifly؟";
  }
  return hadSubstantiveChat
    ? "Of course — I'll reply in English from here. What would you like help with for your dental clinic: patient inquiries, WhatsApp/Messenger AI, international patients, or signing up?"
    : "Of course — I'll reply in English from here. How can I help you with Clinifly?";
}

/**
 * @param {string} message
 * @param {string|null|undefined} profileLang
 */
function inferSalesConversationLanguage(message, profileLang) {
  const m = String(message || "").trim();
  const profile = normalizeLangCode(profileLang) || normalizeLocale(profileLang);

  const requested = detectSalesRequestedLanguage(m);
  if (requested) return requested;

  if (!m) return profile || "en";

  if (/[\u10A0-\u10FF]/.test(m)) return "ka";
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(m)) return "ar";
  if (/[а-яё]/i.test(m)) return "ru";

  const detected = detectMessageLanguage(m);
  if (detected.code === "ar" && (detected.arabicScript || detected.confidence >= 0.5)) {
    return "ar";
  }
  if (detected.code === "en" && (looksClearlyEnglish(m) || detected.confidence >= 0.65)) {
    return "en";
  }
  if (detected.code && detected.confidence >= 0.65) {
    return detected.code;
  }
  if (/[ğüşöçıİ]/i.test(m) || /\b(mi|mı|mu|mü|misiniz|nasıl|nedir|merhaba|teşekkür|tesekkur)\b/i.test(m)) {
    return "tr";
  }
  if (profile && profile !== "en" && looksClearlyEnglish(m)) {
    return "en";
  }
  if (detected.code && detected.confidence >= 0.45) {
    return detected.code;
  }
  if (profile && profile !== "tr") return profile;
  if (detected.code) return detected.code;
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
  if (intent === "tutorial_videos") {
    const url = getCliniflyTutorialYoutubeUrl();
    const key = normalizeLocale(lang);
    if (key === "tr") {
      return `ACTIVE PLAYBOOK — EĞİTİM VİDEOLARI:
Ziyaretçi kullanım/eğitim videosu soruyor — kayıt linki gönderme.
• Evet de — resmi videolar YouTube'da: ${url}
• Kısaca konular: kayıt, AI ayarları, WhatsApp/Messenger, admin paneli.
• ASLA "videolarımız yok" deme.`;
    }
    return `ACTIVE PLAYBOOK — TUTORIAL VIDEOS:
Visitor asks for how-to / training videos — do NOT push registration as the main answer.
• Confirm yes — official videos on YouTube: ${url}
• Briefly mention topics: registration, AI settings, WhatsApp/Messenger, admin panel.
• NEVER say we have no videos.`;
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
    intent === "patient_acquisition" ||
    intent === "tutorial_videos";
  if (!skipPrimaryCta) {
    out += `\n\n${buildPrimaryCtaGuidance(lang)}`;
  }
  return out;
}

const SALES_STAGES_GUIDE = `CONVERSATION STAGES (follow in order):
Stage 1 — Qualification: pure hello/hi/salam only → welcome + ask clinic representative vs patient (or how can we help). NO product pitch.
Stage 2 — Discovery: learn visitor type (clinic owner, dentist, manager, patient, partner) and what they need. ONE question at a time. NO long feature lists.
Stage 3 — Sales: only after visitor type is clear (especially clinic/partner) → use PBSC, KB facts, registration CTA when appropriate.

NEVER repeat Stage 1 or Stage 2 mid-conversation. Once you have explained a product topic (WhatsApp AI, pricing, registration, tutorial videos, etc.), short acknowledgments like "mantıklı", "bence de", "ok", "makes sense", "neden yok", "olmalı" mean continue the SAME topic — do NOT greet again and do NOT re-ask clinic vs patient.

If visitor pushes back on a wrong answer (e.g. "why not" / "there should be videos") → apologize briefly and correct with facts from KB — never restart introduction.

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
  isSalesAcknowledgmentMessage,
  isSalesRepetitionComplaintMessage,
  isSalesVisitorTypeOnlyMessage,
  isSalesQualificationWhyMessage,
  isSalesReservedPhraseMessage,
  isSalesTutorialVideoQuery,
  isSalesTutorialVideoPushbackMessage,
  looksLikeDeniesTutorialVideos,
  looksLikeGreetingQualificationRestartReply,
  shouldBlockQualificationRestartReply,
  looksLikeSalesMisnamedReply,
  resolveSalesDirectReply,
  buildTutorialVideosReply,
  buildTutorialVideoCorrectionReply,
  buildMidChatContinuationReply,
  buildPastQualificationHint,
  buildRepetitionComplaintReply,
  buildVisitorTypeAckReply,
  buildQualificationWhyReply,
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
  conversationPastQualificationStage,
  buildGreetingQualificationReply,
  parseProfileIdentityFromMessage,
  inferSalesConversationLanguage,
  detectSalesRequestedLanguage,
  isSalesLanguageSwitchMessage,
  buildSalesLanguageSwitchAckReply,
  buildAntiRepeatHint,
  buildCtaRepeatGuard,
  buildPricingFollowUpHint,
  buildSalesPlaybookBlock,
  buildPrimaryCtaGuidance,
  SALES_REPLY_FRAMEWORK,
  SALES_STAGES_GUIDE,
  getCliniflyClinicRegisterUrl,
};
