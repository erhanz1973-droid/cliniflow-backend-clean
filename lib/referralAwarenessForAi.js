/**
 * Referral program context for AI coordinator — clinic rules + patient state + timing.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  recentTurnsDiscussReferral,
  textDiscussesReferralTopic,
  isShortContinuationMessage,
} = require("./conversationTopicTracking");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REFERRAL_ASK_PATTERNS = [
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
  /\b(is there|any)\s*(a\s*)?discount\b/i,
  /\b(cheaper|more affordable|lower price)\b/i,
  /\b(çok\s*)?pahal[ıi]\b/i,
  /\b(too\s*expensive|can't afford|cannot afford)\b/i,
  /\bbudget\b/i,
  /\bbütçe\b/i,
  /\b(daha\s*)?uygun\s*olur\s*mu\b/i,
  /\breduce\s*(the\s*)?cost\b/i,
  /\bmaliyet.*(düş|azalt)/i,
];

const PRICE_SENSITIVITY_PATTERNS = [
  /\b(expensive|pricey|costly|afford)\b/i,
  /\b(pahal[ıi]|ucuz|bütçe|indirim)\b/i,
  /\b(too\s*much|out of budget)\b/i,
  /\bprice\s*objection\b/i,
];

/**
 * @param {unknown} raw
 */
function normalizeReferralLevels(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const level1Raw = input.level1 ?? input.referralLevel1Percent ?? null;
  const level2Raw = input.level2 ?? input.referralLevel2Percent ?? null;
  const level3Raw = input.level3 ?? input.referralLevel3Percent ?? null;
  const level1 = level1Raw != null && level1Raw !== "" ? Number(level1Raw) : null;
  const level2 = level2Raw != null && level2Raw !== "" ? Number(level2Raw) : null;
  const level3 = level3Raw != null && level3Raw !== "" ? Number(level3Raw) : null;
  return { level1, level2, level3 };
}

/**
 * @param {number} count
 * @param {{ level1?: number|null, level2?: number|null, level3?: number|null }} levels
 */
function levelPercentForCount(count, levels) {
  const level1 = levels?.level1 ?? 0;
  const level2 = levels?.level2 ?? level1 ?? 0;
  const level3 = levels?.level3 ?? level2 ?? level1 ?? 0;
  if (count <= 0) return 0;
  if (count === 1) return level1 || 0;
  if (count === 2) return level2 || level1 || 0;
  return level3 || level2 || level1 || 0;
}

/**
 * @param {unknown} state
 */
