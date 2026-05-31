/**
 * Operational intake flags, tags, journey stage, and readiness (stored in operational_intake_flags jsonb).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { DOCUMENT_TYPES } = require("./aiPatientDocumentTypes");
const {
  resolvePatientReportedTags,
  extractMissingTeethCount,
  buildTreatmentTagsPromptBlock,
} = require("./treatmentInterestTags");
const { computeLeadReadiness } = require("./aiLeadReadiness");
const { computeJourneyStage } = require("./aiIntakeJourney");
const {
  classifyTreatmentIntake,
  imagingRequiredForIntake,
  photosRequiredForIntake,
  buildTreatmentIntakeGuidanceBlock,
} = require("./treatmentIntakeComplexity");
const { detectPatientCommercialIntent } = require("./clinicPricingIntent");
const {
  mergeConversationalIntake,
  syncUploadedDocumentsFromFiles,
} = require("./patientPreparationIntake");
const { preserveBookingStateInFlags } = require("./aiBookingState");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IMAGING_TYPES = new Set(["panoramic_xray", "ct_scan"]);
const PHOTO_TYPES = new Set(["selfie", "intraoral_photo"]);

/**
 * @param {import('./leadIntelligence').LeadData|null|undefined} leadData
 * @param {Array<{ documentType?: string, requiresDoctorReview?: boolean, reviewStatus?: string }>} documents
 * @param {string[]} patientReportedTags
 * @param {string} [patientMessage]
 */
