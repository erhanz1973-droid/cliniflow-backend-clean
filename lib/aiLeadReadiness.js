/**
 * Operational lead readiness score (computed — no new tables).
 */

const { TAG_DEFINITIONS } = require("./treatmentInterestTags");

/**
 * @param {{
 *   leadData?: import('./leadIntelligence').LeadData|null,
 *   flags?: Record<string, unknown>|null,
 *   documents?: Array<{ documentType?: string, reviewStatus?: string, requiresDoctorReview?: boolean }>,
 *   profile?: { messageCount?: number, coordinationMode?: string, lastHumanReplyAt?: string|null, country?: string|null }|null,
 * }} input
 */
function computeLeadReadiness(input) {
  const ld = input.leadData || {};
  const flags = input.flags || {};
  const docs = input.documents || [];
  const profile = input.profile || {};

  const checks = [];

  if (ld.treatmentInterest || (flags.patientReportedTags || []).length) {
    checks.push({ key: "treatment_goals", label: "Treatment goals / concerns captured", met: true, weight: 20 });
  } else {
    checks.push({
      key: "treatment_goals",
      label: "Treatment goals or patient-reported concerns",
      met: false,
      weight: 20,
    });
  }

  if (ld.country) {
    checks.push({ key: "country", label: "Country / origin", met: true, weight: 8 });
  } else {
    checks.push({ key: "country", label: "Country / origin", met: false, weight: 8 });
  }

  if (ld.travelTimeline) {
    checks.push({ key: "travel", label: "Travel timeline (optional boost)", met: true, weight: 10 });
  } else {
    checks.push({
      key: "travel",
      label: "Travel timeline (optional)",
      met: false,
      weight: 10,
      optional: true,
    });
  }

  const hasDocs = docs.length > 0;
  checks.push({
    key: "documents",
    label: "At least one intake document uploaded",
    met: hasDocs,
    weight: 18,
  });

  if (!flags.missingXray) {
    checks.push({
      key: "imaging",
      label: "Imaging present when commonly needed",
      met: true,
      weight: 15,
    });
  } else {
    checks.push({
      key: "imaging",
      label: "Panoramic X-ray / imaging (when relevant)",
      met: false,
      weight: 15,
    });
  }

  const cosmeticTags = (flags.patientReportedTags || []).some((t) =>
    ["veneer_interest", "cosmetic_goal", "whitening_interest"].includes(t),
  );
  if (!cosmeticTags || !flags.missingSmilePhotos) {
    checks.push({ key: "photos", label: "Smile photos when relevant", met: true, weight: 10 });
  } else {
    checks.push({ key: "photos", label: "Smile / intraoral photos", met: false, weight: 10 });
  }

  if (!flags.doctorReviewNeeded) {
    checks.push({ key: "doctor_review", label: "No pending doctor document review", met: true, weight: 12 });
  } else {
    checks.push({
      key: "doctor_review",
      label: "Licensed dentist review of uploads",
      met: false,
      weight: 12,
    });
  }

  const engaged =
    (profile.messageCount || 0) >= 2 ||
    profile.coordinationMode === "human_active" ||
    !!profile.lastHumanReplyAt;
  checks.push({
    key: "engagement",
    label: "Conversation / coordinator engagement",
    met: engaged,
    weight: 7,
  });

  let earned = 0;
  let total = 0;
  const missingItems = [];

  for (const c of checks) {
    total += c.weight;
    if (c.met) {
      earned += c.weight;
    } else if (!c.optional) {
      missingItems.push(c.label);
    }
  }

  const readinessPercent = total > 0 ? Math.round((earned / total) * 100) : 0;

  const tagLabels = (flags.patientReportedTags || [])
    .filter((k) => TAG_DEFINITIONS[k])
    .map((k) => TAG_DEFINITIONS[k].label);

  return {
    readinessPercent,
    readinessMissing: missingItems,
    readinessChecks: checks,
    patientReportedTagLabels: tagLabels,
  };
}

module.exports = { computeLeadReadiness };
