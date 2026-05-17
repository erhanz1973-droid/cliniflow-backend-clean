/**
 * Admin API — clinic travel & accommodation (partner hotels).
 */

const express = require("express");
const {
  listHotelsByClinic,
  getHotelById,
  createHotel,
  updateHotel,
  deleteHotel,
} = require("./clinicPartnerHotels");
const { isSupabaseEnabled } = require("./supabase");
const { FUTURE_TRAVEL_PARTNER_CATEGORIES } = require("./clinicTravelTypes");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('express').Request} req
 */
function getClinicId(req) {
  return String(req.clinicId || "").trim();
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerClinicTravelAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;
  const router = express.Router();

  router.get("/clinic/travel/meta", requireAdminAuth, (req, res) => {
    return res.json({
      ok: true,
      implemented: ["hotels"],
      futureCategories: FUTURE_TRAVEL_PARTNER_CATEGORIES,
    });
  });

  router.get("/clinic/travel/hotels", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const hotels = await listHotelsByClinic(clinicId, { activeOnly: false });
      return res.json({ ok: true, hotels, meta: { count: hotels.length, clinicId } });
    } catch (e) {
      console.error("[GET travel/hotels]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/clinic/travel/hotels/:hotelId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const hotelId = String(req.params.hotelId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(hotelId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const hotel = await getHotelById(clinicId, hotelId);
      if (!hotel) return res.status(404).json({ ok: false, error: "not_found" });
      return res.json({ ok: true, hotel });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/clinic/travel/hotels", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      const result = await createHotel(clinicId, req.body || {});
      if (!result.ok) {
        const status = result.error === "name_required" ? 400 : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }
      return res.status(201).json({ ok: true, hotel: result.hotel });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/clinic/travel/hotels/:hotelId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const hotelId = String(req.params.hotelId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(hotelId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const result = await updateHotel(clinicId, hotelId, req.body || {});
      if (!result.ok) {
        const status =
          result.error === "not_found" ? 404 : result.error === "name_required" ? 400 : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }
      return res.json({ ok: true, hotel: result.hotel });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.delete("/clinic/travel/hotels/:hotelId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const hotelId = String(req.params.hotelId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(hotelId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const result = await deleteHotel(clinicId, hotelId);
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

module.exports = { registerClinicTravelAdminRoutes };
