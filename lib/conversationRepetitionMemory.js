/**
 * Recently discussed topics + repetition suppression (strategy layer).
 */

const { detectPatientCommercialIntent } = require("./clinicPricingIntent");
const { textDiscussesReferralTopic } = require("./conversationTopicTracking");
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

const STAFF_COUNT_IN_TEXT_RE =
  /\b(\d+|birkaç|several|three|üç|iki|two|four|dört)\s*(deneyimli\s+)?(ortodontist|orthodontist|doktor|doctor|hekim|uzman)/i;

const STAFF_COUNT_QUESTION_RE =
  /\b(kaç\s+(doktor|hekim|ortodontist|uzman)|how\s+many\s+(doctor|orthodontist|dentist)|toplamda?\s+\d+\s+(doktor|ortodontist))/i;

const SOCIAL_ACK_RE =
  /^(teşekkür|teşekkürler|teşekür|sağol|sağ\s*ol|thanks|thank\s*you|thank\s*u|iyi\s+akşamlar|iyi\s+aksamlar|iyi\s+geceler|günaydın|gunaydin|good\s+(evening|morning|night)|hello|hi|hey|merhaba|selam|selamlar|გამარჯობა|gamarjoba)[\s!.?,🙏]*$/iu;

const MAX_RECENT_TOPICS = 14;

/** Patient asked same thing again — Jaccard on normalized words. */
const REPEATED_PATIENT_QUESTION_SIM = 0.8;
/** Generated reply too close to a recent assistant turn. */
const NEAR_DUPLICATE_REPLY_SIM = 0.74;
const NEAR_DUPLICATE_REPLY_STRICT = 0.82;

/**
 * @param {string} text
 */
function normalizeForSimilarity(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} a
 * @param {string} b
 */
function wordSetSimilarity(a, b) {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length > 10 && nb.length > 10 && (na.includes(nb) || nb.includes(na))) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    if (ratio > 0.82) return 0.96;
  }
  const wa = new Set(na.split(" ").filter((w) => w.length > 1));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 1));
  if (!wa.size || !wb.size) return na === nb ? 1 : 0;
  let inter = 0;
  for (const w of wa) {
    if (wb.has(w)) inter += 1;
  }
  const union = wa.size + wb.size - inter;
  return union ? inter / union : 0;
}

/**
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {number} limit
 */
function recentTurnTextsByRole(recentTurns, role, limit) {
  const want = role === "user" ? "user" : "assistant";
  return (recentTurns || [])
    .filter((t) => String(t.role || "").toLowerCase() === want)
    .map((t) => String(t.text || "").trim())
    .filter(Boolean)
    .slice(-limit);
}

/**
 * @param {string} patientMessage
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function detectRepeatedPatientQuestion(patientMessage, recentTurns) {
  const msg = String(patientMessage || "").trim();
  if (!msg || msg.length < 10 || isSocialAcknowledgmentMessage(msg)) {
    return { repeated: false, similarity: 0, matched: null };
  }
  const prior = recentTurnTextsByRole(recentTurns, "user", 6);
  let bestSim = 0;
  let matched = null;
  for (const prev of prior) {
    const sim = wordSetSimilarity(msg, prev);
    if (sim > bestSim) {
      bestSim = sim;
      matched = prev;
    }
  }
  return {
    repeated: bestSim >= REPEATED_PATIENT_QUESTION_SIM,
    similarity: bestSim,
    matched,
  };
}

/**
 * @param {string} reply
 * @param {Array<{ role: string, text: string }>} recentTurns
 */
function detectNearDuplicateAssistantReply(reply, recentTurns) {
  const text = String(reply || "").trim();
  if (!text || text.length < 24) {
    return { duplicate: false, similarity: 0, matched: null };
  }
  const prior = recentTurnTextsByRole(recentTurns, "assistant", 5);
  let bestSim = 0;
  let matched = null;
  for (const prev of prior) {
    const sim = wordSetSimilarity(text, prev);
    if (sim > bestSim) {
      bestSim = sim;
      matched = prev;
    }
  }
  return {
    duplicate: bestSim >= NEAR_DUPLICATE_REPLY_SIM,
    similarity: bestSim,
    matched,
  };
}

