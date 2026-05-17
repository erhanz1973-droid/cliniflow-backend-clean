/**
 * Treatment Support workspace — resume photo, analysis, narrative, inquiry draft.
 * Stored on operational_intake_flags.treatmentGuideWorkspace; analysis source of truth in messages.
 */
const { supabase, isSupabaseEnabled } = require("./supabase");
const { normalizeContentHash } = require("./dentalUploadDedupe");

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

function buildAnalysisSnapshot(ai, imageUrl) {
  if (!ai || typeof ai !== "object") return null;
  const insights = Array.isArray(ai.insights) ? ai.insights : [];
  if (!insights.length && !ai.summary && !ai.analysis) return null;
  return {
    ok: true,
    reused: true,
    cached: true,
    insights,
    summary: ai.summary || ai.analysis || "",
    recommendation: ai.recommendation || "",
    analysis: ai.analysis || ai.summary || "",
    confidence: ai.confidence || "medium",
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

  const photoUrl =
    String(stored.photoUrl || stored.photo_url || latestPhoto?.fileUrl || "").trim() || null;
  const contentHash =
    normalizeContentHash(stored.contentHash || stored.content_hash) ||
    latestPhoto?.contentHash ||
    normalizeContentHash(latestAnalysis?.contentHash) ||
    null;

  const analysisSnapshot =
    latestAnalysis ||
    (stored.analysisSnapshot && typeof stored.analysisSnapshot === "object"
      ? stored.analysisSnapshot
      : null);

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

module.exports = {
  findLatestDentalAnalysisForPatient,
  findLatestAiDentalPhoto,
  loadTreatmentGuideWorkspace,
  mergeWorkspaceIntoFlags,
};
