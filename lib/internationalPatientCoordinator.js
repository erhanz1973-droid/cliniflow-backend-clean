/**
 * International Patient AI — clinic coordinator training layer.
 * Behave like a human coordinator (travel, stay, pricing discipline, post-op, UK market, conversion, trust).
 */

const { detectPatientTreatmentTopic } = require("./patientQuestionAnchoring");
const { classifyPatientTravelIntent } = require("./patientTravelIntent");

/** Default stay guidance when clinic protocols are not configured (operational only — not medical). */
const DEFAULT_STAY_BY_TREATMENT = {
  implant: {
    label: "Implant / full-arch implant",
    firstVisit: "typically 3–7 days for first visit (surgery + initial checks)",
    secondVisit: "often a second visit 3–6 months later for 5–10 days (final prosthetics)",
    notes: "Exact days depend on bone quality, number of implants, and healing.",
  },
  crown: {
    label: "Crown / bridge",
    firstVisit: "typically 5–7 days for prep, lab work, and fitting",
    secondVisit: null,
    notes: "Some cases need a short second trip if lab timing requires it.",
  },
  veneer: {
    label: "Hollywood Smile / veneers",
    firstVisit: "typically 5–7 days",
    secondVisit: null,
    notes: "Smile design, temporaries, and final bonding often fit in one trip.",
  },
  orthodontics: {
    label: "Orthodontics / aligners",
    firstVisit: "long-term treatment — first visit often 1–2 days for records and planning",
    secondVisit: "remote or periodic check-ins; not a single short trip like implants",
    notes: "Stay length for tourism is usually short; treatment continues over months.",
  },
  cleaning: {
    label: "Cleaning / hygiene",
    firstVisit: "often same-day or 1 day",
    secondVisit: null,
    notes: null,
  },
};

const STAY_DURATION_PATTERNS = [
  /\b(kaç\s*gün|kac\s*gun|ne\s*kadar\s*süre|how\s+many\s+days|how\s+long\s+(should|do)\s+i\s+stay|length\s+of\s+stay|stay\s+for)\b/i,
  /\b(kalmam\s+lazım|kalmalıyım|kalacagim|kalacağım|need\s+to\s+stay|days\s+do\s+i\s+need)\b/i,
  /\b(visit\s+count|kaç\s*sefer|how\s+many\s+visits|how\s+many\s+trips)\b/i,
];

const POST_OP_PATTERNS = [
  /\b(ağrı|agri|pain|sore|ache|tender)\b/i,
  /\b(şişlik|sislik|swell|swelling|puffy)\b/i,
  /\b(ne\s+yiyebilir|what\s+can\s+i\s+eat|diet|soft\s+food|yemek)\b/i,
  /\b(sigara|smok|cigarette|vape)\b/i,
  /\b(ilaç|ilac|medicine|medication|antibiotic|painkiller|ibuprofen)\b/i,
  /\b(post[\s-]?op|after\s+surgery|after\s+treatment|healing|recovery)\b/i,
  /\b(normal\s+mi|is\s+this\s+normal|should\s+i\s+worry)\b/i,
];

const TRUST_COMPETITOR_PATTERNS = [
  /\b(neden\s+sizi|why\s+(you|choose\s+you|should\s+i\s+choose)|why\s+turkey|why\s+antalya|why\s+not\s+georgia|niye\s+türkiye)\b/i,
  /\b(competitor|other\s+clinic|başka\s+klinik|compare|comparison|reviews?|trust|scam|guven|güven)\b/i,
  /\b(dental\s+tourism|medical\s+tourism|abroad\s+for\s+dental)\b/i,
];

const UK_ORIGIN_PATTERNS = [
  /\b(uk|u\.k\.|united\s+kingdom|england|britain|british)\b/i,
  /\b(london|manchester|birmingham|glasgow|liverpool|leeds|edinburgh)\b/i,
  /\b(gbp|£|pounds?|sterling)\b/i,
];

