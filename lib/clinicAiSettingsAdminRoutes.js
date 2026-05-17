/**
 * Admin API — Clinic Operations AI Profile (autonomy, SLA, knowledge, safety).
 */

const express = require("express");
const {
  getClinicAiProfile,
  upsertClinicAiSettings,
  resolveClinicAiOpsContext,
} = require("./clinicAiSettings");
const {
  AUTONOMY_LEVELS,
  AUTONOMY_CATEGORIES,
  AUTONOMY_SAFETY_FLOOR_KEYS,
  TONE_PERSONALITIES,
  SIGNATURE_STYLES,
  WEEKEND_MODES,
  buildDefaultClinicAiProfile,
} = require("./clinicAiSettingsTypes");
const { isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getClinicId(req) {
  return String(req.clinicId || "").trim();
}

/**
 * Accept camelCase API body; map to service patch keys.
 * @param {Record<string, unknown>} body
 */
function bodyToPatch(body) {
  return {
    autonomy: body.autonomy,
    escalation: body.escalation,
    tone: body.tone,
    knowledgeBase: body.knowledgeBase ?? body.knowledge_base,
    communicationPolicy: body.communicationPolicy ?? body.communication_policy,
    safetyRules: body.safetyRules ?? body.safety_rules,
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerClinicAiSettingsAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;
  const router = express.Router();

  router.get("/clinic/ai-ops/meta", requireAdminAuth, (req, res) => {
    const defaults = buildDefaultClinicAiProfile();
    return res.json({
      ok: true,
      schemaVersion: 1,
      autonomyLevels: AUTONOMY_LEVELS,
      autonomyCategories: AUTONOMY_CATEGORIES,
      autonomySafetyFloorKeys: AUTONOMY_SAFETY_FLOOR_KEYS,
      tonePersonalities: TONE_PERSONALITIES,
      signatureStyles: SIGNATURE_STYLES,
      weekendModes: WEEKEND_MODES,
      defaults: {
        autonomy: defaults.autonomy,
        escalation: defaults.escalation,
        tone: defaults.tone,
        knowledgeBase: defaults.knowledgeBase,
        communicationPolicy: defaults.communicationPolicy,
        safetyRules: defaults.safetyRules,
      },
    });
  });

  router.get("/clinic/ai-ops/settings", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }
      const profile = await getClinicAiProfile(clinicId);
      return res.json({ ok: true, profile, meta: { clinicId, schemaVersion: 1 } });
    } catch (e) {
      console.error("[GET ai-ops/settings]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/clinic/ai-ops/context", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }
      const context = await resolveClinicAiOpsContext(clinicId);
      return res.json({ ok: true, context });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/clinic/ai-ops/settings", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      const patch = bodyToPatch(req.body || {});
      const hasPayload = Object.values(patch).some((v) => v !== undefined);
      if (!hasPayload) {
        return res.status(400).json({ ok: false, error: "empty_patch" });
      }
      const result = await upsertClinicAiSettings(clinicId, patch);
      if (!result.ok) {
        const status = result.error === "supabase_required" ? 503 : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }
      return res.json({ ok: true, profile: result.profile });
    } catch (e) {
      console.error("[PATCH ai-ops/settings]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.put("/clinic/ai-ops/settings", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      const body = req.body || {};
      const patch = {
        autonomy: body.autonomy,
        escalation: body.escalation,
        tone: body.tone,
        knowledgeBase: body.knowledgeBase ?? body.knowledge_base,
        communicationPolicy: body.communicationPolicy ?? body.communication_policy,
        safetyRules: body.safetyRules ?? body.safety_rules,
      };
      const result = await upsertClinicAiSettings(clinicId, patch);
      if (!result.ok) {
        const status = result.error === "supabase_required" ? 503 : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }
      return res.json({ ok: true, profile: result.profile });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/admin", router);
}

module.exports = { registerClinicAiSettingsAdminRoutes };
