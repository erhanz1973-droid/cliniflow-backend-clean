/**
 * Orthodontic treatment interest — photo intake + Clinifly guided capture.
 */

const { detectPatientTreatmentTopic } = require("./patientQuestionAnchoring");
const {
  CLINIFLY_PATIENT_WEB_URL,
  getCliniflyPlatformFreeFact,
} = require("./patientClinicEnrollment");

const ORTHO_TOPIC_RE =
  /\b(ortodont\w*|orthodont\w*|tel\s*tedav\w*|braces|invisalign|diş\s*teli|aligner)\b/i;

const TREATMENT_WANT_RE =
  /\b(istiyorum|istiyor|istiyoruz|düşünüyorum|dusunuyorum|yaptırmak|yaptirmak|want|need|looking\s+for|interested|arıyorum|ariyorum|talep|planlıyorum|planliyorum|başlamak|baslamak)\b/i;

/**
 * Patient expresses orthodontic treatment interest (not price-only).
 * @param {string} message
 * @param {import('./leadIntelligence').LeadData|null|undefined} [leadData]
 */
function isOrthodonticTreatmentIntent(message, leadData) {
  const t = String(message || "").trim();
  if (!t) return false;

  const hasOrthoWord = ORTHO_TOPIC_RE.test(t);
  const ti = String(leadData?.treatmentInterest || leadData?.primaryTreatment || "")
    .toLowerCase()
    .trim();
  const leadOrtho = ti === "orthodontics" || ti.includes("orthodont");

  if (!hasOrthoWord && !leadOrtho) return false;

  const topic = detectPatientTreatmentTopic(t);
  const orthoTopic = topic?.slug === "orthodontics" || hasOrthoWord || leadOrtho;

  if (!orthoTopic) return false;

  const priceOnly =
    /\b(fiyat|price|ne\s+kadar|ücret|maliyet|pahalı|how\s+much|cost)\b/i.test(t) &&
    !TREATMENT_WANT_RE.test(t) &&
    !/\b(tedavi|tedavisi|bilgi|information|hakkında|hakkinda)\b/i.test(t);

  if (priceOnly) return false;

  return (
    TREATMENT_WANT_RE.test(t) ||
    /\b(tedavi|tedavisi|bilgi|information|foto|photo|görüntü|goruntu)\b/i.test(t) ||
    t.length >= 14
  );
}

/**
 * @param {string} [lang]
 * @param {string|null|undefined} clinicCode
 */