function computeIntakeFlags(leadData, documents, patientReportedTags = [], patientMessage = "") {
  const ld = leadData && typeof leadData === "object" ? leadData : {};
  const docs = documents || [];
  const tags = patientReportedTags || [];
  const treatment = String(ld.treatmentInterest || "").trim();
  const combinedText = [treatment, patientMessage, ...tags].join(" ");

  const intakeClass = classifyTreatmentIntake(treatment, patientMessage, tags);

  const hasImaging = docs.some((d) => IMAGING_TYPES.has(String(d.documentType || "")));
  const hasPhotos = docs.some((d) => PHOTO_TYPES.has(String(d.documentType || "")));

  const needsImaging = imagingRequiredForIntake(intakeClass, tags, combinedText);
  const needsPhotos = photosRequiredForIntake(intakeClass, tags, combinedText);

  const missingDocumentTypes = [];
  if (needsImaging && !hasImaging) missingDocumentTypes.push("panoramic_xray");
  if (needsPhotos && !hasPhotos) missingDocumentTypes.push("intraoral_photo");

  const doctorReviewNeeded = docs.some(
    (d) =>
      d.requiresDoctorReview === true &&
      String(d.reviewStatus || "pending") === "pending",
  );

  return {
    missingXray: needsImaging && !hasImaging,
    missingSmilePhotos: needsPhotos && !hasPhotos,
    missingTravelTimeline: !String(ld.travelTimeline || "").trim(),
    missingTreatmentPreference: !treatment && !tags.length,
    missingMedicalHistory: false,
    doctorReviewNeeded,
    missingDocumentTypes,
    patientReportedTags: tags,
    missingTeethCount: ld.missingTeethCount ?? null,
    treatmentComplexity: intakeClass.tier,
    treatmentCategory: intakeClass.category,
    treatmentIntakeClassification: intakeClass,
  };
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function flagsChanged(a, b) {
  return (
    a.missingXray !== b.missingXray ||
    a.missingSmilePhotos !== b.missingSmilePhotos ||
    a.missingTravelTimeline !== b.missingTravelTimeline ||
    a.missingTreatmentPreference !== b.missingTreatmentPreference ||
    a.doctorReviewNeeded !== b.doctorReviewNeeded ||
    JSON.stringify(a.patientReportedTags || []) !== JSON.stringify(b.patientReportedTags || [])
  );
}

function hasAnyMissing(flags) {
  return (
    flags.missingXray ||
    flags.missingSmilePhotos ||
    flags.missingTravelTimeline ||
    flags.missingTreatmentPreference
  );
}

/**
 * Build full operational intake state for CRM + admin UI.
 * @param {{
 *   leadData: import('./leadIntelligence').LeadData,
 *   documents: Array<Record<string, unknown>>,
 *   patientMessage?: string|null,
 *   persistedFlags?: Record<string, unknown>|null,
 *   profile?: Record<string, unknown>|null,
 * }} params
 */
function buildOperationalIntakeState(params) {
  const prev = params.persistedFlags || {};
  const tags = resolvePatientReportedTags(
    params.leadData,
    params.patientMessage || "",
    [...(prev.patientReportedTags || []), ...(params.leadData?.patientReportedTags || [])],
  );

  const leadWithTags = {
    ...params.leadData,
    patientReportedTags: tags,
    missingTeethCount:
      params.leadData?.missingTeethCount ??
      extractMissingTeethCount(
        `${params.patientMessage || ""} ${params.leadData?.treatmentInterest || ""}`,
      ) ??
      prev.missingTeethCount ??
      null,
  };

  const baseFlags = computeIntakeFlags(
    leadWithTags,
    params.documents,
    tags,
    params.patientMessage || "",
  );
  const readiness = computeLeadReadiness({
    leadData: leadWithTags,
    flags: baseFlags,
    documents: params.documents,
    profile: params.profile,
  });

  const journey = computeJourneyStage({
    flags: baseFlags,
    documents: params.documents,
    leadData: leadWithTags,
    profile: params.profile,
    readinessPercent: readiness.readinessPercent,
  });

  return {
    ...baseFlags,
    ...readiness,
    ...journey,
  };
}

/**
 * @param {string} profileId
 * @param {import('./leadIntelligence').LeadData} leadData
 * @param {Array<Record<string, unknown>>} documents
 * @param {{
 *   patientMessage?: string|null,
 *   profile?: Record<string, unknown>|null,
 *   conversationalIntake?: Record<string, unknown>|null,
 *   patientContextStrategy?: Record<string, unknown>|null,
 *   discussionMemory?: Record<string, unknown>|null,
 *   conversationTopic?: Record<string, unknown>|null,
 * }} [opts]
 */
async function syncOperationalIntakeFlags(profileId, leadData, documents, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) {
    return { ok: false, reason: "invalid_profile" };
  }

  const { data: prevRow } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "operational_intake_flags, message_count, coordination_mode, ai_unresolved, last_human_reply_at, country",
    )
    .eq("id", profileId)
    .maybeSingle();

  const prev =
    prevRow?.operational_intake_flags && typeof prevRow.operational_intake_flags === "object"
      ? prevRow.operational_intake_flags
      : {};

  const profile = {
    messageCount: prevRow?.message_count,
    coordinationMode: prevRow?.coordination_mode,
    aiUnresolved: prevRow?.ai_unresolved,
    lastHumanReplyAt: prevRow?.last_human_reply_at,
    country: prevRow?.country,
    ...opts.profile,
  };

  const flags = buildOperationalIntakeState({
    leadData,
    documents,
    patientMessage: opts.patientMessage,
    persistedFlags: prev,
    profile,
  });

  if (prev.treatmentGuideWorkspace && typeof prev.treatmentGuideWorkspace === "object") {
    flags.treatmentGuideWorkspace = prev.treatmentGuideWorkspace;
  }

  if (opts.patientContextStrategy) {
    const { mergePatientContextStrategyFlags } = require("./patientContextStrategy");
    Object.assign(flags, mergePatientContextStrategyFlags(flags, opts.patientContextStrategy));
  }
  if (opts.discussionMemory) {
    const { mergeDiscussionMemoryIntoFlags } = require("./conversationRepetitionMemory");
    Object.assign(flags, mergeDiscussionMemoryIntoFlags(flags, opts.discussionMemory));
  }
  if (opts.conversationTopic) {
    const { mergeConversationTopicIntoFlags } = require("./conversationTopicTracking");
    Object.assign(flags, mergeConversationTopicIntoFlags(flags, opts.conversationTopic));
  }

  if (opts.conversationalIntake != null || prev.conversationalIntake) {
    const mergedPrep = mergeConversationalIntake(
      prev.conversationalIntake,
      opts.conversationalIntake,
      leadData,
      opts.patientMessage || "",
    );
    flags.conversationalIntake = syncUploadedDocumentsFromFiles(mergedPrep, documents, {
      missingXray: flags.missingXray,
      missingSmilePhotos: flags.missingSmilePhotos,
    });
  }

  if (opts.conversationWorkflow != null) {
    const { normalizeWorkflowState, readConversationWorkflow } = require("./conversationWorkflowState");
    flags.conversationWorkflow = normalizeWorkflowState({
      ...readConversationWorkflow(prev),
      ...opts.conversationWorkflow,
    });
  }

  preserveBookingStateInFlags(flags, prev);

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: flags,
      updated_at: nowIso,
    })
    .eq("id", profileId);

  if (error) {
    console.warn("[aiIntakeFlags] sync:", error.message);
    return { ok: false, reason: error.message };
  }

  const prevSnap = {
    missingXray: !!prev.missingXray,
    missingSmilePhotos: !!prev.missingSmilePhotos,
    missingTravelTimeline: !!prev.missingTravelTimeline,
    missingTreatmentPreference: !!prev.missingTreatmentPreference,
    doctorReviewNeeded: !!prev.doctorReviewNeeded,
    patientReportedTags: prev.patientReportedTags || [],
  };

  if (hasAnyMissing(flags) && flagsChanged(prevSnap, flags)) {
    await insertTimelineEvent({
      profileId,
      eventType: "missing_documents_detected",
      eventMetadata: {
        flags,
        missingDocumentTypes: flags.missingDocumentTypes || [],
      },
    });
  }

  if (prev.journeyStage && prev.journeyStage !== flags.journeyStage) {
    await insertTimelineEvent({
      profileId,
      eventType: "intake_journey_updated",
      eventMetadata: {
        from: prev.journeyStage,
        to: flags.journeyStage,
        label: flags.journeyStageLabel,
      },
    });
  }

  return { ok: true, flags };
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {Array<{ documentType: string, reviewStatus?: string }>} documents
 * @param {string} [patientMessage]
 */
