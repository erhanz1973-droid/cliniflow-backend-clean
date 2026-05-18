/**
 * Doctor-supervised clinical guidance → patient communication API.
 */

const express = require("express");
const { supabase } = require("./supabase");
const {
  UUID_RE,
  isSupabaseEnabled,
  createClinicalGuidance,
  getClinicalGuidanceById,
  createCommunicationDraft,
  getDraftById,
  updateDraft,
  resolveThreadId,
} = require("./clinicalGuidanceStore");
const { expandClinicalGuidance, rewriteClinicalDraft, INTENT_TAGS } = require("./clinicalGuidanceExpand");
const { sendClinicalDraft } = require("./clinicalGuidanceSend");
const { normalizeIntentTags, normalizeStringList, normalizeRewriteAction } = require("./clinicalGuidanceTypes");
const { loadClinicPolicyForClinic } = require("./aiCoordinatorDelegationHandlers");
const { resolveInquiryDelegation } = require("./aiDelegation");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");

const PROFILE_SELECT =
  "id, patient_id, clinic_id, conversation_summary, last_patient_message, preferred_language, conversation_primary_language, ai_mode, ai_paused, ai_escalation_required, coordination_mode, escalation_flags";

/**
 * @param {import("express").Request} req
 */
function actorFromReq(req) {
  if (req.doctor?.id) {
    return { id: String(req.doctor.id).trim(), role: "doctor", clinicId: String(req.clinicId || req.doctor.clinic_id || "").trim() };
  }
  if (req.admin || req.clinicId) {
    return {
      id: String(req.admin?.adminId || req.admin?.userId || "admin").trim(),
      role: "coordinator",
      clinicId: String(req.clinicId || "").trim(),
    };
  }
  return { id: "", role: "doctor", clinicId: "" };
}

/**
 * @param {string} clinicId
 * @param {string} patientId
 */
async function findProfile(clinicId, patientId) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(PROFILE_SELECT)
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {{ ceilingMode?: string }} clinicPolicy
 */
function delegationForProfile(profileRow, clinicPolicy) {
  return resolveInquiryDelegation(
    {
      ai_mode: profileRow.ai_mode,
      coordination_mode: profileRow.coordination_mode,
      ai_paused: profileRow.ai_paused,
      ai_escalation_required: profileRow.ai_escalation_required,
      escalation_flags: profileRow.escalation_flags,
    },
    { clinicPolicy },
  );
}

/**
 * @param {Record<string, unknown>} profileRow
 */
function buildPatientContext(profileRow) {
  const parts = [];
  if (profileRow.conversation_summary) {
    parts.push(`Summary: ${profileRow.conversation_summary}`);
  }
  if (profileRow.last_patient_message) {
    parts.push(`Latest patient message: ${profileRow.last_patient_message}`);
  }
  return parts.join("\n");
}

/**
 * @param {import("express").Express} app
 * @param {{ requireDoctorAuth: Function, requireAdminAuth?: Function, insertClinicMessage: Function }} deps
 */
