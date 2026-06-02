/**
 * Super Admin — complete pending WhatsApp onboarding (Meta setup).
 */

const {
  listPendingWhatsAppConnections,
  activatePendingWhatsAppConnection,
} = require("./whatsappPhoneConnections");
const {
  previewWhatsAppConnectionForAdmin,
  enrichWhatsAppConnectionFromGraph,
} = require("./whatsappConnectionOps");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('express').Express} app
 * @param {{ superAdminGuard: Function }} deps
 */
function registerWhatsAppSuperAdminRoutes(app, deps) {
  const { superAdminGuard } = deps;
  if (!app || !superAdminGuard) return;

  app.get("/api/super-admin/whatsapp/pending", superAdminGuard, async (_req, res) => {
    try {
      const pending = await listPendingWhatsAppConnections();
      return res.json({ ok: true, pending, count: pending.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "list_pending_failed" });
    }
  });

  app.post(
    "/api/super-admin/whatsapp/pending/:connectionId/preview",
    superAdminGuard,
    async (req, res) => {
      try {
        const phoneNumberId = String(
          req.body?.phoneNumberId || req.body?.phone_number_id || "",
        ).trim();
        if (!phoneNumberId) {
          return res.status(400).json({ ok: false, error: "phone_number_id_required" });
        }
        const result = await previewWhatsAppConnectionForAdmin(phoneNumberId, {
          accessToken: req.body?.accessToken || req.body?.access_token || null,
          wabaId: req.body?.wabaId || req.body?.waba_id || null,
        });
        if (!result.ok) return res.status(400).json(result);
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || "preview_failed" });
      }
    },
  );

  app.post(
    "/api/super-admin/whatsapp/pending/:connectionId/activate",
    superAdminGuard,
    async (req, res) => {
      try {
        const connectionId = String(req.params?.connectionId || "").trim();
        if (!UUID_RE.test(connectionId)) {
          return res.status(400).json({ ok: false, error: "invalid_connection_id" });
        }
        const phoneNumberId = String(
          req.body?.phoneNumberId || req.body?.phone_number_id || "",
        ).trim();
        if (!phoneNumberId) {
          return res.status(400).json({ ok: false, error: "phone_number_id_required" });
        }

        const preview = await previewWhatsAppConnectionForAdmin(phoneNumberId, {
          accessToken: req.body?.accessToken || req.body?.access_token || null,
          wabaId: req.body?.wabaId || req.body?.waba_id || null,
        });
        if (!preview.ok) {
          return res.status(400).json({
            ok: false,
            error: "graph_validation_failed",
            message: preview.message || preview.error,
            ...preview,
          });
        }

        const p = preview.preview || {};
        const result = await activatePendingWhatsAppConnection({
          connectionId,
          phoneNumberId,
          phoneNumber:
            req.body?.phoneNumber ||
            req.body?.phone_number ||
            p.phoneNumber ||
            null,
          displayName: req.body?.displayName || p.displayName || null,
          wabaId: req.body?.wabaId || req.body?.waba_id || p.wabaId || null,
          accessToken: req.body?.accessToken || req.body?.access_token || null,
          actor: "super_admin",
        });

        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error || "activate_failed" });
        }

        void enrichWhatsAppConnectionFromGraph(
          phoneNumberId,
          req.body?.accessToken || req.body?.access_token || null,
        );

        return res.json({
          ok: true,
          connection: result.connection,
          preview: p,
          message:
            "WhatsApp activated for this clinic. The clinic can turn routing ON after webhook verification.",
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || "activate_failed" });
      }
    },
  );
}

module.exports = { registerWhatsAppSuperAdminRoutes };
