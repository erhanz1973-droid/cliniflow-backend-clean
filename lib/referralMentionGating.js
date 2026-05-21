/**
 * Referral mention gating — contextual, non-intrusive patient-facing AI.
 * Prevents promotional tails on medical / operational / address questions.
 */

const {
  textDiscussesReferralTopic,
  isShortContinuationMessage,
} = require("./conversationTopicTracking");

const REFERRAL_COOLDOWN_TURNS = 2;

const MEDICAL_INTENT_PATTERNS = [
  /\ball[\s-]*on[\s-]*4\b/i,
  /\bfull[\s-]*mouth\b/i,
  /\bimplant(s)?\b/i,
  /\bveneer(s)?\b/i,
  /\bcrown(s)?\b/i,
  /\bbridge(s)?\b/i,
  /\bextraction(s)?\b/i,
  /\broot\s*canal\b/i,
  /\borthodont/i,
  /\bbraces\b/i,
  /\bwhiten(ing)?\b/i,
  /\bbleach(ing)?\b/i,
  /\bclean(ing)?\b/i,
  /\bscaling\b/i,
  /\btartar\b/i,
  /\bgum\b/i,
  /\bperiodont/i,
  /\bsinus\s*lift\b/i,
  /\bbone\s*graft\b/i,
  /\bx[\s-]*ray\b/i,
  /\bpanoramic\b/i,
  /\bct\s*scan\b/i,
  /\bdiagnos/i,
  /\btreatment\b/i,
  /\bprocedure\b/i,
  /\btooth\b/i,
  /\bteeth\b/i,
  /\bdi[sş]\b/i,
  /\bkanal\b/i,
  /\bkaplama\b/i,
  /\bimplant\b/i,
  /\bprotetik\b/i,
  /\bortodont/i,
];

const OPERATIONAL_INTENT_PATTERNS = [
  /\bappointment\b/i,
  /\bconsultation\b/i,
  /\bschedule\b/i,
  /\bbooking\b/i,
  /\bavailable\b/i,
  /\bopening\s*hours?\b/i,
  /\bworking\s*hours?\b/i,
  /\bhow\s*long\b/i,
  /\bkaç\s*gün\b/i,
  /\bne\s*zaman\b/i,
  /\brandevu\b/i,
  /\bmuayene\b/i,
  /\bvisit\b/i,
  /\bprocess\b/i,
  /\bstep(s)?\b/i,
  /\bwhatsapp\b/i,
  /\bphone\b/i,
  /\bcall\b/i,
];

const ADDRESS_TRAVEL_INTENT_PATTERNS = [
  /\baddress\b/i,
  /\blocation\b/i,
  /\bwhere\s*(is|are)\b/i,
  /\bmap\b/i,
  /\bdirections?\b/i,
  /\bairport\b/i,
  /\bflight\b/i,
  /\bhotel\b/i,
  /\btransfer\b/i,
  /\btravel\b/i,
  /\baccommodation\b/i,
  /\bnear\b/i,
  /\badres\b/i,
  /\bkonum\b/i,
  /\bnerede\b/i,
  /\bulas[ıi]m\b/i,
  /\bhow\s*to\s*get\b/i,
];

/** @typedef {'medical'|'operational'|'address_travel'|'referral_discount'|'price_cost'|'general'} PatientIntent */

/**
 * @param {string} message
 * @returns {PatientIntent}
 */
function classifyPatientIntent(message) {
  const t = String(message || "").trim();
  if (!t) return "general";
  if (textDiscussesReferralTopic(t)) return "referral_discount";
  if (MEDICAL_INTENT_PATTERNS.some((re) => re.test(t))) return "medical";
  if (ADDRESS_TRAVEL_INTENT_PATTERNS.some((re) => re.test(t))) return "address_travel";
  if (OPERATIONAL_INTENT_PATTERNS.some((re) => re.test(t))) return "operational";
  if (
    /\b(price|cost|fee|expensive|afford|budget|indirim|fiyat|ücret|pahal[ıi]|ucuz|maliyet)\b/i.test(
      t,
    )
  ) {
    return "price_cost";
  }
  return "general";
}

/**
 * @param {PatientIntent} intent
 */
function intentBlocksReferralInjection(intent) {
  return intent === "medical" || intent === "operational" || intent === "address_travel";
}

/**
 * Patient-only turns that discussed referral (ignore assistant spam in history).
 * @param {Array<{ role?: string, text?: string }>} turns
 * @param {number} [maxLookback]
 */
