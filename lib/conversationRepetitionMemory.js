/**
 * Recently discussed topics + repetition suppression (strategy layer).
 */

const { detectPatientCommercialIntent } = require("./clinicPricingIntent");
const { recentAssistantTexts } = require("./coordinatorRecentHistory");

const KNOWN_IMPLANT_BRANDS = [
  "straumann",
  "nobel",
  "nobel biocare",
  "osstem",
  "megagen",
  "anthogyr",
  "bego",
  "mis",
  "neodent",
];

const PRICE_IN_TEXT =
  /\b(\d{2,5}\s*(€|eur|usd|\$|try|tl)|approximately|typically from|price range|per implant|from\s+\d)/i;

const REASSURANCE_RE =
  /\b(completely understandable|natural to feel|many patients|don't worry|do not worry|not uncommon|totally normal|it's normal|completely normal)\b/i;

const CTA_PATTERNS = [
  { id: "xray_request", re: /\b(panoramic|x-?ray|cbct|ct scan|imaging|upload.*scan)\b/i },
  { id: "photo_request", re: /\b(smile photo|intraoral|send (us )?photos|clinical photos)\b/i },
  { id: "consultation_booking", re: /\b(book (a )?consultation|schedule (a )?visit|appointment|video call)\b/i },
  { id: "whatsapp_request", re: /\b(whatsapp|phone number|reach you on)\b/i },
];

const PROCESS_EXPLANATION_RE =
  /\b(step[s]?|process|procedure|timeline|healing|osseointegration|treatment plan|stages? of)\b/i;

const TRAVEL_LOGISTICS_RE =
  /\b(hotel|airport|transfer|accommodation|stay in|how many visits|travel)\b/i;

const MAX_RECENT_TOPICS = 14;

/**
 * @param {string} text
 */
function brandsMentioned(text) {
  const t = String(text || "").toLowerCase();
  return KNOWN_IMPLANT_BRANDS.filter((b) => t.includes(b));
}

/**
 * @param {string} text
 * @param {boolean} [isAi]
 */
function topicsFromText(text, isAi = false) {
  const topics = [];
  const t = String(text || "");
  const lower = t.toLowerCase();
  if (!t.trim()) return topics;

  const brands = brandsMentioned(t);
  const hasPrice = PRICE_IN_TEXT.test(t);

  for (const brand of brands) {
    const slug = brand.replace(/\s+/g, "_");
    if (hasPrice) topics.push(`${slug}_pricing`);
    topics.push(`${slug}_brand`);
  }

  if (hasPrice && !brands.length) topics.push("general_pricing");
  if (hasPrice && brands.length === 0 && /\bimplant/i.test(lower)) topics.push("implant_pricing");

  if (
    /\b(which|what).{0,30}(best|better|recommend|prefer)/i.test(t) &&
    /\bimplant|brand|system/i.test(lower)
  ) {
    topics.push("implant_quality_comparison");
  }
  if (/\bcompare|comparison|difference between|vs\b/i.test(lower) && /\bimplant|brand/i.test(lower)) {
    topics.push("implant_quality_comparison");
  }

  if (REASSURANCE_RE.test(t)) topics.push("reassurance");
  if (PROCESS_EXPLANATION_RE.test(t) && isAi) topics.push("process_explanation");
  if (TRAVEL_LOGISTICS_RE.test(t) && isAi) topics.push("travel_logistics");

  for (const cta of CTA_PATTERNS) {
    if (cta.re.test(t)) topics.push(`cta_${cta.id}`);
  }

  return topics;
}

/**
 * @param {Record<string, unknown>|null|undefined} persisted
 */
function normalizeDiscussionMemory(persisted) {
  const p = persisted && typeof persisted === "object" ? persisted : {};
  const rawTopics = Array.isArray(p.recentTopics) ? p.recentTopics : [];
  return {
    recentTopics: rawTopics.map(String).filter(Boolean).slice(-MAX_RECENT_TOPICS),
    pricingAlreadyDiscussed: p.pricingAlreadyDiscussed === true,
    brandsDiscussed: Array.isArray(p.brandsDiscussed)
      ? p.brandsDiscussed.map(String).filter(Boolean)
      : [],
    lastCtaType: p.lastCtaType ? String(p.lastCtaType) : null,
    lastReassuranceTurn: p.lastReassuranceTurn != null ? Number(p.lastReassuranceTurn) : null,
    turnCount: p.turnCount != null ? Number(p.turnCount) : 0,
    updatedAt: p.updatedAt ? String(p.updatedAt) : null,
  };
}

