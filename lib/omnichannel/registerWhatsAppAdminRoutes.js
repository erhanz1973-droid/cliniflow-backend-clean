/**
 * WhatsApp admin APIs + embedded signup hook (multi-clinic).
 */

const { whatsappIntegrationEnabled, whatsappHealthSnapshot } = require("./whatsappConfig");
const {
  listWhatsAppConnectionsForClinic,
  listAllActiveWhatsAppConnections,
  upsertWhatsAppPhoneConnection,
  reassignWhatsAppConnection,
  disconnectWhatsAppConnection,
  setWhatsAppConnectionEnabled,
  setWhatsAppConnectionAiMode,
  getActiveWhatsAppConnectionByPhoneNumberId,
  getWhatsAppConnectionByPhoneNumberId,
} = require("./whatsappPhoneConnections");
const { listOmnichannelConnectionAudit } = require("./omnichannelAudit");
const { isWhatsAppRoutingEnabled } = require("./whatsappRouting");
const { sendWhatsAppMessage } = require("./whatsappGraph");
const { getClinicLabel } = require("./clinicLookup");
const {
  enrichWhatsAppConnectionFromGraph,
  enrichConnectionForAdminList,
  recordWhatsAppTestSend,
  recordWhatsAppSendResult,
  previewWhatsAppConnectionForAdmin,
} = require("./whatsappConnectionOps");
const { getClinicAiProfile, upsertClinicAiSettings } = require("../clinicAiSettings");
const {
  buildClinicPolicySummary,
  aiModeFromUiPreset,
  UI_PRESET,
} = require("../aiDelegation");
const { AUTONOMY_CATEGORIES } = require("../clinicOpsProfileTypes");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function presetFromCeiling(ceilingMode) {
  const m = String(ceilingMode || "").toUpperCase();
  if (m === "HUMAN_ONLY") return UI_PRESET.OFF;
  if (m === "AI_ACTIVE") return UI_PRESET.ACTIVE;
  if (m === "AI_DRAFT") return "DRAFT";
  return UI_PRESET.ASSIST;
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerWhatsAppAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;

  app.get("/api/integrations/whatsapp/status", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const connections = UUID_RE.test(clinicId)
        ? await listWhatsAppConnectionsForClinic(clinicId)
        : [];
      const active = connections.filter((c) => String(c.status) === "active");
      return res.json({
        ok: true,
        enabled: whatsappIntegrationEnabled(),
        health: whatsappHealthSnapshot(),
        connections: active,
        routing: "database_first_env_fallback",
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "status_failed" });
    }
  });

  app.get("/api/integrations/whatsapp/connections", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const showAll = String(req.query?.all || "") === "1";
      if (showAll) {
        const all = await listAllActiveWhatsAppConnections();
        return res.json({ ok: true, connections: all, scope: "all_active" });
      }
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const connections = await listWhatsAppConnectionsForClinic(clinicId);
      const enriched = [];
      for (const row of connections) {
        enriched.push(await enrichConnectionForAdminList(row));
      }
      return res.json({ ok: true, connections: enriched, scope: "clinic" });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "list_failed" });
    }
  });

  app.post("/api/integrations/whatsapp/connections/preview", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const phoneNumberId = String(
        req.body?.phoneNumberId || req.body?.phone_number_id || "",
      ).trim();
      if (!phoneNumberId) {
        return res.status(400).json({ ok: false, error: "phone_number_id_required" });
      }
      const result = await previewWhatsAppConnectionForAdmin(phoneNumberId, {
        clinicId: UUID_RE.test(clinicId) ? clinicId : undefined,
        wabaId: req.body?.wabaId || req.body?.waba_id || null,
        accessToken: req.body?.accessToken || req.body?.access_token || null,
      });
      if (!result.ok) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "preview_failed" });
    }
  });

  app.post("/api/integrations/whatsapp/connections/connect", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const phoneNumberId = String(
        req.body?.phoneNumberId || req.body?.phone_number_id || "",
      ).trim();
      if (!phoneNumberId) {
        return res.status(400).json({ ok: false, error: "phone_number_id_required" });
      }
      const result = await upsertWhatsAppPhoneConnection({
        clinicId,
        phoneNumberId,
        phoneNumber: req.body?.phoneNumber || req.body?.phone_number || null,
        displayName: req.body?.displayName || req.body?.display_name || null,
        wabaId: req.body?.wabaId || req.body?.waba_id || null,
        accessToken: req.body?.accessToken || req.body?.access_token || null,
        connectedBy: req.clinicCode || req.adminEmail || "admin",
        metadata: { manualConnect: true },
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || "connect_failed" });
      }
      void enrichWhatsAppConnectionFromGraph(phoneNumberId, req.body?.accessToken || null);
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "connect_failed" });
    }
  });

  /**
   * Meta Embedded Signup callback — upsert connection row from signed-up assets.
   */
  app.post(
    "/api/integrations/whatsapp/connections/embedded-signup",
    requireAdminAuth,
    async (req, res) => {
      try {
        const clinicId = String(req.body?.clinicId || req.clinicId || "").trim();
        if (!UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "clinic_required" });
        }
        const phoneNumberId = String(
          req.body?.phoneNumberId || req.body?.phone_number_id || "",
        ).trim();
        if (!phoneNumberId) {
          return res.status(400).json({ ok: false, error: "phone_number_id_required" });
        }
        const result = await upsertWhatsAppPhoneConnection({
          clinicId,
          phoneNumberId,
          phoneNumber: req.body?.phoneNumber || req.body?.phone_number || null,
          displayName: req.body?.displayName || req.body?.display_name || null,
          wabaId: req.body?.wabaId || req.body?.waba_id || null,
          accessToken: req.body?.accessToken || req.body?.access_token || null,
          connectedBy: "embedded_signup",
          metadata: {
            embeddedSignup: true,
            signupPayload: req.body?.signupPayload || req.body?.signup_payload || null,
          },
        });
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error || "embedded_signup_failed" });
        }
        const graph = await enrichWhatsAppConnectionFromGraph(
          phoneNumberId,
          req.body?.accessToken || req.body?.access_token || null,
        );
        return res.json({
          ok: true,
          ...result,
          embeddedSignup: true,
          routingEnabled: true,
          graphEnriched: graph.ok === true,
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || "embedded_signup_failed" });
      }
    },
  );

  app.post("/api/integrations/whatsapp/connections/reassign", requireAdminAuth, async (req, res) => {
    try {
      const sessionClinicId = String(req.clinicId || "").trim();
      const connectionId = String(req.body?.connectionId || req.body?.connection_id || "").trim();
      const targetClinicId = String(
        req.body?.targetClinicId || req.body?.target_clinic_id || sessionClinicId,
      ).trim();
      if (!UUID_RE.test(targetClinicId) || !connectionId) {
        return res.status(400).json({ ok: false, error: "invalid_params" });
      }
      const result = await reassignWhatsAppConnection(
        connectionId,
        targetClinicId,
        req.clinicCode || "admin",
      );
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || "reassign_failed" });
      }
      const clinic = await getClinicLabel(targetClinicId);
      return res.json({ ok: true, ...result, clinicName: clinic.clinicName });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "reassign_failed" });
    }
  });

  app.post("/api/integrations/whatsapp/connections/set-enabled", requireAdminAuth, async (req, res) => {
    try {
      const connectionId = String(req.body?.connectionId || req.body?.connection_id || "").trim();
      const enabled =
        req.body?.enabled === true ||
        req.body?.is_enabled === true ||
        String(req.body?.enabled || "") === "1";
      if (!connectionId) {
        return res.status(400).json({ ok: false, error: "connection_id_required" });
      }
      const result = await setWhatsAppConnectionEnabled(
        connectionId,
        enabled,
        req.clinicCode || "admin",
      );
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || "set_enabled_failed" });
      }
      return res.json({ ok: true, is_enabled: result.is_enabled });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "set_enabled_failed" });
    }
  });

  app.patch("/api/integrations/whatsapp/connections/ai-mode", requireAdminAuth, async (req, res) => {
    try {
      const connectionId = String(req.body?.connectionId || req.body?.connection_id || "").trim();
      const aiMode = String(req.body?.aiMode || req.body?.ai_mode || "").trim();
      if (!connectionId || !aiMode) {
        return res.status(400).json({ ok: false, error: "invalid_params" });
      }
      const result = await setWhatsAppConnectionAiMode(
        connectionId,
        aiMode,
        req.clinicCode || "admin",
      );
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || "ai_mode_failed" });
      }
      return res.json({ ok: true, ai_mode: result.ai_mode });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "ai_mode_failed" });
    }
  });

  app.get("/api/integrations/whatsapp/connections/audit", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const connectionId = String(req.query?.connectionId || req.query?.connection_id || "").trim();
      const events = await listOmnichannelConnectionAudit({
        channel: "whatsapp",
        clinicId: connectionId ? undefined : clinicId,
        connectionId: connectionId || undefined,
        limit: Number(req.query?.limit) || 50,
      });
      return res.json({ ok: true, events });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "audit_failed" });
    }
  });

  app.get("/api/integrations/whatsapp/onboarding", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const connections = await listWhatsAppConnectionsForClinic(clinicId);
      const primary = connections[0] || null;
      const health = whatsappHealthSnapshot();
      const profile = await getClinicAiProfile(clinicId);
      const steps = {
        connect: connections.length > 0,
        verifyWebhook: Boolean(primary?.last_webhook_at),
        testMessage: Boolean(primary?.metadata?.lastTest?.at),
        configureAi: profile.isConfigured,
        goLive:
          primary &&
          isWhatsAppRoutingEnabled(primary) &&
          String(primary.ai_mode || "") === "AI_ACTIVE",
      };
      return res.json({
        ok: true,
        steps,
        expectedWebhookUrl: health.expectedCallbackUrl || null,
        embeddedSignupAvailable: false,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "onboarding_failed" });
    }
  });

  app.post("/api/integrations/whatsapp/connections/disconnect", requireAdminAuth, async (req, res) => {
    try {
      const connectionId = String(req.body?.connectionId || req.body?.connection_id || "").trim();
      if (!connectionId) {
        return res.status(400).json({ ok: false, error: "connection_id_required" });
      }
      const result = await disconnectWhatsAppConnection(connectionId, req.clinicCode || "admin");
      return res.json({ ok: result.ok, error: result.error || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "disconnect_failed" });
    }
  });

  app.post(
    "/api/integrations/whatsapp/connections/refresh-metadata",
    requireAdminAuth,
    async (req, res) => {
      try {
        const connectionId = String(req.body?.connectionId || req.body?.connection_id || "").trim();
        const phoneNumberId = String(
          req.body?.phoneNumberId || req.body?.phone_number_id || "",
        ).trim();
        const { supabase } = require("../supabase");
        let pid = phoneNumberId;
        if (connectionId) {
          const { data } = await supabase
            .from("whatsapp_phone_connections")
            .select("phone_number_id, clinic_id")
            .eq("id", connectionId)
            .maybeSingle();
          pid = data?.phone_number_id || pid;
        }
        if (!pid) {
          return res.status(400).json({ ok: false, error: "phone_number_id_required" });
        }
        const graph = await enrichWhatsAppConnectionFromGraph(pid);
        const row = await enrichConnectionForAdminList(
          (await supabase
            .from("whatsapp_phone_connections")
            .select("*")
            .eq("phone_number_id", pid)
            .maybeSingle()).data || { phone_number_id: pid },
        );
        return res.json({ ok: true, graph, connection: row });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || "refresh_failed" });
      }
    },
  );

  app.get("/api/integrations/whatsapp/clinic-ai-controls", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const profile = await getClinicAiProfile(clinicId);
      const policy = buildClinicPolicySummary(profile);
      const comm =
        profile.communicationPolicy && typeof profile.communicationPolicy === "object"
          ? profile.communicationPolicy
          : {};
      const omni =
        comm.omnichannel && typeof comm.omnichannel === "object" ? comm.omnichannel : {};
      return res.json({
        ok: true,
        clinicPolicy: policy,
        controls: {
          preset: omni.preset || presetFromCeiling(policy.ceilingMode),
          autoReplyEnabled: omni.autoReplyEnabled !== false,
          escalationMode: omni.escalationMode || "standard",
          humanOnly: policy.ceilingMode === "HUMAN_ONLY",
          aiDraftSuggestions: policy.ceilingMode === "AI_DRAFT",
          aiActive: policy.ceilingMode === "AI_ACTIVE",
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "controls_get_failed" });
    }
  });

  app.patch("/api/integrations/whatsapp/clinic-ai-controls", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_required" });
      }
      const preset = String(req.body?.preset || req.body?.uiPreset || "").trim().toUpperCase();
      const autoReplyEnabled = req.body?.autoReplyEnabled;
      const escalationMode = req.body?.escalationMode;

      const profile = await getClinicAiProfile(clinicId);
      const categories = { ...(profile.autonomy?.categories || {}) };

      if (preset === UI_PRESET.OFF || req.body?.humanOnly === true) {
        for (const c of AUTONOMY_CATEGORIES) {
          categories[c.key] = "OFF";
        }
      } else if (preset === UI_PRESET.ACTIVE || req.body?.aiActive === true) {
        for (const c of AUTONOMY_CATEGORIES) {
          categories[c.key] = c.defaultLevel === "AUTO_REPLY" ? "AUTO_REPLY" : "SUGGEST_ONLY";
        }
      } else if (req.body?.aiDraftSuggestions === true || preset === "DRAFT") {
        for (const c of AUTONOMY_CATEGORIES) {
          categories[c.key] = "SUGGEST_ONLY";
        }
      } else if (preset) {
        const mode = aiModeFromUiPreset(preset);
        const level =
          mode === "AI_ACTIVE" ? "AUTO_REPLY" : mode === "AI_DRAFT" ? "SUGGEST_ONLY" : "OFF";
        for (const c of AUTONOMY_CATEGORIES) {
          categories[c.key] = level;
        }
      }

      const comm = profile.communicationPolicy || {};
      const omni = {
        ...(comm.omnichannel || {}),
        preset: preset || comm.omnichannel?.preset || "ASSIST",
        autoReplyEnabled:
          autoReplyEnabled !== undefined ? autoReplyEnabled === true : comm.omnichannel?.autoReplyEnabled !== false,
        escalationMode: escalationMode || comm.omnichannel?.escalationMode || "standard",
        updatedAt: new Date().toISOString(),
      };

      const escalation =
        escalationMode === "aggressive"
          ? {
              ...profile.escalation,
              coordinatorEscalationAfterMinutes: Math.min(
                Number(profile.escalation?.coordinatorEscalationAfterMinutes) || 30,
                15,
              ),
            }
          : profile.escalation;

      const saved = await upsertClinicAiSettings(clinicId, {
        autonomy: { categories },
        communicationPolicy: { ...comm, omnichannel: omni },
        escalation,
      });

      if (!saved.ok) {
        return res.status(400).json({ ok: false, error: saved.error || "save_failed" });
      }

      const policy = buildClinicPolicySummary(saved.profile);
      return res.json({ ok: true, clinicPolicy: policy, profile: saved.profile });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "controls_patch_failed" });
    }
  });

  app.post("/api/integrations/whatsapp/test-send", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const waId = String(req.body?.waId || req.body?.wa_id || req.body?.to || "").trim();
      const text = String(req.body?.text || req.body?.message || "Clinifly WhatsApp test").trim();
      const phoneNumberId = String(
        req.body?.phoneNumberId ||
          req.body?.phone_number_id ||
          "",
      ).trim();

      let connection = null;
      if (req.body?.connectionId || req.body?.connection_id) {
        const { supabase } = require("../supabase");
        const { data } = await supabase
          .from("whatsapp_phone_connections")
          .select("phone_number_id, clinic_id, status, is_enabled")
          .eq("id", String(req.body.connectionId || req.body.connection_id))
          .maybeSingle();
        if (data?.phone_number_id) {
          connection = await getWhatsAppConnectionByPhoneNumberId(data.phone_number_id);
        }
      } else if (phoneNumberId) {
        connection = await getWhatsAppConnectionByPhoneNumberId(phoneNumberId);
      }

      if (!connection?.phone_number_id) {
        return res.status(404).json({ ok: false, error: "connection_not_found" });
      }
      if (UUID_RE.test(clinicId) && String(connection.clinic_id) !== clinicId) {
        return res.status(403).json({ ok: false, error: "connection_not_in_clinic" });
      }
      if (!isWhatsAppRoutingEnabled(connection)) {
        return res.status(400).json({
          ok: false,
          error: "whatsapp_paused",
          message: "Turn WhatsApp ON before sending test messages.",
        });
      }
      if (!waId) {
        return res.status(400).json({ ok: false, error: "wa_id_required" });
      }

      const { assertWhatsAppTokenCanSend, formatWhatsAppGraphErrorForAdmin } = require("./whatsappGraphErrors");
      const token = String(connection.accessToken || "").trim();
      const preflight = await assertWhatsAppTokenCanSend(token);
      if (!preflight.ok) {
        const fmt = preflight.formatted;
        return res.status(400).json({
          ok: false,
          error: preflight.error,
          message: fmt.short,
          detail: fmt.detail,
          steps: fmt.steps,
          code: fmt.code,
          deliveryStatus: "failed",
          hint: fmt.steps?.length ? fmt.steps.join(" · ") : fmt.detail,
          diagnosticsPath: "/api/integrations/meta/whatsapp/diagnostics",
          tokenScopes: preflight.tokenDebug?.scopes || null,
        });
      }

      const started = Date.now();
      let graph;
      try {
        graph = await sendWhatsAppMessage(connection.phone_number_id, waId, text, token);
      } catch (e) {
        const fmt = formatWhatsAppGraphErrorForAdmin(e);
        void recordWhatsAppSendResult(connection.phone_number_id, {
          ok: false,
          error: e?.message || String(e),
        });
        return res.status(400).json({
          ok: false,
          error: e?.message || "send_failed",
          message: fmt.short,
          detail: fmt.detail,
          steps: fmt.steps,
          code: e?.code ?? fmt.code,
          deliveryStatus: "failed",
          latencyMs: Date.now() - started,
          hint: fmt.steps?.length ? fmt.steps.join(" · ") : fmt.detail,
          diagnosticsPath: "/api/integrations/meta/whatsapp/diagnostics",
        });
      }

      const messageId = graph?.messages?.[0]?.id || null;
      const latencyMs = Date.now() - started;
      void recordWhatsAppSendResult(connection.phone_number_id, { ok: true, messageId });
      const testPayload = {
        ok: true,
        messageId,
        waId,
        deliveryStatus: "sent",
        latencyMs,
        sentAt: new Date().toISOString(),
      };
      void recordWhatsAppTestSend(connection.phone_number_id, testPayload);

      return res.json({
        ok: true,
        phoneNumberId: connection.phone_number_id,
        messageId,
        deliveryStatus: "sent",
        latencyMs,
        hint: "Delivery updates when Meta sends a status webhook (delivered/read).",
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e?.message || "test_send_failed",
        code: e?.code,
        deliveryStatus: "failed",
      });
    }
  });
}

module.exports = {
  registerWhatsAppAdminRoutes,
};
