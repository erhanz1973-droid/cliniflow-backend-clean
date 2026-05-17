/**
 * Admin API — clinic treatment journey protocols.
 */

const express = require("express");
const {
  listProtocolsByClinic,
  getProtocolById,
  createProtocol,
  updateProtocol,
  deleteProtocol,
  reorderProtocols,
} = require("./clinicTreatmentProtocols");
const { isSupabaseEnabled } = require("./supabase");
const { FUTURE_JOURNEY_FEATURES, SUGGESTED_TREATMENT_TYPES } = require("./clinicJourneyTypes");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getClinicId(req) {
  return String(req.clinicId || "").trim();
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerClinicJourneyAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;
  const router = express.Router();

  router.get("/clinic/journeys/meta", requireAdminAuth, (req, res) => {
    return res.json({
      ok: true,
      suggestedTreatmentTypes: SUGGESTED_TREATMENT_TYPES,
      futureFeatures: FUTURE_JOURNEY_FEATURES,
    });
  });

  router.get("/clinic/journeys/protocols", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }
      const protocols = await listProtocolsByClinic(clinicId, { activeOnly: false });
      return res.json({ ok: true, protocols, meta: { count: protocols.length, clinicId } });
    } catch (e) {
      console.error("[GET journeys/protocols]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/clinic/journeys/protocols/:protocolId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const protocolId = String(req.params.protocolId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(protocolId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const protocol = await getProtocolById(clinicId, protocolId);
      if (!protocol) return res.status(404).json({ ok: false, error: "not_found" });
      return res.json({ ok: true, protocol });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/clinic/journeys/protocols", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      const result = await createProtocol(clinicId, req.body || {});
      if (!result.ok) {
        const status =
          result.error === "treatment_type_required"
            ? 400
            : result.error === "duplicate_treatment_type"
              ? 409
              : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }
      return res.status(201).json({ ok: true, protocol: result.protocol });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/clinic/journeys/protocols/reorder", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      const items = req.body?.items || req.body?.protocols || [];
      const result = await reorderProtocols(clinicId, items);
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      const protocols = await listProtocolsByClinic(clinicId, { activeOnly: false });
      return res.json({ ok: true, protocols });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/clinic/journeys/protocols/:protocolId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const protocolId = String(req.params.protocolId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(protocolId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const result = await updateProtocol(clinicId, protocolId, req.body || {});
      if (!result.ok) {
        const status =
          result.error === "not_found"
            ? 404
            : result.error === "treatment_type_required"
              ? 400
              : result.error === "duplicate_treatment_type"
                ? 409
                : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }
      return res.json({ ok: true, protocol: result.protocol });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.delete("/clinic/journeys/protocols/:protocolId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const protocolId = String(req.params.protocolId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(protocolId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const result = await deleteProtocol(clinicId, protocolId);
      if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error, message: result.message });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/admin", router);
}

module.exports = { registerClinicJourneyAdminRoutes };