const CLINICAL_URGENCY_PATTERNS = [
  /\b(severe\s+pain|unbearable|excruciating|worst\s+pain|şiddetli\s+ağrı|şiddetli\s+agri|ağrım\s+var|agrim\s+var|dayanamıyorum)\b/i,
  /\b(uncontrolled\s+bleed|bleeding\s+heavily|kanama|kan\s+durmuyor)\b/i,
  /\b(trauma|broken\s+tooth|kırık\s+diş|kirildi|knocked\s+out)\b/i,
  /\b(swelling.*fever|fever.*swell|ateş.*şiş|şiş.*ateş|sis.*ates|facial\s+swell)\b/i,
  /\b(emergency|acil|ambulance|112|911)\b/i,
];

/**
 * @param {string} message
 * @param {Record<string, unknown>|null|undefined} [leadData]
 */
function detectStayDurationQuestion(message, leadData) {
  const t = String(message || "").trim();
  if (!t) return false;
  if (!STAY_DURATION_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}

/**
 * @param {string} message
 */
function detectPostOpQuestion(message) {
  const t = String(message || "").trim();
  if (!t) return POST_OP_PATTERNS.some((re) => re.test(t));
  return POST_OP_PATTERNS.some((re) => re.test(t));
}

/**
 * @param {string} message
 */
function detectTrustCompetitorQuestion(message) {
  const t = String(message || "").trim();
  return TRUST_COMPETITOR_PATTERNS.some((re) => re.test(t));
}

/**
 * @param {string} message
 * @param {Record<string, unknown>|null|undefined} [leadData]
 * @param {Record<string, unknown>|null|undefined} [profileRow]
 */
function detectUkMarketPatient(message, leadData, profileRow) {
  const combined = [
    message,
    leadData?.country,
    profileRow?.country,
    leadData?.city,
  ]
    .filter(Boolean)
    .join(" ");
  return UK_ORIGIN_PATTERNS.some((re) => re.test(String(combined)));
}

/**
 * @param {string} message
 */
function detectClinicalUrgency(message) {
  return CLINICAL_URGENCY_PATTERNS.some((re) => re.test(String(message || "")));
}

/**
 * @param {Record<string, unknown>|null|undefined} leadData
 * @param {string} message
 */
function resolveTreatmentStayKey(leadData, message) {
  const topic = detectPatientTreatmentTopic(String(message || ""));
  const slug = topic?.slug || String(leadData?.treatmentInterest || leadData?.primaryTreatment || "")
    .toLowerCase()
    .trim();
  if (/implant|all.on|full.arch/.test(slug) || /implant|all[\s-]*on/i.test(message)) return "implant";
  if (/orthodont|braces|aligner|tel/.test(slug) || /ortodont|braces|invisalign/i.test(message)) return "orthodontics";
  if (/veneer|hollywood|smile/.test(slug) || /hollywood|veneer|gülüş/i.test(message)) return "veneer";
  if (/crown|bridge|köprü|kaplama/.test(slug) || /crown|bridge|köprü/i.test(message)) return "crown";
  if (/clean|hygiene|temiz/.test(slug)) return "cleaning";
  return slug || "implant";
}

/**
 * @param {string} [lang]
 * @param {Record<string, unknown>|null|undefined} [leadData]
 * @param {string} [message]
 */
function buildStayDurationDirectReply(lang = "tr", leadData, message = "") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const stayKey = resolveTreatmentStayKey(leadData, message);
  const info = DEFAULT_STAY_BY_TREATMENT[stayKey] || DEFAULT_STAY_BY_TREATMENT.implant;

  if (key === "tr") {
    let text = `Kalış süresi tedavi türüne göre değişir — kesin plan muayene ve görüntüleme sonrası netleşir.\n\n`;
    text += `**${info.label}** için genel çerçeve:\n`;
    text += `• İlk ziyaret: ${info.firstVisit}\n`;
    if (info.secondVisit) text += `• İkinci ziyaret: ${info.secondVisit}\n`;
    if (info.notes) text += `\n${info.notes}\n`;
    text += `\nSeyahat tarihlerinizi paylaşırsanız klinik ekibi ziyaret sayısı ve konaklama süresini sizinle netleştirir.`;
    return text;
  }

  let text = `Stay length depends on treatment type — exact timing is confirmed after clinical review.\n\n`;
  text += `**${info.label}** — typical framework:\n`;
  text += `• First visit: ${info.firstVisit}\n`;
  if (info.secondVisit) text += `• Second visit: ${info.secondVisit}\n`;
  if (info.notes) text += `\n${info.notes}\n`;
  text += `\nShare your travel dates and our team will align visit count and accommodation with your plan.`;
  return text;
}