function buildOrthodonticPhotoIntakeDirectReply(lang = "tr", clinicCode = null) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const code = String(clinicCode || "").trim().toUpperCase();
  const url = CLINIFLY_PATIENT_WEB_URL;
  const freeFact = getCliniflyPlatformFreeFact(key);
  const codePart = code ? ` (${code})` : "";

  if (key === "tr") {
    let text =
      "Ortodonti tedavisi düşündüğünüzü not ettik — güzel bir adım.\n\n";
    text +=
      "Ön değerlendirme için dişlerinizin önden, dudaklarınızı hafifçe çekerek (retraksiyonlu) net bir fotoğrafını paylaşmanız çok faydalı olur.\n\n";
    text +=
      "Fotoğrafı doğru açı ve ışıkta çekmek için Clinifly hasta uygulamasını öneririz: uygulama içindeki adım adım yönlendirme ile diş fotoğrafınızı AI destekli şekilde çekebilirsiniz.\n\n";
    text += `${freeFact}\n\n`;
    text += `Uygulamayı ${url} adresinden indirebilirsiniz (App Store / Google Play). Kayıt olurken «Klinik kodu ile kaydol» seçeneğine klinik kodumuzu yazarsanız${codePart} doğrudan kliniğimize bağlanırsınız; randevu ve tedavi adımlarınız tek yerden görünür.\n\n`;
    text +=
      "Fotoğrafı buradan da gönderebilirsiniz; mümkünse yine de uygulama yönlendirmesini kullanın — kliniğimiz için en net görüntüyü bu şekilde alırız.";
    return text;
  }

  if (key === "ka") {
    let text =
      "ორთოდონტიული მკურნალობის ინტერესი ჩავიწერეთ.\n\n";
    text +=
      "წინასწარი შეფასებისთვის გამოგვიგზავნეთ კბილების ფრონტალური ფოტო — ტუჩების ოდნოვით გამოწევით (რეტრაქცია), რაც ძალიან სასარგებლოა.\n\n";
    text +=
      "სწორი კუთხისთვის გირჩევთ Clinifly აპს: ნაბიჯ-ნაბიჯ მიმართულებით AI-დამხარე ფოტოს გადაღება.\n\n";
    text += `${getCliniflyPlatformFreeFact("en")}\n\n`;
    text += `${url} — App Store / Google Play. რეგისტრაციისას აირჩიეთ კლინიკის კოდით${codePart} და პირდაპირ დაუკავშირდებით კლინიკას.\n\n`;
    text += "შეგიძლიათ აქაც გამოგვიგზავნოთ, მაგრამ სასურველია აპის გიდი.";
    return text;
  }

  if (key === "ru") {
    let text = "Мы отметили ваш интерес к ортодонтическому лечению.\n\n";
    text +=
      "Для предварительной оценки очень полезно фото зубов спереди с лёгкой ретракцией губ (чёткий вид зубного ряда).\n\n";
    text +=
      "Рекомендуем приложение Clinifly: пошаговая подсказка и AI-помощь при съёмке.\n\n";
    text += `${getCliniflyPlatformFreeFact("ru")}\n\n`;
    text += `Скачайте: ${url}. При регистрации выберите вход по коду клиники${codePart} — вы сразу будете привязаны к нашей клинике.\n\n`;
    text +=
      "Можно отправить фото и в этом чате, но лучше через приложение.";
    return text;
  }

  let text = "We've noted your interest in orthodontic treatment.\n\n";
  text +=
    "For an initial assessment, a clear front photo with your lips gently retracted (showing your teeth from the front) is very helpful.\n\n";
  text +=
    "We recommend the Clinifly patient app: step-by-step guidance lets you capture dental photos with AI-assisted framing and lighting.\n\n";
  text += `${getCliniflyPlatformFreeFact("en")}\n\n`;
  text += `Download at ${url} (App Store / Google Play). On Register with clinic code, enter our code${codePart} to connect directly to our clinic.\n\n`;
  text +=
    "You can also send a photo here, but the in-app guide usually gives us the clearest image.";
  return text;
}

/**
 * LLM prompt when orthodontic topic is detected but direct reply path did not run.
 * @param {{ lang?: string, clinicCode?: string|null }} [opts]
 */
function buildOrthodonticPhotoIntakePromptBlock(opts = {}) {
  const key = String(opts.lang || "tr").slice(0, 2).toLowerCase();
  const code = String(opts.clinicCode || "").trim().toUpperCase();
  const codeLine = code
    ? `Clinic code for app registration: **${code}**.`
    : "Clinic code: share from context or say the team will provide it.";

  if (key === "tr") {
    return [
      "ORTHODONTIC PHOTO INTAKE (mandatory when patient wants braces/aligners/ortodonti):",
      "* Acknowledge orthodontic treatment interest warmly in sentence 1.",
      "* Ask for a front intraoral-style photo: lips gently retracted so anterior teeth are clearly visible (retraksiyonlu ön fotoğraf).",
      "* Recommend **Clinifly** patient app at " + CLINIFLY_PATIENT_WEB_URL + " for guided capture — step-by-step directions, **AI-assisted** dental photo framing (not clinical diagnosis).",
      "* Explain: on «Klinik kodu ile kaydol», entering the clinic code links them directly to this clinic.",
      codeLine,
      `* ${getCliniflyPlatformFreeFact("tr")}`,
      "* One soft next step: send photo via app (preferred) or this chat; offer brief consult/booking if natural.",
      "* Do NOT interpret photos clinically; do NOT diagnose malocclusion from chat text.",
    ].join("\n");
  }

  return [
    "ORTHODONTIC PHOTO INTAKE:",
    "* Acknowledge orthodontic interest; request front retracted smile/teeth photo.",
    "* Recommend Clinifly app (" + CLINIFLY_PATIENT_WEB_URL + ") for guided **AI-assisted** capture; register with clinic code in app.",
    codeLine,
    "* No clinical diagnosis from photos in chat.",
  ].join("\n");
}

module.exports = {
  isOrthodonticTreatmentIntent,
  buildOrthodonticPhotoIntakeDirectReply,
  buildOrthodonticPhotoIntakePromptBlock,
};
