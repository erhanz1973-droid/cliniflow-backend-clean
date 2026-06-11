/**
 * Medical / legal guardrails for AI dental coordinator replies.
 * Defense in depth: system prompt + post-generation checks.
 */

const {
  OPERATIONAL_HONESTY_PROMPT,
  applyDoctorAttributionGuardrails,
} = require("./doctorAttributionGuardrails");
const { normalizeLangCode } = require("./conversationLanguage");

const DIAGNOSIS_PATTERNS = [
  /\byou (have|likely have|probably have|definitely have)\b/i,
  /\bthis (is|looks like|appears to be) (a |an )?(cavity|infection|abscess|fracture|gum disease)\b/i,
  /\bi (diagnose|can diagnose|would diagnose)\b/i,
  /\byou need (a |an )?(root canal|extraction|antibiotics?)\b/i,
  /\bconfirmed diagnosis\b/i,
];

const GUARANTEE_PATTERNS = [
  /\b(guarantee|guaranteed|100%|will definitely|promise you)\b/i,
  /\b(pain[- ]free|completely safe|no risk|zero risk)\b/i,
  /\b(will (be |look )?perfect|always works)\b/i,
];

const MEDICATION_PATTERNS = [
  /\b(take|prescribe|use) \d+\s*mg\b/i,
  /\b(amoxicillin|ibuprofen|paracetamol|acetaminophen|metronidazole)\b/i,
  /\b(take|prescribe|recommend).{0,40}\d+\s*mg\b/i,
  /\b(dosage|dose of)\b/i,
  /\byou should (take|start) (the |a )?(medication|antibiotic|painkiller)\b/i,
  /\bshould (take|use) (an |a )?antibiotic\b/i,
];

