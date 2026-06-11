/**
 * Treatment Support workspace — resume photo, analysis, narrative, inquiry draft.
 * Stored on operational_intake_flags.treatmentGuideWorkspace; analysis source of truth in messages.
 */
const { supabase, isSupabaseEnabled } = require("./supabase");
const { normalizeContentHash } = require("./dentalUploadDedupe");
const { resolveLeadProfileBySession } = require("./aiPatientDocuments");

/**
 * Treatment Guide sessions need a lead profile row for workspace PATCH.
 * @param {string} patientId
 * @param {string} sessionId
 */
async function ensureTreatmentGuideLeadProfile(patientId, sessionId) {
  const pid = String(patientId || "").trim();
  const sid = String(sessionId || "").trim();
  if (!pid || !sid || !UUID_RE.test(pid) || !isSupabaseEnabled()) return null;

  const existing = await resolveLeadProfileBySession(sid);
  if (existing?.id) return existing;

  let clinicId = null;
  let preferredLanguage = null;
  try {
    const { data: patient } = await supabase
      .from("patients")
      .select("clinic_id, language")
      .eq("id", pid)
      .maybeSingle();
    if (patient?.clinic_id && UUID_RE.test(String(patient.clinic_id))) {
      clinicId = String(patient.clinic_id);
    }
    if (patient?.language) preferredLanguage = String(patient.language).trim().slice(0, 8) || null;
  } catch (_) {
    /* non-fatal */
  }

  const nowIso = new Date().toISOString();
  const row = {
    session_id: sid,
    patient_id: pid,
    clinic_id: clinicId,
    source: "treatment_guide",
    primary_channel: "in_app",
    preferred_language: preferredLanguage,
    message_count: 0,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data: inserted, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .insert(row)
    .select("id, clinic_id, patient_id")
    .single();

  if (error) {
    const raced = await resolveLeadProfileBySession(sid);
    if (raced?.id) return raced;
    console.warn("[treatmentGuideWorkspace] ensure profile:", error.message);
    return null;
  }
  return inserted;
}
const { parseSupabaseStorageRefFromUrl } = require("./aiAnalyzeImageLoad");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseMessageAttachmentsForAi(row) {
  const raw = row?.attachments ?? row?.attachment;
  if (!raw) return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return null;
    return o.aiResult || o.ai_result || (o.insights ? o : null);
  } catch (_) {
    return null;
  }
}

/**
 * True when URL/path clearly belongs to this patient's ai-photos folder.
 * Prevents showing another patient's photo from stale lead-profile workspace blobs.
 */
