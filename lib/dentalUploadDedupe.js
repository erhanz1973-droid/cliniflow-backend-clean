/**
 * Idempotent dental photo uploads & analysis — keyed by content hash.
 */
const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { parseSupabaseStorageRefFromUrl } = require("./aiAnalyzeImageLoad");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AI_UPLOAD_SOURCE = "ai_upload";
const DEDUPE_LOOKBACK_DAYS = 30;

function computeBufferSha256(buffer) {
  if (!buffer?.length) return "";
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeContentHash(raw) {
  const h = String(raw || "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(h) ? h : "";
}

/**
 * @param {string} patientId
 * @param {string} contentHash
 * @returns {Promise<{ fileUrl: string, storagePath: string|null, patientFileId: string|null }|null>}
 */
async function findExistingAiPhotoUpload(patientId, contentHash) {
  const pid = String(patientId || "").trim();
  const hash = normalizeContentHash(contentHash);
  if (!pid || !UUID_RE.test(pid) || !hash || !isSupabaseEnabled()) return null;

  const since = new Date(Date.now() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from("patient_files")
      .select("id, file_url, image_url, created_at, content_hash, source")
      .eq("patient_id", pid)
      .eq("content_hash", hash)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error?.code === "42703" || /content_hash/i.test(String(error?.message || ""))) {
      return findExistingAiPhotoUploadLegacy(pid, hash, since);
    }
    if (error || !data?.length) return null;

    const row = data[0];
    const fileUrl = String(row.image_url || row.file_url || "").trim();
    if (!fileUrl) return null;
    const ref = parseSupabaseStorageRefFromUrl(fileUrl);
    return {
      fileUrl,
      storagePath: ref?.objectPath || null,
      patientFileId: row.id || null,
    };
  } catch (e) {
    console.warn("[dentalUploadDedupe] findExistingAiPhotoUpload:", e?.message || e);
    return null;
  }
}

/** Fallback when content_hash column is not migrated yet. */
async function findExistingAiPhotoUploadLegacy(patientId, contentHash, sinceIso) {
  try {
    const { data } = await supabase
      .from("patient_files")
      .select("id, file_url, image_url, created_at, source")
      .eq("patient_id", patientId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(80);

    for (const row of data || []) {
      const src = String(row.source || "");
      if (!src.startsWith(AI_UPLOAD_SOURCE)) continue;
      const marker = `hash:${contentHash}`;
      if (src.includes(marker)) {
        const fileUrl = String(row.image_url || row.file_url || "").trim();
        if (fileUrl) {
          const ref = parseSupabaseStorageRefFromUrl(fileUrl);
          return {
            fileUrl,
            storagePath: ref?.objectPath || null,
            patientFileId: row.id || null,
          };
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * @param {{
 *   patientId: string,
 *   clinicId?: string|null,
 *   sessionId?: string|null,
 *   documentType: string,
 *   contentHash: string,
 * }} params
 */
async function findExistingAiPatientDocument(params) {
  const pid = String(params.patientId || "").trim();
  const hash = normalizeContentHash(params.contentHash);
  const docType = String(params.documentType || "").trim();
  const sessionId = params.sessionId ? String(params.sessionId).trim() : null;
  if (!pid || !UUID_RE.test(pid) || !hash || !docType || !isSupabaseEnabled()) return null;

  const since = new Date(Date.now() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    let qb = supabase
      .from("ai_patient_documents")
      .select("id, file_url, uploaded_at, session_id, storage_metadata")
      .eq("patient_id", pid)
      .eq("document_type", docType)
      .neq("upload_status", "archived")
      .gte("uploaded_at", since)
      .order("uploaded_at", { ascending: false })
      .limit(24);

    if (sessionId) qb = qb.eq("session_id", sessionId);

    const { data, error } = await qb;
    if (error || !Array.isArray(data)) return null;

    for (const row of data) {
      const meta = row.storage_metadata && typeof row.storage_metadata === "object" ? row.storage_metadata : {};
      const rowHash = normalizeContentHash(meta.content_hash || meta.contentHash);
      if (rowHash === hash) return row;
    }
  } catch (e) {
    console.warn("[dentalUploadDedupe] findExistingAiPatientDocument:", e?.message || e);
  }
  return null;
}

module.exports = {
  AI_UPLOAD_SOURCE,
  computeBufferSha256,
  normalizeContentHash,
  findExistingAiPhotoUpload,
  findExistingAiPatientDocument,
};
