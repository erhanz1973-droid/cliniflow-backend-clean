/**
 * Clinic membership gate — clinical writes require enrolled patient (ACTIVE / APPROVED).
 * WhatsApp/Messenger leads may book first visit; AI guides them to install the app and register with clinic code.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

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

/** Patient app install / clinic-code enrollment — not bare "Clinifly" (B2B product questions use separate intent). */
const APP_REGISTRATION_QUESTION_RE =
  /\b(klinik\s*kod|clinic\s*code|uygulama\w*|clinifly\.net|indir\w*|yukle\w*|yükley\w*|kaydol\w*|kayıt|kayit|üye\s*ol|uye\s*ol|register|sign\s*up|download|app\s*store|google\s*play|hesap\s*aç|enroll)\b/i;

const CLINIFLY_B2B_SALES_INTENT_RE =
  /\b(hasta\s*kazan|hasta\s*kazandir|patient\s*acquisition|acquire\s*patients|bring\s*patients|get\s*more\s*patients|international\s*patients?|uluslararasi\s*hasta|referral\s*system|referans\s*sistemi|premium\s*(trial|uyelik|membership|uyeli)|free\s*premium|demo\s*(talep|istiyor|request)?|toplanti|meeting\s*request|messenger\s*integration|whatsapp\s*integration|ai\s*assistant\s*for\s*clinics|dis\s*klinik\w*\s*icin|dental\s*clinic\s*platform|platform\s*for\s*clinics|clinifly\s*nedir|what\s*is\s*clinifly|clinifly\s*features|clinifly\s*ozellik)\b/i;

const APP_DOWNLOAD_QUESTION_RE =
  /\b(nereden\s+(indir|yukle|yükley)|nasil\s+(indir|yukle|yükley)|nasıl\s+(indir|yukle|yükley)|where\s+(to\s+)?download|how\s+(to\s+)?download|app\s+link|indirme\s+link)\b/i;

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
 * Patient asks about Clinifly app install / clinic enrollment (not appointment times).
 * @param {string} message
 */
function patientAskedAboutAppRegistration(message) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (patientAskedAboutCliniflyProductSales(t)) return false;
  if (APP_DOWNLOAD_QUESTION_RE.test(t)) return true;
  if (APP_REGISTRATION_QUESTION_RE.test(t)) return true;
  if (/uygulama\w*/i.test(t) && /\b(nereden|nasil|nasıl|link|indir|yukle|yükle)\b/i.test(t)) {
    return true;
  }
  if (/\bclinifly\b/i.test(t) && /\b(indir\w*|yukle\w*|download|app\s*store|google\s*play|klinik\s*kod)\b/i.test(t)) {
    return true;
  }
  return false;
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
  const url = CLINIFLY_PATIENT_WEB_URL;
  const freeLine = getCliniflyPlatformFreeFact(key);

  if (key === "tr") {
    let text = `${freeLine}\n\n`;
    text += `Clinifly hasta uygulamasını ${url} adresinden indirebilirsiniz. Bu sayfada App Store ve Google Play bağlantıları yer alır.\n\n`;
    text +=
      "Kurulumdan sonra uygulamada «Klinik kodu ile kaydol» seçeneğine girip klinik kodumuzu yazmanız yeterli";
    if (code) text += ` (${code})`;
    text +=
      ".\n\nUygulamada randevu saatiniz, tedavi adımlarınız ve gerektiğinde seyahat bilgileriniz tek yerde görünür.";
    return text;
  }
  if (key === "ru") {
    let text = `${getCliniflyPlatformFreeFact("ru")}\n\n`;
    text += `Скачать приложение Clinifly: ${url} (App Store и Google Play на этой странице).\n\n`;
    text += "После установки выберите регистрацию по коду клиники и введите наш код";
    if (code) text += ` ${code}`;
    text += ".";
    return text;
  }
  let text = `${getCliniflyPlatformFreeFact("en")}\n\n`;
  text += `Download the Clinifly patient app at ${url} — App Store and Google Play links are on that page.\n\n`;
  text += "After installing, choose register with clinic code and enter our code";
  if (code) text += ` (${code})`;
  text += ". Your appointment and treatment details will appear in the app once enrolled.";
  return text;
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
  CLINIFLY_PLATFORM_FREE_FACT,
  getCliniflyPlatformFreeFact,
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
  buildCliniflyFreeDirectReply,
  buildPatientAppDownloadDirectReply,
  buildAiClinicMembershipAfterBookingNotice,
  buildPatientAppOnboardingPromptBlock,
  APP_DOWNLOAD_QUESTION_RE,
};
