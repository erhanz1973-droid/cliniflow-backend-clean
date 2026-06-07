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
    await syncPatientExternalName(id, name, { force: false });
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

const NAME_COLLECTION_CHANNELS = new Set(["messenger", "instagram"]);

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function patientRowKnownDisplayName(row) {
  if (!row || typeof row !== "object") return null;
  return (
    normalizePatientDisplayName(row.full_name) ||
    normalizePatientDisplayName(row.name) ||
    normalizePatientDisplayName(
      [row.first_name, row.last_name]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" "),
    )
  );
}

/**
 * Source name from channel (audit) — may include placeholders like "Messenger User".
 * @param {Record<string, unknown>|null|undefined} row
 */
function resolvePatientSourceName(row) {
  if (!row || typeof row !== "object") return null;
  const ext = String(row.external_name || "").replace(/\s+/g, " ").trim();
  if (ext.length >= 1 && ext.length <= 120) return ext;
  return patientRowKnownDisplayName(row);
}

/**
 * Effective UI label: override → external_name → legacy name fields.
 * @param {Record<string, unknown>|null|undefined} row
 */
function resolvePatientDisplayLabel(row) {
  if (!row || typeof row !== "object") return null;
  const override = normalizePatientDisplayName(row.display_name_override);
  if (override) return override.slice(0, 120);
  const ext = String(row.external_name || "").replace(/\s+/g, " ").trim();
  if (ext.length >= 1) return ext.slice(0, 120);
  const known = patientRowKnownDisplayName(row);
  return known ? known.slice(0, 120) : null;
}

/**
 * @param {string} patientId
 * @param {string|null|undefined} rawName
 * @param {{ force?: boolean }} [opts]
 */
