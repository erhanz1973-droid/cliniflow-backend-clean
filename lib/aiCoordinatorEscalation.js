/**
 * Lightweight escalation signal detection (no automation).
 */

const { detectPatientCommercialIntent } = require("./clinicPricingIntent");

/**
 * @param {string} text
 * @returns {{
 *   angry: boolean,
 *   emergency: boolean,
 *   repeatedQuestions: boolean,
 *   complaintRefund: boolean,
 *   any: boolean,
 * }}
 */
function detectEscalationSignals(text) {
  const t = String(text || "").toLowerCase();
  const angry =
    /\b(angry|furious|terrible service|worst|unacceptable|ridiculous|scam|lawyer)\b/i.test(t);
  const emergency =
    /\b(severe pain|unbearable|emergency|can't breathe|difficulty breathing|facial swell|uncontrolled bleed|bleeding heavily|post[- ]?op complication|911|ambulance)\b/i.test(
      t,
    ) ||
    /\b(şiddetli\s+ağrı|dayanamıyorum|acil|kanama|kan\s+durmuyor|kırık\s+diş|kirildi|travma|ateş.*şiş|şiş.*ateş)\b/i.test(
      t,
    );
  const severePain = /\b(severe pain|unbearable pain|excruciating|worst pain)\b/i.test(t);
  const complaintRefund =
    /\b(refund|money back|complaint|sue|legal action|chargeback|disappointed|never again)\b/i.test(t);
  const repeatedQuestions = (t.match(/\?/g) || []).length >= 3;

  const flags = { angry, emergency, severePain, repeatedQuestions, complaintRefund };
  flags.any = angry || emergency || severePain || complaintRefund || repeatedQuestions;
  return flags;
}

/**
 * Multi-question commercial messages (price + brand + duration) should not force human escalation.
 * @param {ReturnType<typeof detectEscalationSignals>} flags
 * @param {string} [messageText]
 */
function softenEscalationForCommercialIntent(flags, messageText = "") {
  const f = { ...flags };
  if (!f.repeatedQuestions || f.angry || f.emergency || f.severePain || f.complaintRefund) {
    return f;
  }
  const commercial = detectPatientCommercialIntent(messageText);
  if (!commercial.isCommercialQuestion) return f;
  f.repeatedQuestions = false;
  f.any = f.angry || f.emergency || f.severePain || f.complaintRefund;
  return f;
}

/**
 * @param {ReturnType<typeof detectEscalationSignals>} flags
 */
function escalationFlagsToJson(flags) {
  return {
    angry: !!flags.angry,
    emergency: !!flags.emergency,
    severePain: !!flags.severePain,
    repeatedQuestions: !!flags.repeatedQuestions,
    complaintRefund: !!flags.complaintRefund,
    detectedAt: new Date().toISOString(),
  };
}

module.exports = {
  detectEscalationSignals,
  softenEscalationForCommercialIntent,
  escalationFlagsToJson,
};