function recentPatientTurnsDiscussReferral(turns, maxLookback = 8) {
  const slice = (turns || []).slice(-maxLookback);
  for (const turn of slice) {
    const role = String(turn?.role || "").toLowerCase();
    if (role !== "patient" && role !== "user") continue;
    if (textDiscussesReferralTopic(turn?.text || "")) return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} topic
 * @param {Array<{ role?: string, text?: string }>} [recentTurns]
 */
function countTurnsSinceReferralMention(topic, recentTurns = []) {
  const fromPersisted = Number(topic?.turns_since_referral_mention);
  if (Number.isFinite(fromPersisted) && fromPersisted >= 0) return fromPersisted;

  let patientTurns = 0;
  let seenReferral = false;
  for (let i = recentTurns.length - 1; i >= 0; i--) {
    const turn = recentTurns[i];
    const role = String(turn?.role || "").toLowerCase();
    if (role !== "patient" && role !== "user") continue;
    patientTurns++;
    if (textDiscussesReferralTopic(turn?.text || "")) {
      seenReferral = true;
      break;
    }
  }
  if (!seenReferral && topic?.referral_last_mentioned_at) {
    return patientTurns;
  }
  return seenReferral ? 0 : patientTurns;
}

/**
 * @param {{
 *   message: string,
 *   asksReferral: boolean,
 *   priceSensitive: boolean,
 *   topicContext?: Record<string, unknown>|null,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 *   persistedTopic?: Record<string, unknown>|null,
 * }} params
 */
function evaluateReferralMentionGate(params) {
  const message = String(params.message || "").trim();
  const intent = classifyPatientIntent(message);
  const blocks = intentBlocksReferralInjection(intent);
  const asksReferral = params.asksReferral === true;
  const priceCostIntent = intent === "price_cost";
  const topic = params.topicContext || params.persistedTopic || null;

  const patientHistoryReferral = recentPatientTurnsDiscussReferral(params.recentTurns || []);
  const shortContinuation =
    topic?.isShortReferralContinuation === true ||
    (patientHistoryReferral && isShortContinuationMessage(message) && textDiscussesReferralTopic(message) === false);

  const explicitReferralThread =
    asksReferral ||
    (topic?.referral_topic_locked === true && (asksReferral || patientHistoryReferral || shortContinuation));

  const turnsSince = countTurnsSinceReferralMention(topic, params.recentTurns || []);
  const mentionCount = Number(topic?.referral_mention_count) || 0;
  const cooldownActive =
    !asksReferral && mentionCount > 0 && turnsSince < REFERRAL_COOLDOWN_TURNS;

  let relevanceScore = 0;
  if (asksReferral) relevanceScore = 1;
  else if (priceCostIntent && params.priceSensitive) relevanceScore = 0.75;
  else if (explicitReferralThread && shortContinuation) relevanceScore = 0.85;

  let shouldSurface = false;
  if (blocks) {
    shouldSurface = false;
  } else if (cooldownActive) {
    shouldSurface = asksReferral;
  } else if (asksReferral) {
    shouldSurface = true;
  } else if (priceCostIntent && params.priceSensitive) {
    shouldSurface = true;
  } else if (explicitReferralThread && shortContinuation) {
    shouldSurface = true;
  }

  return {
    shouldSurface,
    intent,
    active_topic: intent === "referral_discount" ? "referral" : intent,
    user_current_intent: intent,
    referral_relevance_score: relevanceScore,
    referral_mention_count: mentionCount,
    turns_since_referral_mention: turnsSince,
    referral_cooldown_active: cooldownActive,
    blocks_referral_injection: blocks,
    explicit_referral_thread: explicitReferralThread,
  };
}

function buildReferralAntiSpamPromptBlock() {
  return [
    "REFERRAL PROGRAM (exists at clinic — gated OFF for this turn):",
    "* Do NOT append referral codes, invite-friend programs, discount campaigns, or promotional sentences.",
    "* Do NOT add a marketing tail at the end of your reply.",
    "* Answer ONLY what the patient asked — natural, short, clinically/operationally relevant.",
    "* Referral/discount may be mentioned ONLY when the patient explicitly asks about discount, referral, campaign, or cost reduction in THIS message.",
    "Rule: Do not append referral/promotional information unless directly relevant to the user's current intent.",
  ].join("\n");
}

/**
 * @param {ReturnType<typeof evaluateReferralMentionGate>} gate
 */
function buildReferralGatingPromptSnippet(gate) {
  if (!gate) return "";
  return [
    "REFERRAL MENTION GATING (mandatory):",
    `* user_current_intent: ${gate.user_current_intent}`,
    `* referral_relevance_score: ${gate.referral_relevance_score}`,
    `* referral_mention_count: ${gate.referral_mention_count}`,
    `* turns_since_referral_mention: ${gate.turns_since_referral_mention}`,
    gate.referral_cooldown_active
      ? `* Cooldown active — do NOT mention referral for at least ${REFERRAL_COOLDOWN_TURNS} patient turns after the last referral explanation unless the patient asks again.`
      : "",
    gate.blocks_referral_injection
      ? "* Medical / operational / address-travel question — ZERO referral content this turn."
      : "",
    "Rule: Do not append referral/promotional information unless directly relevant to the user's current intent.",
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  REFERRAL_COOLDOWN_TURNS,
  classifyPatientIntent,
  intentBlocksReferralInjection,
  recentPatientTurnsDiscussReferral,
  evaluateReferralMentionGate,
  buildReferralAntiSpamPromptBlock,
  buildReferralGatingPromptSnippet,
  countTurnsSinceReferralMention,
};
