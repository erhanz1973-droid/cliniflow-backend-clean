/**
 * Doctor API — live inquiry AI coordination (operational control per patient).
 */

const express = require("express");
const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  loadClinicPolicyForClinic,
  attachDelegationToLead,
  patchInquiryDelegation,
} = require("./aiCoordinatorDelegationHandlers");
const { enrichLeadRow } = require("./aiCoordinatorWorkspace");
const { enrichLeadForCoordinatorUI } = require("./aiCoordinatorQueues");
const { suggestCoordinatorReply } = require("./aiCoordinatorSuggestReply");
const { attachPatientNamesToProfileRows } = require("./coordinationProjection");
const { timelineLabel } = require("./timelineLabels");
const { projectCoordinationState } = require("./coordinationProjection");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROFILE_SELECT = `
  id, session_id, patient_id, clinic_id,
  treatment_interest, country, preferred_language,
  coordination_mode, ai_mode, ai_paused, ai_escalation_required,
  responder_mode, primary_responder_type,
  assigned_coordinator_id, assigned_doctor_id,
  escalation_flags, operational_intake_flags,
  conversation_summary, lead_score, is_hot, message_count,
  last_patient_message, last_patient_message_at, last_ai_reply_at,
  last_human_reply_at, updated_at
`;

function mapProfileRow(row) {
  const patientName = row._patientName || null;
  return {
    id: row.id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    patientName,
    treatmentInterest: row.treatment_interest,
    country: row.country,
    coordinationMode: row.coordination_mode,
    aiMode: row.ai_mode,
    aiPaused: row.ai_paused === true,
    aiEscalationRequired: row.ai_escalation_required === true,
    responderMode: row.responder_mode || null,
    primaryResponderType: row.primary_responder_type || null,
    assignedCoordinatorId: row.assigned_coordinator_id,
    assignedDoctorId: row.assigned_doctor_id,
    escalationFlags: row.escalation_flags || {},
    operationalIntakeFlags: row.operational_intake_flags || {},
    conversationSummary: row.conversation_summary,
    lastPatientMessage: row.last_patient_message,
    leadScore: row.lead_score,
    isHot: row.is_hot === true,
    messageCount: row.message_count,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {Record<string, unknown>} ev
 */
function mapTimelineEvent(ev) {
  const meta = ev.event_metadata && typeof ev.event_metadata === "object" ? ev.event_metadata : {};
  return {
    id: ev.id,
    eventType: ev.event_type || "patient_turn",
    channel: ev.channel || "in_app",
    createdAt: ev.created_at,
    patientMessage: ev.patient_message,
    aiReply: ev.ai_reply,
    eventMetadata: meta,
    label: timelineLabel(ev.event_type, meta),
  };
}

/**
 * @param {import('express').Request} req
 */
function getClinicId(req) {
  return String(req.clinicId || req.doctor?.clinic_id || "").trim();
}

/**
 * @param {import('express').Request} req
 */
function getDoctorId(req) {
  return String(req.doctorId || req.doctor?.id || "").trim();
}

/**
 * @param {string} clinicId
 * @param {string} patientId
 */
async function findLeadProfileForPatient(clinicId, patientId) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(PROFILE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [named] = await attachPatientNamesToProfileRows([data]);
  return named || data;
}

/**
 * @param {string} profileId
 */
async function fetchTimeline(profileId) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_events")
    .select(
      "id, profile_id, patient_message, ai_reply, channel, event_type, event_metadata, created_at",
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data || []).map(mapTimelineEvent);
}

/**
 * @param {import("express").Express} app
 * @param {{ requireDoctorAuth: Function }} deps
 */
function registerAiCoordinatorDoctorRoutes(app, deps) {
  const { requireDoctorAuth } = deps;
  const router = express.Router();

  router.get("/patients/:patientId/ai-coordination", requireDoctorAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const patientId = String(req.params.patientId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const row = await findLeadProfileForPatient(clinicId, patientId);
      if (!row) {
        return res.json({
          ok: true,
          profile: null,
          clinicPolicy: await loadClinicPolicyForClinic(clinicId),
        });
      }

      const clinicPolicy = await loadClinicPolicyForClinic(clinicId);
      const base = enrichLeadRow(row, mapProfileRow);
      const enriched = enrichLeadForCoordinatorUI(base);
      const lead = attachDelegationToLead(enriched, clinicPolicy);

      return res.json({ ok: true, profile: lead, clinicPolicy });
    } catch (e) {
      console.error("[GET doctor ai-coordination]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/patients/:patientId/coordination-workspace", requireDoctorAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const patientId = String(req.params.patientId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const row = await findLeadProfileForPatient(clinicId, patientId);
      if (!row) {
        return res.json({ ok: true, profile: null, timeline: [], messages: [] });
      }

      await projectCoordinationState(row.id).catch(() => {});

      const clinicPolicy = await loadClinicPolicyForClinic(clinicId);
      const base = enrichLeadRow(row, mapProfileRow);
      const enriched = enrichLeadForCoordinatorUI(base);
      const lead = attachDelegationToLead(enriched, clinicPolicy);
      const timeline = await fetchTimeline(row.id);

      const messages = timeline
        .filter((ev) => ev.patientMessage || ev.aiReply)
        .map((ev) => ({
          id: ev.id,
          role: ev.patientMessage ? "patient" : "coordinator",
          text: ev.patientMessage || ev.aiReply,
          at: ev.createdAt,
          channel: ev.channel,
          label: ev.label,
        }));

      const latestAi = [...timeline].reverse().find((ev) => ev.aiReply);
      const latestPatient = [...timeline].reverse().find((ev) => ev.patientMessage);

      return res.json({
        ok: true,
        profile: lead,
        clinicPolicy,
        timeline,
        messages,
        latestAiReply: latestAi?.aiReply || null,
        latestAiReplyAt: latestAi?.createdAt || lead.lastAiReplyAt || null,
        latestPatientMessage: latestPatient?.patientMessage || lead.lastPatientMessage || null,
        blocker: lead.blockingReason || lead.operationalIntakeFlags?.blockingReason || null,
        nextStep: lead.nextAction || lead.operationalIntakeFlags?.nextStep || null,
      });
    } catch (e) {
      console.error("[GET doctor coordination-workspace]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/patients/:patientId/suggest-reply", requireDoctorAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const patientId = String(req.params.patientId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const row = await findLeadProfileForPatient(clinicId, patientId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "profile_not_found" });
      }

      const timeline = await fetchTimeline(row.id);
      const result = await suggestCoordinatorReply({
        conversationSummary: row.conversation_summary,
        events: timeline.map((ev) => ({
          patientMessage: ev.patientMessage,
          aiReply: ev.aiReply,
          eventType: ev.eventType,
        })),
        operationalIntakeFlags: row.operational_intake_flags,
        leadContext: {
          treatmentInterest: row.treatment_interest,
          country: row.country,
        },
      });

      return res.json({ ok: true, suggestedReply: result.suggestedReply, draftOnly: true });
    } catch (e) {
      const code = e?.code === "ai_not_configured" ? 503 : 500;
      return res.status(code).json({
        ok: false,
        error: e?.code || "suggest_failed",
        message: e?.message || "Suggest failed",
      });
    }
  });

  router.patch("/patients/:patientId/ai-coordination", requireDoctorAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const patientId = String(req.params.patientId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const row = await findLeadProfileForPatient(clinicId, patientId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "profile_not_found" });
      }

      const result = await patchInquiryDelegation({
        clinicId,
        profileId: row.id,
        body: req.body || {},
        actorId: getDoctorId(req),
        actorRole: "doctor",
      });

      if (!result.ok) {
        return res.status(result.status || 500).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error("[PATCH doctor ai-coordination]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/ai-leads/:profileId/coordination", requireDoctorAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const profileId = String(req.params.profileId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const result = await patchInquiryDelegation({
        clinicId,
        profileId,
        body: req.body || {},
        actorId: getDoctorId(req),
        actorRole: "doctor",
      });

      if (!result.ok) {
        return res.status(result.status || 500).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error("[PATCH doctor coordination]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/doctor", router);
}

module.exports = { registerAiCoordinatorDoctorRoutes };
