/**
 * Clinic membership gate — clinical writes require enrolled patient (ACTIVE / APPROVED).
 * WhatsApp/Messenger leads may book first visit; AI guides them to install the app and register with clinic code.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  buildFacebookAdPartnerSmileBridgeLine,
} = require("./cliniflyAdPartnerClinic");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ENROLLED_STATUSES = new Set(["ACTIVE", "APPROVED"]);

const MESSAGES = {
  tr: {
    patient_not_found: "Hasta kaydı bulunamadı.",
    patient_not_clinic_member:
      "Hasta kliniğe henüz üye değil. İlk muayeneden sonra hastanın Clinifly uygulamasından kliniğe kayıt olması gerekir; üyelik tamamlanmadan klinik tedavi planı kaydı yapılamaz.",
  },
  en: {
    patient_not_found: "Patient record was not found.",
    patient_not_clinic_member:
      "This patient is not enrolled with the clinic yet. After the first consultation they must join the clinic in the Clinifly app; treatment plans cannot be saved until enrollment is complete.",
  },
  ru: {
    patient_not_found: "Запись пациента не найдена.",
    patient_not_clinic_member:
      "Пациент ещё не зарегистрирован в клинике. После первого приёма он должен оформить членство в приложении Clinifly; план лечения нельзя сохранить до завершения регистрации.",
  },
};

const CLINIFLY_PATIENT_WEB_URL = "https://www.clinifly.net";

const CLINIFLY_IOS_APP_STORE_URL =
  String(process.env.CLINIFLY_IOS_APP_STORE_URL || "").trim() ||
  "https://apps.apple.com/us/app/clinifly-patient-clinic-app/id6761667892";

const CLINIFLY_ANDROID_PLAY_STORE_URL =
  String(process.env.CLINIFLY_ANDROID_PLAY_STORE_URL || "").trim() ||
  "https://play.google.com/store/apps/details?id=com.clinifly.mobile";

/** Patient app install / clinic-code enrollment — not bare "Clinifly" (B2B product questions use separate intent). */
const APP_REGISTRATION_QUESTION_RE =
  /\b(klinik\s*kod|clinic\s*code|uygulama\w*|clinifly\.net|indir\w*|yukle\w*|yükley\w*|kaydol\w*|kayıt|kayit|üye\s*ol|uye\s*ol|register|sign\s*up|download|app\s*store|google\s*play|hesap\s*aç|enroll)\b/i;

const CLINIFLY_B2B_SALES_INTENT_RE =
  /\b(hasta\s*kazan|hasta\s*kazandir|patient\s*acquisition|acquire\s*patients|bring\s*patients|get\s*more\s*patients|international\s*patients?|uluslararasi\s*hasta|referral\s*system|referans\s*sistemi|premium\s*(trial|uyelik|membership|uyeli)|free\s*premium|demo\s*(talep|istiyor|request)?|toplanti|meeting\s*request|messenger\s*integration|whatsapp\s*integration|ai\s*assistant\s*for\s*clinics|dis\s*klinik\w*\s*icin|dental\s*clinic\s*platform|platform\s*for\s*clinics|clinifly\s*nedir|what\s*is\s*clinifly|clinifly\s*features|clinifly\s*ozellik)\b/i;

const APP_DOWNLOAD_QUESTION_RE =
  /\b(nereden\s+(indir|yukle|yükley)|nasil\s+(indir|yukle|yükley)|nasıl\s+(indir|yukle|yükley)|where\s+(can\s+)?(i\s+)?download|how\s+(do\s+i\s+|to\s+)?download|download\s+(the\s+)?(clinifly\s+)?app|get\s+(the\s+)?(clinifly\s+)?app|install\s+(the\s+)?app|app\s+download|app\s+link|indirme\s+link|iphone\s+app|android\s+app|ios\s+app|mobile\s+app|clinifly\s+app)\b/i;

