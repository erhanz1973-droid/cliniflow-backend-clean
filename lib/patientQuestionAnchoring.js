/**
 * Keep coordinator replies anchored to the patient's actual question (avoid generic greetings).
 */

const { classifyPatientIntent } = require("./referralMentionGating");
const { isSocialAcknowledgmentMessage } = require("./conversationRepetitionMemory");

/** @type {Array<{ id: string, re: RegExp, labelTr: string, labelEn: string, slug: string }>} */
const TREATMENT_TOPIC_PATTERNS = [
  {
    id: "bridge",
    re: /(bridge|bridges|dental\s+bridge|fixed\s+bridge|köprü|kopru)/i,
    labelTr: "köprü tedavisi",
    labelEn: "dental bridge treatment",
    slug: "bridge",
  },
  {
    id: "implant",
    re: /(implant|implants|implantasyon|implantları|diş\s*implant|all[\s-]*on[\s-]*4)/i,
    labelTr: "implant tedavisi",
    labelEn: "dental implant treatment",
    slug: "implant",
  },
  {
    id: "veneer",
    re: /(veneer|veneers|laminate|lamina|yaprak\s*diş|porselen\s*lamina)/i,
    labelTr: "lamina / veneer",
    labelEn: "veneers",
    slug: "veneer",
  },
  {
    id: "crown",
    re: /(crown|crowns|kron|diş\s*kaplama|zirkonyum\s*kaplama|kaplama\s*tedavi)/i,
    labelTr: "diş kaplama / kron",
    labelEn: "dental crowns",
    slug: "crown",
  },
  {
    id: "prosthetic",
    re: /(prosthetic|prosthesis|protez|tam\s*protez|hareketli\s*protez|sabit\s*protez)/i,
    labelTr: "protez tedavisi",
    labelEn: "prosthetic dentistry",
    slug: "prosthetic",
  },
  {
    id: "root_canal",
    re: /\b(root\s*canal|endodont|kanal\s*tedavi)\b/i,
    labelTr: "kanal tedavisi",
    labelEn: "root canal treatment",
    slug: "root_canal",
  },
  {
    id: "extraction",
    re: /\b(extraction|extract|çekim|diş\s*çekim|yirmilik)\b/i,
    labelTr: "diş çekimi",
    labelEn: "tooth extraction",
    slug: "extraction",
  },
  {
    id: "orthodontics",
    re: /\b(orthodont\w*|braces|invisalign|tel\s*tedav\w*|ortodont\w*|diş\s*teli)\b/i,
    labelTr: "ortodonti / tel tedavisi",
    labelEn: "orthodontic treatment",
    slug: "orthodontics",
  },
  {
    id: "whitening",
    re: /\b(whiten|bleach|bleaching|diş\s*beyazlat|beyazlatma)\b/i,
    labelTr: "diş beyazlatma",
    labelEn: "teeth whitening",
    slug: "whitening",
  },
  {
    id: "cleaning",
    re: /\b(cleaning|hygiene|scaling|polish|diş\s*taşı|temizlik|detartraj)\b/i,
    labelTr: "diş temizliği",
    labelEn: "dental cleaning",
    slug: "cleaning",
  },
];

const INFO_REQUEST_RE =
  /\b(bilgi|information|hakkında|about|detay|detail|açıkla|explain|nedir|ne\s+kadar|fiyat|price|ücret|maliyet|cost|süre|kaç\s+gün|how\s+long|süreci|process)\b/i;

const GENERIC_DEFLECTION_RE = [
  /^[\s\S]{0,120}(size\s+nasıl\s+yardımcı\s+olabiliriz|nasıl\s+yardımcı\s+olabiliriz)\??[\s!.]*$/iu,
  /^[\s\S]{0,120}(how\s+can\s+we\s+help|how\s+can\s+i\s+help|how\s+may\s+we\s+assist)\??[\s!.]*$/iu,
  /^[\s\S]{0,80}(merhaba|hello|hi)[!.,\s]*(size\s+nasıl\s+yardımcı|how\s+can\s+we\s+help)/iu,
  /^[\s\S]{0,100}(what\s+can\s+we\s+do\s+for\s+you|how\s+can\s+we\s+assist\s+you\s+today)\??[\s!.]*$/iu,
];

/**
 * @param {string} message
 */
function detectPatientTreatmentTopic(message) {
  const t = String(message || "").trim();
  if (!t) return null;
  for (const p of TREATMENT_TOPIC_PATTERNS) {
    if (p.re.test(t)) return p;
  }
  return null;
}

/**
 * @param {string} message
 */
