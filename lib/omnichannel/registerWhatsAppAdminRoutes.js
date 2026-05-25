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
  getActiveWhatsAppConnectionByPhoneNumberId,
} = require("./whatsappPhoneConnections");
const { sendWhatsAppMessage } = require("./whatsappGraph");
const { getClinicLabel } = require("./clinicLookup");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      return res.json({ ok: true, connections, scope: "clinic" });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "list_failed" });
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
        return res.json({ ok: true, ...result, embeddedSignup: true });
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
          .select("phone_number_id, clinic_id, status")
          .eq("id", String(req.body.connectionId || req.body.connection_id))
          .maybeSingle();
        if (data?.phone_number_id) {
          connection = await getActiveWhatsAppConnectionByPhoneNumberId(data.phone_number_id);
        }
      } else if (phoneNumberId) {
        connection = await getActiveWhatsAppConnectionByPhoneNumberId(phoneNumberId);
      }

      if (!connection?.phone_number_id) {
        return res.status(404).json({ ok: false, error: "connection_not_found" });
      }
      if (UUID_RE.test(clinicId) && String(connection.clinic_id) !== clinicId) {
        return res.status(403).json({ ok: false, error: "connection_not_in_clinic" });
      }
      if (!waId) {
        return res.status(400).json({ ok: false, error: "wa_id_required" });
      }

      const graph = await sendWhatsAppMessage(
        connection.phone_number_id,
        waId,
        text,
        connection.accessToken,
      );
      return res.json({
        ok: true,
        phoneNumberId: connection.phone_number_id,
        messageId: graph?.messages?.[0]?.id || null,
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e?.message || "test_send_failed",
        code: e?.code,
      });
    }
  });
}

module.exports = {
  registerWhatsAppAdminRoutes,
};
