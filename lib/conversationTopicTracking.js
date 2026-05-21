/**
 * Active conversation topic + short-reply continuation (referral / campaign / discount).
 * Persisted under operational_intake_flags.conversationTopic.
 */

const REFERRAL_TOPIC = "referral";

/** Lazy import avoids circular dependency with referralMentionGating. */
function patientIntentBlocksReferral(message) {
  const { classifyPatientIntent, intentBlocksReferralInjection } = require("./referralMentionGating");
  return intentBlocksReferralInjection(classifyPatientIntent(message));
}

function classifyPatientIntentLazy(message) {
  const { classifyPatientIntent } = require("./referralMentionGating");
  return classifyPatientIntent(message);
}
const REFERRAL_TOPIC_ALIASES = new Set(["referral", "campaign", "discount", "invite"]);

/** Assistant or patient text that establishes referral thread */
const REFERRAL_TOPIC_IN_TEXT = [
  /\breferral\b/i,
  /\brefer\s*(a\s*)?friend/i,
  /\binvite\s*(a\s*)?friend/i,
  /\barkada[sş]\s*davet/i,
  /\breferans\b/i,
  /\bdavet\s*kodu\b/i,
  /\breferral\s*code\b/i,
  /\bindirim\s*kodu\b/i,
  /\bdiscount\s*code\b/i,
  /\bpromo(tion)?\s*code\b/i,
  /\bkampanya\b/i,
  /\bcampaign\b/i,
  /\bindirim\s*var\s*m[ıi]/i,
  /\breferral\s*program/i,
  /\bdavet\s*program/i,
  /\bindirim\s*program/i,
  /\barkada[sş].*\bindirim/i,
  /\bindirim\s*kazan/i,
  /\bfriend.*discount/i,
  /\binvite.*discount/i,
];

const CODE_REQUEST_RE =
  /\b(kod|code)\s*(lütfen|please|ver|gönder|send|payla[sş]|share)?\b/i;
const HOW_USE_RE =
  /\b(nasıl\s*kullan|how\s*(to|do)\s*(use|apply)|kullan[ıi]l[ıi]yor|kayıt\s*olurken)\b/i;
const SHORT_ACK_RE =
  /^(evet|tamam|ok|okay|yes|lütfen|please|sure|tabii|olur|peki|hadi|yeah|yep|ha|he|mhm|👍|✅)\b/i;

/**
 * @param {string} text
 */
function textDiscussesReferralTopic(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return REFERRAL_TOPIC_IN_TEXT.some((re) => re.test(t));
}

/**
 * @param {Array<{ role?: string, text?: string }>} turns
 * @param {number} [maxLookback]
 */
function recentTurnsDiscussReferral(turns, maxLookback = 8) {
  const slice = (turns || []).slice(-maxLookback);
  for (const turn of slice) {
    const role = String(turn?.role || "").toLowerCase();
    if (role !== "patient" && role !== "user") continue;
    if (textDiscussesReferralTopic(turn?.text || "")) return true;
  }
  return false;
}

/**
 * @param {string} message
 */
function isShortContinuationMessage(message) {
  const m = String(message || "").trim();
  if (!m) return false;
  if (m.length > 100) return false;
  const words = m.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return true;
  if (SHORT_ACK_RE.test(m)) return true;
  if (CODE_REQUEST_RE.test(m)) return true;
  if (HOW_USE_RE.test(m)) return true;
  return false;
}

/**
 * @param {string} message
 * @param {string|null} activeTopic
 */
