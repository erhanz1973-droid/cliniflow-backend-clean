/**
 * Admin API — Clinic Operations Profile hub (AI ops sections; pricing lives in treatment_prices).
 */

const express = require("express");
const {
  getClinicOpsProfile,
  patchClinicOpsSection,
  resolveClinicOpsKnowledge,
} = require("./clinicOpsProfile");
const { getClinicAiProfile, upsertClinicAiSettings } = require("./clinicAiSettings");
const {
  OPS_PROFILE_SECTIONS,
  OPS_PROFILE_SCHEMA_VERSION,
  AUTONOMY_LEVELS,
  AUTONOMY_CATEGORIES,
  AUTONOMY_SAFETY_FLOOR_KEYS,
  PROFILE_TAGS,
  TONE_STYLES,
  SIGNATURE_STYLES,
  HARD_HUMAN_REVIEW_KEYS,
  HANDOFF_TRIGGERS,
  buildDefaultToneConfig,
  buildDefaultMaterialsConfig,
  buildDefaultLogisticsConfig,
  buildDefaultPaymentPolicyConfig,
  buildDefaultInternalNotesConfig,
  buildDefaultAutonomyConfig,
  buildDefaultSafetyRules,
  buildDefaultEscalationConfig,
} = require("./clinicOpsProfileTypes");
const {
  VISIBILITY_TYPES,
  SECTION_HELP,
  FIELD_HELP_BY_ID,
} = require("./clinicOpsProfileFieldHelp");
const { isSupabaseEnabled } = require("./supabase");
const { CLINIC_LANGUAGE_PRESETS } = require("./clinicMultilingual");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getClinicId(req) {
  return String(req.clinicId || "").trim();
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerClinicOpsProfileAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;
  const router = express.Router();

  router.get("/clinic/ops-profile/meta", requireAdminAuth, (req, res) => {
    return res.json({
      ok: true,
      schemaVersion: OPS_PROFILE_SCHEMA_VERSION,
      sections: OPS_PROFILE_SECTIONS,
      autonomyLevels: AUTONOMY_LEVELS,
      autonomyCategories: AUTONOMY_CATEGORIES,
      autonomySafetyFloorKeys: AUTONOMY_SAFETY_FLOOR_KEYS,
      profileTags: PROFILE_TAGS,
      toneStyles: TONE_STYLES,
      signatureStyles: SIGNATURE_STYLES,
      languagePresets: CLINIC_LANGUAGE_PRESETS,
      pricingManagePath: "/admin-settings.html",
      hardHumanReviewKeys: HARD_HUMAN_REVIEW_KEYS,
      handoffTriggers: HANDOFF_TRIGGERS,
      defaults: {
        aiProfile: buildDefaultToneConfig(),
        materials: buildDefaultMaterialsConfig(),
        logistics: buildDefaultLogisticsConfig(),
        payment: buildDefaultPaymentPolicyConfig(),
        internalNotes: buildDefaultInternalNotesConfig(),
        autonomy: buildDefaultAutonomyConfig(),
        safetyRules: buildDefaultSafetyRules(),
        escalation: buildDefaultEscalationConfig(),
      },
      visibilityTypes: VISIBILITY_TYPES,
      sectionHelp: SECTION_HELP,
      fieldHelp: FIELD_HELP_BY_ID,
    });
  });

  router.get("/clinic/ops-profile", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) return res.status(400).json({ ok: false, error: "clinic_missing" });
      if (!isSupabaseEnabled()) return res.status(503).json({ ok: false, error: "supabase_required" });
      const profile = await getClinicOpsProfile(clinicId);
      if (!profile.ok) return res.status(400).json(profile);
      return res.json(profile);
    } catch (e) {
      console.error("[GET ops-profile]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/clinic/ops-profile/knowledge", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) return res.status(400).json({ ok: false, error: "clinic_missing" });
      const knowledge = await resolveClinicOpsKnowledge(clinicId);
      return res.json({ ok: true, knowledge });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/clinic/ops-profile/sections/:sectionId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const sectionId = String(req.params.sectionId || "").trim();
      if (!UUID_RE.test(clinicId)) return res.status(400).json({ ok: false, error: "clinic_missing" });
      const result = await patchClinicOpsSection(clinicId, sectionId, req.body || {});
      if (!result.ok) {
        const status = result.error === "unknown_section" ? 400 : 500;
        return res.status(status).json(result);
      }
      const profile = await getClinicOpsProfile(clinicId);
      return res.json({ ok: true, profile });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/clinic/ai-ops/meta", requireAdminAuth, (req, res) => {
    return res.json({
      ok: true,
      schemaVersion: OPS_PROFILE_SCHEMA_VERSION,
      autonomyLevels: AUTONOMY_LEVELS,
      autonomyCategories: AUTONOMY_CATEGORIES,
      autonomySafetyFloorKeys: AUTONOMY_SAFETY_FLOOR_KEYS,
      tonePersonalities: TONE_STYLES,
      signatureStyles: SIGNATURE_STYLES,
      weekendModes: [
        { value: "ai_only", label: "AI only" },
        { value: "reduced_sla", label: "Reduced SLA" },
        { value: "human_required", label: "Human required" },
      ],
      defaults: {
        autonomy: buildDefaultAutonomyConfig(),
        escalation: buildDefaultEscalationConfig(),
        tone: buildDefaultToneConfig(),
        knowledgeBase: buildDefaultMaterialsConfig(),
        communicationPolicy: buildDefaultPaymentPolicyConfig(),
        safetyRules: buildDefaultSafetyRules(),
      },
    });
  });

  /** Legacy aliases — ai-ops paths delegate to settings row. */
  router.get("/clinic/ai-ops/settings", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) return res.status(400).json({ ok: false, error: "clinic_missing" });
      const profile = await getClinicAiProfile(clinicId);
      return res.json({ ok: true, profile, meta: { clinicId, schemaVersion: OPS_PROFILE_SCHEMA_VERSION } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/clinic/ai-ops/settings", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) return res.status(400).json({ ok: false, error: "clinic_missing" });
      const body = req.body || {};
      const result = await upsertClinicAiSettings(clinicId, {
        tone: body.tone,
        materials: body.materials ?? body.knowledgeBase,
        logistics:
          body.logistics ??
          (body.escalation?.businessHours
            ? { workingHours: body.escalation.businessHours }
            : undefined),
        payment: body.payment ?? body.communicationPolicy,
        internalNotes: body.internalNotes,
        autonomy: body.autonomy,
        escalation: body.escalation,
        safetyRules: body.safetyRules,
        communicationPolicy: body.communicationPolicy,
        knowledgeBase: body.knowledgeBase,
      });
      if (!result.ok) return res.status(500).json(result);
      return res.json({ ok: true, profile: result.profile });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/admin", router);
}

module.exports = { registerClinicOpsProfileAdminRoutes };