function registerClinicalGuidanceRoutes(app, deps) {
  const { requireDoctorAuth, insertClinicMessage } = deps;
  const router = express.Router();

  const auth = (req, res, next) => {
    if (req.doctor?.id) return requireDoctorAuth(req, res, next);
    if (deps.requireAdminAuth && (req.admin || req.clinicId)) {
      return deps.requireAdminAuth(req, res, next);
    }
    return requireDoctorAuth(req, res, next);
  };

  router.get("/intent-tags", auth, (_req, res) => {
    res.json({ ok: true, intentTags: INTENT_TAGS });
  });

  router.post("/clinical-guidance", auth, async (req, res) => {
    try {
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }
      const actor = actorFromReq(req);
      const body = req.body || {};
      const patientId = String(body.patientId || body.patient_id || "").trim();
      const clinicId = String(body.clinicId || actor.clinicId || "").trim();
      const intentText = String(body.intentText || body.intent_text || "").trim();

      if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      if (!intentText) {
        return res.status(400).json({ ok: false, error: "intent_text_required" });
      }

      const profile = await findProfile(clinicId, patientId);
      const threadId =
        String(body.threadId || body.thread_id || "").trim() ||
        (await resolveThreadId(clinicId, patientId));

      const guidance = await createClinicalGuidance({
        profileId: profile?.id || null,
        threadId: UUID_RE.test(String(threadId)) ? threadId : null,
        patientId,
        clinicId,
        authorId: actor.id,
        authorRole: actor.role,
        intentTags: normalizeIntentTags(body.intentTags || body.intent_tags),
        intentText,
        constraints: normalizeStringList(body.constraints),
        communicationGoals: normalizeStringList(body.communicationGoals || body.communication_goals),
      });

      return res.json({ ok: true, guidance });
    } catch (e) {
      console.error("[POST clinical-guidance]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.post("/expand-clinical-guidance", auth, async (req, res) => {
    try {
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }
      const actor = actorFromReq(req);
      const body = req.body || {};
      const patientId = String(body.patientId || body.patient_id || "").trim();
      const clinicId = String(body.clinicId || actor.clinicId || "").trim();
      const guidanceId = String(body.guidanceId || body.guidance_id || "").trim();

      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic_id" });
      }

      const profile = patientId && UUID_RE.test(patientId) ? await findProfile(clinicId, patientId) : null;
      const clinicPolicy = await loadClinicPolicyForClinic(clinicId);

      if (profile) {
        const delegation = delegationForProfile(profile, clinicPolicy);
        if (!delegation.draftGenerationAllowed) {
          return res.status(403).json({
            ok: false,
            error: "expansion_not_allowed",
            aiMode: delegation.aiMode,
            message: "AI expansion is disabled for this inquiry (human-only or escalation).",
          });
        }
      }

      let guidanceRecord = null;
      let guidancePayload = body.guidance || body.clinicalGuidance || null;

      if (guidanceId && UUID_RE.test(guidanceId)) {
        guidanceRecord = await getClinicalGuidanceById(guidanceId);
        if (!guidanceRecord) {
          return res.status(404).json({ ok: false, error: "guidance_not_found" });
        }
        if (String(guidanceRecord.clinicId) !== clinicId) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        guidancePayload = {
          intent_text: guidanceRecord.intentText,
          intent_tags: guidanceRecord.intentTags,
          constraints: guidanceRecord.constraints,
          communication_goals: guidanceRecord.communicationGoals,
        };
      } else if (!guidancePayload) {
        const intentText = String(body.intentText || body.intent_text || "").trim();
        if (!intentText) {
          return res.status(400).json({ ok: false, error: "guidance_required" });
        }
        if (!UUID_RE.test(patientId)) {
          return res.status(400).json({ ok: false, error: "patient_id_required" });
        }
        guidanceRecord = await createClinicalGuidance({
          profileId: profile?.id || null,
          threadId: await resolveThreadId(clinicId, patientId),
          patientId,
          clinicId,
          authorId: actor.id,
          authorRole: actor.role,
          intentTags: normalizeIntentTags(body.intentTags || body.intent_tags),
          intentText,
          constraints: normalizeStringList(body.constraints),
          communicationGoals: normalizeStringList(body.communicationGoals || body.communication_goals),
        });
        guidancePayload = {
          intent_text: guidanceRecord.intentText,
          intent_tags: guidanceRecord.intentTags,
          constraints: guidanceRecord.constraints,
          communication_goals: guidanceRecord.communicationGoals,
        };
      }

      const resolvedPatientId =
        patientId ||
        (guidanceRecord?.patientId ? String(guidanceRecord.patientId) : "") ||
        (profile?.patient_id ? String(profile.patient_id) : "");

      const expanded = await expandClinicalGuidance({
        guidance: guidancePayload,
        clinicId,
        profileId: profile?.id || guidanceRecord?.profileId || null,
        patientContext: body.patientContext || buildPatientContext(profile || {}),
        conversationLanguage:
          body.conversationLanguage ||
          profile?.conversation_primary_language ||
          profile?.preferred_language ||
          "en",
      });

      const provenance = {
        message_source: "ai_expanded",
        generated_from_guidance_id: guidanceRecord?.id || guidanceId || null,
        approved_by: null,
        rewrite_actions: [],
        conversion_engine_used: expanded.rewriteMetadata?.conversionEngineUsed === true,
        ai_mode: profile?.ai_mode || null,
      };

      let draft = null;
      if (resolvedPatientId && UUID_RE.test(resolvedPatientId)) {
        draft = await createCommunicationDraft({
          guidanceId: guidanceRecord?.id || guidanceId,
          profileId: profile?.id || guidanceRecord?.profileId || null,
          patientId: resolvedPatientId,
          clinicId,
          draftText: expanded.patientDraft,
          messageProvenance: provenance,
          safetyReport: expanded.safetyReport,
          confidence: expanded.confidence,
        });
      }

      const profileIdForTimeline = profile?.id || guidanceRecord?.profileId || null;
      if (profileIdForTimeline) {
        void insertTimelineEvent({
          profileId: profileIdForTimeline,
          eventType: "system",
          aiReply: expanded.patientDraft,
          eventMetadata: {
            subtype: "guidance_created",
            guidance_id: guidanceRecord?.id || guidanceId,
            author_id: actor.id,
            intent_tags: guidancePayload.intent_tags || [],
          },
        });
        void insertTimelineEvent({
          profileId: profileIdForTimeline,
          eventType: "system",
          aiReply: expanded.patientDraft,
          eventMetadata: {
            subtype: "ai_expanded",
            guidance_id: guidanceRecord?.id || guidanceId,
            draft_id: draft?.id || null,
            confidence: expanded.confidence,
            safety_warnings: expanded.safetyReport?.warnings || [],
            provenance,
          },
        });
      }

      return res.json({
        ok: true,
        guidance: guidanceRecord,
        patientDraft: expanded.patientDraft,
        confidence: expanded.confidence,
        detectedRisks: expanded.detectedRisks,
        safetyReport: expanded.safetyReport,
        rewriteMetadata: expanded.rewriteMetadata,
        draft,
        requiresApproval: true,
        provenance,
      });
    } catch (e) {
      const code = e?.code === "ai_not_configured" ? 503 : 500;
      console.error("[POST expand-clinical-guidance]", e?.message || e);
      return res.status(code).json({
        ok: false,
        error: e?.code || "expand_failed",
        message: e?.message || "Expand failed",
      });
    }
  });

  router.post("/rewrite-clinical-draft", auth, async (req, res) => {
    try {
      const body = req.body || {};
      const action = normalizeRewriteAction(body.action || body.rewriteAction);
      const draftId = String(body.draftId || body.draft_id || "").trim();
      let draftText = String(body.draftText || body.draft_text || body.patientDraft || "").trim();

      if (!action) {
        return res.status(400).json({ ok: false, error: "invalid_rewrite_action" });
      }

      const actor = actorFromReq(req);
      const clinicId = String(body.clinicId || actor.clinicId || "").trim();

      if (draftId && UUID_RE.test(draftId)) {
        const existing = await getDraftById(draftId);
        if (!existing) return res.status(404).json({ ok: false, error: "draft_not_found" });
        if (clinicId && String(existing.clinicId) !== clinicId) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        draftText = draftText || existing.draftText;
      }

      if (!draftText) {
        return res.status(400).json({ ok: false, error: "draft_text_required" });
      }

      const result = await rewriteClinicalDraft({
        draftText,
        action,
        clinicId,
        patientContext: body.patientContext || null,
      });

      const rewriteActions = draftId && UUID_RE.test(draftId)
        ? [...new Set([...(body.priorRewriteActions || []), action])]
        : [action];

      let draft = null;
      if (draftId && UUID_RE.test(draftId)) {
        const existing = await getDraftById(draftId);
        draft = await updateDraft(draftId, {
          draft_text: result.patientDraft,
          safety_report: result.safetyReport,
          confidence: result.confidence,
          rewrite_actions: rewriteActions,
          message_provenance: {
            ...(existing?.messageProvenance || {}),
            rewrite_actions: rewriteActions,
            last_rewrite: action,
          },
        });
        if (existing?.profileId) {
          void insertTimelineEvent({
            profileId: existing.profileId,
            eventType: "system",
            aiReply: result.patientDraft,
            eventMetadata: {
              subtype: "rewrite_applied",
              draft_id: draftId,
              rewrite_action: action,
              rewrite_actions: rewriteActions,
            },
          });
        }
      }

      return res.json({
        ok: true,
        patientDraft: result.patientDraft,
        confidence: result.confidence,
        safetyReport: result.safetyReport,
        rewriteAction: action,
        draft,
      });
    } catch (e) {
      const code = e?.code === "ai_not_configured" ? 503 : 500;
      return res.status(code).json({
        ok: false,
        error: e?.code || "rewrite_failed",
        message: e?.message || "Rewrite failed",
      });
    }
  });

  router.post("/clinical-guidance/:guidanceId/send", auth, async (req, res) => {
    try {
      if (!isSupabaseEnabled()) {
        return res.status(503).json({ ok: false, error: "supabase_required" });
      }
      const actor = actorFromReq(req);
      const guidanceId = String(req.params.guidanceId || "").trim();
      const body = req.body || {};
      const draftId = String(body.draftId || body.draft_id || "").trim();
      const finalText = String(body.finalText || body.text || body.message || "").trim();

      if (!UUID_RE.test(guidanceId)) {
        return res.status(400).json({ ok: false, error: "invalid_guidance_id" });
      }
      if (!draftId || !UUID_RE.test(draftId)) {
        return res.status(400).json({ ok: false, error: "draft_id_required" });
      }

      const guidance = await getClinicalGuidanceById(guidanceId);
      if (!guidance) {
        return res.status(404).json({ ok: false, error: "guidance_not_found" });
      }
      if (actor.clinicId && String(guidance.clinicId) !== actor.clinicId) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const draft = await getDraftById(draftId);
      if (!draft || String(draft.guidanceId) !== guidanceId) {
        return res.status(404).json({ ok: false, error: "draft_not_found" });
      }

      const profile = guidance.patientId
        ? await findProfile(String(guidance.clinicId), String(guidance.patientId))
        : null;
      if (profile) {
        const clinicPolicy = await loadClinicPolicyForClinic(String(guidance.clinicId));
        const delegation = delegationForProfile(profile, clinicPolicy);
        if (delegation.aiMode === "ESCALATION_REQUIRED" && delegation.aiEscalationRequired) {
          return res.status(403).json({
            ok: false,
            error: "send_blocked_escalation",
            message: "Human review escalation is active — resolve escalation before sending.",
          });
        }
      }

      const result = await sendClinicalDraft({
        draftId,
        finalText,
        approvedBy: actor.id,
        provenance: body.provenance,
        insertClinicMessage,
      });

      if (!result.ok) {
        return res.status(result.status || 500).json(result);
      }

      return res.json({
        ok: true,
        draft: result.draft,
        messageRef: result.messageRef,
        provenance: result.provenance,
      });
    } catch (e) {
      console.error("[POST clinical-guidance send]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/ai", router);
}

module.exports = { registerClinicalGuidanceRoutes };
