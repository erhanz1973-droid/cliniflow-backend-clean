/**
 * Medical / legal guardrails for AI dental coordinator replies.
 * Defense in depth: system prompt + post-generation checks.
 */

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

const DISCLAIMERS = {
  diagnosis:
    "Please consult a licensed dentist for diagnosis and a personalised treatment plan.",
  guarantee:
    "Treatment outcomes vary by individual — a licensed dentist can explain realistic expectations after an examination.",
  medication:
    "I cannot recommend medications or dosages. Please speak with a licensed dentist or pharmacist.",
  emergency:
    "If you have severe pain, significant swelling, uncontrolled bleeding, fever with dental symptoms, or trouble breathing, seek urgent in-person dental or emergency care immediately.",
};

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
 * @param {{ userMessage?: string }} [ctx]
 * @returns {string}
 */
function applyReplyGuardrails(reply, ctx = {}) {
  let out = String(reply || "").trim();
  if (!out) return out;

  const combined = `${ctx.userMessage || ""}\n${out}`;
  const risks = detectRiskTopics(combined);

  if (risks.emergency) {
    if (
      !replyAlreadyContains(out, /urgent|emergency|immediately|seek care|licensed dentist/i)
    ) {
      out = `${out}\n\n${DISCLAIMERS.emergency}`;
    }
  }

  if (risks.diagnosis || DIAGNOSIS_PATTERNS.some((re) => re.test(out))) {
    if (!replyAlreadyContains(out, /licensed dentist.*diagnos|consult.*licensed dentist/i)) {
      out = `${out}\n\n${DISCLAIMERS.diagnosis}`;
    }
  }

  if (risks.medication || MEDICATION_PATTERNS.some((re) => re.test(out))) {
    if (!replyAlreadyContains(out, /cannot recommend medication|medications or dosages/i)) {
      out = `${out}\n\n${DISCLAIMERS.medication}`;
    }
  }

  if (risks.guarantee || GUARANTEE_PATTERNS.some((re) => re.test(out))) {
    if (!replyAlreadyContains(out, /outcomes vary|realistic expectations|cannot guarantee/i)) {
      out = `${out}\n\n${DISCLAIMERS.guarantee}`;
    }
  }

  return out.trim();
}

const TREATMENT_GUIDE_DISCLAIMER =
  "Final clinical evaluation is performed by licensed dental professionals.";

/**
 * Treatment Guide replies always reinforce licensed clinical evaluation.
 * @param {string} reply
 * @returns {string}
 */
function applyTreatmentGuideDisclaimer(reply) {
  let out = String(reply || "").trim();
  if (!out) return out;
  if (!replyAlreadyContains(out, /licensed dental professionals|licensed dentist/i)) {
    out = `${out}\n\n${TREATMENT_GUIDE_DISCLAIMER}`;
  }
  return out.trim();
}

const MEDICAL_GUARDRAIL_PROMPT = `
STRICT MEDICAL & LEGAL GUARDRAILS (never violate):
* NEVER diagnose: do not state or imply what condition the patient has. Use phrases like "Please consult a licensed dentist for diagnosis."
* NEVER guarantee treatment results, timelines, pain levels, or success rates.
* NEVER prescribe or recommend specific medications, drugs, antibiotics, or dosages.
* EMERGENCY topics (severe pain, facial swelling, uncontrolled bleeding, fever with dental infection, trauma, breathing difficulty):
  — Tell the patient to seek urgent in-person dental or emergency care immediately.
  — Do not give step-by-step clinical emergency treatment instructions.
* You may explain general procedure information in neutral, educational terms only.
* When uncertain, defer to an in-person consultation with a licensed dentist.`;

module.exports = {
  MEDICAL_GUARDRAIL_PROMPT,
  TREATMENT_GUIDE_DISCLAIMER,
  DISCLAIMERS,
  detectRiskTopics,
  applyReplyGuardrails,
  applyTreatmentGuideDisclaimer,
};