function inferPendingAction(message, activeTopic) {
  if (activeTopic !== REFERRAL_TOPIC) return null;
  const m = String(message || "").trim();
  if (CODE_REQUEST_RE.test(m) || /\bkod\s*lütfen\b/i.test(m)) {
    return "provide_referral_code";
  }
  if (HOW_USE_RE.test(m)) return "explain_referral_usage";
  if (SHORT_ACK_RE.test(m) || isShortContinuationMessage(m)) {
    return "continue_referral_thread";
  }
  return "referral_inquiry";
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readConversationTopicFromFlags(flags) {
  const raw =
    flags?.conversationTopic && typeof flags.conversationTopic === "object"
      ? flags.conversationTopic
      : null;
  if (!raw) return null;
  return {
    current_topic: raw.current_topic ? String(raw.current_topic) : null,
    unresolved_user_intent: raw.unresolved_user_intent
      ? String(raw.unresolved_user_intent)
      : null,
    pending_action: raw.pending_action ? String(raw.pending_action) : null,
    referral_context:
      raw.referral_context && typeof raw.referral_context === "object"
        ? raw.referral_context
        : null,
    referral_mention_count:
      raw.referral_mention_count != null ? Number(raw.referral_mention_count) : 0,
    referral_last_mentioned_at: raw.referral_last_mentioned_at
      ? String(raw.referral_last_mentioned_at)
      : null,
    turns_since_referral_mention:
      raw.turns_since_referral_mention != null ? Number(raw.turns_since_referral_mention) : 0,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

/**
 * @param {{
 *   patientMessage?: string,
 *   conversationSummary?: string,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 *   persistedTopic?: ReturnType<typeof readConversationTopicFromFlags>|null,
 * }} params
 */
function resolveActiveConversationTopic(params) {
  const msg = String(params.patientMessage || "").trim();
  const summary = String(params.conversationSummary || "").trim();
  const recent = params.recentTurns || [];
  const persisted = params.persistedTopic || null;

  const patientIntent = classifyPatientIntentLazy(msg);
  const intentBlocksReferral = patientIntentBlocksReferral(msg);
  const msgEstablishesReferral = textDiscussesReferralTopic(msg) && !intentBlocksReferral;
  const historyReferral = recentTurnsDiscussReferral(recent);
  const shortContinuation = isShortContinuationMessage(msg);

  let current_topic = persisted?.current_topic || null;
  let unresolved_user_intent = persisted?.unresolved_user_intent || null;
  let pending_action = persisted?.pending_action || null;
  let referral_mention_count = Number(persisted?.referral_mention_count) || 0;
  let referral_last_mentioned_at = persisted?.referral_last_mentioned_at || null;
  let turns_since_referral_mention = Number(persisted?.turns_since_referral_mention) || 0;

  if (intentBlocksReferral && current_topic === REFERRAL_TOPIC) {
    current_topic = patientIntent;
    pending_action = null;
    unresolved_user_intent = patientIntent;
  }

  if (msgEstablishesReferral) {
    current_topic = REFERRAL_TOPIC;
    pending_action = inferPendingAction(msg, REFERRAL_TOPIC);
    unresolved_user_intent = pending_action || "referral_inquiry";
  } else if (
    (historyReferral || current_topic === REFERRAL_TOPIC) &&
    shortContinuation
  ) {
    current_topic = REFERRAL_TOPIC;
    pending_action = inferPendingAction(msg, REFERRAL_TOPIC) || "continue_referral_thread";
    unresolved_user_intent = pending_action;
  } else if (current_topic === REFERRAL_TOPIC && historyReferral && !msg) {
    pending_action = pending_action || "continue_referral_thread";
  } else if (
    current_topic === REFERRAL_TOPIC &&
    (intentBlocksReferral ||
      (!historyReferral &&
        !msgEstablishesReferral &&
        !shortContinuation &&
        msg.length > 40))
  ) {
    current_topic = intentBlocksReferral ? patientIntent : null;
    pending_action = null;
    unresolved_user_intent = intentBlocksReferral ? patientIntent : null;
  }

  if (msg && current_topic !== REFERRAL_TOPIC) {
    turns_since_referral_mention = (turns_since_referral_mention || 0) + 1;
  }

  const referral_topic_locked =
    !intentBlocksReferral &&
    (current_topic === REFERRAL_TOPIC || REFERRAL_TOPIC_ALIASES.has(String(current_topic || "")));

  return {
    current_topic,
    unresolved_user_intent,
    pending_action,
    referral_context: persisted?.referral_context || null,
    referral_mention_count,
    referral_last_mentioned_at,
    turns_since_referral_mention,
    active_topic: current_topic || patientIntent,
    user_current_intent: patientIntent,
    referral_topic_locked,
    isShortReferralContinuation:
      referral_topic_locked &&
      shortContinuation &&
      (historyReferral || msgEstablishesReferral),
    recent_turns_had_referral: historyReferral,
    msg_establishes_referral: msgEstablishesReferral,
  };
}

/**
 * @param {ReturnType<typeof resolveActiveConversationTopic>} topic
 */
function buildConversationTopicGuardPromptBlock(topic) {
  if (!topic?.referral_topic_locked) return null;

  const pending = topic.pending_action || topic.unresolved_user_intent || "referral";
  const lines = [
    "ACTIVE CONVERSATION TOPIC — REFERRAL (mandatory; overrides clinical intake, pricing pivots, travel, imaging):",
    `* current_topic: referral`,
    `* pending_action: ${pending}`,
    `* unresolved_user_intent: ${topic.unresolved_user_intent || pending}`,
    "",
    "Rules for THIS reply ONLY:",
    "* The patient is continuing a referral / invite-friend / discount / campaign thread — NOT a new clinical question.",
    "* Do NOT answer about extractions, anesthesia, sedation, implants, X-rays, photos, travel, or unrelated procedures unless the patient explicitly asks about those in this same message.",
    "* Do NOT change topic or deflect to medical intake.",
    "* Answer the referral thread: how the program works, where to find their code, how a friend registers with clinic code + referral code, and that rewards may apply after successful registration/treatment per clinic approval.",
  ];

  if (topic.pending_action === "provide_referral_code") {
    lines.push(
      "* Patient asked for their referral code — give the code from runtime state if present; otherwise direct them to the Referrals / Invite page in the patient app where their personal code is shown.",
    );
  }
  if (topic.pending_action === "explain_referral_usage") {
    lines.push(
      "* Explain step-by-step how a friend uses clinic code + the patient's referral code at registration.",
    );
  }
  if (topic.isShortReferralContinuation) {
    lines.push(
      '* Short reply (e.g. "yes", "ok", "code please") — treat as continuation of the LAST referral explanation; fulfill the implied request (usually share code or next step).',
    );
  }

  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof resolveActiveConversationTopic>} topic
 * @param {Record<string, unknown>|null} [referralState]
 */
function buildReferralContinuationPromptBlock(topic, referralState = null) {
  if (!topic?.referral_topic_locked) return null;

  const code = referralState?.referral_code
    ? String(referralState.referral_code)
    : null;
  const lines = [
    "REFERRAL THREAD CONTINUATION (patient-facing — complete the open referral request):",
    "",
    "How the clinic referral system works (explain naturally in the patient's language):",
    "* The patient's personal referral code is on their Referrals / Invite friends page in the app (davet / referans sayfası).",
    "* When a friend registers at the clinic, they enter the clinic code AND the patient's referral code.",
    "* After successful registration and/or treatment start (per clinic policy), both the inviter and the invited friend may receive discount benefits — often subject to clinic approval.",
    "",
  ];

  if (code) {
    lines.push(
      `* This patient's referral_code (share if they asked for code): ${code}`,
      "* Include the code clearly in your reply when they asked for it.",
    );
  } else {
    lines.push(
      "* referral_code not in system yet — tell them to open the Referrals page in the app to view or generate their code; do NOT invent a code.",
    );
  }

  if (topic.pending_action === "provide_referral_code") {
    lines.push(
      "",
      "Expected shape (adapt tone/language; do not copy verbatim if awkward):",
      '* Warm confirmation + where the code lives in app + friend registers with clinic code + referral code + mutual discount after approval.',
    );
  }

  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof resolveActiveConversationTopic>} topic
 * @param {{ patientMessage?: string, aiReply?: string, referralState?: Record<string, unknown>|null }} turn
 */
function updateConversationTopicAfterTurn(topic, turn) {
  const next = { ...topic };
  const patientMsg = String(turn.patientMessage || "");
  const aiText = String(turn.aiReply || "");

  if (textDiscussesReferralTopic(patientMsg) && !patientIntentBlocksReferral(patientMsg)) {
    next.current_topic = REFERRAL_TOPIC;
  } else if (patientIntentBlocksReferral(patientMsg) && next.current_topic === REFERRAL_TOPIC) {
    next.current_topic = classifyPatientIntentLazy(patientMsg);
    next.pending_action = null;
  }

  if (textDiscussesReferralTopic(aiText)) {
    next.referral_mention_count = (Number(next.referral_mention_count) || 0) + 1;
    next.referral_last_mentioned_at = new Date().toISOString();
    next.turns_since_referral_mention = 0;
  } else if (patientMsg) {
    next.turns_since_referral_mention = (Number(next.turns_since_referral_mention) || 0) + 1;
  }

  if (next.current_topic === REFERRAL_TOPIC) {
    next.pending_action = inferPendingAction(patientMsg, REFERRAL_TOPIC);
    next.unresolved_user_intent = next.pending_action || next.unresolved_user_intent;
    if (turn.referralState && typeof turn.referralState === "object") {
      next.referral_context = {
        referral_code: turn.referralState.referral_code || null,
        current_discount: turn.referralState.current_discount ?? null,
        referral_count: turn.referralState.referral_count ?? null,
      };
    }
  }

  next.referral_topic_locked =
    next.current_topic === REFERRAL_TOPIC ||
    REFERRAL_TOPIC_ALIASES.has(String(next.current_topic || ""));
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * @param {Record<string, unknown>} flags
 * @param {ReturnType<typeof resolveActiveConversationTopic>} topic
 */
function mergeConversationTopicIntoFlags(flags, topic) {
  const base = flags && typeof flags === "object" ? { ...flags } : {};
  return {
    ...base,
    conversationTopic: {
      current_topic: topic.current_topic,
      unresolved_user_intent: topic.unresolved_user_intent,
      pending_action: topic.pending_action,
      referral_context: topic.referral_context,
      referral_mention_count: topic.referral_mention_count ?? 0,
      referral_last_mentioned_at: topic.referral_last_mentioned_at || null,
      turns_since_referral_mention: topic.turns_since_referral_mention ?? 0,
      updatedAt: topic.updatedAt || new Date().toISOString(),
    },
  };
}

/**
 * @param {ReturnType<typeof resolveActiveConversationTopic>} topicContext
 * @param {{ promptBlock?: string, state?: Record<string, unknown>|null }} referralAwareness
 */
function assembleReferralAwarenessContext(topicContext, referralAwareness = {}) {
  if (referralAwareness.shouldSurface !== true) {
    return referralAwareness.promptBlock || "";
  }
  return [
    buildConversationTopicGuardPromptBlock(topicContext),
    referralAwareness.promptBlock || "",
    buildReferralContinuationPromptBlock(topicContext, referralAwareness.state || null),
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = {
  REFERRAL_TOPIC,
  textDiscussesReferralTopic,
  recentTurnsDiscussReferral,
  isShortContinuationMessage,
  readConversationTopicFromFlags,
  resolveActiveConversationTopic,
  buildConversationTopicGuardPromptBlock,
  buildReferralContinuationPromptBlock,
  assembleReferralAwarenessContext,
  updateConversationTopicAfterTurn,
  mergeConversationTopicIntoFlags,
};
