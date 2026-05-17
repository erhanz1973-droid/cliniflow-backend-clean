/**
 * Admin API — proposal queue and quote workflow actions.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  listProposalQueueForClinic,
  setProposalStatus,
  generateProposalDraftForRequest,
  PROPOSAL_STATUS,
  enrichRequestProposalFields,
} = require("./treatmentProposalWorkflow");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_STATUSES = new Set(Object.values(PROPOSAL_STATUS));

/**
 * @param {import('express').Application} app
 * @param {{ requireAdminAuth: import('express').RequestHandler }} deps
 */
function registerTreatmentProposalAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;

  app.get("/api/admin/proposal-queue", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_id_required" });
      }
      if (!isSupabaseEnabled()) {
        return res.json({ ok: true, items: [] });
      }
      const items = await listProposalQueueForClinic(clinicId, { limit: 100 });
      return res.json({ ok: true, items, count: items.length });
    } catch (e) {
      console.error("[admin proposal-queue]", e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.get(
    "/api/admin/treatment-requests/:requestId/proposal-draft",
    requireAdminAuth,
    async (req, res) => {
      try {
        const requestId = String(req.params.requestId || "").trim();
        const clinicId = String(req.clinicId || "").trim();
        if (!UUID_RE.test(requestId) || !UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_id" });
        }
        const { data: row, error } = await supabase
          .from("treatment_requests")
          .select(
            "id, clinic_id, proposal_status, proposal_draft, proposal_waiting_since, preferred_treatment, budget",
          )
          .eq("id", requestId)
          .eq("clinic_id", clinicId)
          .maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: "db_error" });
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });

        const enriched = enrichRequestProposalFields(row, { offerCount: 0 });
        return res.json({
          ok: true,
          requestId,
          proposalStatus: enriched.proposal_status,
          draft: row.proposal_draft || null,
          coordinatorQueueTitle: enriched.coordinator_queue_title,
        });
      } catch (e) {
        console.error("[admin proposal-draft GET]", e);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  app.post(
    "/api/admin/treatment-requests/:requestId/generate-proposal-draft",
    requireAdminAuth,
    async (req, res) => {
      try {
        const requestId = String(req.params.requestId || "").trim();
        const clinicId = String(req.clinicId || "").trim();
        if (!UUID_RE.test(requestId) || !UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_id" });
        }
        const { data: row } = await supabase
          .from("treatment_requests")
          .select("id")
          .eq("id", requestId)
          .eq("clinic_id", clinicId)
          .maybeSingle();
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });

        const draft = await generateProposalDraftForRequest(requestId);
        return res.json({ ok: true, draft });
      } catch (e) {
        console.error("[admin generate-proposal-draft]", e);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  app.patch(
    "/api/admin/treatment-requests/:requestId/proposal-status",
    requireAdminAuth,
    async (req, res) => {
      try {
        const requestId = String(req.params.requestId || "").trim();
        const clinicId = String(req.clinicId || "").trim();
        const status = String(req.body?.proposal_status || req.body?.status || "").trim();
        if (!UUID_RE.test(requestId) || !UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_id" });
        }
        if (!ALLOWED_STATUSES.has(status)) {
          return res.status(400).json({ ok: false, error: "invalid_proposal_status" });
        }
        const { data: row } = await supabase
          .from("treatment_requests")
          .select("id")
          .eq("id", requestId)
          .eq("clinic_id", clinicId)
          .maybeSingle();
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });

        const normalized = await setProposalStatus(requestId, status);
        return res.json({ ok: true, proposal_status: normalized });
      } catch (e) {
        console.error("[admin proposal-status PATCH]", e);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );
}

module.exports = { registerTreatmentProposalAdminRoutes };
