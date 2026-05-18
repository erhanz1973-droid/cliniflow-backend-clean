/**
 * Clinic AI settings row — tone, autonomy, safety, logistics, materials, payment, notes.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { normalizeToneMultilingual } = require("./clinicMultilingual");
const {
  AUTONOMY_LEVELS,
  AUTONOMY_CATEGORIES,
  AUTONOMY_SAFETY_FLOOR_KEYS,
  LEGACY_AUTONOMY_KEY_MAP,
  buildDefaultToneConfig,
  buildDefaultMaterialsConfig,
  buildDefaultPricingSalesAuthority,
  buildDefaultLogisticsConfig,
  buildDefaultPaymentPolicyConfig,
  buildDefaultInternalNotesConfig,
  buildDefaultAutonomyConfig,
  buildDefaultSafetyRules,
  buildDefaultEscalationConfig,
} = require("./clinicOpsProfileTypes");
const { normalizeConversionConfig } = require("./conversionEngine");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AUTONOMY_LEVEL_SET = new Set(AUTONOMY_LEVELS);
const AUTONOMY_KEY_SET = new Set(AUTONOMY_CATEGORIES.map((c) => c.key));

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

function clampAutonomyLevel(level, categoryKey) {
  const normalized = String(level || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!AUTONOMY_LEVEL_SET.has(normalized)) return "SUGGEST_ONLY";
  if (!AUTONOMY_SAFETY_FLOOR_KEYS.includes(categoryKey)) return normalized;
  if (normalized === "OFF" || normalized === "SUGGEST_ONLY") return normalized;
  if (normalized === "AUTO_REPLY") return "AUTO_REPLY";
  return "SUGGEST_ONLY";
}

function normalizeAutonomyConfig(raw) {
  const defaults = buildDefaultAutonomyConfig();
  const categories = { ...defaults.categories };
  const incoming =
    raw && isPlainObject(raw.categories) ? /** @type {Record<string, unknown>} */ (raw.categories) : raw;

  if (isPlainObject(incoming)) {
    for (const [key, val] of Object.entries(incoming)) {
      const mapped = LEGACY_AUTONOMY_KEY_MAP[key] || key;
      if (!AUTONOMY_KEY_SET.has(mapped)) continue;
      const level = clampAutonomyLevel(String(val), mapped);
      if (!categories[mapped] || categories[mapped] === defaults.categories[mapped]) {
        categories[mapped] = level;
      }
    }
  }

  return deepMergeObjects(defaults, { categories });
}

function normalizeMaterialsConfig(raw) {
  const defaults = buildDefaultMaterialsConfig();
  const merged = deepMergeObjects(defaults, raw && typeof raw === "object" ? raw : {});
  if (!merged.salesAuthority || typeof merged.salesAuthority !== "object") {
    merged.salesAuthority = buildDefaultPricingSalesAuthority();
  }
  return merged;
}

function normalizeToneConfig(raw) {
  const defaults = buildDefaultToneConfig();
  const merged = deepMergeObjects(defaults, raw && typeof raw === "object" ? raw : {});
  const multilingual = normalizeToneMultilingual(merged);
  return {
    ...merged,
    version: Math.max(Number(merged.version) || 0, 3),
    ...multilingual,
    supportedLanguages: multilingual.supportedLanguages,
  };
}

function normalizeKnowledgeBaseConfig(raw) {
  const kb = raw && typeof raw === "object" ? raw : { version: 1 };
  const ce = kb.conversionEngine ?? kb.conversion_engine;
  return {
    ...kb,
    version: Math.max(Number(kb.version) || 0, 1),
    conversionEngine: normalizeConversionConfig(ce),
  };
}

