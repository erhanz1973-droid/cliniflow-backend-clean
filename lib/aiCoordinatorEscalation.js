/**
 * Lightweight escalation signal detection (no automation).
 */

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
    /\b(severe pain|unbearable|emergency|can't breathe|facial swell|uncontrolled bleed|911|ambulance)\b/i.test(
      t,
    );
  const complaintRefund =
    /\b(refund|money back|complaint|sue|legal action|chargeback|disappointed|never again)\b/i.test(t);
  const repeatedQuestions = (t.match(/\?/g) || []).length >= 3;

  const flags = { angry, emergency, repeatedQuestions, complaintRefund };
  flags.any = angry || emergency || complaintRefund || repeatedQuestions;
  return flags;
}

/**
 * @param {ReturnType<typeof detectEscalationSignals>} flags
 */
function escalationFlagsToJson(flags) {
  return {
    angry: !!flags.angry,
    emergency: !!flags.emergency,
    repeatedQuestions: !!flags.repeatedQuestions,
    complaintRefund: !!flags.complaintRefund,
    detectedAt: new Date().toISOString(),
  };
}

module.exports = {
  detectEscalationSignals,
  escalationFlagsToJson,
};
