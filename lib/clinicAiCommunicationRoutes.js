/**
 * Admin API — AI Communication (instant vs human-fallback orchestration).
 */

const { getClinicAiProfile, upsertClinicAiSettings } = require("./clinicAiSettings");
const { buildClinicPolicySummary } = require("./aiDelegation");
const { normalizeAiRepliesConfig, REPLY_MODE } = require("./aiReplyOrchestration");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerClinicAiCommunicationRoutes(app, deps) {
  const { requireAdminAuth } = deps;

  app.get("/api/admin/clinic/ai-communication", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const profile = await getClinicAiProfile(clinicId);
      const policy = buildClinicPolicySummary(profile);
      const aiReplies = normalizeAiRepliesConfig(profile.communicationPolicy);
      return res.json({
        ok: true,
        clinicPolicy: policy,
        aiReplies,
        envDefaults: {
          omnichannelInstantDelayMs: parseInt(process.env.AI_OMNICHANNEL_INSTANT_DELAY_MS || "200", 10),
          fallbackDelayMinutes: parseFloat(process.env.AI_DOCTOR_SILENCE_FALLBACK_MINUTES || "5"),
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "get_failed" });
    }
  });

  app.patch("/api/admin/clinic/ai-communication", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const profile = await getClinicAiProfile(clinicId);
      const comm =
        profile.communicationPolicy && typeof profile.communicationPolicy === "object"
          ? { ...profile.communicationPolicy }
          : {};
      const prev = normalizeAiRepliesConfig(comm);

      let replyMode = prev.replyMode;
      if (req.body?.replyMode) {
        replyMode = String(req.body.replyMode).trim().toLowerCase();
      } else if (req.body?.instantAiReplies === true) {
        replyMode = REPLY_MODE.INSTANT;
      } else if (req.body?.waitForHumanBeforeAi === true) {
        replyMode = REPLY_MODE.WAIT_HUMAN;
      } else if (req.body?.humanOnlyMode === true) {
        replyMode = REPLY_MODE.HUMAN_ONLY;
      }

      const aiReplies = {
        ...prev,
        replyMode,
        instantEnabled:
          req.body?.instantEnabled !== undefined
            ? req.body.instantEnabled === true
            : replyMode === REPLY_MODE.INSTANT,
        humanFallbackEnabled:
          req.body?.humanFallbackEnabled !== undefined
            ? req.body.humanFallbackEnabled === true
            : prev.humanFallbackEnabled,
        instantDelayMs:
          req.body?.instantDelayMs != null
            ? Math.max(0, Number(req.body.instantDelayMs))
            : prev.instantDelayMs,
        omnichannelInstantDelayMs:
          req.body?.omnichannelInstantDelayMs != null
            ? Math.max(0, Number(req.body.omnichannelInstantDelayMs))
            : prev.omnichannelInstantDelayMs,
        fallbackDelayMinutes:
          req.body?.fallbackDelayMinutes != null
            ? Math.max(1, Number(req.body.fallbackDelayMinutes))
            : prev.fallbackDelayMinutes,
        officeHoursOnlyInstant:
          req.body?.officeHoursOnlyInstant !== undefined
            ? req.body.officeHoursOnlyInstant === true
            : prev.officeHoursOnlyInstant,
        updatedAt: new Date().toISOString(),
      };

      const saved = await upsertClinicAiSettings(clinicId, {
        communicationPolicy: { ...comm, aiReplies },
      });
      if (!saved.ok) {
        return res.status(400).json({ ok: false, error: saved.error || "save_failed" });
      }

      return res.json({
        ok: true,
        aiReplies: normalizeAiRepliesConfig(saved.profile?.communicationPolicy),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "patch_failed" });
    }
  });
}

module.exports = { registerClinicAiCommunicationRoutes };
