/**
 * Visual intake pipeline steps for coordinators and patients (operational workflow only).
 */

const { JOURNEY_STAGES } = require("./aiIntakeJourney");

/** @typedef {'complete'|'current'|'pending'|'skipped'} StepStatus */

/**
 * @type {Array<{ key: string, title: string, subtitle: string, linkedStages: string[] }>}
 */
const INTAKE_PIPELINE_STEPS = [
  {
    key: "goals",
    title: "Tell us your goals",
    subtitle: "Patient-reported concerns and treatment interests (not a diagnosis).",
    linkedStages: ["intake_started"],
  },
  {
    key: "photos",
    title: "Upload smile photos",
    subtitle: "Clear smile or intraoral photos when relevant for cosmetic planning.",
    linkedStages: ["awaiting_photos"],
  },
  {
    key: "xray",
    title: "Upload panoramic X-ray",
    subtitle: "Recent imaging commonly requested before surgical planning.",
    linkedStages: ["awaiting_xray"],
  },
  {
    key: "doctor_review",
    title: "Dentist review",
    subtitle: "Licensed dental professionals review uploads — AI does not diagnose.",
    linkedStages: ["doctor_review_pending"],
  },
  {
    key: "coordinator",
    title: "Coordinator follow-up",
    subtitle: "Human coordinator assists with logistics and next steps.",
    linkedStages: ["coordinator_followup"],
  },
  {
    key: "consultation",
    title: "Consultation ready",
    subtitle: "Operational intake complete enough to offer a clinic consultation.",
    linkedStages: ["consultation_ready"],
  },
];

const IMAGING_TYPES = new Set(["panoramic_xray", "ct_scan"]);
const PHOTO_TYPES = new Set(["selfie", "intraoral_photo"]);

/**
 * @param {Record<string, unknown>} flags
 * @param {Array<{ documentType?: string, reviewStatus?: string }>} documents
 */
function stepCompletion(flags, documents) {
  const docs = documents || [];
  const f = flags || {};
  const tags = f.patientReportedTags || [];

  const hasGoals =
    !f.missingTreatmentPreference &&
    (!!tags.length || !f.missingTreatmentPreference);

  const needsPhotos =
    f.missingSmilePhotos === true ||
    tags.some((t) => ["veneer_interest", "cosmetic_goal", "whitening_interest"].includes(t));

  const needsXray =
    f.missingXray === true ||
    tags.some((t) =>
      ["implant_interest", "full_mouth_restoration_interest", "missing_teeth_count"].includes(t),
    );

  const hasPhotos = docs.some((d) => PHOTO_TYPES.has(String(d.documentType || "")));
  const hasImaging = docs.some((d) => IMAGING_TYPES.has(String(d.documentType || "")));

  return {
    goals: hasGoals,
    photos: needsPhotos ? hasPhotos : true,
    photosSkipped: !needsPhotos,
    xray: needsXray ? hasImaging : true,
    xraySkipped: !needsXray,
    doctor_review: !f.doctorReviewNeeded,
    coordinator: false,
    consultation: f.journeyStage === "consultation_ready",
  };
}

/**
 * @param {string} journeyStage
 * @param {Record<string, boolean>} done
 */
function resolveCurrentKey(journeyStage, done) {
  const map = {
    intake_started: "goals",
    awaiting_photos: "photos",
    awaiting_xray: "xray",
    doctor_review_pending: "doctor_review",
    coordinator_followup: "coordinator",
    consultation_ready: "consultation",
  };
  if (map[journeyStage]) return map[journeyStage];
  if (!done.goals) return "goals";
  if (!done.photos && !done.photosSkipped) return "photos";
  if (!done.xray && !done.xraySkipped) return "xray";
  if (!done.doctor_review) return "doctor_review";
  return "consultation";
}

/**
 * @param {{
 *   operationalIntakeFlags?: Record<string, unknown>|null,
 *   documents?: Array<Record<string, unknown>>,
 *   readiness?: { percent?: number, missing?: string[] }|null,
 * }} input
 */
function buildIntakeJourneySteps(input) {
  const flags = input.operationalIntakeFlags || {};
  const documents = input.documents || [];
  const readiness = input.readiness || {};
  const journeyStage = String(flags.journeyStage || "intake_started");
  const done = stepCompletion(flags, documents);
  const currentKey = resolveCurrentKey(journeyStage, done);

  const steps = INTAKE_PIPELINE_STEPS.map((def) => {
    /** @type {StepStatus} */
    let status = "pending";
    const isDone =
      def.key === "goals"
        ? done.goals
        : def.key === "photos"
          ? done.photos || done.photosSkipped
          : def.key === "xray"
            ? done.xray || done.xraySkipped
            : def.key === "doctor_review"
              ? done.doctor_review
              : def.key === "coordinator"
                ? journeyStage === "consultation_ready" || done.doctor_review
                : def.key === "consultation"
                  ? done.consultation
                  : false;

    if (def.key === "photos" && done.photosSkipped) status = "skipped";
    else if (def.key === "xray" && done.xraySkipped) status = "skipped";
    else if (isDone) status = "complete";
    else if (def.key === currentKey) status = "current";
    else status = "pending";

    if (def.key === "coordinator" && journeyStage === "coordinator_followup") {
      status = "current";
    }
    if (def.key === "consultation" && journeyStage === "consultation_ready") {
      status = "complete";
    }

    return {
      key: def.key,
      title: def.title,
      subtitle: def.subtitle,
      status,
      statusLabel:
        status === "complete"
          ? "Done"
          : status === "current"
            ? "In progress"
            : status === "skipped"
              ? "Not required"
              : "Pending",
    };
  });

  return {
    disclaimer:
      "Operational intake workflow only. Final clinical evaluation and treatment planning are performed by licensed dental professionals.",
    journeyStage,
    journeyStageLabel: flags.journeyStageLabel || JOURNEY_STAGES[journeyStage] || journeyStage,
    readinessPercent: flags.readinessPercent ?? readiness.percent ?? null,
    readinessMissing: flags.readinessMissing || readiness.missing || [],
    currentStepKey: currentKey,
    steps,
  };
}

module.exports = {
  INTAKE_PIPELINE_STEPS,
  buildIntakeJourneySteps,
};
