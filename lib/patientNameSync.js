/**
 * Persist patient display names to patients.name (single column; "Ad Soyad" OK).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { normalizeWhatsappNumber } = require("./whatsappCollection");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PLACEHOLDER_NAMES = new Set(
  [
    "whatsapp user",
    "messenger user",
    "instagram user",
    "unknown",
    "patient",
    "lead",
    "misafir",
    "guest",
    "whatsapp hasta",
    "whatsapp user",
  ].map((s) => s.toLowerCase()),
);

const NAME_INTRO_RE =
  /\b(?:(?:ben(?:im)?|ismim|adim|adım|adim|name\s+is|my\s+name\s+is|i\s*am|i'm)\s+)?(?:ad(?:ım|im)?|ismim|name)\s*(?::|,|—|-)?\s*([A-Za-zÀ-ÿİıĞğÜüŞşÖöÇç][A-Za-zÀ-ÿİıĞğÜüŞşÖöÇç\s.'-]{1,78})/iu;

const NAME_ASK_RE =
  /\b(ad(?:ınız|iniz|ınızı|inizi)?|isim|isminiz|ad\s*soyad|full\s*name|your\s*name|adınızı\s*yaz|isminizi\s*yaz)\b/i;

/**
 * @param {string|null|undefined} raw
 */
function normalizePatientDisplayName(raw) {
  const name = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length < 2 || name.length > 120) return null;
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return null;
  if (/^\+?\d[\d\s().-]{7,}$/.test(name)) return null;
  return name;
}

/**
 * @param {string|null|undefined} name
 */
function isPlaceholderPatientName(name) {
  const n = normalizePatientDisplayName(name);
  return !n;
}

/**
 * @param {string} text
 */
function looksLikeStandaloneNameLine(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 2 || t.length > 80) return false;
  if (normalizeWhatsappNumber(t)) return false;
  if (/\d{4,}/.test(t)) return false;
  if (/[@#]/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return words.every((w) => /^[\p{L}'-]{2,}$/u.test(w));
}

/**
 * @param {string} text
 * @param {{ coordinatorAskedName?: boolean }} [opts]
 */
function extractPatientNameFromMessage(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const intro = raw.match(NAME_INTRO_RE);
  if (intro?.[1]) {
    const n = normalizePatientDisplayName(intro[1]);
    if (n) return n;
  }

  if (opts.coordinatorAskedName && looksLikeStandaloneNameLine(raw)) {
    return normalizePatientDisplayName(raw);
  }

  return null;
}

/**
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function coordinatorRecentlyAskedForName(recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 4; i--) {
    const t = turns[i];
    if (t.role !== "assistant") continue;
    if (NAME_ASK_RE.test(String(t.text || ""))) return true;
    break;
  }
  return false;
}

/**
 * @param {string} patientId
 * @param {string|null|undefined} rawName
 * @param {{ source?: string, force?: boolean }} [opts]
 */
async function syncPatientNameColumn(patientId, rawName, opts = {}) {
  const id = String(patientId || "").trim();
  const name = normalizePatientDisplayName(rawName);
  if (!UUID_RE.test(id) || !name || !isSupabaseEnabled()) {
    return { ok: false, updated: false, name: null };
  }

  try {
    const { data: row } = await supabase.from("patients").select("name, full_name").eq("id", id).maybeSingle();
    const current = normalizePatientDisplayName(row?.full_name) || normalizePatientDisplayName(row?.name);
    if (current && !opts.force) {
      if (current.toLowerCase() === name.toLowerCase()) {
        return { ok: true, updated: false, name: current };
      }
      if (!isPlaceholderPatientName(current)) {
        return { ok: true, updated: false, name: current };
      }
    }

    const patch = { name, updated_at: new Date().toISOString() };
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts[0]) patch.first_name = parts[0];
    if (parts.length > 1) patch.last_name = parts.slice(1).join(" ");

    const { error } = await supabase.from("patients").update(patch).eq("id", id);
    if (error) {
      console.warn("[patientNameSync] update failed:", error.message, { source: opts.source || null });
      return { ok: false, updated: false, name: null, error: error.message };
    }
    return { ok: true, updated: true, name };
  } catch (e) {
    console.warn("[patientNameSync]", e?.message || e);
    return { ok: false, updated: false, name: null };
  }
}