/**
 * @param {{
 *   patientMessage?: string|null,
 *   conversationSummary?: string|null,
 *   recentTurns?: Array<{ role: string, text: string }>,
 *   persistedMemory?: Record<string, unknown>|null,
 * }} params
 */
function buildDiscussionMemory(params) {
  const persisted = normalizeDiscussionMemory(params.persistedMemory);
  const recentTurns = params.recentTurns || [];
  const assistantTexts = recentAssistantTexts(recentTurns, 5);

  const topicSet = new Set(persisted.recentTopics);
  let pricingAlreadyDiscussed = persisted.pricingAlreadyDiscussed;
  const brandsSet = new Set(persisted.brandsDiscussed);
  let lastCtaType = persisted.lastCtaType;
  let lastReassuranceTurn = persisted.lastReassuranceTurn;

  for (const text of assistantTexts) {
    for (const topic of topicsFromText(text, true)) {
      topicSet.add(topic);
    }
    if (PRICE_IN_TEXT.test(text)) pricingAlreadyDiscussed = true;
    for (const b of brandsMentioned(text)) brandsSet.add(b);
    for (const cta of CTA_PATTERNS) {
      if (cta.re.test(text)) lastCtaType = cta.id;
    }
    if (REASSURANCE_RE.test(text)) {
      lastReassuranceTurn = persisted.turnCount + assistantTexts.indexOf(text) + 1;
    }
  }

  const patientTopics = topicsFromText(params.patientMessage || "", false);
  for (const t of patientTopics) topicSet.add(t);

  const summary = String(params.conversationSummary || "").toLowerCase();
  if (summary && PRICE_IN_TEXT.test(summary)) pricingAlreadyDiscussed = true;
  if (summary && /\bstraumann|nobel|osstem|implant brand/i.test(summary)) {
    for (const b of KNOWN_IMPLANT_BRANDS) {
      if (summary.includes(b)) brandsSet.add(b);
    }
  }

  const recentTopics = [...topicSet].slice(-MAX_RECENT_TOPICS);
  const intent = detectPatientCommercialIntent(String(params.patientMessage || ""), {});

  const patientMsg = String(params.patientMessage || "");
  const patientBrands = brandsMentioned(patientMsg);
  const brandAlreadyPriced = patientBrands.some((b) =>
    recentTopics.includes(`${b.replace(/\s+/g, "_")}_pricing`),
  );
  const confirmationFollowUp =
    pricingAlreadyDiscussed &&
    (/\b(so|then|is that|is it|mean)\b/i.test(patientMsg) &&
      /\b(best|better|right|good choice|worth it|recommend)\b/i.test(patientMsg));

  const isFollowUp =
    confirmationFollowUp ||
    brandAlreadyPriced ||
    (intent.isCommercialQuestion &&
      (pricingAlreadyDiscussed ||
        recentTopics.some((t) => t.endsWith("_pricing") || t === "general_pricing")));

  const repeatedBrandPricing = isFollowUp && (brandAlreadyPriced || confirmationFollowUp);

  return {
    recentTopics,
    pricingAlreadyDiscussed,
    brandsDiscussed: [...brandsSet],
    lastCtaType,
    lastReassuranceTurn,
    turnCount: persisted.turnCount,
    isFollowUpQuestion: isFollowUp,
    repeatedBrandPricing,
    patientAsksNewPrice:
      intent.asksPrice &&
      !repeatedBrandPricing &&
      !recentTopics.some((t) => t.endsWith("_pricing")),
  };
}

/**
 * @param {ReturnType<typeof buildDiscussionMemory>} memory
 * @param {{ patientMessage?: string }} [ctx]
 */
