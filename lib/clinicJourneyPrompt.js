/**
 * Treatment journey context for AI coordinator (operational only).
 */

const JOURNEY_GUARDRAIL_PROMPT = `
TREATMENT JOURNEY GUIDANCE (when clinic protocol context is provided):
* Provide operational coordination guidance only — NOT medical diagnosis, prognosis, or treatment prescriptions.
* Use only timelines and visit patterns from the clinic protocol list — do not invent clinical steps.
* Always clarify that exact visit count, stay length, and healing timing depend on clinical evaluation and individual healing.
* Never guarantee outcomes, pain levels, or fixed schedules.
* Encourage confirmation with the clinic doctor/coordinator before booking travel.
* If no protocol matches the patient's question, give general orientation and offer coordinator follow-up.`;

/**
 * @param {string} slug
 */
function formatTreatmentLabel(slug) {
  return String(slug || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {import('./clinicJourneyTypes').ClinicTreatmentProtocolDto} p
 */
function summarizeProtocol(p) {
  const parts = [];
  if (p.typicalVisitCount != null) {
    parts.push(`typically ${p.typicalVisitCount} visit${p.typicalVisitCount === 1 ? "" : "s"}`);
  }
  if (p.estimatedStayDuration) {
    parts.push(`first-stay duration commonly ${p.estimatedStayDuration}`);
  }
  if (p.secondVisitAfter) {
    parts.push(`second visit often ${p.secondVisitAfter}`);
  }
  if (p.healingNotes) parts.push(`healing: ${p.healingNotes}`);
  if (p.postOpNotes) parts.push(`post-op coordination: ${p.postOpNotes}`);
  if (p.xrayRequired) parts.push("X-ray/imaging usually needed before planning");
  if (p.temporaryTeethPossible) parts.push("temporary teeth may be possible during healing");
  if (p.aiNotes) parts.push(`coordinator notes: ${p.aiNotes}`);
  return parts.join("; ") || "operational timeline configured by clinic";
}

/**
 * @param {import('./clinicJourneyTypes').ClinicTreatmentProtocolDto[]} protocols
 * @returns {string|null}
 */
function buildTreatmentJourneyPromptBlock(protocols) {
  const list = Array.isArray(protocols) ? protocols.filter((p) => p && p.isActive !== false) : [];
  if (!list.length) return null;

  const lines = list.map((p) => {
    return `- ${formatTreatmentLabel(p.treatmentType)}: ${summarizeProtocol(p)}`;
  });

  return (
    "Clinic treatment journey protocols (operational coordination only; timelines vary by clinical evaluation):\n" +
    lines.join("\n")
  );
}

module.exports = {
  JOURNEY_GUARDRAIL_PROMPT,
  buildTreatmentJourneyPromptBlock,
  formatTreatmentLabel,
  summarizeProtocol,
};