/**
 * @param {string} patientId
 * @param {{ profileName?: string|null, message?: string, recentTurns?: Array<{ role: string, text: string }> }} params
 */
async function syncPatientNameFromWhatsAppTurn(patientId, params = {}) {
  const profileName = normalizePatientDisplayName(params.profileName);
  if (profileName) {
    const r = await syncPatientNameColumn(patientId, profileName, { source: "whatsapp_profile" });
    if (r.updated || r.name) return r;
  }

  const asked = coordinatorRecentlyAskedForName(params.recentTurns);
  const fromMsg = extractPatientNameFromMessage(params.message || "", { coordinatorAskedName: asked });
  if (fromMsg) {
    return syncPatientNameColumn(patientId, fromMsg, { source: "whatsapp_message" });
  }

  return { ok: true, updated: false, name: profileName || null };
}

/**
 * @param {Record<string, unknown>|null|undefined} profile
 */
function normalizeMessengerGraphProfileName(profile) {
  if (!profile || typeof profile !== "object") return null;
  const fromParts = normalizePatientDisplayName(
    [profile.first_name, profile.last_name].filter(Boolean).join(" "),
  );
  if (fromParts) return fromParts;
  return normalizePatientDisplayName(profile.name);
}

/**
 * @param {string} patientId
 * @param {{ profileName?: string|null, message?: string, recentTurns?: Array<{ role: string, text: string }> }} params
 */
async function syncPatientNameFromMessengerTurn(patientId, params = {}) {
  const profileName = normalizePatientDisplayName(params.profileName);
  if (profileName) {
    const r = await syncPatientNameColumn(patientId, profileName, { source: "messenger_profile" });
    if (r.updated) return r;
  }

  const asked = coordinatorRecentlyAskedForName(params.recentTurns);
  const fromMsg =
    extractPatientNameFromMessage(params.message || "", { coordinatorAskedName: asked }) ||
    (asked && looksLikeStandaloneNameLine(params.message || "")
      ? normalizePatientDisplayName(params.message)
      : null);
  if (fromMsg) {
    return syncPatientNameColumn(patientId, fromMsg, { source: "messenger_message" });
  }

  return { ok: true, updated: false, name: profileName || null };
}

/**
 * @param {{
 *   profileRow?: Record<string, unknown>,
 *   patientMessage?: string,
 *   recentTurns?: Array<{ role: string, text: string }>,
 * }} params
 */
async function resolvePatientRecordName(params) {
  const profile = params.profileRow || {};
  const patientId = String(profile.patient_id || "").trim();
  let name = null;

  if (UUID_RE.test(patientId)) {
    try {
      const { data } = await supabase
        .from("patients")
        .select("name, full_name, first_name, last_name")
        .eq("id", patientId)
        .maybeSingle();
      name =
        normalizePatientDisplayName(data?.full_name) ||
        normalizePatientDisplayName(data?.name) ||
        normalizePatientDisplayName(
          [data?.first_name, data?.last_name].filter(Boolean).join(" "),
        );
    } catch {
      /* ignore */
    }
  }

  const asked = coordinatorRecentlyAskedForName(params.recentTurns);
  const fromMsg = extractPatientNameFromMessage(params.patientMessage || "", {
    coordinatorAskedName: asked,
  });
  if (fromMsg && patientId) {
    const synced = await syncPatientNameColumn(patientId, fromMsg, { source: "inbound_message" });
    if (synced.name) name = synced.name;
  }

  return { name, hasName: !!name };
}

module.exports = {
  normalizePatientDisplayName,
  isPlaceholderPatientName,
  extractPatientNameFromMessage,
  coordinatorRecentlyAskedForName,
  looksLikeStandaloneNameLine,
  normalizeMessengerGraphProfileName,
  syncPatientNameColumn,
  syncPatientNameFromWhatsAppTurn,
  syncPatientNameFromMessengerTurn,
  resolvePatientRecordName,
};
