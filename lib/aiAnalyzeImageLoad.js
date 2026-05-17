/**
 * Load dental photos for ai-analyze — prefer Supabase service-role download
 * over HTTP fetch of signed URLs (avoids missing/expired token issues).
 */
const { supabase, isSupabaseEnabled } = require("./supabase");

const DEFAULT_AI_BUCKET = "patient-files";

/**
 * @param {string} url
 * @returns {{ bucket: string, objectPath: string } | null}
 */
function parseSupabaseStorageRefFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const withoutQuery = raw.split("?")[0];
    const decoded = decodeURIComponent(withoutQuery);
    const m = decoded.match(
      /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/i,
    );
    if (!m) return null;
    const bucket = m[1];
    const objectPath = m[2].replace(/^\/+/, "");
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  } catch {
    return null;
  }
}

/**
 * @param {string} hint — upload `path` (ai-photos/…) or bucket-prefixed path
 */
function storageRefFromPathHint(hint) {
  const s = String(hint || "")
    .trim()
    .replace(/^\/+/, "");
  if (!s) return null;
  if (/^patient-files\//i.test(s)) {
    return { bucket: DEFAULT_AI_BUCKET, objectPath: s.replace(/^patient-files\//i, "") };
  }
  if (/^ai-photos\//i.test(s)) {
    return { bucket: DEFAULT_AI_BUCKET, objectPath: s };
  }
  return null;
}

function guessMimeFromPath(objectPath) {
  const ext = String(objectPath || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

async function downloadViaServiceRole(ref) {
  if (!ref?.bucket || !ref?.objectPath || !isSupabaseEnabled()) return null;
  const { data, error } = await supabase.storage.from(ref.bucket).download(ref.objectPath);
  if (error || !data) {
    return { error: error?.message || "download_failed" };
  }
  const buf = Buffer.from(await data.arrayBuffer());
  if (!buf.length) return { error: "empty_object" };
  return {
    buffer: buf,
    mimeType: guessMimeFromPath(ref.objectPath),
    source: "storage_download",
  };
}

async function fetchViaHttp(url, timeoutMs, patientId, log) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let fetchUrl = String(url).trim();
    const tryFetch = async (u) => fetch(u, { signal: ctrl.signal });

    let res = await tryFetch(fetchUrl);

    if ((res.status === 401 || res.status === 403 || res.status === 400) && isSupabaseEnabled()) {
      const ref = parseSupabaseStorageRefFromUrl(fetchUrl);
      if (ref) {
        const dl = await downloadViaServiceRole(ref);
        if (dl?.buffer) {
          log?.("info", "image_loaded_storage_after_http_4xx", {
            patientId,
            status: res.status,
            objectPath: ref.objectPath,
          });
          return { ...dl, httpStatus: res.status };
        }
        const withoutQuery = fetchUrl.split("?")[0];
        const signMatch = withoutQuery.match(/\/object\/sign\/([^/]+)\/(.+)$/i);
        if (signMatch) {
          const bucket = signMatch[1];
          const objPath = decodeURIComponent(signMatch[2]);
          const { data: signed, error: signErr } = await supabase.storage
            .from(bucket)
            .createSignedUrl(objPath, 120);
          if (!signErr && signed?.signedUrl) {
            res = await tryFetch(signed.signedUrl);
            log?.("info", "signed_url_refreshed", { patientId, newStatus: res.status });
          }
        }
      }
    }

    if (!res.ok) {
      const bodySnippet = await res
        .text()
        .then((t) => String(t || "").slice(0, 240))
        .catch(() => "");
      return {
        error: "http_fetch_failed",
        status: res.status,
        bodySnippet,
        contentType: res.headers.get("content-type"),
      };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (!buffer.length) return { error: "empty_http_body" };
    return { buffer, mimeType, source: "http_fetch" };
  } catch (e) {
    if (e?.name === "AbortError") return { error: "timeout" };
    return { error: e?.message || "fetch_exception" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   imageUrl?: string|null,
 *   storagePath?: string|null,
 *   patientId?: string|null,
 *   log?: (level: string, event: string, meta?: object) => void,
 *   timeoutMs?: number,
 * }} params
 * @returns {Promise<{ buffer: Buffer, mimeType: string, source: string }>}
 */
async function loadAiAnalyzeImageBuffer(params) {
  const imageUrl = params?.imageUrl ? String(params.imageUrl).trim() : "";
  const storagePath = params?.storagePath ? String(params.storagePath).trim() : "";
  const patientId = params?.patientId ? String(params.patientId).trim() : "";
  const log = typeof params?.log === "function" ? params.log : null;
  const timeoutMs = Math.max(5000, Number(params?.timeoutMs) || 15_000);

  let ref = storageRefFromPathHint(storagePath);
  if (!ref && imageUrl) ref = parseSupabaseStorageRefFromUrl(imageUrl);

  if (ref) {
    const dl = await downloadViaServiceRole(ref);
    if (dl?.buffer) {
      log?.("info", "image_loaded_storage", {
        patientId,
        bucket: ref.bucket,
        objectPath: ref.objectPath,
        bytes: dl.buffer.length,
        source: dl.source,
      });
      return dl;
    }
    log?.("warn", "storage_download_failed", {
      patientId,
      bucket: ref.bucket,
      objectPath: ref.objectPath,
      error: dl?.error,
    });
  }

  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    const http = await fetchViaHttp(imageUrl, timeoutMs, patientId, log);
    if (http?.buffer) {
      log?.("info", "image_loaded_http", {
        patientId,
        bytes: http.buffer.length,
        source: http.source,
      });
      return http;
    }
    const err = new Error(http?.error || "image_fetch_failed");
    err.code = http?.error === "timeout" ? "image_fetch_timeout" : "image_fetch_failed";
    err.status = http?.status;
    err.bodySnippet = http?.bodySnippet;
    throw err;
  }

  const err = new Error("image_url_required");
  err.code = "image_fetch_failed";
  throw err;
}

/**
 * Post-upload sanity check — confirms service role can read the object.
 */
async function probeStorageObjectReadable(storagePath, patientId, log) {
  const ref = storageRefFromPathHint(storagePath);
  if (!ref) return { ok: false, reason: "no_ref" };
  const dl = await downloadViaServiceRole(ref);
  if (dl?.buffer) {
    log?.("info", "ai_upload_storage_probe_ok", {
      patientId,
      objectPath: ref.objectPath,
      bytes: dl.buffer.length,
    });
    return { ok: true, bytes: dl.buffer.length };
  }
  log?.("warn", "ai_upload_storage_probe_failed", {
    patientId,
    objectPath: ref.objectPath,
    error: dl?.error,
  });
  return { ok: false, reason: dl?.error || "probe_failed" };
}

module.exports = {
  DEFAULT_AI_BUCKET,
  parseSupabaseStorageRefFromUrl,
  storageRefFromPathHint,
  loadAiAnalyzeImageBuffer,
  probeStorageObjectReadable,
};