function buildRepetitionSuppressionPromptBlock(memory, ctx = {}) {
  const hasSignals =
    memory.recentTopics.length > 0 ||
    memory.pricingAlreadyDiscussed ||
    memory.brandsDiscussed.length > 0;

  if (!hasSignals) return null;

  const lines = [
    "CONVERSATION REPETITION AWARENESS (strategy layer — mandatory):",
    `recent_topics: ${JSON.stringify(memory.recentTopics)}`,
    `pricing_already_discussed: ${memory.pricingAlreadyDiscussed}`,
  ];

  if (memory.brandsDiscussed.length) {
    lines.push(`brands_already_mentioned: ${memory.brandsDiscussed.join(", ")}`);
  }
  if (memory.lastCtaType) {
    lines.push(`last_cta_type: ${memory.lastCtaType} — do NOT repeat the same CTA wording this turn.`);
  }
  if (memory.lastReassuranceTurn != null) {
    lines.push(
      `last_reassurance_turn: ${memory.lastReassuranceTurn} — avoid repeating the same reassurance phrases.`,
    );
  }

  lines.push(
    "",
    "Rules for THIS reply:",
    "* Do NOT repeat the same pricing block, brand paragraph, CTA, reassurance, travel logistics, or process summary from your recent messages unless the patient explicitly asks for a correction or a different treatment.",
    "* If the patient asks a follow-up (e.g. \"So Straumann is best?\" after pricing was given): advance the conversation — clinical suitability, longevity, support ecosystem, bone assessment — NOT the same price figures again.",
    "* If pricing was already discussed and the patient seeks confirmation: acknowledge briefly without re-listing ranges.",
    "* Prefer ONE new useful angle or ONE clarifying question instead of looping templates.",
    "* Sound conversational and memory-capable, not like a brochure re-sent every turn.",
  );

  if (memory.repeatedBrandPricing) {
    lines.push(
      "* Patient message looks like a follow-up on a brand/price already covered — elaborate or clarify, do NOT repeat the same Straumann/brand price paragraph.",
    );
  }

  if (memory.pricingAlreadyDiscussed && !memory.patientAsksNewPrice) {
    lines.push(
      "* Pricing already shared recently — skip price ranges unless answering a genuinely new commercial question (different treatment or currency).",
    );
  }

  const msg = String(ctx.patientMessage || "").trim();
  if (msg) {
    lines.push(`\nPatient's latest message (read for follow-up vs new topic):\n${msg.slice(0, 500)}`);
  }

  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof buildDiscussionMemory>} memory
 * @param {{ patientMessage?: string, aiReply?: string }} turn
 */
function updateDiscussionMemoryAfterTurn(memory, turn) {
  const next = { ...memory };
  next.turnCount = (next.turnCount || 0) + 1;

  const patientTopics = topicsFromText(turn.patientMessage || "", false);
  const aiTopics = topicsFromText(turn.aiReply || "", true);
  const merged = new Set([...(next.recentTopics || []), ...patientTopics, ...aiTopics]);

  if (PRICE_IN_TEXT.test(turn.aiReply || "")) next.pricingAlreadyDiscussed = true;
  for (const b of brandsMentioned(turn.aiReply || "")) {
    next.brandsDiscussed = [...new Set([...(next.brandsDiscussed || []), b])];
  }
  for (const cta of CTA_PATTERNS) {
    if (cta.re.test(turn.aiReply || "")) next.lastCtaType = cta.id;
  }
  if (REASSURANCE_RE.test(turn.aiReply || "")) {
    next.lastReassuranceTurn = next.turnCount;
  }

  next.recentTopics = [...merged].slice(-MAX_RECENT_TOPICS);
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * @param {Record<string, unknown>} flags
 * @param {ReturnType<typeof buildDiscussionMemory>} memory
 */
function mergeDiscussionMemoryIntoFlags(flags, memory) {
  const base = flags && typeof flags === "object" ? { ...flags } : {};
  return {
    ...base,
    discussionMemory: {
      recentTopics: memory.recentTopics,
      pricingAlreadyDiscussed: memory.pricingAlreadyDiscussed,
      brandsDiscussed: memory.brandsDiscussed,
      lastCtaType: memory.lastCtaType,
      lastReassuranceTurn: memory.lastReassuranceTurn,
      turnCount: memory.turnCount,
      updatedAt: memory.updatedAt || new Date().toISOString(),
    },
    pricingDiscussed: memory.pricingAlreadyDiscussed,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readDiscussionMemoryFromFlags(flags) {
  if (!flags || typeof flags !== "object") return null;
  return flags.discussionMemory || null;
}

module.exports = {
  buildDiscussionMemory,
  buildRepetitionSuppressionPromptBlock,
  updateDiscussionMemoryAfterTurn,
  mergeDiscussionMemoryIntoFlags,
  readDiscussionMemoryFromFlags,
  normalizeDiscussionMemory,
  topicsFromText,
};
