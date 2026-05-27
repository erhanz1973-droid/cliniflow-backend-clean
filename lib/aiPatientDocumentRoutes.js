/**
 * Patient + admin routes for AI document intake.
 */

const express = require("express");
const path = require("path");
const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  savePatientDocumentUpload,
  listDocumentsForPatient,
  listDocumentsForProfile,
  updateDocumentReview,
  mapDocumentForApi,
  resolveLeadProfileBySession,
  parsePatientUploadConsent,
  DEFAULT_CONSENT_VERSION,
} = require("./aiPatientDocuments");
const { syncOperationalIntakeFlags, buildOperationalIntakeState } = require("./aiIntakeFlags");
const { buildClinicInquiryDraft } = require("./clinicInquiryDraft");
const {
  loadTreatmentGuideWorkspace,
  mergeWorkspaceIntoFlags,
} = require("./treatmentGuideWorkspace");
const { mergeLeadData, emptyLeadData } = require("./leadIntelligence");
const { normalizeTagList } = require("./treatmentInterestTags");
const { normalizeContentHash } = require("./dentalUploadDedupe");
const { DOCUMENT_TYPES } = require("./aiPatientDocumentTypes");
const { buildIntakeJourneySteps } = require("./aiIntakeJourneySteps");
const { searchClinicDirectory } = require("./clinicDirectoryForAi");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('express').Express} app
 * @param {{ requireToken: Function, requireAdminAuth: Function, chatUpload: import('multer').Multer, publicDir?: string }} deps
 */