/**
 * @param {string} lang
 * @param {string} patientMessage
 */
function isTurkishConversation(lang, patientMessage) {
  const l = String(lang || "").toLowerCase().slice(0, 2);
  if (l === "tr") return true;
  return /[çğıöşü]/i.test(String(patientMessage || ""));
}

/**
 * @param {string} lang
 * @param {string} patientMessage
 */
function isGeorgianConversation(lang, patientMessage) {
  const l = String(lang || "").toLowerCase().slice(0, 2);
  if (l === "ka") return true;
  return /[\u10A0-\u10FF]/.test(String(patientMessage || ""));
}

/**
 * @param {{ patientMessage?: string, language?: string|null, priorAssistantReply?: string|null }} params
 */
function buildRepeatedQuestionShortReply(params) {
  const patientMessage = String(params.patientMessage || "");
  const lang = params.language;
  const tr = isTurkishConversation(lang, patientMessage);
  const ka = !tr && isGeorgianConversation(lang, patientMessage);
  const prior = String(params.priorAssistantReply || "").trim();
  const sentences = prior
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const tail = sentences.length ? sentences[sentences.length - 1] : null;
  const allowVariedTail = params.allowVariedTail !== false;
  if (tr) {
    if (allowVariedTail && tail && wordSetSimilarity(tail, prior) < 0.88) {
      return `Sizi anlıyorum. Kısaca: ${tail}`;
    }
    return "Sizi anladım — bu konuyu az önce de konuşmuştuk. İsterseniz tek bir noktayı (fiyat, süre veya randevu) yazın, oraya odaklanayım.";
  }
  if (ka) {
    return "გესმით — ამ თემაზე უკვე გითხარით. დამიწერეთ ერთი კონკრეტული კითხვა (ფასი, ვადა თუ ჩაწერა) და ამაზე ვპასუხებ.";
  }
  return "I understand — we touched on this recently. Send one specific point (price, timeline, or booking) and I'll focus on that.";
}

/**
 * @param {string} lang
 * @param {string} patientMessage
 */
function acknowledgmentPrefix(lang, patientMessage) {
  if (isTurkishConversation(lang, patientMessage)) return "Sizi anlıyorum. ";
  if (isGeorgianConversation(lang, patientMessage)) return "გესმით. ";
  return "I understand. ";
}

/**
 * @param {string} reply
 * @param {string} prefix
 */
function replyAlreadyHasAcknowledgment(reply, prefix) {
  const head = String(reply || "")
    .trim()
    .slice(0, 48)
    .toLowerCase();
  const p = String(prefix || "")
    .trim()
    .toLowerCase();
  if (!head || !p) return false;
  return (
    head.startsWith(p.slice(0, 10)) ||
    /^sizi anl|sizi anlad|i understand|გესმით|got it/i.test(head)
  );
}

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

  if (STAFF_COUNT_IN_TEXT_RE.test(t) || STAFF_COUNT_QUESTION_RE.test(t)) {
    topics.push("clinic_staff_count");
  }

  for (const cta of CTA_PATTERNS) {
    if (cta.re.test(t)) topics.push(`cta_${cta.id}`);
  }

  if (!isAi && textDiscussesReferralTopic(t)) topics.push("referral");

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
 * @param {string} text
 */
function isSocialAcknowledgmentMessage(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 80) return false;
  try {
    const { isGreetingOnlyMessage } = require("./greetingIntent");
    if (isGreetingOnlyMessage(t)) return true;
  } catch (_) {
    /* optional */
  }
  return SOCIAL_ACK_RE.test(t);
}

/**
 * @param {string} text
 */