/**
 * @param {string} [lang]
 */
function buildPostOpCoordinationDirectReply(lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return (
      "Ameliyat/tedavi sonrası hafif ağrı ve şişlik birkaç gün normal olabilir — doktorunuzun önerdiği ilaçları ve beslenme talimatlarını izleyin.\n\n" +
      "Sigara ve alkol iyileşmeyi yavaşlatabilir; mümkünse doktorunuzun belirttiği süre boyunca kaçının.\n\n" +
      "Şiddetli ağrı, artan şişlik, ateş veya kontrol edilemeyen kanama fark ederseniz en kısa sürede klinik ekibimizle iletişime geçin — acil durumda yerel acil servise başvurun."
    );
  }
  return (
    "Mild pain and swelling for a few days after treatment can be normal — follow your doctor's medication and diet instructions.\n\n" +
    "Smoking and alcohol can slow healing; avoid them for the period your doctor advised.\n\n" +
    "Contact our clinic promptly if you have severe pain, worsening swelling, fever, or bleeding that won't stop — go to local emergency care if needed."
  );
}

/**
 * @param {string} [lang]
 */
function buildClinicalUrgencyDirectReply(lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return (
      "Anlattığınız belirtiler acil değerlendirme gerektirebilir.\n\n" +
      "Lütfen en kısa sürede klinik ekibimizle iletişime geçin veya bulunduğunuz yerde acil diş/hekim desteği alın. " +
      "Mesajınızı koordinasyon ekibimize ilettik — bir ekip üyesi sizinle dönüş yapacaktır."
    );
  }
  return (
    "What you describe may need urgent clinical attention.\n\n" +
    "Please contact our clinic team as soon as possible or seek local emergency dental/medical care. " +
    "We've flagged your message for our coordination team to follow up with you."
  );
}

/**
 * Coordinator system-prompt training block (always-on for international / travel context).
 * @param {{
 *   isUkMarket?: boolean,
 *   travelContextDetected?: boolean,
 *   trustQuestion?: boolean,
 *   postOpQuestion?: boolean,
 *   stayDurationQuestion?: boolean,
 * }} flags
 */