/** Explicit clinic admin signup — NOT the patient/doctor mobile app. */
const CLINIC_REGISTRATION_EXPLICIT_RE =
  /\b(register\s+(my\s+)?clinic|clinic\s+(sign[- ]?up|registration|register)|add\s+my\s+clinic|join\s+clinic\s+as\s+(admin|owner)|sign\s+up\s+my\s+clinic|how\s+do\s+i\s+register\s+my\s+clinic|klinik\s*(kayit|kaydı|kaydol|hesabi|hesabı)|kliniğimi\s+kaydet|klinik\s+kayit|clinic\s+sign\s*up|admin-register|admin\s+panel\s+register|clinic\s+admin\s+register|klinik\s+kayd[ıi]|kliniğimi\s+ekle)\b/i;

const DOCTOR_REGISTRATION_RE =
  /\b(doctor\s+register|register\s+(as\s+)?a?\s*doctor|dentist\s+register|register\s+(as\s+)?a?\s*dentist|hekim\s+kayit|doktor\s+kayit|doktor\s+olarak\s+kayit|dis\s+hekimi\s+kayit|ექიმ.*რეგისტრ|რეგისტრ.*ექიმ)\b/i;

const CLINIFLY_APP_PRICING_QUESTION_RE =
  /\b(bedava|ucretsiz|ucretli|ucret|parali|paralı|free|cost|fee|charge|odeme|subscription|abonelik|ucret\s*var|odeme\s*var)\b/i;

/**
 * @param {string} text
 */
function normalizeCliniflyIntentText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} message
 */
function messageHasCliniflyPricingIntent(message) {
  const t = normalizeCliniflyIntentText(message);
  if (!t) return false;
  return CLINIFLY_APP_PRICING_QUESTION_RE.test(t);
}

/** Canonical product fact — patients AND doctors/clinics use Clinifly at no charge. */
const CLINIFLY_PLATFORM_FREE_FACT = {
  tr: "Clinifly hasta uygulaması ve diş hekimi/klinik uygulaması hem hastalar hem de doktorlar/klinikler için tamamen ücretsizdir; indirmek, kayıt olmak veya klinik kodu ile üye olmak için ücret alınmaz.",
  en: "The Clinifly patient app and the Clinifly doctor/clinic app are completely free for patients, dentists, and clinics — there is no download fee, subscription, or charge to register with a clinic code.",
  ru: "Приложение Clinifly для пациентов и для врачей/клиник полностью бесплатно — нет платы за загрузку, подписку или регистрацию по коду клиники.",
};

/**
 * @param {string} [lang]
 */
function getCliniflyPlatformFreeFact(lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  return CLINIFLY_PLATFORM_FREE_FACT[key] || CLINIFLY_PLATFORM_FREE_FACT.en;
}

/**
 * Patient asks whether Clinifly / the app costs money.
 * @param {string} message
 */
function patientAskedAboutCliniflyPricing(message) {
  const raw = String(message || "").trim();
  if (!raw) return false;
  if (patientAskedAboutCliniflyProductSales(raw)) return false;
  if (!messageHasCliniflyPricingIntent(raw)) return false;
  const t = normalizeCliniflyIntentText(raw);
  return (
    /\b(clinifly|clinifly\.net)\b/.test(t) ||
    /\b(uygulama|uygulamasi|app|program)\b/.test(t) ||
    (/\b(doktor\w*|hekim\w*|doctor\w*|klinik\w*|clinic\w*)\b/.test(t) && messageHasCliniflyPricingIntent(t))
  );
}

/**
 * Clinifly product / B2B sales question (clinics evaluating the platform — not patient app signup).
 * @param {string} message
 */