function isSubstantiveClinicalQuestion(message) {
  const t = String(message || "").trim();
  if (!t || isSocialAcknowledgmentMessage(t)) return false;
  const intent = classifyPatientIntent(t);
  if (intent === "medical" || intent === "price_cost") return true;
  const topic = detectPatientTreatmentTopic(t);
  if (topic && INFO_REQUEST_RE.test(t)) return true;
  if (topic && t.length >= 12) return true;
  return false;
}

/**
 * @param {string} reply
 */
function isGenericDeflectionReply(reply) {
  const r = String(reply || "").trim();
  if (!r) return true;
  if (r.length > 280) return false;
  return GENERIC_DEFLECTION_RE.some((re) => re.test(r));
}

/**
 * @param {string} message
 * @param {string} [lang]
 */
function topicAnchoredFallbackReply(message, lang) {
  const topic = detectPatientTreatmentTopic(message);
  const tr =
    String(lang || "")
      .trim()
      .toLowerCase()
      .startsWith("tr") || /[çğıöşü]/i.test(message);
  const label = topic ? (tr ? topic.labelTr : topic.labelEn) : tr ? "tedavi" : "treatment";

  if (tr) {
    return `${label.charAt(0).toUpperCase() + label.slice(1)} hakkında bilgi istediğinizi anlıyoruz. Kliniğimizde genellikle önce kısa bir muayene veya görüntüleme (panoramik röntgen / gerekirse tomografi) ile diş ve kemik durumuna bakılır; ardından size uygun seçenekler (malzeme, diş sayısı, süre) netleştirilir. İsterseniz kaç diş için düşündüğünüzü veya mevcut bir röntgeniniz olup olmadığını yazın, ona göre devam edelim.`;
  }
  return `I understand you're asking about ${label}. We usually start with a brief exam and imaging (panoramic X-ray, and CT if needed) to assess your teeth and bone, then outline suitable options (materials, number of teeth, timeline). If you share how many teeth are involved or whether you already have X-rays, we can guide you more specifically.`;
}

/**
 * @param {string} message
 */
function buildPatientQuestionAnchoringPromptBlock(message) {
  if (!isSubstantiveClinicalQuestion(message)) return null;

  const topic = detectPatientTreatmentTopic(message);
  const intent = classifyPatientIntent(message);
  const topicLine = topic
    ? `Detected treatment topic: ${topic.labelEn} (${topic.slug}).`
    : "Patient asked a specific clinical / treatment question.";

  return [
    "PATIENT QUESTION ANCHORING (mandatory — overrides generic greetings):",
    `* ${topicLine}`,
    "* The patient already stated what they want — do NOT open with only “How can I help?”, “Size nasıl yardımcı olabilirim?”, or a bare hello.",
    "* First 1–2 sentences MUST directly address their treatment topic (what it involves at a high level, what the clinic typically needs to assess, realistic next step).",
    "* You may add ONE short follow-up question if needed (e.g. number of teeth, existing X-rays) — not instead of answering.",
    "* Do not pivot to referral programs, WhatsApp collection, or unrelated services unless they asked.",
    intent === "price_cost"
      ? "* They may be asking about cost — if clinic pricing is in context, give ranges; otherwise explain what affects price (teeth count, materials) without inventing numbers."
      : null,
    topic?.id === "bridge"
      ? "* For bridges: mention assessment of supporting teeth, typical steps (exam/imaging → plan → preparation → bridge placement), and that exact design depends on their case — no diagnosis."
      : null,
    topic?.id === "orthodontics"
      ? "* For orthodontics: request a front photo with lips gently retracted (anterior teeth visible). Recommend the Clinifly patient app (clinifly.net) for step-by-step guided, AI-assisted photo capture; on register-with-clinic-code they link directly to the clinic. App is free — do not diagnose from photos."
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {string} reply
 * @param {string} patientMessage
 * @param {{ conversationLanguage?: string|null }} [opts]
 */
function repairGenericDeflectionReply(reply, patientMessage, opts = {}) {
  const patient = String(patientMessage || "").trim();
  const out = String(reply || "").trim();
  if (!patient || !isSubstantiveClinicalQuestion(patient)) return out;
  if (!isGenericDeflectionReply(out)) return out;
  const fixed = topicAnchoredFallbackReply(patient, opts.conversationLanguage);
  console.warn("[patientQuestionAnchoring] replaced generic deflection reply", {
    topic: detectPatientTreatmentTopic(patient)?.id || "clinical",
    preview: out.slice(0, 80),
  });
  return fixed;
}

module.exports = {
  TREATMENT_TOPIC_PATTERNS,
  detectPatientTreatmentTopic,
  isSubstantiveClinicalQuestion,
  isGenericDeflectionReply,
  buildPatientQuestionAnchoringPromptBlock,
  repairGenericDeflectionReply,
  topicAnchoredFallbackReply,
};
