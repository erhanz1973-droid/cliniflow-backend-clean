/**
 * Compose a clinic-ready inquiry from operational intake state (no separate engine).
 * Used by GET /api/patient/me/intake-journey — patient app may mirror for live edits.
 */
const SUGGESTED_QUESTION_KEYS = [
  "visits",
  "panoramic",
  "timeline",
  "morePhotos",
];

const TAG_LABEL_EN = {
  implant_interest: "Missing teeth / implant interest",
  cosmetic_goal: "Smile aesthetics",
  pain_signal: "Pain or sensitivity",
  broken_tooth: "Broken or damaged tooth",
  chewing_problem: "Difficulty chewing",
  whitening_interest: "Teeth whitening",
  orthodontic_interest: "Orthodontics / alignment",
  full_mouth_restoration_interest: "Full-mouth restoration",
};

const DOC_LABEL_EN = {
  panoramic_xray: "Panoramic X-ray",
  ct_scan: "CT scan",
  smile_photos: "Dental / smile photos",
  intraoral_photo: "Intraoral photos",
  intraoral_photos: "Intraoral photos",
  selfie: "Dental photo",
  treatment_report: "Treatment report (PDF)",
  bloodwork_pdf: "Medical report (PDF)",
  medical_history: "Medical history document",
  other: "Supporting document",
};

function docKind(documentType) {
  const d = String(documentType || "").toLowerCase();
  if (d === "ct_scan" || /\bct\b/.test(d)) return "ct";
  if (/panoramic|xray|x-ray|opg|radiograph/.test(d)) return "xray";
  if (/treatment_report|bloodwork|pdf|report/.test(d)) return "pdf";
  if (/smile|intraoral|selfie|dental|photo|ai_upload/.test(d)) return "photo";
  return "document";
}

function docLabel(documentType, documentTypeLabel) {
  if (documentTypeLabel) return String(documentTypeLabel);
  const key = String(documentType || "other").toLowerCase();
  return DOC_LABEL_EN[key] || DOC_LABEL_EN.other;
}

/**
 * @param {{
 *   leadData?: Record<string, unknown>|null,
 *   operationalIntakeFlags?: Record<string, unknown>|null,
 *   documents?: Array<Record<string, unknown>>,
 *   patientNarrative?: string|null,
 *   photoGuidanceSummary?: string|null,
 *   hasDentalPhoto?: boolean,
 * }} input
 */
function buildClinicInquiryDraft(input) {
  const lead = input.leadData && typeof input.leadData === "object" ? input.leadData : {};
  const flags =
    input.operationalIntakeFlags && typeof input.operationalIntakeFlags === "object"
      ? input.operationalIntakeFlags
      : {};
  const docs = Array.isArray(input.documents) ? input.documents : [];
  const narrative = String(input.patientNarrative || "").trim();
  const guidance = String(input.photoGuidanceSummary || "").trim();

  const tags = Array.isArray(flags.patientReportedTags)
    ? flags.patientReportedTags
    : Array.isArray(lead.patientReportedTags)
      ? lead.patientReportedTags
      : [];

  const concernLines = [];
  for (const tag of tags) {
    const label = TAG_LABEL_EN[String(tag).toLowerCase()] || String(tag).replace(/_/g, " ");
    if (label && !concernLines.includes(label)) concernLines.push(label);
  }
  if (narrative) concernLines.push(narrative);

  const attachments = [];
  if (input.hasDentalPhoto) {
    attachments.push({
      id: "dental_photo_session",
      kind: "photo",
      label: "Dental photo (Treatment Support)",
      url: input.dentalPhotoUrl || null,
    });
  }
  for (const row of docs) {
    const documentType = row.document_type || row.documentType || "other";
    attachments.push({
      id: String(row.id || documentType),
      kind: docKind(documentType),
      label: docLabel(documentType, row.document_type_label || row.documentTypeLabel),
      url: row.file_url || row.fileUrl || null,
    });
  }

  const attachmentSummary =
    attachments.length > 0
      ? attachments.map((a) => `• ${a.label}`).join("\n")
      : "• No files attached yet (text-only inquiry is fine).";

  const travel = String(lead.travelTimeline || lead.travel_timeline || "").trim();
  const timelineLine = travel
    ? `Preferred timeline: ${travel.replace(/_/g, " ")}`
    : flags.missingTravelTimeline
      ? "Travel timeline: not specified yet"
      : null;

  const questionLines = [];
  if (guidance) {
    questionLines.push(`Based on my photo guidance: ${guidance.slice(0, 280)}${guidance.length > 280 ? "…" : ""}`);
  }

  const intro =
    "Hello,\n\nI am reaching out through Cliniflow regarding dental treatment. I would appreciate your review of the information below.";

  const concernsBlock =
    concernLines.length > 0
      ? concernLines.map((l) => `• ${l}`).join("\n")
      : "• I would like to discuss my dental concerns and suitable treatment options.";

  const parts = [
    intro,
    "",
    "My concerns and goals",
    concernsBlock,
    "",
    "Files I have shared",
    attachmentSummary,
  ];

  if (timelineLine) {
    parts.push("", "Timeline", `• ${timelineLine}`);
  }

  if (questionLines.length) {
    parts.push("", "Questions for your team", questionLines.map((q) => `• ${q}`).join("\n"));
  } else {
    parts.push(
      "",
      "Questions for your team",
      "• I would welcome your guidance on next steps and whether any additional imaging is needed.",
    );
  }

  parts.push("", "Thank you for your time.", "");

  return {
    text: parts.join("\n"),
    attachments,
    suggestedQuestionKeys: SUGGESTED_QUESTION_KEYS,
    meta: {
      tagCount: tags.length,
      documentCount: docs.length,
      hasNarrative: !!narrative,
      hasPhotoGuidance: !!guidance,
    },
  };
}

module.exports = {
  buildClinicInquiryDraft,
  SUGGESTED_QUESTION_KEYS,
};