const EMERGENCY_USER_PATTERNS = [
  /\b(severe|unbearable|extreme) (pain|toothache)\b/i,
  /\b(face|facial) swell/i,
  /\b(uncontrolled |heavy )?bleeding\b/i,
  /\b(difficulty breathing|can't breathe)\b/i,
  /\b(knocked out|broken jaw|trauma)\b/i,
  /\b(fever).{0,40}(tooth|dental|gum|swell)/i,
];

const LICENSED_CLINICAL_EVAL_MARKERS = [
  /licensed dental professionals|licensed dentist/i,
  /lisanslı diş hekim/i,
  /ლიცენზირებული\s+სტომატოლოგ/i,
  /лицензированн/i,
  /مرخص/i,
  /final clinical evaluation/i,
  /son klinik değerlendirme/i,
];

/** @param {unknown} lang */
function resolveGuardrailLang(lang) {
  return normalizeLangCode(lang) || "en";
}

const TREATMENT_GUIDE_DISCLAIMER_BY_LANG = {
  en: "Final clinical evaluation is performed by licensed dental professionals.",
  tr: "Son klinik değerlendirme lisanslı diş hekimleri tarafından yapılır.",
  ka: "საბოლოო კლინიკური შეფასებას ახორციელებენ ლიცენზირებული სტომატოლოგები.",
  ru: "Окончательную клиническую оценку проводят лицензированные стоматологи.",
  ar: "يُجرى التقييم السريري النهائي من قبل أطباء أسنان مرخّصين.",
};

const DISCLAIMERS_BY_LANG = {
  en: {
    diagnosis:
      "Please consult a licensed dentist for diagnosis and a personalised treatment plan.",
    guarantee:
      "Treatment outcomes vary by individual — a licensed dentist can explain realistic expectations after an examination.",
    medication:
      "I cannot recommend medications or dosages. Please speak with a licensed dentist or pharmacist.",
    emergency:
      "If you have severe pain, significant swelling, uncontrolled bleeding, fever with dental symptoms, or trouble breathing, seek urgent in-person dental or emergency care immediately.",
  },
  tr: {
    diagnosis:
      "Teşhis ve kişiselleştirilmiş tedavi planı için lütfen lisanslı bir diş hekimine danışın.",
    guarantee:
      "Tedavi sonuçları kişiden kişiye değişir — lisanslı bir diş hekimi muayene sonrası gerçekçi beklentileri açıklayabilir.",
    medication:
      "İlaç veya doz öneremem. Lütfen lisanslı bir diş hekimi veya eczacıya danışın.",
    emergency:
      "Şiddetli ağrı, belirgin şişlik, kontrol edilemeyen kanama, diş sorunlarıyla birlikte ateş veya nefes darlığı varsa acilen yüz yüze diş veya acil servise başvurun.",
  },
  ka: {
    diagnosis:
      "დიაგნოზისა და ინდივიდუალური გეგმისთვის მიმართეთ ლიცენზირებულ სტომატოლოგს.",
    guarantee:
      "შედეგები ინდივიდუალურია — ლიცენზირებული ექიმი განმარტავს რეალისტურ მოლოდინებს გამოკვლევის შემდეგ.",
    medication:
      "ვერ გირჩევთ წამლებს ან დოზებს. მიმართეთ ლიცენზირებულ სტომატოლოგს.",
    emergency:
      "მძიმე ტკივილი, მნიშვნელოვანი შეშუპება, შეუჩერებელი სისხლდენა, კბილის სიმპტომებთან ერთად ცხელება ან სუნთქვის გაძნელება — დაუყოვნებლივ მიმართეთ სტომატოლოგს ან სასწრაფოს.",
  },
  ru: {
    diagnosis:
      "Для диагноза и индивидуального плана лечения обратитесь к лицензированному стоматологу.",
    guarantee:
      "Результаты лечения индивидуальны — стоматолог после осмотра объяснит реалистичные ожидания.",
    medication:
      "Я не могу рекомендовать лекарства или дозировки. Обратитесь к лицензированному стоматологу.",
    emergency:
      "При сильной боли, выраженном отёке, неконтролируемом кровотечении, лихорадке с симптомами зубов или затруднённом дыхании срочно обратитесь к стоматологу или в неотложную помощь.",
  },
  ar: {
    diagnosis:
      "يُرجى استشارة طبيب أسنان مرخّص للتشخيص وخطة علاج شخصية.",
    guarantee:
      "نتائج العلاج تختلف من شخص لآخر — يمكن لطبيب الأسنان المرخّص شرح التوقعات الواقعية بعد الفحص.",
    medication:
      "لا يمكنني التوصية بأدوية أو جرعات. يُرجى التحدث مع طبيب أسنان مرخّص أو صيدلي.",
    emergency:
      "إذا كان لديك ألم شديد أو تورم كبير أو نزيف غير مسيطر عليه أو حمى مع أعراض أسنان أو صعوبة في التنفس، اطلب رعاية أسنان أو طوارئ بشكل عاجل.",
  },
};

/** @param {unknown} lang */
function treatmentGuideDisclaimerForLang(lang) {
  const code = resolveGuardrailLang(lang);
  return TREATMENT_GUIDE_DISCLAIMER_BY_LANG[code] || TREATMENT_GUIDE_DISCLAIMER_BY_LANG.en;
}

/** @param {unknown} lang */
function disclaimersForLang(lang) {
  const code = resolveGuardrailLang(lang);
  return DISCLAIMERS_BY_LANG[code] || DISCLAIMERS_BY_LANG.en;
}

const DISCLAIMERS = DISCLAIMERS_BY_LANG.en;

const TREATMENT_GUIDE_DISCLAIMER = TREATMENT_GUIDE_DISCLAIMER_BY_LANG.en;

/**
 * @param {string} text
 * @returns {{ diagnosis: boolean, guarantee: boolean, medication: boolean, emergency: boolean }}
 */
function detectRiskTopics(text) {
  const t = String(text || "");
  return {
    diagnosis: DIAGNOSIS_PATTERNS.some((re) => re.test(t)),
    guarantee: GUARANTEE_PATTERNS.some((re) => re.test(t)),
    medication: MEDICATION_PATTERNS.some((re) => re.test(t)),
    emergency: EMERGENCY_USER_PATTERNS.some((re) => re.test(t)),
  };
}

/**
 * @param {string} reply
 * @param {RegExp} pattern
 */
function replyAlreadyContains(reply, pattern) {
  return pattern.test(String(reply || ""));
}

/**
 * Append required disclaimers when risks detected in user message or model reply.
 * @param {string} reply
 * @param {{ userMessage?: string, conversationLanguage?: string|null }} [ctx]
 * @returns {string}
 */
function applyReplyGuardrails(reply, ctx = {}) {
  let out = applyDoctorAttributionGuardrails(String(reply || "").trim());
  if (!out) return out;

  const disclaimers = disclaimersForLang(ctx.conversationLanguage);
  const combined = `${ctx.userMessage || ""}\n${out}`;
  const risks = detectRiskTopics(combined);

  if (risks.emergency) {
    if (
      !replyAlreadyContains(
        out,
        /urgent|emergency|immediately|seek care|licensed dentist|acil servis|acilen|სასწრაფ|неотложн|طوارئ/i,
      )
    ) {
      out = `${out}\n\n${disclaimers.emergency}`;
    }
  }

  if (risks.diagnosis || DIAGNOSIS_PATTERNS.some((re) => re.test(out))) {
    if (
      !replyAlreadyContains(
        out,
        /licensed dentist.*diagnos|consult.*licensed dentist|lisanslı.*diş hekim|ლიცენზირებულ სტომატოლოგ|лицензированн.*стоматолог|طبيب أسنان/i,
      )
    ) {
      out = `${out}\n\n${disclaimers.diagnosis}`;
    }
  }

  if (risks.medication || MEDICATION_PATTERNS.some((re) => re.test(out))) {
    if (
      !replyAlreadyContains(
        out,
        /cannot recommend medication|medications or dosages|İlaç veya doz|ვერ გირჩევთ წამლ|не могу рекомендовать лекарства|لا يمكنني التوصية/i,
      )
    ) {
      out = `${out}\n\n${disclaimers.medication}`;
    }
  }

  if (risks.guarantee || GUARANTEE_PATTERNS.some((re) => re.test(out))) {
    if (
      !replyAlreadyContains(
        out,
        /outcomes vary|realistic expectations|cannot guarantee|kişiden kişiye|ინდივიდუალურია|индивидуальн|تختلف من شخص/i,
      )
    ) {
      out = `${out}\n\n${disclaimers.guarantee}`;
    }
  }

  return out.trim();
}

/**
 * Treatment Guide replies always reinforce licensed clinical evaluation.
 * @param {string} reply
 * @param {string|null|undefined} [conversationLanguage]
 * @returns {string}
 */
function applyTreatmentGuideDisclaimer(reply, conversationLanguage = null) {
  let out = String(reply || "").trim();
  if (!out) return out;
  const disclaimer = treatmentGuideDisclaimerForLang(conversationLanguage);
  if (!LICENSED_CLINICAL_EVAL_MARKERS.some((re) => re.test(out))) {
    out = `${out}\n\n${disclaimer}`;
  }
  return out.trim();
}

const COORDINATOR_SALES_AUTHORITY_PROMPT = `
COORDINATOR COMMERCIAL AUTHORITY (when clinic pricing data is provided in context):
* NEVER volunteer prices, cost ranges, €/TL/$ amounts, or "starting from X" unless the user asked for a specific amount (fiyat ne kadar, kaç lira, how much).
* «Pahalı mı», «is it expensive», «ucuz mu» are NOT price-amount questions — answer qualitatively without numbers.
* When the user DID ask for a direct price — you MAY use clinic-configured ranges with non-binding estimate language (typically from, approximately, depending on complexity).
* When they ask about brands or duration without mentioning price — name brands or visit length only; no money figures.
* Do NOT unnecessarily escalate basic pricing questions to a human coordinator or refuse to answer when price was explicitly asked.
* Final binding quotes still require clinical assessment — state that briefly when giving ranges, not instead of giving ranges.`;

const MEDICAL_GUARDRAIL_PROMPT = `
STRICT MEDICAL & LEGAL GUARDRAILS (never violate):
* NEVER diagnose: do not state or imply what condition the user has. Use phrases like "Please consult a licensed dentist for diagnosis."
* NEVER guarantee treatment results, timelines, pain levels, or success rates.
* NEVER prescribe or recommend specific medications, drugs, antibiotics, or dosages.
* EMERGENCY topics (severe pain, facial swelling, uncontrolled bleeding, fever with dental infection, trauma, breathing difficulty):
  — Tell the user to seek urgent in-person dental or emergency care immediately.
  — Do not give step-by-step clinical emergency treatment instructions.
* You may explain general procedure information in neutral, educational terms only.
* For clinical diagnosis or treatment necessity, defer to licensed dentists — but commercial/pricing questions are NOT clinical diagnosis.

${OPERATIONAL_HONESTY_PROMPT}`;

module.exports = {
  COORDINATOR_SALES_AUTHORITY_PROMPT,
  MEDICAL_GUARDRAIL_PROMPT,
  OPERATIONAL_HONESTY_PROMPT,
  TREATMENT_GUIDE_DISCLAIMER,
  TREATMENT_GUIDE_DISCLAIMER_BY_LANG,
  DISCLAIMERS,
  disclaimersForLang,
  treatmentGuideDisclaimerForLang,
  detectRiskTopics,
  applyReplyGuardrails,
  applyTreatmentGuideDisclaimer,
};