function normalizeSafetyRules(raw) {
  const defaults = buildDefaultSafetyRules();
  const incoming = raw && isPlainObject(raw.requireHumanReview) ? raw.requireHumanReview : raw;
  const requireHumanReview = { ...defaults.requireHumanReview };

  if (isPlainObject(incoming)) {
    const legacyMap = {
      surgeryAdvice: "surgeryDecisions",
      medications: "medicationAdvice",
      diagnosis: "diagnosis",
      complications: "complications",
      emergencies: "emergencies",
    };
    for (const [key, val] of Object.entries(incoming)) {
      const mapped = legacyMap[key] || key;
      if (mapped in requireHumanReview) requireHumanReview[mapped] = val === true;
    }
  }

  return deepMergeObjects(defaults, { requireHumanReview });
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @param {string} clinicId
 */
function mapRowToProfile(row, clinicId) {
  const defaults = buildDefaultClinicAiProfile();
  if (!row) return { ...defaults, clinicId, isConfigured: false };

  return {
    clinicId,
    isConfigured: true,
    tone: normalizeToneConfig(
      deepMergeObjects(defaults.tone, /** @type {Record<string, unknown>} */ (row.tone_config || {})),
    ),
    materials: normalizeMaterialsConfig(
      /** @type {Record<string, unknown>} */ (row.materials_config || {}),
    ),
    logistics: deepMergeObjects(
      defaults.logistics,
      /** @type {Record<string, unknown>} */ (row.logistics_config || {}),
    ),
    payment: deepMergeObjects(
      defaults.payment,
      /** @type {Record<string, unknown>} */ (row.payment_policy_config || {}),
    ),
    internalNotes: deepMergeObjects(
      defaults.internalNotes,
      /** @type {Record<string, unknown>} */ (row.internal_notes_config || {}),
    ),
    autonomy: normalizeAutonomyConfig(
      /** @type {Record<string, unknown>} */ (row.autonomy_config || {}),
    ),
    escalation: deepMergeObjects(
      defaults.escalation,
      /** @type {Record<string, unknown>} */ (row.escalation_config || {}),
    ),
    safetyRules: normalizeSafetyRules(
      /** @type {Record<string, unknown>} */ (row.safety_rules || {}),
    ),
    knowledgeBase: normalizeKnowledgeBaseConfig(
      deepMergeObjects(
        defaults.knowledgeBase,
        /** @type {Record<string, unknown>} */ (row.knowledge_base_config || {}),
      ),
    ),
    communicationPolicy: deepMergeObjects(
      defaults.communicationPolicy,
      /** @type {Record<string, unknown>} */ (row.communication_policy || {}),
    ),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function buildDefaultClinicAiProfile() {
  return {
    clinicId: null,
    isConfigured: false,
    tone: buildDefaultToneConfig(),
    materials: buildDefaultMaterialsConfig(),
    logistics: buildDefaultLogisticsConfig(),
    payment: buildDefaultPaymentPolicyConfig(),
    internalNotes: buildDefaultInternalNotesConfig(),
    autonomy: buildDefaultAutonomyConfig(),
    escalation: buildDefaultEscalationConfig(),
    safetyRules: buildDefaultSafetyRules(),
    knowledgeBase: normalizeKnowledgeBaseConfig({ version: 1 }),
    communicationPolicy: {
      version: 1,
      canDiscussPricing: true,
      canNegotiateDiscounts: false,
      canAutoBookAppointments: false,
      canSendPaymentLinks: false,
      whatsappCollection: {
        requestWhatsappEnabled: true,
        askWhatsappAfterStage: "responded",
        whatsappRequiredForBooking: false,
        coordinatorWhatsappEnabled: true,
      },
    },
    createdAt: null,
    updatedAt: new Date().toISOString(),
  };
}

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

async function getAutonomyLevelForCategory(clinicId, categoryKey) {
  const profile = await getClinicAiProfile(clinicId);
  const categories = /** @type {Record<string, string>} */ (profile.autonomy.categories || {});
  const key = LEGACY_AUTONOMY_KEY_MAP[categoryKey] || categoryKey;
  if (!AUTONOMY_KEY_SET.has(key)) return "SUGGEST_ONLY";
  return clampAutonomyLevel(categories[key] || "SUGGEST_ONLY", key);
}

function autonomyAllowsAutoSend(level) {
  const l = String(level || "").toUpperCase();
  return l === "AUTO_REPLY" || l === "FULLY_AUTONOMOUS";
}

/**
 * @param {string} clinicId
 * @param {Record<string, unknown>} patch
 */
async function upsertClinicAiSettings(clinicId, patch) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  if (!UUID_RE.test(clinicId)) return { ok: false, error: "invalid_clinic_id" };

  const existing = await getClinicAiProfile(clinicId);
  const nowIso = new Date().toISOString();

  const next = {
    tone: patch.tone
      ? normalizeToneConfig(deepMergeObjects(existing.tone, patch.tone))
      : existing.tone,
    materials: patch.materials
      ? deepMergeObjects(existing.materials, patch.materials)
      : existing.materials,
    logistics: patch.logistics
      ? deepMergeObjects(existing.logistics, patch.logistics)
      : existing.logistics,
    payment: patch.payment ? deepMergeObjects(existing.payment, patch.payment) : existing.payment,
    internalNotes: patch.internalNotes
      ? deepMergeObjects(existing.internalNotes, patch.internalNotes)
      : existing.internalNotes,
    autonomy: patch.autonomy
      ? normalizeAutonomyConfig(deepMergeObjects(existing.autonomy, patch.autonomy))
      : existing.autonomy,
    escalation: patch.escalation
      ? deepMergeObjects(existing.escalation, patch.escalation)
      : existing.escalation,
    safetyRules: patch.safetyRules
      ? normalizeSafetyRules(deepMergeObjects(existing.safetyRules, patch.safetyRules))
      : existing.safetyRules,
    knowledgeBase: patch.knowledgeBase
      ? normalizeKnowledgeBaseConfig(deepMergeObjects(existing.knowledgeBase, patch.knowledgeBase))
      : existing.knowledgeBase,
    communicationPolicy: patch.communicationPolicy
      ? deepMergeObjects(existing.communicationPolicy, patch.communicationPolicy)
      : existing.communicationPolicy,
  };

  const row = {
    clinic_id: clinicId,
    tone_config: next.tone,
    materials_config: next.materials,
    logistics_config: next.logistics,
    payment_policy_config: next.payment,
    internal_notes_config: next.internalNotes,
    autonomy_config: next.autonomy,
    escalation_config: next.escalation,
    safety_rules: next.safetyRules,
    knowledge_base_config: next.knowledgeBase,
    communication_policy: next.communicationPolicy,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from("clinic_ai_settings")
    .upsert(row, { onConflict: "clinic_id" })
    .select("*")
    .single();

  if (error) return { ok: false, error: "upsert_failed", message: error.message };
  return { ok: true, profile: mapRowToProfile(data, clinicId) };
}

async function resolveClinicAiOpsContext(clinicId) {
  const profile = await getClinicAiProfile(clinicId);
  return {
    clinicId: profile.clinicId,
    isConfigured: profile.isConfigured,
    identity: {
      displayName: profile.tone.displayName,
      toneStyle: profile.tone.toneStyle,
      profileTags: profile.tone.profileTags,
      languages: profile.tone.enabledLanguageCodes || [],
      primaryLanguage: profile.tone.primaryLanguage,
      supportedLanguages: profile.tone.supportedLanguages,
      signatureStyle: profile.tone.signatureStyle,
    },
    autonomy: profile.autonomy.categories,
    sla: {
      doctorResponseSlaMinutes: profile.escalation.doctorResponseSlaMinutes,
      aiFallbackAfterMinutes: profile.escalation.aiFallbackAfterMinutes,
      coordinatorEscalationAfterMinutes: profile.escalation.coordinatorEscalationAfterMinutes,
    },
    logistics: profile.logistics,
    materials: profile.materials,
    payment: profile.payment,
    handoff: profile.escalation.handoff,
    safetyRules: profile.safetyRules,
    internalNotes: profile.internalNotes,
    communicationPolicy: profile.communicationPolicy,
    updatedAt: profile.updatedAt,
  };
}

module.exports = {
  buildDefaultClinicAiProfile,
  getClinicAiProfile,
  getAutonomyLevelForCategory,
  upsertClinicAiSettings,
  resolveClinicAiOpsContext,
  autonomyAllowsAutoSend,
  clampAutonomyLevel,
  normalizeAutonomyConfig,
  mapRowToProfile,
  deepMergeObjects,
};