function patientAskedAboutCliniflyProductSales(message) {
  const t = normalizeCliniflyIntentText(message);
  if (!t) return false;
  if (CLINIFLY_B2B_SALES_INTENT_RE.test(t)) return true;
  if (
    /\bclinifly\b/.test(t) &&
    /\b(hasta\s*kazan|nasil.*hasta|how.*(get|acquire).*patient|help.*clinic|klinikler|clinics|platform)\b/.test(
      t,
    ) &&
    !/\b(klinik\s*kodum|clinic\s*code|indir\w*|download|uygulama.*indir)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Visitor explicitly asks to register their clinic on the admin platform (not mobile app download).
 * @param {string} message
 */
function isClinicRegistrationQuery(message) {
  return CLINIC_REGISTRATION_EXPLICIT_RE.test(String(message || "").trim());
}

/**
 * Visitor asks how doctors register in Clinifly.
 * @param {string} message
 */
function isDoctorRegistrationQuery(message) {
  const t = String(message || "").trim();
  if (!t || isClinicRegistrationQuery(t)) return false;
  return DOCTOR_REGISTRATION_RE.test(t);
}

/**
 * Visitor asks where/how to download the Clinifly mobile app (user/patient/doctor app — not clinic admin signup).
 * @param {string} message
 */
function isMobileAppDownloadQuery(message) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (isClinicRegistrationQuery(t)) return false;
  if (isDoctorRegistrationQuery(t)) return false;
  if (patientAskedAboutCliniflyProductSales(t)) return false;
  if (APP_DOWNLOAD_QUESTION_RE.test(t)) return true;
  if (/\b(app\s*store|google\s*play)\b/i.test(t) && /\b(clinifly|uygulama|app)\b/i.test(t)) return true;
  if (/uygulama\w*/i.test(t) && /\b(nereden|nasil|nasıl|link|indir|yukle|yükle|download|store)\b/i.test(t)) {
    return true;
  }
  if (/\bclinifly\b/i.test(t) && /\b(indir\w*|yukle\w*|download|app\s*store|google\s*play)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Patient asks about Clinifly app install / clinic enrollment (not appointment times).
 * @param {string} message
 */
function patientAskedAboutAppRegistration(message) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (patientAskedAboutCliniflyProductSales(t)) return false;
  if (isMobileAppDownloadQuery(t)) return true;
  if (APP_REGISTRATION_QUESTION_RE.test(t)) return true;
  return false;
}

function getCliniflyIosAppStoreUrl() {
  return CLINIFLY_IOS_APP_STORE_URL;
}

function getCliniflyAndroidPlayStoreUrl() {
  return CLINIFLY_ANDROID_PLAY_STORE_URL;
}

/**
 * Deterministic mobile app download reply with App Store + Google Play links.
 * @param {string} [lang]
 * @param {{ introLine?: string|null, includeFreeFact?: boolean, clinicCode?: string|null }} [options]
 */
function buildMobileAppDownloadReply(lang = "en", options = {}) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const ios = getCliniflyIosAppStoreUrl();
  const android = getCliniflyAndroidPlayStoreUrl();
  const intro = options.introLine || null;
  const code = String(options.clinicCode || "").trim().toUpperCase();

  if (key === "tr") {
    let text = intro ? `${intro}\n\n` : "";
    text += "Clinifly uygulamasını buradan indirebilirsiniz:\n\n";
    text += `📱 iPhone (App Store):\n${ios}\n\n`;
    text += `📱 Android (Google Play):\n${android}\n\n`;
    text +=
      "Kurulumdan sonra kullanıcı hesabı oluşturabilir, fotoğraf yükleyebilir, AI önerileri alabilir ve kliniklerle iletişime geçebilirsiniz.";
    if (code) {
      text += `\n\nKlinik kodunuz varsa uygulamada «Klinik kodu ile kaydol» seçeneğine ${code} yazmanız yeterli.`;
    }
    if (options.includeFreeFact) {
      text = `${getCliniflyPlatformFreeFact("tr")}\n\n${text}`;
    }
    return text;
  }
  if (key === "ka") {
    let text = intro ? `${intro}\n\n` : "";
    text += "Clinifly აპის ჩამოტვირთვა:\n\n";
    text += `📱 iPhone (App Store):\n${ios}\n\n`;
    text += `📱 Android (Google Play):\n${android}\n\n`;
    text +=
      "დაყენების შემდეგ შეგიძლიათ შექმნათ ანგარიში, ატვირთოთ ფოტოები, მიიღოთ AI რეკომენდაციები და დაუკავშირდეთ კლინიკებს.";
    if (code) {
      text += `\n\nთუ გაქვთ კლინიკის კოდი, აირჩიეთ «კლინიკის კოდით რეგისტრაცია» და შეიყვანეთ ${code}.`;
    }
    if (options.includeFreeFact) {
      text = `${getCliniflyPlatformFreeFact("ka") || getCliniflyPlatformFreeFact("en")}\n\n${text}`;
    }
    return text;
  }
  if (key === "ru") {
    let text = intro ? `${intro}\n\n` : "";
    text += "Скачать Clinifly:\n\n";
    text += `📱 iPhone (App Store):\n${ios}\n\n`;
    text += `📱 Android (Google Play):\n${android}\n\n`;
    text +=
      "После установки создайте аккаунт, загрузите фото, получите рекомендации ИИ и свяжитесь с клиниками.";
    if (code) {
      text += `\n\nЕсли есть код клиники — выберите регистрацию по коду и введите ${code}.`;
    }
    if (options.includeFreeFact) {
      text = `${getCliniflyPlatformFreeFact("ru")}\n\n${text}`;
    }
    return text;
  }
  let text = intro ? `${intro}\n\n` : "";
  text += "You can download Clinifly here:\n\n";
  text += `📱 iPhone (App Store):\n${ios}\n\n`;
  text += `📱 Android (Google Play):\n${android}\n\n`;
  text +=
    "After installing the app, you can create a user account, upload photos, receive AI recommendations, and connect with clinics.";
  if (code) {
    text += `\n\nIf you have a clinic code, choose register with clinic code and enter ${code}.`;
  }
  if (options.includeFreeFact) {
    text = `${getCliniflyPlatformFreeFact("en")}\n\n${text}`;
  }
  return text;
}

/**
 * Smile-analysis ad → app download (Messenger/Instagram). Photo analysis happens in-app only.
 * @param {string} [lang]
 * @param {{ partnerClinic?: string|null }} [options]
 */
function buildSmileAnalysisMessengerConversionReply(lang = "en", options = {}) {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const ios = getCliniflyIosAppStoreUrl();
  const android = getCliniflyAndroidPlayStoreUrl();
  const partnerClinic = String(options.partnerClinic || "").trim() || null;
  const partnerBridge = partnerClinic
    ? `${buildFacebookAdPartnerSmileBridgeLine(key, partnerClinic)}\n\n`
    : "";

  if (key === "tr") {
    return (
      "😁 Bunu anlamak için gülüş fotoğrafınızı yüklemeniz yeterli.\n\n" +
      partnerBridge +
      "🤖 Clinifly AI gülüşünüzü değerlendirir, Smile Score'unuzu gösterir ve gülüş estetiğinizi nasıl geliştirebileceğinizi söyler.\n\n" +
      "📸 Fotoğraf yükleyin ve birkaç saniyede sonucu alın.\n\n" +
      "📲 Clinifly'ı indirin:\n" +
      `iPhone: ${ios}\n` +
      `Android: ${android}`
    );
  }
  if (key === "ka") {
    return (
      "😁 ამის გასაგებად უბრალოდ ატვირთეთ თქვენი ღიმილის ფოტო.\n\n" +
      partnerBridge +
      "🤖 Clinifly AI შეაფასებს თქვენს ღიმილს, გაჩვენებთ Smile Score-ს და გეტყვით, რა შეიძლება გააუმჯობესოს თქვენი ღიმილის ესთეტიკა.\n\n" +
      "📸 ატვირთეთ ფოტო და მიიღეთ შედეგი რამდენიმე წამში.\n\n" +
      "📲 ჩამოტვირთეთ Clinifly:\n" +
      `iPhone: ${ios}\n` +
      `Android: ${android}`
    );
  }
  if (key === "ru") {
    return (
      "😁 Чтобы это понять, просто загрузите фото вашей улыбки.\n\n" +
      partnerBridge +
      "🤖 Clinifly AI оценит улыбку, покажет Smile Score и подскажет, что можно улучшить в эстетике улыбки.\n\n" +
      "📸 Загрузите фото и получите результат за несколько секунд.\n\n" +
      "📲 Скачайте Clinifly:\n" +
      `iPhone: ${ios}\n` +
      `Android: ${android}`
    );
  }
  return (
    "😁 To understand this, simply upload a photo of your smile.\n\n" +
    partnerBridge +
    "🤖 Clinifly AI will evaluate your smile, show your Smile Score, and tell you what could improve your smile aesthetics.\n\n" +
    "📸 Upload your photo and get results in seconds.\n\n" +
    "📲 Download Clinifly:\n" +
    `iPhone: ${ios}\n` +
    `Android: ${android}`
  );
}

/**
 * @param {string} [lang]
 */
function buildDoctorRegistrationReply(lang = "en") {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  const appReply = buildMobileAppDownloadReply(key, {
    introLine:
      key === "tr"
        ? "Doktorlar Clinifly mobil uygulamasını indirip klinik kodlarıyla kliniğe katılır."
        : key === "ka"
          ? "ექიმები Clinifly აპს ჩამოტვირთავენ და კლინიკის კოდით ურთიერთობენ კლინიკასთან."
          : key === "ru"
            ? "Врачи скачивают приложение Clinifly и подключаются к клинике по коду клиники."
            : "Doctors download the Clinifly mobile app and join their clinic using the clinic code.",
  });
  if (key === "tr") {
    return `${appReply}\n\nUygulamada Kayıt → Doktor seçin ve kliniğinizin paylaştığı klinik kodunu girin.`;
  }
  if (key === "ka") {
    return `${appReply}\n\nაპში: რეგისტრაცია → ექიმი → შეიყვანეთ კლინიკის კოდი.`;
  }
  if (key === "ru") {
    return `${appReply}\n\nВ приложении: Регистрация → Врач → введите код клиники от вашей клиники.`;
  }
  return `${appReply}\n\nIn the app: Register → Doctor → enter the clinic code your clinic shared with you.`;
}

function buildMobileAppDownloadPromptRules() {
  const ios = getCliniflyIosAppStoreUrl();
  const android = getCliniflyAndroidPlayStoreUrl();
  return `MOBILE APP DOWNLOAD vs CLINIC REGISTRATION (mandatory — never confuse these):

1) MOBILE APP (user / patient / doctor app install):
When the visitor asks to download the app, get the app, iPhone/Android app, Clinifly app, or install links:
• Reply with App Store + Google Play links ONLY:
  iPhone: ${ios}
  Android: ${android}
• Explain they can create a user account, upload photos, get AI recommendations, and connect with clinics.
• NEVER send admin-register.html or the clinic admin registration URL for app-download questions.
• Do NOT assume they are a clinic owner unless they clearly say so.

2) CLINIC REGISTRATION (admin panel — clinic owners only):
Only when they explicitly ask to register their clinic, add their clinic, or clinic sign-up → use the CLINIC REGISTRATION URL rules.

3) DOCTOR REGISTRATION:
Doctors download the Clinifly app (links above) and join their clinic with the clinic code — Register → Doctor in the app. Not admin-register.html.`;
}

/**
 * Short reply when the patient asks if Clinifly / the app is free.
 * @param {string} [lang]
 */
function buildCliniflyFreeDirectReply(lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return `${getCliniflyPlatformFreeFact("tr")} Tedavi ücretleri klinik hizmetlerine göre ayrıdır; uygulamanın kendisi için ödeme yapmanız gerekmez.`;
  }
  if (key === "ru") {
    return `${getCliniflyPlatformFreeFact("ru")} Стоимость лечения — отдельно по услугам клиники; за само приложение платить не нужно.`;
  }
  return `${getCliniflyPlatformFreeFact("en")} Treatment fees are separate clinic service charges — the app itself costs nothing.`;
}