function dentalPhotoUrlBelongsToPatient(photoUrl, patientId) {
  const pid = String(patientId || "").trim().toLowerCase();
  const url = String(photoUrl || "").trim();
  if (!pid || !url || !UUID_RE.test(pid)) return false;

  const ref = parseSupabaseStorageRefFromUrl(url);
  const objectPath = ref?.objectPath ? String(ref.objectPath) : "";
  const pathHaystack = objectPath || decodeURIComponent(url.split("?")[0] || url);
  const m = pathHaystack.match(/ai-photos\/([0-9a-f-]{36})\//i);
  if (m) return m[1].toLowerCase() === pid;

  if (pathHaystack.toLowerCase().includes(`/${pid}/`)) return true;
  return false;
}

function buildAnalysisSnapshot(ai, imageUrl) {
  if (!ai || typeof ai !== "object") return null;
  const insights = Array.isArray(ai.insights) ? ai.insights : [];
  const strengths = Array.isArray(ai.strengths) ? ai.strengths : [];
  const improvementAreas = Array.isArray(ai.improvementAreas) ? ai.improvementAreas : [];
  if (
    !insights.length &&
    !strengths.length &&
    !improvementAreas.length &&
    !ai.summary &&
    !ai.analysis &&
    ai.smileScore == null
  ) {
    return null;
  }
  return {
    ok: true,
    reused: true,
    cached: true,
    insights,
    summary: ai.summary || ai.analysis || "",
    recommendation: ai.recommendation || "",
    analysis: ai.analysis || ai.summary || "",
    confidence: ai.confidence || "medium",
    smileScore: ai.smileScore ?? null,
    dentalSmileScore: ai.dentalSmileScore ?? null,
    facialHarmonyScore: ai.facialHarmonyScore ?? null,
    potentialScore: ai.potentialScore ?? null,
    strengths,
    improvementAreas,
    recommendations: Array.isArray(ai.recommendations) ? ai.recommendations : [],
    categoryScores:
      ai.categoryScores && typeof ai.categoryScores === "object" ? ai.categoryScores : null,
    scoreModel: ai.scoreModel || null,
    originalImageUrl: ai.originalImageUrl || imageUrl || null,
    contentHash: ai.contentHash || ai.content_hash || null,
    analyzedAt: ai.analyzedAt || null,
  };
}

/**
 * Latest ai_result row for patient (any image).
 * @param {string} patientId
 */
async function findLatestDentalAnalysisForPatient(patientId) {
  const pid = String(patientId || "").trim();
  if (!pid || !UUID_RE.test(pid) || !isSupabaseEnabled()) return null;
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("id, type, message, attachments, attachment, created_at")
      .eq("patient_id", pid)
      .order("created_at", { ascending: false })
      .limit(64);
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      const type = String(row.type || "").toLowerCase();
      const ai = parseMessageAttachmentsForAi(row);
      if (!ai) continue;
      if (type && type !== "ai_result" && !ai.insights?.length) continue;
      const snapshot = buildAnalysisSnapshot(ai, ai.originalImageUrl);
      if (!snapshot) continue;
      snapshot.analyzedAt = row.created_at || null;
      return snapshot;
    }
  } catch (e) {
    console.warn("[treatmentGuideWorkspace] findLatestDentalAnalysis:", e?.message || e);
  }
  return null;
}

/**
 * Latest ai_upload patient_files row.
 * @param {string} patientId
 */
async function findLatestAiDentalPhoto(patientId) {
  const pid = String(patientId || "").trim();
  if (!pid || !UUID_RE.test(pid) || !isSupabaseEnabled()) return null;
  try {
    let qb = supabase
      .from("patient_files")
      .select("id, file_url, image_url, content_hash, created_at, source")
      .eq("patient_id", pid)
      .order("created_at", { ascending: false })
      .limit(40);
    const { data, error } = await qb;
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      const src = String(row.source || "");
      if (!src.startsWith("ai_upload")) continue;
      const url = String(row.image_url || row.file_url || "").trim();
      if (!url) continue;
      return {
        fileUrl: url,
        contentHash: normalizeContentHash(row.content_hash) || null,
        createdAt: row.created_at || null,
        patientFileId: row.id || null,
      };
    }
  } catch (e) {
    console.warn("[treatmentGuideWorkspace] findLatestAiDentalPhoto:", e?.message || e);
  }
  return null;
}

/**
 * Merge stored workspace blob with server artifacts.
 * @param {string} patientId
 * @param {Record<string, unknown>|null} storedFlags
 */
