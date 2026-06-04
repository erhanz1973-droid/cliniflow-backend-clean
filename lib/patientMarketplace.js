/**
 * Authenticated patient marketplace actions: save/follow clinics.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function registerPatientMarketplaceRoutes(app, { supabase, requireToken, normalizeDiscoveryClinic }) {
  app.get("/api/patient/saved-clinics", requireToken, async (req, res) => {
    try {
      const patientId = String(req.patientId || "").trim();
      if (!UUID_RE.test(patientId)) {
        return res.status(400).json({ ok: false, error: "invalid_patient" });
      }

      const { data: saved, error } = await supabase
        .from("patient_clinic_saved")
        .select("clinic_id, notify_updates, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        if (/patient_clinic_saved|does not exist/i.test(String(error.message || ""))) {
          return res.json({ ok: true, clinics: [], schemaPending: true });
        }
        throw error;
      }

      const ids = (saved || []).map((s) => String(s.clinic_id)).filter(Boolean);
      if (!ids.length) return res.json({ ok: true, clinics: [] });

      const { data: rows } = await supabase
        .from("clinics")
        .select(
          "id, name, clinic_code, city, country, logo_url, short_description, google_rating, google_review_count, trustpilot_rating, trustpilot_review_count, is_verified, languages, specialties, is_listed",
        )
        .in("id", ids)
        .eq("is_listed", true);

      const byId = new Map((rows || []).map((r) => [String(r.id), r]));
      const clinics = (saved || [])
        .map((s) => {
          const row = byId.get(String(s.clinic_id));
          if (!row) return null;
          return {
            ...normalizeDiscoveryClinic(row, { profile: false }),
            savedAt: s.created_at,
            notifyUpdates: s.notify_updates === true,
          };
        })
        .filter(Boolean);

      return res.json({ ok: true, clinics });
    } catch (e) {
      console.error("[GET /api/patient/saved-clinics]", e?.message || e);
      return res.status(500).json({ ok: false, error: "saved_clinics_failed" });
    }
  });

  app.post("/api/patient/saved-clinics/:clinicId", requireToken, async (req, res) => {
    try {
      const patientId = String(req.patientId || "").trim();
      const clinicId = String(req.params?.clinicId || "").trim();
      if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const notify = req.body?.notify === true || req.body?.notifyUpdates === true;

      const { error } = await supabase.from("patient_clinic_saved").upsert(
        {
          patient_id: patientId,
          clinic_id: clinicId,
          notify_updates: notify,
        },
        { onConflict: "patient_id,clinic_id" },
      );

      if (error) throw error;
      return res.json({ ok: true, saved: true, clinicId });
    } catch (e) {
      console.error("[POST /api/patient/saved-clinics/:id]", e?.message || e);
      return res.status(500).json({ ok: false, error: "save_clinic_failed" });
    }
  });

  app.delete("/api/patient/saved-clinics/:clinicId", requireToken, async (req, res) => {
    try {
      const patientId = String(req.patientId || "").trim();
      const clinicId = String(req.params?.clinicId || "").trim();
      if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const { error } = await supabase
        .from("patient_clinic_saved")
        .delete()
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId);

      if (error) throw error;
      return res.json({ ok: true, removed: true, clinicId });
    } catch (e) {
      console.error("[DELETE /api/patient/saved-clinics/:id]", e?.message || e);
      return res.status(500).json({ ok: false, error: "unsave_clinic_failed" });
    }
  });
}

module.exports = { registerPatientMarketplaceRoutes };