function patientAsksClinicStaffCount(text) {
  return STAFF_COUNT_QUESTION_RE.test(String(text || ""));
}

/**
 * @param {string} text
 * @param {RegExp} re
 */
function stripSentencesMatching(text, re) {
  const parts = String(text || "")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => !re.test(p));
  return kept.join(" ").trim();
}

/**
 * @param {string} text
 * @param {number} n
 */
function firstNSentences(text, n) {
  const parts = String(text || "")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(0, n).join(" ").trim();
}

/**
 * @param {string} patientMessage
 * @param {string} [lang]
 */
function shortSocialAckFallback(patientMessage, lang) {
  const t = String(patientMessage || "").toLowerCase();
  const tr = String(lang || "").toLowerCase().startsWith("tr") || /[çğıöşü]/i.test(t);
  try {
    const { isGreetingOnlyMessage, buildGreetingDirectReply } = require("./greetingIntent");
    if (isGreetingOnlyMessage(patientMessage)) {
      return buildGreetingDirectReply(patientMessage, lang);
    }
  } catch (_) {
    /* optional */
  }
  if (/iyi\s+akşam|good\s+evening|iyi\s+gece|good\s+night/.test(t)) {
    return tr
      ? "İyi akşamlar! Başka bir sorunuz olursa yazabilirsiniz."
      : "Good evening! Feel free to message us if you need anything else.";
  }
  if (/günaydın|good\s+morning|merhaba|selam|hello|hi\b/.test(t)) {
    return tr
      ? "Merhaba! Size nasıl yardımcı olabilirim?"
      : "Hello! How can I help you today?";
  }
  return tr
    ? "Rica ederiz! Başka bir sorunuz olursa yazabilirsiniz."
    : "You're welcome! Let us know if you need anything else.";
}

/**
 * Post-generation guard — strip re-stated facts on thanks/greetings.
 * @param {string} reply
 * @param {{ patientMessage?: string, discussionMemory?: ReturnType<typeof buildDiscussionMemory>|null, conversationLanguage?: string|null }} ctx
 */
function applyConversationRepetitionGuardrails(reply, ctx = {}) {
  let out = String(reply || "").trim();
  if (!out) return out;

  const patientMsg = String(ctx.patientMessage || "").trim();
  const recentTurns = ctx.recentTurns || [];
  const mem = ctx.discussionMemory;
  const socialAck = isSocialAcknowledgmentMessage(patientMsg);
  const repeatedQ = detectRepeatedPatientQuestion(patientMsg, recentTurns);
  const dupReply = detectNearDuplicateAssistantReply(out, recentTurns);
  const asksStaff = patientAsksClinicStaffCount(patientMsg);
  const staffAlreadyDiscussed =
    mem?.recentTopics?.includes("clinic_staff_count") === true;

  if (
    (socialAck || (staffAlreadyDiscussed && !asksStaff)) &&
    (STAFF_COUNT_IN_TEXT_RE.test(out) ||
      /\b(klinikte|kliniğimizde|clinic).{0,50}(ortodontist|orthodontist|doktor)/i.test(out))
  ) {
    out = stripSentencesMatching(out, STAFF_COUNT_IN_TEXT_RE);
    out = stripSentencesMatching(
      out,
      /\b(klinikte|kliniğimizde|clinic).{0,50}(ortodontist|orthodontist|doktor|doctor)/i,
    );
  }

  if (socialAck) {
    if (!out) {
      out = shortSocialAckFallback(patientMsg, ctx.conversationLanguage);
    } else if (out.length > 220) {
      out = firstNSentences(out, 2);
    }
  }

  if (dupReply.duplicate) {
    const strict =
      dupReply.similarity >= NEAR_DUPLICATE_REPLY_STRICT ||
      (repeatedQ.repeated && dupReply.similarity >= NEAR_DUPLICATE_REPLY_SIM);
    if (strict) {
      out = buildRepeatedQuestionShortReply({
        patientMessage: patientMsg,
        language: ctx.conversationLanguage,
        priorAssistantReply: dupReply.matched,
        allowVariedTail: dupReply.similarity < 0.88,
      });
    } else {
      const pref = acknowledgmentPrefix(ctx.conversationLanguage, patientMsg);
      if (!replyAlreadyHasAcknowledgment(out, pref)) {
        out = `${pref}${out}`;
      }
      if (wordSetSimilarity(out, dupReply.matched || "") >= NEAR_DUPLICATE_REPLY_SIM) {
        out = buildRepeatedQuestionShortReply({
          patientMessage: patientMsg,
          language: ctx.conversationLanguage,
          priorAssistantReply: dupReply.matched,
        });
      }
    }
  } else if (repeatedQ.repeated && out.length > 80 && !replyAlreadyHasAcknowledgment(out, "")) {
    const pref = acknowledgmentPrefix(ctx.conversationLanguage, patientMsg);
    if (!replyAlreadyHasAcknowledgment(out, pref)) {
      out = `${pref}${out}`;
    }
  }

  return out.trim();
}