function buildDocumentIntakePromptBlock(flags, documents, patientMessage = "") {
  const f = flags || {};
  const docs = documents || [];
  const uploaded = docs.map((d) => d.documentType).filter(Boolean);
  const tier = String(f.treatmentComplexity || "medium");
  const classification =
    f.treatmentIntakeClassification ||
    classifyTreatmentIntake(
      null,
      "",
      f.patientReportedTags || [],
    );

  const lines = [
    "PATIENT DOCUMENT INTAKE (operational coordination only — NOT diagnostic AI):",
    "* Never interpret X-rays, CT scans, or photos medically. Never confirm treatment eligibility or suitability.",
    "* Final clinical evaluation is performed by licensed dental professionals.",
    buildTreatmentIntakeGuidanceBlock(classification),
  ];

  if (uploaded.length) {
    lines.push(`* Documents already uploaded: ${uploaded.join(", ")}.`);
  } else if (tier !== "low") {
    lines.push("* No treatment documents uploaded yet for this session.");
  }

  const commercial = detectPatientCommercialIntent(patientMessage);
  const missing = [];
  if (f.missingXray && !commercial.isCommercialQuestion) {
    missing.push("panoramic X-ray / imaging");
  } else if (f.missingXray && commercial.asksPrice) {
    lines.push(
      "* Patient asked about price — give a brief price answer only (2–3 sentences). Do NOT mention panoramic X-ray or uploads in the same reply.",
    );
  }
  if (f.missingSmilePhotos && !commercial.isCommercialQuestion) {
    missing.push("smile / intraoral photos");
  }
  if (f.missingTravelTimeline) missing.push("travel timeline");
  if (f.missingTreatmentPreference) missing.push("treatment preference or goals");
  if (missing.length) {
    lines.push(`* Operationally missing for intake: ${missing.join("; ")}.`);
    lines.push("* Gently encourage only the items listed above — do not add extra document types.");
  } else if (tier === "low") {
    lines.push("* No imaging or photo uploads required for this routine inquiry unless the patient asks about advanced treatment.");
  }

  if (f.doctorReviewNeeded) {
    lines.push("* Coordinator note: imaging uploaded — pending licensed dentist review.");
  }

  lines.push(buildTreatmentTagsPromptBlock(f.patientReportedTags || []));

  return lines.join("\n");
}

/**
 * @param {unknown} raw
 */
function normalizeDocumentType(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliases = {
    xray: "panoramic_xray",
    panoramic: "panoramic_xray",
    panoramic_xray: "panoramic_xray",
    ct: "ct_scan",
    ct_scan: "ct_scan",
    cbct: "ct_scan",
    selfie: "selfie",
    intraoral: "intraoral_photo",
    intraoral_photo: "intraoral_photo",
    bloodwork: "bloodwork_pdf",
    pdf: "bloodwork_pdf",
    report: "treatment_report",
    treatment_report: "treatment_report",
  };
  const mapped = aliases[s] || s;
  return DOCUMENT_TYPES.includes(mapped) ? mapped : "other";
}

module.exports = {
  computeIntakeFlags,
  buildOperationalIntakeState,
  syncOperationalIntakeFlags,
  buildDocumentIntakePromptBlock,
  buildTreatmentTagsPromptBlock,
  normalizeDocumentType,
  hasAnyMissing,
  classifyTreatmentIntake,
};
