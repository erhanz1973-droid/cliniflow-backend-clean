/**
 * Admin API — AI learning candidates (approve / reject).
 */

const express = require("express");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { applyApprovedCandidateToKnowledge } = require("./aiLearningKnowledge");
const { writeLearningAuditLog } = require("./aiLearningSystem");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('express').Request} req
 */
function getClinicId(req) {
  return String(req.clinicId || req.query?.clinicId || "").trim();
}

/**
 * @param {import('express').Request} req
 */
function getAdminId(req) {
  const id = req.admin?.adminId || req.admin?.userId || req.user?.adminId || req.user?.userId;
  return id && UUID_RE.test(String(id)) ? String(id) : null;
}

/**
 * @param {Record<string, unknown>} row
 */
function mapCandidateRow(row) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    type: row.candidate_type,
    value: row.value,
    meaning: row.meaning,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    count: Number(row.occurrence_count) || 1,
    status: row.status,
    sourceProfileId: row.source_profile_id,
    sourceChannel: row.source_channel,
    evidence: row.evidence || {},
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    rejectionReason: row.rejection_reason,
  };
}

/**
 * @param {import('express').Application} app
 * @param {{ requireAdminAuth: import('express').RequestHandler }} deps
 */
function registerAiLearningAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;
  const router = express.Router();

  router.get("/learning/candidates", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.json({ ok: true, candidates: [], audit: [] });
      }

      const status = String(req.query?.status || "pending").trim().toLowerCase();
      const type = String(req.query?.type || "").trim();
      const limit = Math.min(Math.max(parseInt(String(req.query?.limit || "100"), 10) || 100, 1), 200);

      let q = supabase
        .from("ai_learning_candidates")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (status && status !== "all") q = q.eq("status", status);
      if (type) q = q.eq("candidate_type", type);

      const { data, error } = await q;
      if (error) {
        return res.status(500).json({ ok: false, error: "fetch_failed", message: error.message });
      }

      return res.json({
        ok: true,
        candidates: (data || []).map(mapCandidateRow),
      });
    } catch (e) {
      console.error("[GET learning/candidates]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/learning/audit", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.json({ ok: true, logs: [] });
      }
      const limit = Math.min(Math.max(parseInt(String(req.query?.limit || "50"), 10) || 50, 1), 200);
      const { data, error } = await supabase
        .from("ai_learning_audit_logs")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        return res.status(500).json({ ok: false, error: "fetch_failed", message: error.message });
      }
      return res.json({ ok: true, logs: data || [] });
    } catch (e) {
      console.error("[GET learning/audit]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/learning/candidates/:id/approve", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const candidateId = String(req.params.id || "").trim();
      const adminId = getAdminId(req);
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(candidateId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const { data: row, error: fetchErr } = await supabase
        .from("ai_learning_candidates")
        .select("*")
        .eq("id", candidateId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (fetchErr || !row) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      if (row.status !== "pending") {
        return res.status(409).json({ ok: false, error: "not_pending", status: row.status });
      }

      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("ai_learning_candidates")
        .update({
          status: "approved",
          reviewed_at: now,
          reviewed_by: adminId,
          updated_at: now,
        })
        .eq("id", candidateId);

      if (updErr) {
        return res.status(500).json({ ok: false, error: "update_failed", message: updErr.message });
      }

      const applyResult = await applyApprovedCandidateToKnowledge(clinicId, row);
      if (!applyResult.ok) {
        return res.status(500).json({ ok: false, error: "apply_knowledge_failed", detail: applyResult });
      }

      await writeLearningAuditLog({
        clinicId,
        candidateId,
        action: "approve",
        actorAdminId: adminId,
        metadata: { type: row.candidate_type, value: row.value },
      });

      return res.json({
        ok: true,
        candidate: mapCandidateRow({ ...row, status: "approved", reviewed_at: now, reviewed_by: adminId }),
        knowledgeApplied: true,
      });
    } catch (e) {
      console.error("[POST learning/approve]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/learning/candidates/:id/reject", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const candidateId = String(req.params.id || "").trim();
      const adminId = getAdminId(req);
      const reason = String(req.body?.reason || req.body?.rejectionReason || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(candidateId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const { data: row, error: fetchErr } = await supabase
        .from("ai_learning_candidates")
        .select("*")
        .eq("id", candidateId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (fetchErr || !row) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      if (row.status !== "pending") {
        return res.status(409).json({ ok: false, error: "not_pending", status: row.status });
      }

      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("ai_learning_candidates")
        .update({
          status: "rejected",
          reviewed_at: now,
          reviewed_by: adminId,
          rejection_reason: reason || null,
          updated_at: now,
        })
        .eq("id", candidateId);

      if (updErr) {
        return res.status(500).json({ ok: false, error: "update_failed", message: updErr.message });
      }

      await writeLearningAuditLog({
        clinicId,
        candidateId,
        action: "reject",
        actorAdminId: adminId,
        metadata: { type: row.candidate_type, value: row.value, reason },
      });

      return res.json({
        ok: true,
        candidate: mapCandidateRow({
          ...row,
          status: "rejected",
          reviewed_at: now,
          reviewed_by: adminId,
          rejection_reason: reason,
        }),
      });
    } catch (e) {
      console.error("[POST learning/reject]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/admin", router);
}

module.exports = { registerAiLearningAdminRoutes };
