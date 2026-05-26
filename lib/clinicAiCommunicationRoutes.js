/**
 * Admin API — AI Communication (instant vs human-fallback orchestration).
 */

const { getClinicAiProfile, upsertClinicAiSettings } = require("./clinicAiSettings");
const { buildClinicPolicySummary } = require("./aiDelegation");
const {
  normalizeAiRepliesConfig,
  withFallbackDerivedFields,
  REPLY_MODE,
  FALLBACK_DELAY_MIN_SEC,
  FALLBACK_DELAY_MAX_SEC,
} = require("./aiReplyOrchestration");
const { normalizeAiBookingConfig, BOOKING_MODES } = require("./aiAppointmentBooking");

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
      const aiReplies = withFallbackDerivedFields(normalizeAiRepliesConfig(profile.communicationPolicy));
      const aiBooking = normalizeAiBookingConfig(profile.communicationPolicy);
      return res.json({
        ok: true,
        clinicPolicy: policy,
        aiReplies,
        aiBooking,
        envDefaults: {
          omnichannelInstantDelayMs: parseInt(process.env.AI_OMNICHANNEL_INSTANT_DELAY_MS || "200", 10),
          fallbackDelaySeconds: parseInt(process.env.AI_DOCTOR_SILENCE_FALLBACK_SECONDS || "30", 10),
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
      const prevBooking = normalizeAiBookingConfig(comm);

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
        fallbackDelaySeconds: (() => {
          if (req.body?.fallbackDelaySeconds != null) {
            const n = Math.round(Number(req.body.fallbackDelaySeconds));
            return Math.min(FALLBACK_DELAY_MAX_SEC, Math.max(FALLBACK_DELAY_MIN_SEC, n));
          }
          if (req.body?.fallbackDelayMinutes != null) {
            const n = Math.round(Number(req.body.fallbackDelayMinutes) * 60);
            return Math.min(FALLBACK_DELAY_MAX_SEC, Math.max(FALLBACK_DELAY_MIN_SEC, n));
          }
          return prev.fallbackDelaySeconds;
        })(),
        officeHoursOnlyInstant:
          req.body?.officeHoursOnlyInstant !== undefined
            ? req.body.officeHoursOnlyInstant === true
            : prev.officeHoursOnlyInstant,
        updatedAt: new Date().toISOString(),
      };

      let bookingMode = prevBooking.mode;
      if (req.body?.aiBookingMode) {
        const m = String(req.body.aiBookingMode).trim().toLowerCase();
        if (Object.values(BOOKING_MODES).includes(m)) bookingMode = m;
      }

      const aiBooking = {
        ...prevBooking,
        enabled: req.body?.aiBookingEnabled !== undefined ? req.body.aiBookingEnabled === true : prevBooking.enabled,
        mode: bookingMode,
        contactRequired:
          req.body?.aiBookingContactRequired !== undefined
            ? req.body.aiBookingContactRequired === true
            : prevBooking.contactRequired,
        updatedAt: new Date().toISOString(),
      };

      const saved = await upsertClinicAiSettings(clinicId, {
        communicationPolicy: {
          ...comm,
          aiReplies,
          aiBooking,
          canAutoBookAppointments: bookingMode === BOOKING_MODES.FULL_AUTO,
        },
      });
      if (!saved.ok) {
        return res.status(400).json({ ok: false, error: saved.error || "save_failed" });
      }

      let whatsappAiSync = { updated: 0 };
      if (replyMode !== REPLY_MODE.HUMAN_ONLY && aiReplies.instantEnabled !== false) {
        const {
          syncWhatsAppConnectionsForInstantClinicAi,
        } = require("./omnichannel/whatsappPhoneConnections");
        whatsappAiSync = await syncWhatsAppConnectionsForInstantClinicAi(
          clinicId,
          "admin_ai_communication_save",
        );
      }

      return res.json({
        ok: true,
        aiReplies: withFallbackDerivedFields(normalizeAiRepliesConfig(saved.profile?.communicationPolicy)),
        aiBooking: normalizeAiBookingConfig(saved.profile?.communicationPolicy),
        whatsappConnectionsPromotedToAiActive: whatsappAiSync.updated || 0,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "patch_failed" });
    }
  });
}

module.exports = { registerClinicAiCommunicationRoutes };
