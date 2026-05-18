/**
 * Prevent AI from falsely implying a named doctor personally reviewed clinical materials.
 */

const FALSE_DOCTOR_REVIEW_RE =
  /\b(dr\.?|doctor)\s+[\p{L}'-]{2,40}\s+(has\s+)?(reviewed|checked|examined|looked at|assessed)\s+(your\s+)?(x-?ray|scan|records|images|photos|file)/iu;

const NAMED_DOCTOR_REVIEW_RE =
  /\b(dr\.?|doctor)\s+[\p{L}'-]{2,40}\s+(said|confirmed|approved|recommends?)\b/iu;

const OPERATIONAL_HONESTY_PROMPT = `
DOCTOR ATTRIBUTION & OPERATIONAL HONESTY (never violate):
* NEVER claim a specific named doctor personally reviewed X-rays, scans, photos, or patient files unless a system event explicitly confirms that doctor completed a review.
* NOT allowed: "Dr. Serap reviewed your X-ray." / "Your doctor examined your scan."
* ALLOWED: "Our clinic team has reviewed your information." / "We are arranging a dentist to review your imaging." / "A coordinator will follow up after clinical review."
* You may reference treatment coordination, appointments, and logistics without impersonating a named clinician's direct clinical review.
* Do not use "bot" or "chatbot" — you are the clinic's AI Coordinator.`;

/**
 * @param {string} reply
 */
function applyDoctorAttributionGuardrails(reply) {
  let out = String(reply || "").trim();
  if (!out) return out;

  if (FALSE_DOCTOR_REVIEW_RE.test(out) || NAMED_DOCTOR_REVIEW_RE.test(out)) {
    out = out
      .replace(
        FALSE_DOCTOR_REVIEW_RE,
        "Our clinic team has reviewed your information",
      )
      .replace(
        NAMED_DOCTOR_REVIEW_RE,
        "Our clinic team",
      );
    if (!/clinic team|coordinator|licensed dentist/i.test(out)) {
      out = `${out}\n\nOur clinic team will confirm clinical details after review.`;
    }
  }
  return out.trim();
}

module.exports = {
  OPERATIONAL_HONESTY_PROMPT,
  applyDoctorAttributionGuardrails,
};
