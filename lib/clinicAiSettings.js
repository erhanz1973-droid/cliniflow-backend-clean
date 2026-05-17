/**
 * Clinic Operations AI Profile — load, merge defaults, persist, and resolve for orchestration.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  AUTONOMY_LEVELS,
  AUTONOMY_CATEGORIES,
  AUTONOMY_SAFETY_FLOOR_KEYS,
  buildDefaultClinicAiProfile,
  buildDefaultAutonomyConfig,
  buildDefaultToneConfig,
  buildDefaultEscalationConfig,
  buildDefaultKnowledgeBaseConfig,
  buildDefaultCommunicationPolicy,
  buildDefaultSafetyRules,
} = require("./clinicAiSettingsTypes");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AUTONOMY_LEVEL_SET = new Set(AUTONOMY_LEVELS);
const AUTONOMY_KEY_SET = new Set(AUTONOMY_CATEGORIES.map((c) => c.key));

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function deepMergeObjects(target, patch) {
  const out = { ...target };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMergeObjects(/** @type {Record<string, unknown>} */ (out[key]), val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * @param {string} level
 * @param {string} categoryKey
 * @returns {string}
 */
function clampAutonomyLevel(level, categoryKey) {
  const normalized = String(level || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!AUTONOMY_LEVEL_SET.has(normalized)) return "SUGGEST_ONLY";
  if (!AUTONOMY_SAFETY_FLOOR_KEYS.includes(categoryKey)) return normalized;
  if (normalized === "OFF" || normalized === "SUGGEST_ONLY") return normalized;
  return "SUGGEST_ONLY";
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
function normalizeAutonomyConfig(raw) {
  const defaults = buildDefaultAutonomyConfig();
  const categories = { ...defaults.categories };
  const incoming =
    raw && isPlainObject(raw.categories) ? /** @type {Record<string, unknown>} */ (raw.categories) : raw;

  if (isPlainObject(incoming)) {
    for (const [key, val] of Object.entries(incoming)) {
      if (!AUTONOMY_KEY_SET.has(key)) continue;
      categories[key] = clampAutonomyLevel(String(val), key);
    }
  }

  return deepMergeObjects(defaults, { categories });
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @param {string} clinicId
 * @returns {import('./clinicAiSettingsTypes').ResolvedClinicAiProfile}
 */
function mapRowToProfile(row, clinicId) {
  const defaults = buildDefaultClinicAiProfile();
  if (!row) {
    return { ...defaults, clinicId, isConfigured: false };
  }

  return {
    clinicId,
    isConfigured: true,
    autonomy: normalizeAutonomyConfig(
      /** @type {Record<string, unknown>} */ (row.autonomy_config || {}),
    ),
    escalation: deepMergeObjects(
      defaults.escalation,
      /** @type {Record<string, unknown>} */ (row.escalation_config || {}),
    ),
    tone: deepMergeObjects(
      defaults.tone,
      /** @type {Record<string, unknown>} */ (row.tone_config || {}),
    ),
    knowledgeBase: deepMergeObjects(
      defaults.knowledgeBase,
      /** @type {Record<string, unknown>} */ (row.knowledge_base_config || {}),
    ),
    communicationPolicy: deepMergeObjects(
      defaults.communicationPolicy,
      /** @type {Record<string, unknown>} */ (row.communication_policy || {}),
    ),
    safetyRules: deepMergeObjects(
      defaults.safetyRules,
      /** @type {Record<string, unknown>} */ (row.safety_rules || {}),
    ),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

/**
 * Resolved profile for AI orchestration (always returns merged defaults).
 * @param {string} clinicId
 */
async function getClinicAiProfile(clinicId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) {
    return buildDefaultClinicAiProfile();
  }

  const { data, error } = await supabase
    .from("clinic_ai_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    console.warn("[clinicAiSettings] get:", error.message);
    return { ...buildDefaultClinicAiProfile(), clinicId, isConfigured: false };
  }

  return mapRowToProfile(data, clinicId);
}

/**
 * @param {string} clinicId
 * @param {string} categoryKey
 */
async function getAutonomyLevelForCategory(clinicId, categoryKey) {
  const profile = await getClinicAiProfile(clinicId);
  const categories = /** @type {Record<string, string>} */ (
    profile.autonomy.categories || {}
  );
  const key = String(categoryKey || "").trim();
  if (!AUTONOMY_KEY_SET.has(key)) return "SUGGEST_ONLY";
  return clampAutonomyLevel(categories[key] || "SUGGEST_ONLY", key);
}

/**
 * Whether orchestration may auto-send (vs draft-only).
 * @param {string} level
 */
function autonomyAllowsAutoSend(level) {
  const l = String(level || "").toUpperCase();
  return l === "AUTO_REPLY" || l === "FULLY_AUTONOMOUS";
}

/**
 * @param {string} clinicId
 * @param {{
 *   autonomy?: Record<string, unknown>,
 *   escalation?: Record<string, unknown>,
 *   tone?: Record<string, unknown>,
 *   knowledgeBase?: Record<string, unknown>,
 *   communicationPolicy?: Record<string, unknown>,
 *   safetyRules?: Record<string, unknown>,
 * }} patch
 */
async function upsertClinicAiSettings(clinicId, patch) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!UUID_RE.test(clinicId)) return { ok: false, error: "invalid_clinic_id" };

  const existing = await getClinicAiProfile(clinicId);
  const nowIso = new Date().toISOString();

  const nextProfile = {
    autonomy: patch.autonomy
      ? normalizeAutonomyConfig(deepMergeObjects(existing.autonomy, patch.autonomy))
      : existing.autonomy,
    escalation: patch.escalation
      ? deepMergeObjects(existing.escalation, patch.escalation)
      : existing.escalation,
    tone: patch.tone ? deepMergeObjects(existing.tone, patch.tone) : existing.tone,
    knowledgeBase: patch.knowledgeBase
      ? deepMergeObjects(existing.knowledgeBase, patch.knowledgeBase)
      : existing.knowledgeBase,
    communicationPolicy: patch.communicationPolicy
      ? deepMergeObjects(existing.communicationPolicy, patch.communicationPolicy)
      : existing.communicationPolicy,
    safetyRules: patch.safetyRules
      ? deepMergeObjects(existing.safetyRules, patch.safetyRules)
      : existing.safetyRules,
  };

  const row = {
    clinic_id: clinicId,
    autonomy_config: nextProfile.autonomy,
    escalation_config: nextProfile.escalation,
    tone_config: nextProfile.tone,
    knowledge_base_config: nextProfile.knowledgeBase,
    communication_policy: nextProfile.communicationPolicy,
    safety_rules: nextProfile.safetyRules,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("clinic_ai_settings")
    .upsert(row, { onConflict: "clinic_id" })
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: "upsert_failed", message: error.message };
  }

  return { ok: true, profile: mapRowToProfile(data, clinicId) };
}