/**
 * Deterministic reply when the patient asks where/how to download the app.
 * @param {string} [lang]
 * @param {string|null|undefined} clinicCode
 */
function buildPatientAppDownloadDirectReply(lang = "tr", clinicCode = null) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const code = String(clinicCode || "").trim().toUpperCase();
  return buildMobileAppDownloadReply(key, { includeFreeFact: true, clinicCode: code || null });
}

function buildAiClinicMembershipAfterBookingNotice(lang = "tr", clinicCode = null) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const code = String(clinicCode || "").trim().toUpperCase();
  const url = CLINIFLY_PATIENT_WEB_URL;
  if (key === "tr") {
    let text =
      `Önemli (Clinifly): ${getCliniflyPlatformFreeFact("tr")} Tedavi süreciniz, kliniğimize üye olduktan sonra başlar. En hızlı yol: ${url} üzerinden Clinifly hasta uygulamasını indirin (App Store / Google Play), «Klinik kodu ile kaydol» ekranına klinik kodumuzu yazın`;
    if (code) text += ` (${code})`;
    text +=
      ". Uygulamada randevu tarihiniz, işlem detayları ve gerektiğinde seyahat bilgileriniz elinizin altında olur. Üyelik tamamlanmadan diş hekiminiz klinik tedavi planınızı sisteme işleyemez.";
    return text;
  }
  if (key === "ru") {
    let text =
      "Важно (Clinifly): Лечение начинается после регистрации в клинике через приложение. Самый быстрый способ: установите приложение Clinifly и на экране регистрации по коду клиники введите код";
    if (code) text += ` ${code}`;
    text +=
      ". В приложении будут дата приёма, детали лечения и при необходимости информация о поездке.";
    return text;
  }
  let text =
    `Important (Clinifly): ${getCliniflyPlatformFreeFact("en")} Your treatment journey starts once you enroll with our clinic in the app. Fastest path: download from ${url} (App Store / Google Play), choose register with clinic code, and enter our clinic code`;
  if (code) text += ` (${code})`;
  text +=
    ". In the app you will see your appointment, treatment details, and travel coordination when needed. Until enrollment is complete, your dentist cannot save your clinical treatment plan.";
  return text;
}