/**
 * @param {ReturnType<typeof buildDiscussionMemory>} memory
 * @param {{ patientMessage?: string }} [ctx]
 */
function buildRepetitionSuppressionPromptBlock(memory, ctx = {}) {
  const recentTurns = ctx.recentTurns || [];
  const msg = String(ctx.patientMessage || "").trim();
  const repeatedQ = detectRepeatedPatientQuestion(msg, recentTurns);

  const hasSignals =
    memory.recentTopics.length > 0 ||
    memory.pricingAlreadyDiscussed ||
    memory.brandsDiscussed.length > 0 ||
    repeatedQ.repeated;

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

  if (repeatedQ.repeated) {
    lines.push(
      "* Patient repeated the same or very similar question as a recent message — do NOT copy your previous answer word-for-word.",
      "* Start with a brief acknowledgment (Turkish: «Sizi anlıyorum» / «Sizi anladım»; English: «I understand»; Georgian: «გესმით»), then give a SHORTER recap, one new detail, or one clarifying question — never paste the same paragraph again.",
    );
  }
  if (memory.recentTopics.includes("clinic_staff_count") && !patientAsksClinicStaffCount(msg)) {
    lines.push(
      "* Clinic team size / doctor count was already explained — do NOT repeat how many doctors or orthodontists work at the clinic unless the patient asks again in this message.",
    );
  }
  if (isSocialAcknowledgmentMessage(msg)) {
    lines.push(
      "* Patient message is only thanks or a greeting — reply in 1–2 short warm sentences. Do NOT repeat doctor counts, appointment pitches, or facts already stated in recent messages.",
    );
  }
  if (patientAsksClinicStaffCount(msg)) {
    lines.push(
      "* Answer the team-size question once clearly; on later turns do not re-state the same count unless asked again.",
    );
  }

  lines.push(
    "",
    "Rules for THIS reply:",
    "* Do NOT repeat the same pricing block, brand paragraph, CTA, reassurance, travel logistics, process summary, or clinic staff count from your recent messages unless the patient explicitly asks for a correction or a different treatment.",
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

  if (memory.recentTopics.includes("referral") && textDiscussesReferralTopic(ctx.patientMessage || "")) {
    lines.push(
      "* Patient is continuing referral/discount — answer referral only; do NOT append referral to unrelated clinical or travel answers.",
    );
  } else if (memory.recentTopics.includes("referral")) {
    lines.push(
      "* Referral was discussed earlier — do NOT mention it again unless the patient asks about discount/referral/campaign in this message (cooldown).",
    );
  }

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
  isSocialAcknowledgmentMessage,
  patientAsksClinicStaffCount,
  applyConversationRepetitionGuardrails,
  detectRepeatedPatientQuestion,
  detectNearDuplicateAssistantReply,
  wordSetSimilarity,
};