async function syncPatientExternalName(patientId, rawName, opts = {}) {
  const id = String(patientId || "").trim();
  const name = String(rawName || "").replace(/\s+/g, " ").trim();
  if (!UUID_RE.test(id) || !name || name.length > 120 || !isSupabaseEnabled()) {
    return { ok: false, updated: false };
  }
  try {
    const { data: row } = await supabase
      .from("patients")
      .select("external_name")
      .eq("id", id)
      .maybeSingle();
    const current = String(row?.external_name || "").trim();
    if (current && !opts.force && !isPlaceholderPatientName(current)) {
      return { ok: true, updated: false, externalName: current };
    }
    if (current === name) return { ok: true, updated: false, externalName: current };
    const { error } = await supabase
      .from("patients")
      .update({ external_name: name, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.warn("[patientNameSync] external_name update:", error.message);
      return { ok: false, updated: false, error: error.message };
    }
    return { ok: true, updated: true, externalName: name };
  } catch (e) {
    console.warn("[patientNameSync] syncPatientExternalName:", e?.message || e);
    return { ok: false, updated: false };
  }
}

/**
 * @param {string} patientId
 * @param {string|null|undefined} rawOverride — null/empty clears override
 */
async function setPatientDisplayNameOverride(patientId, rawOverride) {
  const id = String(patientId || "").trim();
  if (!UUID_RE.test(id) || !isSupabaseEnabled()) {
    return { ok: false, error: "invalid_patient_id" };
  }
  const trimmed = String(rawOverride ?? "").replace(/\s+/g, " ").trim();
  const override = trimmed ? normalizePatientDisplayName(trimmed) : null;
  if (trimmed && !override) {
    return { ok: false, error: "invalid_display_name" };
  }
  try {
    const { data: row, error: loadErr } = await supabase
      .from("patients")
      .select("id, external_name, name, full_name, first_name, last_name, display_name_override")
      .eq("id", id)
      .maybeSingle();
    if (loadErr || !row) return { ok: false, error: "patient_not_found" };

    const patch = {
      display_name_override: override,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("patients").update(patch).eq("id", id);
    if (error) {
      console.warn("[patientNameSync] display_name_override:", error.message);
      return { ok: false, error: error.message };
    }
    const merged = { ...row, display_name_override: override };
    return {
      ok: true,
      displayNameOverride: override,
      externalName: resolvePatientSourceName(merged),
      displayName: resolvePatientDisplayLabel(merged),
    };
  } catch (e) {
    return { ok: false, error: e?.message || "update_failed" };
  }
}

/**
 * @param {string} patientId
 */
async function loadPatientKnownDisplayName(patientId) {
  const id = String(patientId || "").trim();
  if (!UUID_RE.test(id) || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase
      .from("patients")
      .select("name, full_name, first_name, last_name")
      .eq("id", id)
      .maybeSingle();
    return patientRowKnownDisplayName(data);
  } catch {
    return null;
  }
}

/**
 * WhatsApp contact name is usually visible from Meta — do not prompt there.
 * Messenger / Instagram need an explicit ask when Graph profile is missing.
 * @param {Record<string, unknown>} profileRow
 * @param {Record<string, unknown>} flags
 * @param {string} inboundChannel
 * @param {{
 *   knownName?: string|null,
 *   patientMessage?: string,
 *   recentTurns?: Array<{ role: string, text: string }>,
 * }} [opts]
 */
function evaluateNameCollectionCandidate(profileRow, flags, inboundChannel, opts = {}) {
  const channel = String(inboundChannel || profileRow?.primary_channel || profileRow?.source || "")
    .trim()
    .toLowerCase();
  const knownName = normalizePatientDisplayName(opts.knownName);
  if (knownName) {
    return { candidate: false, reason: "has_name", knownName, channel };
  }

  if (channel === "whatsapp") {
    return { candidate: false, reason: "whatsapp_profile_visible", channel };
  }

  if (!NAME_COLLECTION_CHANNELS.has(channel)) {
    return { candidate: false, reason: "channel_not_applicable", channel };
  }

  const stage = String(flags.nameCollectionStage || "").toLowerCase();
  if (stage === "collected" || stage === "declined") {
    return { candidate: false, reason: stage, channel };
  }

  const recentTurns = Array.isArray(opts.recentTurns) ? opts.recentTurns : [];
  const msg = String(opts.patientMessage || "").trim();
  const askedRecently = coordinatorRecentlyAskedForName(recentTurns);

  if (
    extractPatientNameFromMessage(msg, { coordinatorAskedName: askedRecently }) ||
    (askedRecently && looksLikeStandaloneNameLine(msg))
  ) {
    return { candidate: false, reason: "name_in_message", channel };
  }

  if (flags.nameCollectionPrompted === true && !askedRecently) {
    const promptedAt = flags.namePromptedAt ? new Date(String(flags.namePromptedAt)).getTime() : 0;
    const daysSince = promptedAt ? (Date.now() - promptedAt) / 86400000 : 999;
    if (daysSince < 2) {
      return { candidate: false, reason: "recently_prompted", channel };
    }
  }

  const msgCount = Number(profileRow.message_count || 0) || 0;
  if (msgCount < 1) {
    return { candidate: false, reason: "too_early", channel };
  }

  return { candidate: true, reason: "missing_name", channel };
}

/**
 * @param {{ candidate?: boolean, channel?: string }} evalResult
 * @param {string} [contextMode]
 * @param {string} [lang]
 */
function buildNameCollectionPromptBlock(evalResult, contextMode = "coordinator", lang = "tr") {
  if (contextMode === "treatment_guide" || !evalResult?.candidate) return "";
  const ch =
    String(evalResult.channel || "messenger").toLowerCase() === "instagram"
      ? "Instagram"
      : "Messenger";
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  const examples =
    code === "en"
      ? '"May I have your name so I can address you properly?"'
      : code === "ru"
        ? '"Подскажите, пожалуйста, как к вам обращаться?"'
        : code === "ka"
          ? '"როგორ შემიძლია მივმართო თქვენ? სახელს გაგვიზიარებთ?"'
          : '"Size nasıl hitap edebilirim? Adınızı paylaşır mısınız?"';

  return `PATIENT NAME COLLECTION (${ch} — ask naturally, once):
* You do not know the patient's real name yet. After briefly answering their question, politely ask for their name once this turn.
* Example (${code}): ${examples}
* WhatsApp patients already show a contact name — do NOT use this block on WhatsApp. This patient is on ${ch}.
* If they reply with only a name (e.g. Ayşe / Mehmet Yılmaz), thank them briefly and continue — never ask again.
* Do not ask for WhatsApp/phone in the same message as the name ask — name comes first.
* When they provide a name, include patientName in leadData.`;
}

/**
 * @param {string|null|undefined} name
 * @param {string} [lang]
 */
function buildNameAcknowledgmentPromptBlock(name, lang = "tr") {
  const n = normalizePatientDisplayName(name);
  if (!n) return "";
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  if (code === "en") {
    return `PATIENT NAME RECEIVED: The patient shared their name (${n}). Thank them briefly (e.g. "Thank you, ${n.split(" ")[0]}!") and continue the conversation. Do not ask for their name again.`;
  }
  if (code === "ru") {
    return `ИМЯ ПОЛУЧЕНО: Пациент назвал себя (${n}). Кратко поблагодарите и продолжайте — больше не спрашивайте имя.`;
  }
  if (code === "ka") {
    return `სახელი მიღებულია: პაციენტმა თქვა (${n}). მოკლედ მადლობა უთხარით და გააგრძელეთ — სახელი აღარ ჰკითხოთ.`;
  }
  return `İSİM ALINDI: Hasta adını paylaştı (${n}). Kısaca teşekkür edin (ör. "Teşekkürler ${n.split(" ")[0]}!") ve konuşmaya devam edin — adını tekrar sormayın.`;
}

/**
 * @param {string} replyText
 * @param {string} [lang]
 */
function appendNameAskSuffixToReply(replyText, lang = "tr") {
  const base = String(replyText || "").trim();
  if (!base) return base;
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  const suffix =
    code === "en"
      ? " May I have your name so I can address you properly?"
      : code === "ru"
        ? " Подскажите, пожалуйста, как к вам обращаться?"
        : code === "ka"
          ? " როგორ შემიძლია მივმართო თქვენ? სახელს გაგვიზიარებთ?"
          : " Size nasıl hitap edebilirim? Adınızı paylaşır mısınız?";
  if (base.endsWith("?") || base.endsWith("!")) return `${base}${suffix}`;
  return `${base}.${suffix}`;
}

/**
 * @param {string} profileId
 */
async function markNamePromptOffered(profileId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(String(profileId || "").trim())) return;
  const pid = String(profileId).trim();
  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("operational_intake_flags")
    .eq("id", pid)
    .maybeSingle();
  const flags =
    row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? { ...row.operational_intake_flags }
      : {};
  flags.nameCollectionPrompted = true;
  flags.namePromptedAt = new Date().toISOString();
  flags.nameCollectionStage = "prompted";
  const { error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: flags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pid);
  if (error) console.warn("[patientNameSync] markNamePrompted:", error.message);
}

/**
 * @param {string} profileId
 * @param {string|null|undefined} rawName
 */
async function markNameCollectionCollected(profileId, rawName) {
  if (!isSupabaseEnabled() || !UUID_RE.test(String(profileId || "").trim())) return;
  const name = normalizePatientDisplayName(rawName);
  if (!name) return;
  const pid = String(profileId).trim();
  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("operational_intake_flags, patient_id")
    .eq("id", pid)
    .maybeSingle();
  const flags =
    row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? { ...row.operational_intake_flags }
      : {};
  flags.nameCollectionPrompted = true;
  flags.nameCollectionStage = "collected";
  flags.nameCollectedAt = new Date().toISOString();
  const { error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: flags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pid);
  if (error) console.warn("[patientNameSync] markNameCollected:", error.message);
  const patientId = String(row?.patient_id || "").trim();
  if (UUID_RE.test(patientId)) {
    await syncPatientNameColumn(patientId, name, { source: "name_collection_turn" });
  }
}

module.exports = {
  normalizePatientDisplayName,
  isPlaceholderPatientName,
  extractPatientNameFromMessage,
  coordinatorRecentlyAskedForName,
  looksLikeStandaloneNameLine,
  normalizeMessengerGraphProfileName,
  patientRowKnownDisplayName,
  resolvePatientSourceName,
  resolvePatientDisplayLabel,
  syncPatientExternalName,
  setPatientDisplayNameOverride,
  loadPatientKnownDisplayName,
  evaluateNameCollectionCandidate,
  buildNameCollectionPromptBlock,
  buildNameAcknowledgmentPromptBlock,
  appendNameAskSuffixToReply,
  markNamePromptOffered,
  markNameCollectionCollected,
  syncPatientNameColumn,
  syncPatientNameFromWhatsAppTurn,
  syncPatientNameFromMessengerTurn,
  resolvePatientRecordName,
};