/**
 * Coordinator prompt block — teach AI to recommend app + clinic code for omnichannel leads.
 * @param {{
 *   lang?: string,
 *   clinicCode?: string|null,
 *   channel?: string,
 *   hasActiveAppointment?: boolean,
 * }} opts
 */
function buildPatientAppOnboardingPromptBlock(opts = {}) {
  const key = String(opts.lang || "tr").slice(0, 2).toLowerCase();
  const code = String(opts.clinicCode || "").trim().toUpperCase();
  const channel = String(opts.channel || "whatsapp").toLowerCase();
  const hasAppt = opts.hasActiveAppointment === true;

  const channelLabel =
    channel === "messenger"
      ? "Facebook Messenger"
      : channel === "instagram"
        ? "Instagram"
        : channel === "whatsapp"
          ? "WhatsApp"
          : "this chat";

  const codeLine = code
    ? key === "tr"
      ? `* Clinic code to type on that screen: **${code}** (spell clearly for the patient).`
      : `* Clinic code for that screen: **${code}** (share clearly).`
    : key === "tr"
      ? "* Clinic code: if not in context, say the clinic team will share it — still recommend installing the app now."
      : "* Clinic code: if unknown, say the clinic will share it — still recommend installing the app.";

  if (key === "tr") {
    return [
      "PATIENT APP ONBOARDING (Clinifly — only when patient asks about app/register OR name collection is pending):",
      `* PRODUCT FACT (state clearly if asked): ${getCliniflyPlatformFreeFact("tr")}`,
      `* Patient reached us via ${channelLabel} but is NOT yet enrolled in the clinic app (lead/pending).`,
      "* After first consultation booking OR when they ask how to continue / register:",
      `  - Recommend installing the **Clinifly patient app** via **${CLINIFLY_PATIENT_WEB_URL}** (App Store / Google Play links on that page) — fastest path.`,
      "  - If they ask where to download, give that web link — do NOT send appointment slot lists.",
      '  - In the app, on the screen **«Klinik kodu ile kaydol»**, they must enter the clinic code (not in chat instead of the app).',
      codeLine,
      "  - Once enrolled they can see: appointment date/time, treatment steps, documents, and travel info when relevant — all in one place.",
      hasAppt
        ? "* They already have an appointment on the calendar — tie your message to completing app registration before/after the visit."
        : "* If no appointment yet, still mention app enrollment before detailed treatment planning in the system.",
      "* Tone: warm coordinator; one clear CTA; do not be pushy every single message unless they ask or you just confirmed a booking.",
      "* Do NOT promise clinical treatment details in WhatsApp/Messenger only — point to the app after enrollment.",
    ].join("\n");
  }

  return [
    "PATIENT APP ONBOARDING (Clinifly — mandatory for this lead):",
    `* PRODUCT FACT (state clearly if asked): ${getCliniflyPlatformFreeFact("en")}`,
    `* Patient contacted via ${channelLabel} but is NOT enrolled in the clinic app yet.`,
    `* Recommend installing the **Clinifly patient app** via **${CLINIFLY_PATIENT_WEB_URL}** (store links on that page).`,
    "* If they ask how/where to download — share that link only; do NOT repeat appointment slot tables.",
    '* On **Register with clinic code**, they must enter the clinic code in the app.',
    codeLine,
    "* After enrollment: appointment, treatment details, and travel coordination (when needed) live in the app.",
    hasAppt ? "* Appointment exists — link registration to before/after the visit." : "",
    "* Warm tone; one clear CTA; avoid repeating every turn unless relevant.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {Record<string, unknown>|null|undefined} patient
 */
function isPatientEnrolledForClinicalCare(patient) {
  if (!patient || typeof patient !== "object") return false;
  const st = String(patient.status || "")
    .trim()
    .toUpperCase();
  if (!st) return true;
  return ENROLLED_STATUSES.has(st);
}

/**
 * @param {string} [lang]
 * @param {string} code
 */
function messageForEnrollmentError(code, lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const bucket = MESSAGES[key] || MESSAGES.en;
  return bucket[code] || bucket.patient_not_clinic_member;
}

/**
 * @param {string} code
 * @param {string} [lang]
 */
function buildEnrollmentErrorBody(code, lang = "tr") {
  return {
    ok: false,
    error: code,
    message: messageForEnrollmentError(code, lang),
  };
}

/**
 * @param {import('express').Response} res
 * @param {Record<string, unknown>|null|undefined} patient
 * @param {{ lang?: string }} [opts]
 */
function respondDoctorClinicalPatientGate(res, patient, opts = {}) {
  const lang = opts.lang || "tr";
  if (!patient) {
    res.status(404).json(buildEnrollmentErrorBody("patient_not_found", lang));
    return false;
  }
  if (!isPatientEnrolledForClinicalCare(patient)) {
    res.status(403).json(buildEnrollmentErrorBody("patient_not_clinic_member", lang));
    return false;
  }
  return true;
}

/**
 * @param {string} patientId UUID
 */
async function fetchPatientEnrollmentRow(patientId) {
  const id = String(patientId || "").trim();
  if (!id || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase
      .from("patients")
      .select("id, status, is_lead, clinic_id")
      .eq("id", id)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} clinicId
 */
async function fetchClinicCodeByClinicId(clinicId) {
  const id = String(clinicId || "").trim();
  if (!UUID_RE.test(id) || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase.from("clinics").select("clinic_code").eq("id", id).maybeSingle();
    const code = data?.clinic_code ? String(data.clinic_code).trim().toUpperCase() : "";
    return code || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} patientId
 */
async function patientNeedsClinicEnrollmentNotice(patientId) {
  const row = await fetchPatientEnrollmentRow(patientId);
  if (!row) return false;
  return !isPatientEnrolledForClinicalCare(row);
}

module.exports = {
  ENROLLED_STATUSES,
  CLINIFLY_PATIENT_WEB_URL,
  CLINIFLY_IOS_APP_STORE_URL,
  CLINIFLY_ANDROID_PLAY_STORE_URL,
  CLINIFLY_PLATFORM_FREE_FACT,
  getCliniflyPlatformFreeFact,
  getCliniflyIosAppStoreUrl,
  getCliniflyAndroidPlayStoreUrl,
  isPatientEnrolledForClinicalCare,
  messageForEnrollmentError,
  buildEnrollmentErrorBody,
  respondDoctorClinicalPatientGate,
  fetchPatientEnrollmentRow,
  fetchClinicCodeByClinicId,
  patientNeedsClinicEnrollmentNotice,
  patientAskedAboutCliniflyPricing,
  patientAskedAboutAppRegistration,
  patientAskedAboutCliniflyProductSales,
  isMobileAppDownloadQuery,
  isClinicRegistrationQuery,
  isDoctorRegistrationQuery,
  buildCliniflyFreeDirectReply,
  buildMobileAppDownloadReply,
  buildSmileAnalysisMessengerConversionReply,
  buildDoctorRegistrationReply,
  buildMobileAppDownloadPromptRules,
  buildPatientAppDownloadDirectReply,
  buildAiClinicMembershipAfterBookingNotice,
  buildPatientAppOnboardingPromptBlock,
  APP_DOWNLOAD_QUESTION_RE,
  CLINIC_REGISTRATION_EXPLICIT_RE,
};
