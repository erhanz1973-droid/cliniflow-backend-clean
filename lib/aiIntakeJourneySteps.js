/**
 * Visual intake pipeline steps for coordinators and patients (operational workflow only).
 */

const { JOURNEY_STAGES } = require("./aiIntakeJourney");
const { t, normalizeUiLang } = require("./i18n/coordinationLocales");

/** @typedef {'complete'|'current'|'pending'|'skipped'} StepStatus */

const STEP_DEFS = [
  { key: "goals", titleKey: "pipeline.goalsTitle", subtitleKey: "pipeline.goalsSubtitle", linkedStages: ["intake_started"] },
  { key: "photos", titleKey: "pipeline.photosTitle", subtitleKey: "pipeline.photosSubtitle", linkedStages: ["awaiting_photos"] },
  { key: "xray", titleKey: "pipeline.xrayTitle", subtitleKey: "pipeline.xraySubtitle", linkedStages: ["awaiting_xray"] },
  { key: "doctor_review", titleKey: "pipeline.doctorTitle", subtitleKey: "pipeline.doctorSubtitle", linkedStages: ["doctor_review_pending"] },
  { key: "coordinator", titleKey: "pipeline.coordinatorTitle", subtitleKey: "pipeline.coordinatorSubtitle", linkedStages: ["coordinator_followup"] },
  { key: "consultation", titleKey: "pipeline.consultationTitle", subtitleKey: "pipeline.consultationSubtitle", linkedStages: ["consultation_ready"] },
  {
    key: "appointment",
    titleKey: "pipeline.appointmentTitle",
    subtitleKey: "pipeline.appointmentSubtitle",
    linkedStages: ["appointment_scheduled", "waiting_for_consultation"],
  },
];

const IMAGING_TYPES = new Set(["panoramic_xray", "ct_scan"]);
const PHOTO_TYPES = new Set(["selfie", "intraoral_photo"]);

/**
 * @param {string} lang
 * @param {string} key
 */
function opsStep(lang, key) {
  return t(normalizeUiLang(lang), `ops.${key}`);
}

/**
 * @param {Record<string, unknown>} flags
 * @param {Array<{ documentType?: string, reviewStatus?: string }>} documents
 */
function stepCompletion(flags, documents) {
  const docs = documents || [];
  const f = flags || {};
  const tags = f.patientReportedTags || [];

  const hasGoals = !f.missingTreatmentPreference && (!!tags.length || !f.missingTreatmentPreference);

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
    appointment:
      f.journeyStage === "appointment_scheduled" ||
      f.journeyStage === "waiting_for_consultation" ||
      f.appointmentScheduled === true,
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
    appointment_scheduled: "appointment",
    waiting_for_consultation: "appointment",
  };
  if (map[journeyStage]) return map[journeyStage];
  if (!done.goals) return "goals";
  if (!done.photos && !done.photosSkipped) return "photos";
  if (!done.xray && !done.xraySkipped) return "xray";
  if (!done.doctor_review) return "doctor_review";
  return "consultation";
}

/**
 * @param {StepStatus} status
 * @param {string} lang
 */
function stepStatusLabel(status, lang) {
  const L = normalizeUiLang(lang);
  if (status === "complete") return opsStep(L, "pipeline.stepComplete");
  if (status === "current") return opsStep(L, "pipeline.stepCurrent");
  if (status === "skipped") return opsStep(L, "pipeline.stepSkipped");
  return opsStep(L, "pipeline.stepPending");
}

/**
 * @param {{
 *   operationalIntakeFlags?: Record<string, unknown>|null,
 *   documents?: Array<Record<string, unknown>>,
 *   readiness?: { percent?: number, missing?: string[] }|null,
 *   lang?: string,
 * }} input
 */
function buildIntakeJourneySteps(input) {
  const lang = normalizeUiLang(input?.lang || "en");
  const flags = input.operationalIntakeFlags || {};
  const documents = input.documents || [];
  const readiness = input.readiness || {};
  const journeyStage = String(flags.journeyStage || "intake_started");
  const done = stepCompletion(flags, documents);
  const currentKey = resolveCurrentKey(journeyStage, done);

  const steps = STEP_DEFS.map((def) => {
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
                  : def.key === "appointment"
                    ? done.appointment
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
    if (def.key === "appointment" && done.appointment) {
      status = "complete";
    }
    if (def.key === "appointment" && journeyStage === "appointment_scheduled") {
      status = "current";
    }

    return {
      key: def.key,
      title: opsStep(lang, def.titleKey),
      subtitle: opsStep(lang, def.subtitleKey),
      status,
      statusLabel: stepStatusLabel(status, lang),
    };
  });

  return {
    disclaimer: opsStep(lang, "pipeline.disclaimer"),
    journeyStage,
    journeyStageLabel: (() => {
      const label = opsStep(lang, `journeyStage.${journeyStage}`);
      if (!label.startsWith("ops.journeyStage.")) return label;
      return flags.journeyStageLabel || JOURNEY_STAGES[journeyStage] || journeyStage;
    })(),
    readinessPercent: flags.readinessPercent ?? readiness.percent ?? null,
    readinessMissing: flags.readinessMissing || readiness.missing || [],
    currentStepKey: currentKey,
    steps,
  };
}

module.exports = {
  STEP_DEFS,
  buildIntakeJourneySteps,
};