/**
 * Compact bundle for prompt / routing layers.
 * @param {string} clinicId
 */
async function resolveClinicAiOpsContext(clinicId) {
  const profile = await getClinicAiProfile(clinicId);
  return {
    clinicId: profile.clinicId,
    isConfigured: profile.isConfigured,
    identity: {
      displayName: profile.tone.displayName,
      languages: profile.tone.supportedLanguages,
      personality: profile.tone.personality,
      signatureStyle: profile.tone.signatureStyle,
    },
    autonomy: profile.autonomy.categories,
    sla: {
      doctorResponseSlaMinutes: profile.escalation.doctorResponseSlaMinutes,
      aiFallbackAfterMinutes: profile.escalation.aiFallbackAfterMinutes,
      coordinatorEscalationAfterMinutes: profile.escalation.coordinatorEscalationAfterMinutes,
      businessHours: profile.escalation.businessHours,
    },
    handoff: profile.escalation.handoff,
    communicationPolicy: profile.communicationPolicy,
    safetyRules: profile.safetyRules,
    knowledgeBase: profile.knowledgeBase,
    updatedAt: profile.updatedAt,
  };
}

module.exports = {
  getClinicAiProfile,
  getAutonomyLevelForCategory,
  upsertClinicAiSettings,
  resolveClinicAiOpsContext,
  autonomyAllowsAutoSend,
  clampAutonomyLevel,
  normalizeAutonomyConfig,
  mapRowToProfile,
};