function normalizeReferralState(state) {
  const s = state && typeof state === "object" ? state : {};
  const base = Number(s.baseDiscountPercent ?? s.base_discount_percent ?? 0);
  const earned = Number(s.earnedDiscountPercent ?? s.earned_discount_percent ?? 0);
  const total = Number(s.totalDiscountPercent ?? s.total_discount_percent ?? 0);
  return {
    baseDiscountPercent: Number.isFinite(base) ? base : 0,
    earnedDiscountPercent: Number.isFinite(earned) ? earned : 0,
    totalDiscountPercent: Number.isFinite(total) ? total : 0,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} settings
 */
function isReferralProgramActive(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  if (s.referralProgramEnabled === false || s.referral_enabled === false) return false;
  const levels = normalizeReferralLevels(s.referralLevels || s.referral_levels);
  const hasLevel =
    (levels.level1 != null && levels.level1 > 0) ||
    (levels.level2 != null && levels.level2 > 0) ||
    (levels.level3 != null && levels.level3 > 0);
  const flat =
    Number(s.referral_discount_percent ?? s.referralDiscountPercent ?? 0) > 0 ||
    Number(s.referralDiscount ?? 0) > 0;
  return hasLevel || flat;
}

/**
 * @param {string} clinicId
 */
async function loadClinicReferralConfig(clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(String(clinicId || ""))) {
    return { active: false, levels: { level1: null, level2: null, level3: null }, maxCap: 0 };
  }
  const { data, error } = await supabase
    .from("clinics")
    .select("id, settings, default_inviter_discount_percent")
    .eq("id", clinicId)
    .maybeSingle();
  if (error || !data) {
    return { active: false, levels: { level1: null, level2: null, level3: null }, maxCap: 0 };
  }
  const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  const levels = normalizeReferralLevels(
    settings.referralLevels ||
      settings.referral_levels || {
        level1: data.default_inviter_discount_percent ?? settings.referralLevel1Percent,
      },
  );
  const active = isReferralProgramActive(settings);
  const maxCap = levels.level3 ?? levels.level2 ?? levels.level1 ?? 0;
  return { active, levels, maxCap: Number(maxCap) || 0, settings };
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function loadPatientReferralRow(patientId, clinicId) {
  if (!isSupabaseEnabled()) return null;
  const pid = String(patientId || "").trim();
  if (!pid) return null;

  let row = null;
  if (UUID_RE.test(pid)) {
    const r1 = await supabase
      .from("patients")
      .select("id, patient_id, clinic_id, referral_code, referral_state, name")
      .eq("id", pid)
      .maybeSingle();
    row = r1.data;
  }
  if (!row) {
    const r2 = await supabase
      .from("patients")
      .select("id, patient_id, clinic_id, referral_code, referral_state, name")
      .eq("patient_id", pid)
      .maybeSingle();
    row = r2.data;
  }
  if (!row) return null;
  if (clinicId && row.clinic_id && String(row.clinic_id) !== String(clinicId)) return null;
  return row;
}

/**
 * @param {string} inviterId
 * @param {string} [clinicId]
 */
async function countSuccessfulReferrals(inviterId, clinicId) {
  if (!isSupabaseEnabled()) return 0;
  const statusList = ["APPROVED", "COMPLETED"];
  const columns = ["inviter_patient_id", "referrer_patient_id"];
  for (const col of columns) {
    let q = supabase
      .from("referrals")
      .select("*", { count: "exact", head: true })
      .eq(col, inviterId)
      .in("status", statusList);
    if (clinicId && UUID_RE.test(clinicId)) q = q.eq("clinic_id", clinicId);
    const { count, error } = await q;
    if (!error) return count || 0;
    const msg = String(error.message || "").toLowerCase();
    if (!msg.includes("column") && !msg.includes("does not exist")) break;
  }
  return 0;
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [leadData]
 */
function detectReferralConversationSignals(message, leadData = {}) {
  const text = [message, leadData?.treatmentInterest, leadData?.budgetSignal]
    .filter(Boolean)
    .join(" ");
  const asksReferral = REFERRAL_ASK_PATTERNS.some((re) => re.test(text));
  const priceSensitive =
    PRICE_SENSITIVITY_PATTERNS.some((re) => re.test(text)) ||
    leadData?.budgetSignal === "low" ||
    /\bprice_objection\b/i.test(text);
  return { asksReferral, priceSensitive };
}

/**
 * Whether this turn should surface referral (not spammy).
 * @param {{ asksReferral: boolean, priceSensitive: boolean }} signals
 * @param {{ messageCount?: number, topicContext?: Record<string, unknown>|null, recentTurns?: Array<{ text?: string }> }} [opts]
 */
function shouldSurfaceReferralThisTurn(signals, opts = {}) {
  const topic = opts.topicContext;
  if (topic?.referral_topic_locked) return true;
  if (topic?.isShortReferralContinuation) return true;
  const msgCount = Number(opts.messageCount) || 0;
  if (signals.asksReferral) return true;
  if (signals.priceSensitive && msgCount >= 1) return true;
  return false;
}

/**
 * @param {number} count
 * @param {{ level1?: number|null, level2?: number|null, level3?: number|null }} levels
 */
function describeReferralTier(count, levels) {
  const current = levelPercentForCount(count, levels);
  const nextAt = count + 1;
  const next = levelPercentForCount(nextAt, levels);
  let tierLabel = "starter";
  if (count >= 3) tierLabel = "level_3";
  else if (count === 2) tierLabel = "level_2";
  else if (count === 1) tierLabel = "level_1";
  return { tierLabel, currentPercent: current, nextPercent: next, successfulCount: count };
}

/**
 * @param {{
 *   clinicId: string,
 *   patientId: string,
 *   message: string,
 *   leadData?: Record<string, unknown>,
 *   messageCount?: number,
 *   pricingBlocker?: boolean,
 *   topicContext?: Record<string, unknown>|null,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 * }} params
 */
async function buildReferralAwarenessForAi(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const message = String(params.message || "").trim();

  const clinicCfg = await loadClinicReferralConfig(clinicId);
  if (!clinicCfg.active) {
    return {
      active: false,
      shouldSurface: false,
      promptBlock: "",
      state: null,
    };
  }

  const patientRow = await loadPatientReferralRow(patientId, clinicId);
  const referralState = normalizeReferralState(patientRow?.referral_state);
  const selfIds = [
    patientId,
    patientRow?.patient_id,
    patientRow?.id,
  ].filter(Boolean);
  const primaryId = patientRow?.patient_id || patientRow?.id || patientId;
  const successfulCount = await countSuccessfulReferrals(primaryId, clinicId);
  const tier = describeReferralTier(successfulCount, clinicCfg.levels);

  const currentDiscount =
    referralState.totalDiscountPercent > 0
      ? referralState.totalDiscountPercent
      : tier.currentPercent;

  const recentTurns = params.recentTurns || [];
  const topicContext = params.topicContext || null;
  const historyReferral =
    recentTurnsDiscussReferral(recentTurns) ||
    textDiscussesReferralTopic(message) ||
    topicContext?.referral_topic_locked === true;

  const signals = detectReferralConversationSignals(message, params.leadData);
  const shortReferralContinuation =
    topicContext?.isShortReferralContinuation === true ||
    (historyReferral && isShortContinuationMessage(message));

  const priceSensitive = signals.priceSensitive || params.pricingBlocker === true;
  const shouldSurface =
    shouldSurfaceReferralThisTurn(
      { asksReferral: signals.asksReferral, priceSensitive },
      {
        messageCount: params.messageCount,
        topicContext,
        recentTurns,
      },
    ) ||
    shortReferralContinuation ||
    topicContext?.referral_topic_locked === true;

  const state = {
    referral_program_active: true,
    current_discount: currentDiscount,
    referral_count: successfulCount,
    referral_tier: tier.tierLabel,
    referral_code: patientRow?.referral_code || null,
    referral_levels: clinicCfg.levels,
    next_tier_percent: tier.nextPercent,
    max_cap_percent: clinicCfg.maxCap,
    referral_rewards:
      "Successful invites can increase discount tiers for both referrer and invited friend per clinic policy.",
    eligibility:
      successfulCount >= 0
        ? "Patient may share their referral code with friends; rewards apply after clinic approves completed referrals."
        : "unknown",
  };

  const promptBlock = shouldSurface
    ? buildReferralAwarenessPromptBlock(state, {
        asksReferral: signals.asksReferral || shortReferralContinuation,
        priceSensitive,
        pendingAction: topicContext?.pending_action || null,
        shortContinuation: shortReferralContinuation,
      })
    : buildReferralPassiveAwarenessPromptBlock(state);

  return {
    active: true,
    shouldSurface,
    promptBlock,
    state,
  };
}

/**
 * @param {Record<string, unknown>} state
 * @param {{ asksReferral: boolean, priceSensitive: boolean, pendingAction?: string|null, shortContinuation?: boolean }} signals
 */
function buildReferralAwarenessPromptBlock(state, signals) {
  const code = state.referral_code ? String(state.referral_code) : null;
  const discount = Number(state.current_discount) || 0;
  const count = Number(state.referral_count) || 0;
  const nextPct = Number(state.next_tier_percent) || 0;
  const levels = state.referral_levels || {};

  const lines = [
    "REFERRAL PROGRAM (clinic has an active friend-referral / discount system — use as helpful cost guidance, NOT hard selling):",
    "* The clinic runs a referral program. You know the rules below — do NOT reply with only \"contact the clinic\" or \"reach out to the clinic\" for discount/referral/campaign questions.",
    "* Answer in the patient's language with warm, native phrasing (explain — do not translate awkwardly).",
    "* Primary focus stays the patient's treatment need; referral is optional helpful context.",
    "",
    "Runtime referral state (facts you may cite if accurate):",
    `* current_discount (patient total referral benefit now): ${discount}%`,
    `* referral_count (approved successful invites): ${count}`,
    `* referral_tier: ${state.referral_tier}`,
    code ? `* referral_code (patient may share): ${code}` : "* referral_code: not assigned yet — clinic can provide in app",
    `* tier progression (clinic config): level1=${levels.level1 ?? "—"}%, level2=${levels.level2 ?? "—"}%, level3=${levels.level3 ?? "—"}%`,
    nextPct > discount
      ? `* After ${count + 1} successful referral(s), total benefit may reach about ${nextPct}% (subject to clinic approval).`
      : "",
    `* max_cap_percent: ${state.max_cap_percent || "—"}%`,
    `* eligibility: ${state.eligibility}`,
    "",
    "Registration flow (explain when patient wants code or how it works):",
    "* Patient's code: Referrals / Invite page in the patient app (davet / referans sayfası).",
    "* Friend registers at the clinic with: (1) clinic code, (2) patient's referral code.",
    "* After successful registration / treatment start per clinic policy, both inviter and invited friend may earn discount benefits — subject to clinic approval.",
    "",
    "Tone & timing:",
    "* No aggressive sales language, no fake urgency, no spam every message.",
    signals.shortContinuation || signals.pendingAction === "provide_referral_code"
      ? "* Patient continued the referral thread (short reply or code request) — answer ONLY referral: share code if available, else app referrals page; do NOT switch to unrelated clinical topics."
      : signals.asksReferral
        ? "* Patient asked about referral/discount/campaign — explain clearly and offer to walk through how it works."
        : signals.priceSensitive
          ? "* Price sensitivity detected — after addressing their clinical/coordination question, you MAY briefly mention referral as one optional way to reduce cost (one soft sentence)."
          : "",
    code && signals.pendingAction === "provide_referral_code"
      ? `* REQUIRED: Include referral_code ${code} in this reply.`
      : !code && signals.pendingAction === "provide_referral_code"
        ? "* REQUIRED: Direct patient to Referrals page in app for their personal code — do not invent a code."
        : "",
    "",
    "Example phrases (adapt naturally, do not copy every time):",
    '* "I can explain how our friend-referral discount works if you\'d like."',
    '* "Inviting a friend may unlock extra savings for both of you, depending on clinic approval."',
    '* "Would you like to see your referral advantages in the app?"',
    '* "There may be referral options that could help with treatment costs — I can outline how it works."',
    "",
    "Do NOT invent percentages beyond the runtime state above. Final discounts require clinic approval.",
  ];

  return lines.filter(Boolean).join("\n");
}

/**
 * Light awareness when program is active but this turn should not push referral.
 * @param {Record<string, unknown>} state
 */
function buildReferralPassiveAwarenessPromptBlock(state) {
  return [
    "REFERRAL PROGRAM (active at this clinic — passive awareness only this turn):",
    "* Do not bring up referral unless the patient asks about price, discount, campaign, or inviting friends.",
    `* If they do ask: current_discount≈${state.current_discount}%, referral_count=${state.referral_count}, code=${state.referral_code || "via app"}.`,
    '* Never deflect with only "contact the clinic" when referral/discount data is available.',
  ].join("\n");
}

module.exports = {
  buildReferralAwarenessForAi,
  detectReferralConversationSignals,
  isReferralProgramActive,
  normalizeReferralLevels,
  levelPercentForCount,
};