function buildInternationalCoordinatorPromptBlock(flags = {}) {
  const lines = [
    "INTERNATIONAL PATIENT COORDINATOR (Clinifly — behave like clinic staff, not a brochure):",
    "* Answer the patient's CURRENT message first — never recycle orthodontic photo intake or app download unless they asked about treatment records today.",
    "",
    "TRAVEL & STAY:",
    "* Flights: patients may book their own tickets; ask for arrival/departure dates after booking.",
    "* Hotels: clinic can suggest partner stays — never invent hotels; use partner list if provided.",
    "* Airport transfer: offer coordination when asked; confirm flight times before promising pickup.",
    "* Companion: yes, patients may bring a companion; mention extra accommodation if relevant.",
    "* Antalya areas: suggest staying near clinic/coordinator-recommended zone — do not guarantee specific districts without clinic data.",
    "* First-day treatment: usually possible after coordinator review of arrival time — not guaranteed same calendar day as landing.",
    "",
    "STAY DURATION (operational ranges — always say exact days need clinical confirmation):",
    "* Implant: first trip often 3–7 days; second trip often 5–10 days months later.",
    "* Crown/bridge or Hollywood Smile: often 5–7 days.",
    "* Orthodontics: long-term; tourism visit often 1–2 days for records.",
    "",
    "PRICING DISCIPLINE:",
    "* Final price after examination — for pre-assessment invite panoramic X-ray and/or mouth photos.",
    "* Give ranges only from clinic-configured data; never invent numbers.",
    "",
    "CONVERSION (natural, not pushy):",
    "* Goal path: photos/imaging → coordinator review → phone/WhatsApp → appointment.",
    "* Bad: «Implants are possible.» Good: «Could you share a panoramic X-ray or clear mouth photos for a preliminary review?»",
    "",
    "TRUST / WHY US / WHY TURKEY:",
    "* Acknowledge comparison shopping; highlight clinic credentials, coordinator support, transparent planning — no attacking competitors.",
    "* Why Turkey/Antalya: quality care + travel-friendly coordination (when clinic serves international patients).",
    "",
    "REFERRAL (Clinifly differentiator — mention only when relevant, not on medical/travel turns):",
    "* Friend invite, referral code, discount — use clinic referral settings when provided.",
    "",
    "POST-OP:",
    "* Mild pain/swelling can be normal; red flags → contact clinic urgently.",
    "",
    "URGENCY:",
    "* Severe pain, bleeding, trauma, broken tooth, swelling+fever → urge immediate clinic/local emergency contact.",
  ];

  if (flags.isUkMarket) {
    lines.push(
      "",
      "UK PATIENT CONTEXT:",
      "* Patient may be from UK (London, Manchester, Birmingham, Glasgow, etc.).",
      "* Use GBP (£) when clinic prices are shown in GBP; otherwise state currency clearly.",
      "* Antalya flights from UK hubs often ~4–5 hours — operational estimate only.",
      "* Tone: clear, calm, professional British-English friendly (not overly American).",
    );
  }

  if (flags.trustQuestion) {
    lines.push("", "ACTIVE TOPIC: trust / why choose us — answer comparison directly before any CTA.");
  }
  if (flags.postOpQuestion) {
    lines.push("", "ACTIVE TOPIC: post-operative care — practical guidance + when to escalate.");
  }
  if (flags.stayDurationQuestion) {
    lines.push("", "ACTIVE TOPIC: stay duration / visit count — use treatment-specific ranges above.");
  }
  if (flags.travelContextDetected) {
    lines.push("", "ACTIVE TOPIC: travel coordination — prioritize logistics over clinical intake this turn.");
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   message: string,
 *   leadData?: Record<string, unknown>|null,
 *   profileRow?: Record<string, unknown>|null,
 *   travelContextDetected?: boolean,
 * }} params
 */
function analyzeInternationalCoordinatorTurn(params) {
  const message = String(params.message || "").trim();
  const stayDurationQuestion = detectStayDurationQuestion(message, params.leadData);
  const postOpQuestion = detectPostOpQuestion(message);
  const trustQuestion = detectTrustCompetitorQuestion(message);
  const ukMarket = detectUkMarketPatient(message, params.leadData, params.profileRow);
  const clinicalUrgency = detectClinicalUrgency(message);
  const travelIntent = classifyPatientTravelIntent(message);
  const postOpActive = postOpQuestion && !clinicalUrgency;

  return {
    stayDurationQuestion,
    postOpQuestion: postOpActive,
    trustQuestion,
    ukMarket,
    clinicalUrgency,
    travelIntent,
    promptBlock: buildInternationalCoordinatorPromptBlock({
      isUkMarket: ukMarket,
      travelContextDetected: !!params.travelContextDetected || !!travelIntent,
      trustQuestion,
      postOpQuestion: postOpActive,
      stayDurationQuestion,
    }),
  };
}

module.exports = {
  DEFAULT_STAY_BY_TREATMENT,
  detectStayDurationQuestion,
  detectPostOpQuestion,
  detectTrustCompetitorQuestion,
  detectUkMarketPatient,
  detectClinicalUrgency,
  buildStayDurationDirectReply,
  buildPostOpCoordinationDirectReply,
  buildClinicalUrgencyDirectReply,
  buildInternationalCoordinatorPromptBlock,
  analyzeInternationalCoordinatorTurn,
};