async function loadTreatmentGuideWorkspace(patientId, storedFlags) {
  const stored =
    storedFlags?.treatmentGuideWorkspace && typeof storedFlags.treatmentGuideWorkspace === "object"
      ? storedFlags.treatmentGuideWorkspace
      : {};

  const latestPhoto = await findLatestAiDentalPhoto(patientId);
  const latestAnalysis = await findLatestDentalAnalysisForPatient(patientId);

  let storedPhoto = String(stored.photoUrl || stored.photo_url || "").trim();
  if (storedPhoto && !dentalPhotoUrlBelongsToPatient(storedPhoto, patientId)) {
    console.warn("[treatmentGuideWorkspace] dropping stale photoUrl (wrong patient)", {
      patientId: String(patientId).slice(0, 8),
    });
    storedPhoto = "";
  }

  const photoUrl = storedPhoto || latestPhoto?.fileUrl || null;

  let storedSnapshot =
    stored.analysisSnapshot && typeof stored.analysisSnapshot === "object"
      ? stored.analysisSnapshot
      : null;
  if (storedSnapshot?.originalImageUrl) {
    const orig = String(storedSnapshot.originalImageUrl).trim();
    if (orig && !dentalPhotoUrlBelongsToPatient(orig, patientId)) {
      console.warn("[treatmentGuideWorkspace] dropping stale analysisSnapshot (wrong patient photo)", {
        patientId: String(patientId).slice(0, 8),
      });
      storedSnapshot = null;
    }
  }

  const contentHash =
    normalizeContentHash(stored.contentHash || stored.content_hash) ||
    latestPhoto?.contentHash ||
    normalizeContentHash(latestAnalysis?.contentHash) ||
    null;

  const analysisSnapshot = latestAnalysis || storedSnapshot;

  return {
    photoUrl,
    contentHash,
    photoSavedAt: stored.photoSavedAt || latestPhoto?.createdAt || null,
    analysisSnapshot,
    analysisSavedAt:
      stored.analysisSavedAt || latestAnalysis?.analyzedAt || null,
    patientNarrative: String(stored.patientNarrative || "").trim(),
    inquiryDraftText: String(stored.inquiryDraftText || "").trim(),
    updatedAt: stored.updatedAt || null,
  };
}

/**
 * @param {Record<string, unknown>} flags
 * @param {Record<string, unknown>} workspacePatch
 */
function mergeWorkspaceIntoFlags(flags, workspacePatch) {
  const base = flags && typeof flags === "object" ? { ...flags } : {};
  const prev =
    base.treatmentGuideWorkspace && typeof base.treatmentGuideWorkspace === "object"
      ? base.treatmentGuideWorkspace
      : {};
  base.treatmentGuideWorkspace = {
    ...prev,
    ...workspacePatch,
    updatedAt: new Date().toISOString(),
  };
  return base;
}

/**
 * Persist photo + guidance on ai-analyze so Treatment Support can resume without re-analysis.
 */
async function persistTreatmentGuideWorkspaceAfterAnalyze(params) {
  const sessionId = String(params.sessionId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const imageUrl = String(params.imageUrl || "").trim();
  const snapshot = params.analysisSnapshot;
  if (!sessionId || !patientId || !imageUrl || !snapshot || typeof snapshot !== "object") {
    return { ok: false, reason: "missing_fields" };
  }
  if (!isSupabaseEnabled()) return { ok: false, reason: "supabase_disabled" };

  try {
    let profile = await resolveLeadProfileBySession(sessionId);
    if (!profile?.id) {
      profile = await ensureTreatmentGuideLeadProfile(patientId, sessionId);
    }
    if (!profile?.id) return { ok: false, reason: "no_profile" };

    const { data: row } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("operational_intake_flags, patient_id")
      .eq("id", profile.id)
      .maybeSingle();

    if (row?.patient_id && String(row.patient_id) !== patientId) {
      return { ok: false, reason: "patient_mismatch" };
    }

    const prevFlags =
      row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
        ? row.operational_intake_flags
        : {};

    const nowIso = new Date().toISOString();
    const hash = normalizeContentHash(params.contentHash);
    const flags = mergeWorkspaceIntoFlags(prevFlags, {
      photoUrl: imageUrl,
      contentHash: hash || undefined,
      photoSavedAt: nowIso,
      analysisSavedAt: nowIso,
      analysisSnapshot: snapshot,
    });

    const { error } = await supabase
      .from("ai_coordinator_lead_profiles")
      .update({ operational_intake_flags: flags, updated_at: nowIso })
      .eq("id", profile.id);

    if (error) {
      console.warn("[treatmentGuideWorkspace] persist after analyze:", error.message);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[treatmentGuideWorkspace] persist after analyze:", e?.message || e);
    return { ok: false, reason: e?.message || "exception" };
  }
}

module.exports = {
  dentalPhotoUrlBelongsToPatient,
  findLatestDentalAnalysisForPatient,
  findLatestAiDentalPhoto,
  loadTreatmentGuideWorkspace,
  mergeWorkspaceIntoFlags,
  persistTreatmentGuideWorkspaceAfterAnalyze,
  ensureTreatmentGuideLeadProfile,
};