function registerAiPatientDocumentRoutes(app, deps) {
  const { requireToken, requireAdminAuth, chatUpload } = deps;
  const publicDir = deps.publicDir || path.join(__dirname, "..", "public");

  app.get("/api/patient/me/ai-documents/consent-info", requireToken, (_req, res) => {
    return res.json({
      ok: true,
      consentVersion: DEFAULT_CONSENT_VERSION,
      consentSummary:
        "I confirm I may upload medical documents for clinic coordination. Clinifly does not provide diagnosis. Licensed professionals evaluate my case.",
      requiredFields: ["uploadConsent", "file", "documentType", "clinicId"],
    });
  });

  app.post(
    "/api/patient/me/ai-documents",
    requireToken,
    chatUpload.single("file"),
    async (req, res) => {
      try {
        const patientId = String(req.patientId || "").trim();
        if (!patientId) {
          return res.status(401).json({ ok: false, error: "unauthorized" });
        }
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "no_file" });
        }
        if (!isSupabaseEnabled()) {
          return res.status(503).json({ ok: false, error: "supabase_required" });
        }

        const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim() || null;
        const documentType = String(req.body?.documentType || req.body?.document_type || "").trim();

        let clinicId = String(req.body?.clinicId || req.body?.clinic_id || "").trim();
        let leadProfileId = null;

        const { data: patientRow } = await supabase
          .from("patients")
          .select("id, clinic_id")
          .eq("id", patientId)
          .maybeSingle();

        if (!clinicId && patientRow?.clinic_id) {
          clinicId = String(patientRow.clinic_id);
        }
        if (!UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "clinic_id_required" });
        }

        if (sessionId) {
          const profile = await resolveLeadProfileBySession(sessionId);
          if (profile?.id) {
            leadProfileId = profile.id;
            if (!clinicId && profile.clinic_id) clinicId = String(profile.clinic_id);
          }
        }

        const consentParsed = parsePatientUploadConsent(req.body);
        if (!consentParsed.ok) {
          return res.status(400).json({
            ok: false,
            error: consentParsed.error,
            message:
              "Patient upload consent is required (uploadConsent=true). Use GET /api/patient/me/ai-documents/consent-info for the current consent version.",
          });
        }

        const contentHash = String(
          req.body?.contentHash || req.body?.content_hash || "",
        ).trim();

        const result = await savePatientDocumentUpload({
          file: req.file,
          patientId,
          clinicId,
          leadProfileId,
          sessionId,
          documentType,
          contentHash: contentHash || undefined,
          publicDir,
          uploadedByType: "patient",
          uploadedByUserId: patientId,
          uploadConsent: consentParsed.consent,
        });

        if (!result.ok) {
          const status =
            result.error === "invalid_ids" || result.error === "upload_consent_required"
              ? 400
              : 500;
          return res.status(status).json({ ok: false, error: result.error });
        }

        let operationalIntakeFlags = null;
        let intakeJourney = null;

        if (leadProfileId) {
          const { data: profile } = await supabase
            .from("ai_coordinator_lead_profiles")
            .select(
              "treatment_interest, country, preferred_language, travel_timeline, urgency, booking_intent, budget_signal, operational_intake_flags",
            )
            .eq("id", leadProfileId)
            .maybeSingle();

          const persistedFlags =
            profile?.operational_intake_flags && typeof profile.operational_intake_flags === "object"
              ? profile.operational_intake_flags
              : {};

          const leadData = mergeLeadData(emptyLeadData(), {
            treatmentInterest: profile?.treatment_interest,
            country: profile?.country,
            language: profile?.preferred_language,
            travelTimeline: profile?.travel_timeline,
            urgency: profile?.urgency,
            bookingIntent: profile?.booking_intent,
            budgetSignal: profile?.budget_signal,
            patientReportedTags: normalizeTagList(persistedFlags.patientReportedTags),
          });

          const docs = await listDocumentsForProfile(leadProfileId, { clinicId });
          const syncResult = await syncOperationalIntakeFlags(leadProfileId, leadData, docs);
          operationalIntakeFlags = syncResult.flags || null;
          intakeJourney = operationalIntakeFlags
            ? buildIntakeJourneySteps({
                operationalIntakeFlags,
                documents: docs,
              })
            : null;
        }

        return res.json({
          ok: true,
          reused: result.reused === true,
          document: mapDocumentForApi(result.document),
          operationalIntakeFlags,
          intakeJourney,
        });
      } catch (e) {
        console.error("[POST ai-documents]", e?.message || e);
        return res.status(500).json({ ok: false, error: "server_error" });
      }
    },
  );

  app.get("/api/patient/me/intake-journey", requireToken, async (req, res) => {
    try {
      const patientId = String(req.patientId || "").trim();
      if (!patientId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const sessionId = String(req.query?.sessionId || req.query?.session_id || "").trim();
      const clinicId = String(req.query?.clinicId || req.query?.clinic_id || "").trim();

      let flags = {};
      let leadData = emptyLeadData();
      let documents = await listDocumentsForPatient(patientId, clinicId);

      if (sessionId) {
        const profile = await resolveLeadProfileBySession(sessionId);
        if (profile?.id) {
          const profilePatientId =
            profile.patient_id != null ? String(profile.patient_id).trim() : "";
          if (profilePatientId && profilePatientId !== patientId) {
            console.warn("[GET intake-journey] session profile patient mismatch — ignoring profile flags", {
              tokenPatient: patientId.slice(0, 8),
              profilePatient: profilePatientId.slice(0, 8),
            });
          } else {
          const { data: row } = await supabase
            .from("ai_coordinator_lead_profiles")
            .select(
              "operational_intake_flags, treatment_interest, country, preferred_language, travel_timeline, urgency, booking_intent, budget_signal, patient_id",
            )
            .eq("id", profile.id)
            .maybeSingle();

          flags =
            row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
              ? row.operational_intake_flags
              : {};

          leadData = mergeLeadData(emptyLeadData(), {
            treatmentInterest: row?.treatment_interest,
            country: row?.country,
            language: row?.preferred_language,
            travelTimeline: row?.travel_timeline,
            urgency: row?.urgency,
            bookingIntent: row?.booking_intent,
            budgetSignal: row?.budget_signal,
            patientReportedTags: normalizeTagList(flags.patientReportedTags),
          });

          const profileDocs = await listDocumentsForProfile(profile.id);
          const patientDocs = await listDocumentsForPatient(patientId);
          const docById = new Map();
          for (const row of [...profileDocs, ...patientDocs]) {
            if (row?.id) docById.set(String(row.id), row);
          }
          documents = [...docById.values()].sort((a, b) => {
            const ta = Date.parse(a.uploadedAt || "") || 0;
            const tb = Date.parse(b.uploadedAt || "") || 0;
            return tb - ta;
          });

          if (!Object.keys(flags).length) {
            flags = buildOperationalIntakeState({
              leadData,
              documents,
            });
          }
          }
        }
      } else if (clinicId) {
        flags = buildOperationalIntakeState({
          leadData,
          documents,
        });
      }

      const journey = buildIntakeJourneySteps({
        operationalIntakeFlags: flags,
        documents,
      });

      const readinessPct = flags.readinessPercent ?? 0;
      const clinicDirectory =
        readinessPct >= 45
          ? await searchClinicDirectory({
              city: req.query?.city || req.query?.city_code || leadData.country || null,
              query: req.query?.directoryQuery || leadData.country || null,
              limit: 8,
            })
          : null;

      const treatmentGuideWorkspace = await loadTreatmentGuideWorkspace(patientId, flags);

      const clinicInquiryDraft = buildClinicInquiryDraft({
        leadData,
        operationalIntakeFlags: flags,
        documents,
        patientNarrative:
          String(req.query?.patientNarrative || req.query?.narrative || "").trim() ||
          treatmentGuideWorkspace.patientNarrative ||
          null,
        photoGuidanceSummary: String(req.query?.photoGuidance || "").trim() || null,
        hasDentalPhoto:
          String(req.query?.hasDentalPhoto || "") === "1" || !!treatmentGuideWorkspace.photoUrl,
        dentalPhotoUrl: treatmentGuideWorkspace.photoUrl || null,
      });

      return res.json({
        ok: true,
        leadData,
        operationalIntakeFlags: flags,
        activeAppointment:
          flags.activeAppointment && typeof flags.activeAppointment === "object"
            ? flags.activeAppointment
            : null,
        intakeJourney: journey,
        documents: documents.map(mapDocumentForApi),
        clinicDirectory,
        clinicInquiryDraft,
        treatmentGuideWorkspace,
      });
    } catch (e) {
      console.error("[GET intake-journey]", e?.message || e);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.patch("/api/patient/me/treatment-guide-workspace", requireToken, async (req, res) => {
    try {
      const patientId = String(req.patientId || "").trim();
      if (!patientId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim();
      if (!sessionId) {
        return res.status(400).json({ ok: false, error: "session_id_required" });
      }

      const profile = await resolveLeadProfileBySession(sessionId);
      if (!profile?.id) {
        return res.status(404).json({ ok: false, error: "profile_not_found" });
      }

      const { data: row } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("operational_intake_flags, patient_id")
        .eq("id", profile.id)
        .maybeSingle();

      if (row?.patient_id && String(row.patient_id) !== patientId) {
        return res.status(403).json({ ok: false, error: "patient_mismatch" });
      }

      const prevFlags =
        row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
          ? row.operational_intake_flags
          : {};

      const patch = {};
      if (req.body?.patientNarrative != null || req.body?.narrative != null) {
        patch.patientNarrative = String(req.body.patientNarrative ?? req.body.narrative ?? "").slice(
          0,
          4000,
        );
      }
      if (req.body?.inquiryDraftText != null || req.body?.inquiry_draft != null) {
        patch.inquiryDraftText = String(
          req.body.inquiryDraftText ?? req.body.inquiry_draft ?? "",
        ).slice(0, 8000);
      }
      if (req.body?.photoUrl != null || req.body?.photo_url != null) {
        patch.photoUrl = String(req.body.photoUrl ?? req.body.photo_url ?? "").trim() || null;
      }
      if (req.body?.contentHash != null || req.body?.content_hash != null) {
        const h = normalizeContentHash(req.body.contentHash ?? req.body.content_hash);
        if (h) patch.contentHash = h;
      }
      if (req.body?.photoSavedAt != null) patch.photoSavedAt = req.body.photoSavedAt;
      if (req.body?.analysisSavedAt != null) patch.analysisSavedAt = req.body.analysisSavedAt;
      if (req.body?.analysisSnapshot && typeof req.body.analysisSnapshot === "object") {
        patch.analysisSnapshot = req.body.analysisSnapshot;
      }

      const flags = mergeWorkspaceIntoFlags(prevFlags, patch);
      const { error } = await supabase
        .from("ai_coordinator_lead_profiles")
        .update({
          operational_intake_flags: flags,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id);

      if (error) {
        console.warn("[PATCH treatment-guide-workspace]", error.message);
        return res.status(500).json({ ok: false, error: "save_failed" });
      }

      const treatmentGuideWorkspace = await loadTreatmentGuideWorkspace(patientId, flags);
      return res.json({ ok: true, treatmentGuideWorkspace, operationalIntakeFlags: flags });
    } catch (e) {
      console.error("[PATCH treatment-guide-workspace]", e?.message || e);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.get("/api/patient/me/clinic-directory", requireToken, async (req, res) => {
    try {
      const city = req.query?.city || req.query?.city_code || null;
      const query = req.query?.query || req.query?.q || null;
      const limit = Math.min(parseInt(String(req.query?.limit || "12"), 10) || 12, 30);
      const directory = await searchClinicDirectory({ city, query, limit });
      return res.json({ ok: true, ...directory });
    } catch (e) {
      console.error("[GET clinic-directory]", e?.message || e);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.get("/api/patient/me/ai-documents", requireToken, async (req, res) => {
    try {
      const patientId = String(req.patientId || "").trim();
      if (!patientId) return res.status(401).json({ ok: false, error: "unauthorized" });

      const clinicId = String(req.query?.clinicId || req.query?.clinic_id || "").trim();
      const docs = await listDocumentsForPatient(patientId, clinicId);
      return res.json({
        ok: true,
        documents: docs.map(mapDocumentForApi),
        documentTypes: DOCUMENT_TYPES,
        consentVersion: DEFAULT_CONSENT_VERSION,
      });
    } catch (e) {
      console.error("[GET ai-documents]", e?.message || e);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  const adminRouter = express.Router();

  adminRouter.post(
    "/ai-leads/:profileId/documents/upload",
    requireAdminAuth,
    chatUpload.single("file"),
    async (req, res) => {
      try {
        const clinicId = String(req.clinicId || "").trim();
        const profileId = String(req.params.profileId || "").trim();
        if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId)) {
          return res.status(400).json({ ok: false, error: "invalid_id" });
        }
        if (!req.file) return res.status(400).json({ ok: false, error: "no_file" });
        if (!isSupabaseEnabled()) {
          return res.status(503).json({ ok: false, error: "supabase_required" });
        }

        const { data: profile } = await supabase
          .from("ai_coordinator_lead_profiles")
          .select("id, patient_id, clinic_id, session_id")
          .eq("id", profileId)
          .eq("clinic_id", clinicId)
          .maybeSingle();

        if (!profile?.patient_id) {
          return res.status(404).json({ ok: false, error: "profile_or_patient_not_found" });
        }

        const adminId =
          req.admin?.adminId || req.admin?.userId || req.user?.adminId || req.user?.userId;
        const uploadedByUserId =
          adminId && UUID_RE.test(String(adminId)) ? String(adminId) : null;

        const documentType = String(req.body?.documentType || req.body?.document_type || "other").trim();

        const result = await savePatientDocumentUpload({
          file: req.file,
          patientId: profile.patient_id,
          clinicId,
          leadProfileId: profileId,
          sessionId: profile.session_id || null,
          documentType,
          publicDir,
          uploadedByType: "clinic",
          uploadedByUserId,
          uploadConsent: null,
        });

        if (!result.ok) {
          return res.status(500).json({ ok: false, error: result.error });
        }

        const { data: leadRow } = await supabase
          .from("ai_coordinator_lead_profiles")
          .select(
            "treatment_interest, country, preferred_language, travel_timeline, urgency, booking_intent, budget_signal",
          )
          .eq("id", profileId)
          .maybeSingle();

        const leadData = leadRow
          ? mergeLeadData(emptyLeadData(), {
              treatmentInterest: leadRow.treatment_interest,
              country: leadRow.country,
              language: leadRow.preferred_language,
              travelTimeline: leadRow.travel_timeline,
              urgency: leadRow.urgency,
              bookingIntent: leadRow.booking_intent,
              budgetSignal: leadRow.budget_signal,
            })
          : emptyLeadData();

        const docs = await listDocumentsForProfile(profileId, { clinicId });
        await syncOperationalIntakeFlags(profileId, leadData, docs);

        return res.json({ ok: true, document: mapDocumentForApi(result.document) });
      } catch (e) {
        console.error("[POST admin document upload]", e?.message || e);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );

  adminRouter.patch("/ai-leads/:profileId/documents/:documentId", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinicId || "").trim();
      const profileId = String(req.params.profileId || "").trim();
      const documentId = String(req.params.documentId || "").trim();

      if (!UUID_RE.test(clinicId) || !UUID_RE.test(profileId) || !UUID_RE.test(documentId)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const adminId =
        req.admin?.adminId || req.admin?.userId || req.user?.adminId || req.user?.userId;
      const reviewedBy = adminId && UUID_RE.test(String(adminId)) ? String(adminId) : null;

      const result = await updateDocumentReview(clinicId, documentId, {
        reviewStatus: req.body?.reviewStatus ?? req.body?.review_status,
        coordinatorNotes: req.body?.coordinatorNotes ?? req.body?.coordinator_notes,
        reviewedBy,
      });

      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 500;
        return res.status(status).json({ ok: false, error: result.error });
      }

      return res.json({ ok: true, document: mapDocumentForApi(result.document) });
    } catch (e) {
      console.error("[PATCH document]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.use("/api/admin", adminRouter);
}

module.exports = { registerAiPatientDocumentRoutes };
