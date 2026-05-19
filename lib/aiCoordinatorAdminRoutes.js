/**
 * Admin API — AI coordinator workspace, SLA, suggest-reply, tasks.
 */

const express = require("express");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { COORDINATION_AI, COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { enrichLeadRow, matchesWorkspaceFilter } = require("./aiCoordinatorWorkspace");
const { suggestCoordinatorReply } = require("./aiCoordinatorSuggestReply");
const { listTasksForProfile } = require("./aiCoordinatorTasks");
const { getTopHotelsForAi } = require("./clinicPartnerHotels");
const {
  resolvePatientContextStrategy,
  buildPatientContextStrategyPromptBlock,
  buildTravelContextForStrategy,
} = require("./patientContextStrategy");
const { getRelevantProtocolsForAi } = require("./clinicTreatmentProtocols");
const { buildTreatmentJourneyPromptBlock } = require("./clinicJourneyPrompt");
const {
  getProfileIdsWithActiveDrafts,
  getLatestVisitPlanForProfile,
  updateVisitPlanDraft,
  mapVisitPlanForApi,
} = require("./aiVisitPlanDrafts");
const {
  listDocumentsForProfile,
  getProfileIdsWithPendingDoctorReview,
  mapDocumentForApi,
} = require("./aiPatientDocuments");
const { buildDocumentIntakePromptBlock } = require("./aiIntakeFlags");
const { buildIntakeJourneySteps } = require("./aiIntakeJourneySteps");
const {
  INTAKE_QUEUES,
  matchesIntakeQueue,
  enrichLeadForCoordinatorUI,
  computeIntakeQueueCounts,
  compareLeadsForCoordinatorInbox,
} = require("./aiCoordinatorQueues");
const {
  loadClinicPolicyForClinic,
  attachDelegationToLead,
  patchInquiryDelegation,
} = require("./aiCoordinatorDelegationHandlers");
const {
  buildCoordinationProjection,
  projectCoordinationState,
  attachPatientNamesToProfileRows,
  attachProjectionToLead,
  OPERATIONAL_STATUS,
} = require("./coordinationProjection");
const { enrichLeadWhatsappContact } = require("./whatsappCollection");
const {
  buildOperationalQueueForClinic,
  fetchProfileRows,
  fetchProfileById,
  matchesOperationalFilter,
  OPERATIONAL_FILTERS,
} = require("./coordinationOperationalQueue");
const { HANDLING_FILTERS, matchesHandlingFilter } = require("./responderMode");
const { timelineLabel } = require("./timelineLabels");
const { uiLangFromRequest } = require("./i18n/uiLocale");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WORKSPACES = [
  "assigned",
  "hot",
  "waiting_human",
  "ai_unresolved",
  "inactive",
  "recent",
];

/**
 * @param {import('express').Request} req
 */
function getClinicId(req) {
  return String(req.clinicId || "").trim();
}

/**
 * @param {import('express').Request} req
 */
function getAdminId(req) {
  const id = req.admin?.adminId || req.admin?.userId || req.user?.adminId || req.user?.userId;
  return id && UUID_RE.test(String(id)) ? String(id) : null;
}

/**
 * @param {Record<string, unknown>} lead
 */
function attachOperationalProjection(lead) {
  const flags = lead.operationalIntakeFlags || {};
  const timelinePreview = flags.latestMessagePreview
    ? {
        text: String(flags.latestMessagePreview),
        role: flags.latestMessageRole || "clinic",
        at: flags.latestMessageAt || null,
      }
    : null;
  const projection = buildCoordinationProjection(lead, { timelinePreview });
  return enrichLeadWhatsappContact(attachProjectionToLead(lead, projection));
}

function mapProfileRow(row) {
  const p = row.patients && typeof row.patients === "object" ? row.patients : null;
  const patientName =
    (p && String(p.full_name || p.name || "").trim()) ||
    [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() ||
    null;

  return {
    id: row.id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    patientName,
    patientEmail: p?.email || null,
    patientPhone: p?.phone || null,
    treatmentInterest: row.treatment_interest,
    country: row.country,
    preferredLanguage: row.preferred_language,
    travelTimeline: row.travel_timeline,
    urgency: row.urgency,
    bookingIntent: row.booking_intent,
    budgetSignal: row.budget_signal,
    conversationSummary: row.conversation_summary,
    lastPatientMessage: row.last_patient_message,
    leadScore: row.lead_score,
    isHot: row.is_hot === true,
    messageCount: row.message_count,
    coordinationMode: row.coordination_mode || COORDINATION_AI,
    primaryChannel: row.primary_channel || "in_app",
    channelMetadata: row.channel_metadata || {},
    assignedCoordinatorId: row.assigned_coordinator_id,
    assignedDoctorId: row.assigned_doctor_id,
    aiMode: row.ai_mode || null,
    aiPaused: row.ai_paused === true,
    aiEscalationRequired: row.ai_escalation_required === true,
    responderMode: row.responder_mode || null,
    primaryResponderType: row.primary_responder_type || null,
    aiAutonomyLevel: row.ai_autonomy_level || null,
    humanTakeoverAt: row.human_takeover_at,
    followUpStatus: row.follow_up_status || "none",
    inactivityDetectedAt: row.inactivity_detected_at,
    operationalIntakeFlags:
      row.operational_intake_flags && typeof row.operational_intake_flags === "object"
        ? row.operational_intake_flags
        : {},
    whatsappNumber: row.whatsapp_number || null,
    whatsappVerified: row.whatsapp_verified === true,
    whatsappCollectionStage: row.whatsapp_collection_stage || null,
    whatsappConsentAt: row.whatsapp_consent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Post-query filters for jsonb intake fields (tags, readiness, journey).
 * @param {Array<Record<string, unknown>>} leads
 * @param {import('express').Query} query
 */
function applyClientIntakeFilters(leads, query) {
  const filter = String(query.filter || query.f || "").trim().toLowerCase();
  if (!filter || filter === "recent") return leads;

  return leads.filter((L) => {
    const flags = L.operationalIntakeFlags || {};
    const tags = flags.patientReportedTags || [];

    switch (filter) {
      case "tag_implant":
      case "implant_tag":
        return tags.includes("implant_interest");
      case "tag_cosmetic":
      case "cosmetic_tag":
        return tags.some((t) =>
          ["cosmetic_goal", "veneer_interest", "whitening_interest"].includes(t),
        );
      case "readiness_ready":
      case "consultation_ready":
        return (flags.readinessPercent ?? 0) >= 70 || flags.journeyStage === "consultation_ready";
      case "appointment_scheduled":
        return (
          flags.journeyStage === "appointment_scheduled" ||
          flags.appointmentScheduled === true ||
          !!(flags.activeAppointment && flags.activeAppointment.startAt)
        );
      case "waiting_for_consultation":
        return (
          flags.journeyStage === "waiting_for_consultation" ||
          flags.waitingForConsultation === true
        );
      case "awaiting_xray":
        return flags.journeyStage === "awaiting_xray" || flags.missingXray === true;
      case "awaiting_photos":
        return flags.journeyStage === "awaiting_photos" || flags.missingSmilePhotos === true;
      case "doctor_review":
        return flags.doctorReviewNeeded === true || flags.journeyStage === "doctor_review_pending";
      case "human_followup":
        if (flags.journeyStage === "coordinator_followup") return true;
        if (L.coordinationMode === COORDINATION_HUMAN) return true;
        if (L.workspaceBucket === "waiting_human") return true;
        return false;
      case "high_readiness": {
        const pct = flags.readinessPercent ?? 0;
        return pct >= 50;
      }
      default:
        return matchesIntakeQueue(L, { queue: filter });
    }
  });
}

/**
 * @param {import('express').Query} query
 * @param {import('@supabase/supabase-js').PostgrestFilterBuilder} qb
 */
function applyLeadFilters(qb, query) {
  const filter = String(query.filter || query.f || "").trim().toLowerCase();
  switch (filter) {
    case "hot":
      return qb.eq("is_hot", true);
    case "implant":
      return qb.ilike("treatment_interest", "%implant%");
    case "veneers":
    case "veneer":
      return qb.ilike("treatment_interest", "%veneer%");
    case "high_booking":
    case "booking":
      return qb.eq("booking_intent", "high");
    case "high_urgency":
    case "urgency":
      return qb.eq("urgency", "high");
    case "human":
      return qb.eq("coordination_mode", COORDINATION_HUMAN);
    case "ai":
      return qb.eq("coordination_mode", COORDINATION_AI);
    case "recent":
    default:
      return qb;
  }
}

/**
 * @param {import('@supabase/supabase-js').PostgrestFilterBuilder} qb
 * @param {string} workspace
 * @param {string|null} adminId
 */
function applyWorkspaceQuery(qb, workspace, adminId) {
  const w = String(workspace || "").trim().toLowerCase();
  switch (w) {
    case "assigned":
      if (adminId) return qb.eq("assigned_coordinator_id", adminId);
      return qb.not("assigned_coordinator_id", "is", null);
    case "hot":
      return qb.eq("is_hot", true);
    case "waiting_human":
      return qb.eq("coordination_mode", COORDINATION_HUMAN);
    case "ai_unresolved":
      return qb.eq("ai_unresolved", true);
    case "inactive": {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      return qb.lt("updated_at", cutoff);
    }
    default:
      return qb;
  }
}

/**
 * @param {Record<string, unknown>} ev
 */
function mapTimelineEvent(ev, lang = "en") {
  const meta = ev.event_metadata && typeof ev.event_metadata === "object" ? ev.event_metadata : {};
  return {
    id: ev.id,
    eventType: ev.event_type || "patient_turn",
    channel: ev.channel || "in_app",
    createdAt: ev.created_at,
    patientMessage: ev.patient_message,
    aiReply: ev.ai_reply,
    eventMetadata: meta,
    turnLeadData: ev.turn_lead_data,
    mergedLeadData: ev.merged_lead_data,
    label: timelineLabel(ev.event_type, meta, lang),
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ requireAdminAuth: Function }} deps
 */
function registerAiCoordinatorAdminRoutes(app, deps) {
  const { requireAdminAuth } = deps;
  const router = express.Router();

  router.get("/coordination/workspace", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const limit = Math.min(200, Math.max(20, parseInt(String(req.query.limit || "120"), 10) || 120));
      const refresh = String(req.query.refresh || "").trim() === "1";

      const built = await buildOperationalQueueForClinic(clinicId, { limit, syncRequests: true });
      let data = built.rows;

      let leads = (data || []).map((row) => enrichLeadForCoordinatorUI(enrichLeadRow(row, mapProfileRow)));

      if (refresh) {
        for (const L of leads.slice(0, 40)) {
          await projectCoordinationState(L.id);
        }
        const rebuilt = await buildOperationalQueueForClinic(clinicId, { limit, syncRequests: false });
        data = rebuilt.rows;
        leads = (data || []).map((row) =>
          enrichLeadForCoordinatorUI(attachOperationalProjection(enrichLeadRow(row, mapProfileRow))),
        );
      } else {
        leads = leads.map((L) => attachOperationalProjection(L));
      }

      const statusCounts = {};
      for (const s of Object.values(OPERATIONAL_STATUS)) statusCounts[s] = 0;
      for (const L of leads) {
        const k = L.operationalStatus || OPERATIONAL_STATUS.IN_PROGRESS;
        statusCounts[k] = (statusCounts[k] || 0) + 1;
      }

      return res.json({
        ok: true,
        leads,
        statusCounts,
        meta: { count: leads.length, clinicId, refreshed: refresh ? true : false },
      });
    } catch (e) {
      console.error("[GET /api/admin/coordination/workspace]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/ai-leads/queues", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const limit = Math.min(250, Math.max(50, parseInt(String(req.query.limit || "150"), 10) || 150));
      let data;
      try {
        data = await fetchProfileRows(clinicId, limit);
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "query_failed",
          message: error?.message || "query_failed",
        });
      }

      data = await attachPatientNamesToProfileRows(data || []);

      const leads = (data || []).map((row) =>
        enrichLeadForCoordinatorUI(attachOperationalProjection(enrichLeadRow(row, mapProfileRow))),
      );
      const counts = computeIntakeQueueCounts(leads);

      return res.json({
        ok: true,
        intakeQueues: INTAKE_QUEUES.map((q) => ({
          id: q.id,
          label: q.label,
          description: q.description,
          count: counts[q.id] || 0,
        })),
        workspaces: WORKSPACES,
      });
    } catch (e) {
      console.error("[GET /api/admin/ai-leads/queues]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/ai-leads", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "clinic_missing" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const limit = Math.min(150, Math.max(1, parseInt(String(req.query.limit || "80"), 10) || 80));
      const workspace = String(req.query.workspace || req.query.w || "").trim().toLowerCase();
      const intakeQueue = String(req.query.queue || "").trim().toLowerCase();
      const operationalFilter = String(req.query.ops || req.query.operational || "").trim().toLowerCase();
      const handlingFilter = String(req.query.handling || "").trim().toLowerCase();
      const adminId = getAdminId(req);
      const syncRequests = String(req.query.sync || "1").trim() !== "0";

      const useIntakeQueue = intakeQueue && INTAKE_QUEUES.some((q) => q.id === intakeQueue);

      let data;
      let queueMeta = {};
      try {
        const built = await buildOperationalQueueForClinic(clinicId, {
          limit: Math.min(250, limit * 3),
          syncRequests,
        });
        data = built.rows;
        queueMeta = built.meta || {};
      } catch (queueErr) {
        console.error("[GET /api/admin/ai-leads] queue build:", queueErr?.message || queueErr);
        try {
          data = await fetchProfileRows(clinicId, limit * 2);
          data = await attachPatientNamesToProfileRows(data || []);
          queueMeta = { fallback: "fetchProfileRows" };
        } catch (fallbackErr) {
          return res.status(500).json({
            ok: false,
            error: "query_failed",
            message: fallbackErr?.message || queueErr?.message || "queue_failed",
          });
        }
      }

      const clinicPolicy = await loadClinicPolicyForClinic(clinicId);
      const baseLeads = (data || []).map((row) => enrichLeadRow(row, mapProfileRow));
      const draftIds = await getProfileIdsWithActiveDrafts(baseLeads.map((L) => L.id));
      const doctorReviewIds = await getProfileIdsWithPendingDoctorReview(baseLeads.map((L) => L.id));

      const allEnriched = baseLeads.map((L) => {
        const enriched = enrichLeadForCoordinatorUI({
          ...L,
          hasVisitPlanDraft: draftIds.has(L.id),
          needsDoctorDocumentReview: doctorReviewIds.has(L.id),
          readinessPercent: L.operationalIntakeFlags?.readinessPercent ?? null,
          journeyStage: L.operationalIntakeFlags?.journeyStage || null,
          journeyStageLabel: L.operationalIntakeFlags?.journeyStageLabel || null,
          hasMissingIntake:
            !!L.operationalIntakeFlags?.missingXray ||
            !!L.operationalIntakeFlags?.missingSmilePhotos ||
            !!L.operationalIntakeFlags?.missingTravelTimeline ||
            !!L.operationalIntakeFlags?.missingTreatmentPreference,
        });
        return attachDelegationToLead(attachOperationalProjection(enriched), clinicPolicy);
      });

      const operationalCounts = {};
      for (const f of OPERATIONAL_FILTERS) {
        if (!f.id) continue;
        operationalCounts[f.id] = allEnriched.filter((L) => matchesOperationalFilter(L, f.id)).length;
      }

      const handlingCounts = {};
      for (const f of HANDLING_FILTERS) {
        if (!f.id) continue;
        handlingCounts[f.id] = allEnriched.filter((L) => matchesHandlingFilter(L, f.id)).length;
      }

      let leads = allEnriched;

      if (operationalFilter) {
        leads = leads.filter((L) => matchesOperationalFilter(L, operationalFilter));
      }

      if (handlingFilter) {
        leads = leads.filter((L) => matchesHandlingFilter(L, handlingFilter));
      }

      if (workspace === "waiting_human") {
        leads = leads.filter((L) => {
          const lp = L.sla?.lastPatientMessageAt;
          const lh = L.sla?.lastHumanReplyAt;
          if (!lp) return false;
          if (!lh) return true;
          return new Date(lp).getTime() > new Date(lh).getTime();
        });
      }

      if (workspace && WORKSPACES.includes(workspace)) {
        leads = leads.filter((L) => matchesWorkspaceFilter(workspace, L));
      }

      if (useIntakeQueue) {
        leads = leads.filter((L) => matchesIntakeQueue(L, { queue: intakeQueue }));
        leads.sort(compareLeadsForCoordinatorInbox);
        leads = leads.slice(0, limit);
      } else {
        leads = leads.slice(0, limit);
        leads = applyClientIntakeFilters(leads, req.query);
      }

      const poolForCounts = useIntakeQueue ? allEnriched : allEnriched;
      const queueCounts = computeIntakeQueueCounts(poolForCounts);

      return res.json({
        ok: true,
        leads,
        clinicPolicy,
        queueCounts,
        intakeQueues: INTAKE_QUEUES.map((q) => ({
          id: q.id,
          label: q.label,
          description: q.description,
          count: queueCounts[q.id] || 0,
        })),
        operationalFilters: OPERATIONAL_FILTERS.map((f) => ({
          ...f,
          count: f.id ? operationalCounts[f.id] || 0 : leads.length,
        })),
        handlingFilters: HANDLING_FILTERS.map((f) => ({
          ...f,
          count: f.id ? handlingCounts[f.id] || 0 : leads.length,
        })),
        meta: {
          count: leads.length,
          filter: req.query.filter || null,
          queue: intakeQueue || null,
          workspace: workspace || null,
          operational: operationalFilter || null,
          handling: handlingFilter || null,
          clinicId,
          workspaces: WORKSPACES,
          queueBuild: queueMeta,
        },
      });
    } catch (e) {
      console.error("[GET /api/admin/ai-leads]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/ai-leads/:profileId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const profileId = String(req.params.profileId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      let profile;
      try {
        profile = await fetchProfileById(clinicId, profileId);
      } catch (pErr) {
        return res.status(500).json({
          ok: false,
          error: "query_failed",
          message: pErr?.message || "query_failed",
        });
      }
      if (!profile) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }

      const [profileNamed] = await attachPatientNamesToProfileRows([profile]);

      const { data: events, error: eErr } = await supabase
        .from("ai_coordinator_lead_events")
        .select(
          "id, profile_id, patient_message, ai_reply, turn_lead_data, merged_lead_data, channel, message_role, event_type, event_metadata, created_at",
        )
        .eq("profile_id", profileId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (eErr) {
        return res.status(500).json({ ok: false, error: "events_failed", message: eErr.message });
      }

      const tasks = await listTasksForProfile(profileId);
      const uiLang = uiLangFromRequest(req);
      const timeline = (events || []).map((ev) => mapTimelineEvent(ev, uiLang));
      const leadBase = enrichLeadRow(profileNamed || profile, mapProfileRow);
      const visitPlanDraft = mapVisitPlanForApi(await getLatestVisitPlanForProfile(profileId));
      const documents = (await listDocumentsForProfile(profileId, { clinicId })).map(mapDocumentForApi);
      const intakeFlags = leadBase.operationalIntakeFlags || {};
      await projectCoordinationState(profileId);

      let profileFresh;
      try {
        profileFresh = await fetchProfileById(clinicId, profileId);
      } catch (refreshErr) {
        console.warn("[GET /api/admin/ai-leads/:id] refresh:", refreshErr?.message || refreshErr);
        profileFresh = profile;
      }

      const profileWithName = profileFresh
        ? (await attachPatientNamesToProfileRows([profileFresh]))[0]
        : profile;

      const leadBaseFresh = enrichLeadRow(profileWithName || profile, mapProfileRow);
      const intakeFlagsFresh = leadBaseFresh.operationalIntakeFlags || {};

      const lead = attachOperationalProjection(
        enrichLeadForCoordinatorUI({
          ...leadBaseFresh,
          hasVisitPlanDraft: !!visitPlanDraft && visitPlanDraft.status === "draft",
          needsDoctorDocumentReview: documents.some(
            (d) => d.requiresDoctorReview && d.reviewStatus === "pending",
          ),
          hasMissingIntake:
            !!intakeFlagsFresh.missingXray ||
            !!intakeFlagsFresh.missingSmilePhotos ||
            !!intakeFlagsFresh.missingTravelTimeline ||
            !!intakeFlagsFresh.missingTreatmentPreference,
          readinessPercent: intakeFlagsFresh.readinessPercent ?? null,
          journeyStage: intakeFlagsFresh.journeyStage || null,
          journeyStageLabel: intakeFlagsFresh.journeyStageLabel || null,
        }),
      );
      const clinicPolicy = await loadClinicPolicyForClinic(clinicId);

      return res.json({
        ok: true,
        lead: attachDelegationToLead(lead, clinicPolicy),
        clinicPolicy,
        visitPlanDraft,
        documents,
        operationalIntakeFlags: intakeFlags,
        readiness: {
          percent: intakeFlags.readinessPercent ?? 0,
          missing: intakeFlags.readinessMissing || [],
          journeyStage: intakeFlags.journeyStage,
          journeyStageLabel: intakeFlags.journeyStageLabel,
        },
        intakeJourney: buildIntakeJourneySteps({
          operationalIntakeFlags: intakeFlags,
          documents,
          readiness: {
            percent: intakeFlags.readinessPercent,
            missing: intakeFlags.readinessMissing,
          },
        }),
        events: timeline,
        operationalTimeline: timeline,
        tasks: tasks.map((t) => ({
          id: t.id,
          taskType: t.task_type,
          title: t.title,
          status: t.status,
          priority: t.priority,
          source: t.source,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
        })),
      });
    } catch (e) {
      console.error("[GET /api/admin/ai-leads/:id]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/ai-leads/:profileId/suggest-reply", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const profileId = String(req.params.profileId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }

      const { data: profile, error: pErr } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select(
          "id, coordination_mode, conversation_summary, treatment_interest, urgency, booking_intent, country, operational_intake_flags",
        )
        .eq("id", profileId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (pErr) {
        return res.status(500).json({ ok: false, error: "query_failed", message: pErr.message });
      }
      if (!profile) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      if (profile.coordination_mode !== COORDINATION_HUMAN) {
        return res.status(409).json({
          ok: false,
          error: "human_mode_required",
          message: "Switch to Human Active before requesting a draft reply.",
        });
      }

      const { data: events } = await supabase
        .from("ai_coordinator_lead_events")
        .select("patient_message, ai_reply, event_type, created_at")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(12);

      const chron = (events || []).slice().reverse();
      const latestPatientMessage =
        [...chron].reverse().find((ev) => ev.patient_message)?.patient_message || "";
      const patientContextStrategy = resolvePatientContextStrategy({
        message: latestPatientMessage,
        conversationSummary: profile.conversation_summary,
        leadData: {
          treatmentInterest: profile.treatment_interest,
          country: profile.country,
          travelTimeline: profile.travel_timeline,
        },
        profileRow: profile,
      });
      const patientContextStrategyPrompt =
        buildPatientContextStrategyPromptBlock(patientContextStrategy);
      let travelContext = null;
      if (!patientContextStrategy.avoid_travel_coordination_topics) {
        const hotels = await getTopHotelsForAi(clinicId, 3);
        travelContext = buildTravelContextForStrategy(patientContextStrategy, hotels);
      }
      const protocols = await getRelevantProtocolsForAi(clinicId, {
        treatmentInterest: profile.treatment_interest,
        max: 5,
      });
      const journeyContext = buildTreatmentJourneyPromptBlock(protocols);
      const profileDocs = await listDocumentsForProfile(profileId, { clinicId });
      const documentIntakeContext = buildDocumentIntakePromptBlock(
        profile.operational_intake_flags,
        profileDocs,
      );
      const uiLang = uiLangFromRequest(req);
      const result = await suggestCoordinatorReply({
        conversationSummary: profile.conversation_summary,
        coordinatorUiLang: uiLang,
        patientConversationLang:
          profile.conversation_primary_language || profile.preferred_language,
        leadContext: {
          treatmentInterest: profile.treatment_interest,
          urgency: profile.urgency,
          bookingIntent: profile.booking_intent,
          country: profile.country,
          patientReportedTags: profile.operational_intake_flags?.patientReportedTags || [],
        },
        operationalIntakeFlags: profile.operational_intake_flags,
        journeyContext,
        travelContext,
        patientContextStrategyPrompt,
        documentIntakeContext,
        events: chron.map((ev) => ({
          patientMessage: ev.patient_message,
          aiReply: ev.ai_reply,
          eventType: ev.event_type,
        })),
      });

      return res.json({
        ok: true,
        suggestedReply: result.suggestedReply,
        assistantOnly: true,
        autoSend: false,
        operationalHintUsed: result.operationalHintUsed === true,
      });
    } catch (e) {
      if (e?.code === "ai_not_configured") {
        return res.status(503).json({ ok: false, error: "ai_not_configured" });
      }
      console.error("[POST suggest-reply]", e?.message || e);
      return res.status(500).json({ ok: false, error: "suggest_failed", message: e?.message });
    }
  });

  router.patch("/ai-leads/:profileId/visit-plan", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const profileId = String(req.params.profileId || "").trim();
      const draftId = String(req.body?.draftId || req.body?.id || "").trim();

      if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const latest = await getLatestVisitPlanForProfile(profileId);
      const targetId = UUID_RE.test(draftId) ? draftId : latest?.id;
      if (!targetId) {
        return res.status(404).json({ ok: false, error: "visit_plan_not_found" });
      }

      const result = await updateVisitPlanDraft(clinicId, targetId, {
        status: req.body?.status,
        coordinatorNotes: req.body?.coordinatorNotes ?? req.body?.coordinator_notes,
        reviewedBy: getAdminId(req),
      });

      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 500;
        return res.status(status).json({ ok: false, error: result.error, message: result.message });
      }

      return res.json({ ok: true, visitPlanDraft: mapVisitPlanForApi(result.draft) });
    } catch (e) {
      console.error("[PATCH visit-plan]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/coordination/appointment-sync", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const patientId = String(req.body?.patientId || req.body?.patient_id || "").trim();
      const startAt = req.body?.startAt || req.body?.start_at || req.body?.date;
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const { syncAppointmentToCoordination, toStartIso } = require("./appointmentCoordinationSync");
      const iso = toStartIso(startAt);
      if (!iso) {
        return res.status(400).json({ ok: false, error: "invalid_start_at" });
      }
      const result = await syncAppointmentToCoordination({
        patientId,
        clinicId,
        eventType: String(req.body?.eventType || "appointment_booked"),
        appointment: {
          id: req.body?.appointmentId || null,
          startAt: iso,
          treatmentLabel: req.body?.treatment || req.body?.procedure || "Consultation",
          status: req.body?.status || "scheduled",
        },
        source: "admin_backfill",
        sendPatientMessage: req.body?.sendPatientMessage === true,
      });
      return res.json({ ok: true, coordination: result });
    } catch (e) {
      console.error("[POST coordination/appointment-sync]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.patch("/ai-leads/:profileId/coordination", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = getClinicId(req);
      const profileId = String(req.params.profileId || "").trim();
      if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const body = { ...(req.body || {}) };
      const modeLegacy = String(body.mode ?? body.coordinationMode ?? "").trim();
      if (!body.aiMode && !body.ai_mode && !body.uiPreset && modeLegacy) {
        body.uiPreset =
          modeLegacy === COORDINATION_HUMAN ? "OFF" : "ASSIST";
      }

      const result = await patchInquiryDelegation({
        clinicId,
        profileId,
        body,
        actorId: getAdminId(req),
        actorRole: "coordinator",
      });

      if (!result.ok) {
        return res.status(result.status || 500).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error("[PATCH coordination]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/admin", router);
}

module.exports = { registerAiCoordinatorAdminRoutes };
