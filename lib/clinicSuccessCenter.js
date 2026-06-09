/**
 * Clinic Success Center — profile completion, smart recommendations, guidance messages.
 */

const { MARKETPLACE_SELECT } = require("./clinicMarketplaceProfile");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { normalizeAiRepliesConfig, REPLY_MODE } = require("./aiReplyOrchestration");
const { reputationSourceIsVisible, buildReputationSourcesFromRow } = require("./clinicReputation");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUCCESS_ITEM_DEFS = [
  { id: "logo", label: "Logo" },
  { id: "description", label: "Description" },
  { id: "doctors", label: "Doctors" },
  { id: "photos", label: "Photos" },
  { id: "googleReviews", label: "Google Reviews" },
  { id: "facebookReviews", label: "Facebook Reviews" },
  { id: "socialLinks", label: "Social Links" },
  { id: "languages", label: "Languages" },
  { id: "aiSetup", label: "AI Setup" },
];

const RECOMMENDATION_DEFS = {
  logo: {
    title: "Add your clinic logo",
    message: "Add your clinic logo so patients recognize your brand in search results.",
    whyItMatters:
      "Clinics with a logo look more professional and get more profile views from international patients.",
    actionLabel: "Add logo",
    actionHref: "/admin-marketplace-profile.html#media",
    priority: 10,
  },
  description: {
    title: "Write a short clinic description",
    message: "Add a short description that explains what makes your clinic special.",
    whyItMatters:
      "A clear description helps patients understand your services before they contact you.",
    actionLabel: "Edit description",
    actionHref: "/admin-marketplace-profile.html#clinic-info",
    priority: 9,
  },
  doctors: {
    title: "Add doctor profiles",
    message: "Add doctor profiles so patients can learn more about your team.",
    whyItMatters:
      "Patients often choose clinics based on doctor credentials, experience, and specializations.",
    actionLabel: "Manage doctors",
    actionHref: "/admin-doctor-applications-v2.html",
    priority: 8,
  },
  photos: {
    title: "Add clinic photos",
    message: "Upload clinic photos to show patients your facilities and build trust.",
    whyItMatters:
      "Visual proof of your clinic environment increases inquiry quality and conversion rates.",
    actionLabel: "Add photos",
    actionHref: "/admin-marketplace-profile.html#media",
    priority: 7,
  },
  googleReviews: {
    title: "Add your Google Reviews",
    message: "Add your Google Reviews so patients can trust your clinic.",
    whyItMatters:
      "Google ratings are one of the first trust signals patients check when comparing clinics.",
    actionLabel: "Add Google Reviews",
    actionHref: "/admin-marketplace-profile.html#reputation",
    priority: 6,
  },
  facebookReviews: {
    title: "Add Facebook recommendations",
    message: "Add your Facebook recommendation score so patients see social proof.",
    whyItMatters:
      "Facebook recommendations help international patients who discover your clinic on social media.",
    actionLabel: "Add Facebook Reviews",
    actionHref: "/admin-marketplace-profile.html#reputation",
    priority: 5,
  },
  socialLinks: {
    title: "Connect social links",
    message: "Add your website and social media links so patients can verify your clinic.",
    whyItMatters:
      "Active social presence signals that your clinic is real, responsive, and established.",
    actionLabel: "Add social links",
    actionHref: "/admin-marketplace-profile.html#social",
    priority: 4,
  },
  languages: {
    title: "Add supported languages",
    message: "List the languages your team speaks to attract international patients.",
    whyItMatters:
      "Language filters help patients find clinics they can communicate with comfortably.",
    actionLabel: "Add languages",
    actionHref: "/admin-marketplace-profile.html#clinic-info",
    priority: 3,
  },
  aiSetup: {
    title: "Enable AI Assistant",
    message: "Enable AI Assistant to answer patient questions 24/7.",
    whyItMatters:
      "Clinics with AI enabled respond faster, capture more leads, and reduce staff workload.",
    actionLabel: "Set up AI",
    actionHref: "/admin-settings.html#ai-communication",
    priority: 2,
  },
};

const ONBOARDING_CAMPAIGN_STEPS = [
  { day: 1, key: "day1_logo", itemId: "logo", label: "Add logo" },
  { day: 3, key: "day3_google_reviews", itemId: "googleReviews", label: "Add Google Reviews" },
  { day: 5, key: "day5_doctors", itemId: "doctors", label: "Add doctors" },
  { day: 7, key: "day7_ai_assistant", itemId: "aiSetup", label: "Enable AI Assistant" },
];

function hasText(val) {
  return String(val || "").trim().length > 0;
}

function hasUrl(val) {
  const s = String(val || "").trim();
  return s.length > 4 && /^https?:\/\//i.test(s);
}

function arrLen(val) {
  return Array.isArray(val) ? val.filter(Boolean).length : 0;
}

function parseSettings(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === "object" ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function mediaGallery(clinicRow) {
  const mg = clinicRow?.media_gallery;
  if (mg && typeof mg === "object" && !Array.isArray(mg)) return mg;
  return {};
}

function objectHasMeaningfulContent(obj, minKeys = 1) {
  if (!obj || typeof obj !== "object") return false;
  let n = 0;
  for (const val of Object.values(obj)) {
    if (val == null) continue;
    if (typeof val === "string" && val.trim()) n += 1;
    else if (Array.isArray(val) && val.length) n += 1;
    else if (typeof val === "object" && Object.keys(val).length) n += 1;
    else if (typeof val === "number" || typeof val === "boolean") n += 1;
  }
  return n >= minKeys;
}

function computeAiTrainingPercent(profile, settings) {
  const tone = profile?.tone || {};
  const materials = profile?.materials || {};
  const logistics = profile?.logistics || {};
  const kb = profile?.knowledgeBase || {};
  const learned = kb.learnedPatterns || kb.learned_patterns || {};
  const docs =
    kb.documents ||
    kb.uploadedDocuments ||
    materials.documents ||
    materials.uploadedDocuments ||
    [];

  const sources = {
    clinicInformation:
      objectHasMeaningfulContent(tone) ||
      objectHasMeaningfulContent(logistics) ||
      hasText(settings?.clinicDescription),
    treatments:
      arrLen(materials.treatments) > 0 ||
      arrLen(materials.services) > 0 ||
      arrLen(materials.procedures) > 0,
    faqs: arrLen(learned.faqs) > 0 || arrLen(kb.faqs) > 0,
    uploadedDocuments: arrLen(docs) > 0 || arrLen(kb.files) > 0,
    websiteImported:
      settings?.aiTraining?.websiteImported === true ||
      hasText(kb.websiteImportUrl) ||
      hasText(kb.websiteSnapshot) ||
      objectHasMeaningfulContent(kb.websiteContent),
    manualKnowledgeBase:
      arrLen(learned.phrases) > 0 ||
      arrLen(learned.insights) > 0 ||
      arrLen(learned.greetings) > 0 ||
      objectHasMeaningfulContent(profile?.internalNotes),
  };

  const keys = Object.keys(sources);
  const done = keys.filter((k) => sources[k]).length;
  return keys.length ? Math.round((done / keys.length) * 100) : 0;
}

function isAiSetupComplete(profile, settings) {
  const comm = profile?.communicationPolicy || {};
  const aiReplies = normalizeAiRepliesConfig(comm);
  const replyMode = String(aiReplies.replyMode || REPLY_MODE.INSTANT).toLowerCase();
  const configured = profile?.isConfigured === true;
  const enabled =
    configured && replyMode !== REPLY_MODE.HUMAN_ONLY && aiReplies.instantEnabled !== false;
  const trainingPercent = computeAiTrainingPercent(profile, settings);
  return enabled && trainingPercent >= 40;
}

function evaluateSuccessChecks(ctx) {
  const row = ctx.clinicRow || {};
  const mg = mediaGallery(row);
  const photos = [
    ...(Array.isArray(mg.photos) ? mg.photos : []),
    ...(Array.isArray(mg.gallery) ? mg.gallery : []),
  ].filter(Boolean);
  const reputation = buildReputationSourcesFromRow(row);
  const hasSocial =
    hasUrl(row.website_url || row.website) ||
    hasUrl(row.facebook_url) ||
    hasUrl(row.instagram_url) ||
    hasUrl(row.tiktok_url) ||
    hasUrl(row.youtube_url) ||
    hasUrl(row.linkedin_url);

  return {
    logo: hasUrl(row.logo_url) || hasUrl(row.cover_photo_url) || hasUrl(mg.logoUrl || mg.logo_url),
    description: hasText(row.short_description) || hasText(row.about_text),
    doctors: (ctx.doctorCount ?? 0) > 0,
    photos: photos.length > 0 || hasUrl(row.cover_photo_url),
    googleReviews: reputationSourceIsVisible(reputation.google),
    facebookReviews: reputationSourceIsVisible(reputation.facebook),
    socialLinks: hasSocial,
    languages: arrLen(row.languages) > 0,
    aiSetup: isAiSetupComplete(ctx.aiProfile, ctx.settings),
  };
}

function buildBreakdown(checks) {
  return SUCCESS_ITEM_DEFS.map((item) => ({
    id: item.id,
    label: item.label,
    complete: !!checks[item.id],
  }));
}

function buildRecommendations(breakdown) {
  return breakdown
    .filter((item) => !item.complete)
    .map((item) => {
      const def = RECOMMENDATION_DEFS[item.id] || {};
      return {
        id: item.id,
        itemId: item.id,
        title: def.title || `Complete ${item.label}`,
        message: def.message || `Complete ${item.label} to improve your profile.`,
        whyItMatters: def.whyItMatters || "",
        actionLabel: def.actionLabel || "Go to settings",
        actionHref: def.actionHref || "/admin-success-center.html",
        priority: def.priority ?? 0,
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

function resolveOnboardingAnchorDate(clinicRow, settings) {
  const sc = settings?.successCenter || {};
  if (sc.onboardingStartedAt) return sc.onboardingStartedAt;
  return clinicRow?.created_at || clinicRow?.updated_at || new Date().toISOString();
}

function buildOnboardingCampaign(checks, clinicRow, settings) {
  const anchor = resolveOnboardingAnchorDate(clinicRow, settings);
  const anchorMs = Date.parse(String(anchor));
  const nowMs = Date.now();
  const daysSinceStart = Number.isFinite(anchorMs)
    ? Math.max(0, Math.floor((nowMs - anchorMs) / 86400000))
    : 0;
  const completedKeys = new Set(settings?.successCenter?.completedCampaignSteps || []);

  const steps = ONBOARDING_CAMPAIGN_STEPS.map((step) => {
    const itemComplete = !!checks[step.itemId];
    const due = daysSinceStart >= step.day - 1;
    const status = itemComplete
      ? "completed"
      : due
        ? "due"
        : daysSinceStart >= step.day - 2
          ? "upcoming"
          : "scheduled";
    return {
      ...step,
      status,
      complete: itemComplete,
      completedAt: completedKeys.has(step.key) ? step.key : null,
    };
  });

  const nextStep = steps.find((s) => !s.complete && s.status !== "scheduled") || null;

  return {
    startedAt: anchor,
    daysSinceStart,
    steps,
    nextStep,
    automationReady: true,
  };
}

function buildAutoGuidanceMessage(snapshot) {
  const missing = snapshot.breakdown.filter((b) => !b.complete).map((b) => b.label);
  if (!missing.length) {
    return "Great work! Your profile is fully complete and ready to receive patient inquiries.";
  }
  const top = missing.slice(0, 3);
  const tail =
    top.length === 1
      ? top[0]
      : top.length === 2
        ? `${top[0]} and ${top[1]}`
        : `${top[0]}, ${top[1]}, and ${top[2]}`;
  return `Your profile is ${snapshot.profileCompletionPercent}% complete. Add ${tail} to improve visibility.`;
}

function computeSuccessCenterSnapshot(ctx) {
  const checks = evaluateSuccessChecks(ctx);
  const breakdown = buildBreakdown(checks);
  const completedCount = breakdown.filter((b) => b.complete).length;
  const profileCompletionPercent = breakdown.length
    ? Math.round((completedCount / breakdown.length) * 100)
    : 0;
  const recommendations = buildRecommendations(breakdown);
  const onboardingCampaign = buildOnboardingCampaign(
    checks,
    ctx.clinicRow,
    ctx.settings,
  );
  const aiTrainingPercent = computeAiTrainingPercent(ctx.aiProfile, ctx.settings);

  return {
    profileCompletionPercent,
    completedCount,
    totalCount: breakdown.length,
    breakdown,
    recommendations,
    onboardingCampaign,
    aiTrainingPercent,
    readinessLabel:
      profileCompletionPercent >= 85
        ? "Ready for inquiries"
        : profileCompletionPercent >= 60
          ? "Almost there"
          : profileCompletionPercent >= 35
            ? "Getting started"
            : "Needs setup",
    suggestedGuidanceMessage: buildAutoGuidanceMessage({
      profileCompletionPercent,
      breakdown,
    }),
  };
}

function isMissingColumnError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /column|schema|does not exist/i.test(msg)
  );
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation.*does not exist|could not find the table|schema cache/i.test(msg)
  );
}

const CLINIC_ROW_SELECT_ATTEMPTS = [
  MARKETPLACE_SELECT,
  `
  id, name, clinic_code, country, city, city_code, settings, status, is_listed, logo_url, cover_photo_url,
  short_description, about_text,
  website, website_url, facebook_url, instagram_url, tiktok_url, youtube_url, linkedin_url, whatsapp,
  google_maps_url, google_reviews_url, google_rating, google_review_count,
  trustpilot_url, trustpilot_rating, trustpilot_review_count,
  years_in_operation, international_patient_count,
  languages, specialties, services, technologies, certifications, awards,
  media_gallery, working_hours,
  is_verified, is_featured, featured_until, listing_tier, created_at, updated_at
  `,
];

async function fetchClinicRow(supabase, clinicId) {
  let lastErr = null;
  for (let i = 0; i < CLINIC_ROW_SELECT_ATTEMPTS.length; i += 1) {
    const sel = CLINIC_ROW_SELECT_ATTEMPTS[i];
    const { data, error } = await supabase
      .from("clinics")
      .select(sel)
      .eq("id", clinicId)
      .maybeSingle();
    if (!error) return data;
    lastErr = error;
    if (!isMissingColumnError(error)) break;
  }
  if (lastErr) throw new Error(lastErr.message);
  return null;
}

async function countClinicDoctors(supabase, clinicId) {
  try {
    const { count, error } = await supabase
      .from("doctors")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);
    if (error) return 0;
    return count ?? 0;
  } catch (_) {
    return 0;
  }
}

async function loadGuidanceFromSettings(supabase, clinicId) {
  const { data } = await supabase.from("clinics").select("settings").eq("id", clinicId).maybeSingle();
  const settings = parseSettings(data?.settings);
  const list = Array.isArray(settings?.successCenter?.guidanceMessages)
    ? settings.successCenter.guidanceMessages
    : [];
  return list.slice(0, 30);
}

async function listGuidanceMessages(supabase, clinicId) {
  const { data, error } = await supabase
    .from("clinic_guidance_messages")
    .select("id, clinic_id, message, message_type, campaign_key, sent_by, read_at, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    if (isMissingTableError(error)) return loadGuidanceFromSettings(supabase, clinicId);
    throw error;
  }
  return data || [];
}

async function countUnreadGuidanceMessages(supabase, clinicId) {
  const { count, error } = await supabase
    .from("clinic_guidance_messages")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .is("read_at", null);

  if (!error) return Number(count || 0);

  if (isMissingTableError(error)) {
    const list = await loadGuidanceFromSettings(supabase, clinicId);
    return (list || []).filter((m) => !m.read_at).length;
  }
  throw error;
}

async function insertGuidanceMessage(supabase, clinicId, payload) {
  const row = {
    clinic_id: clinicId,
    message: String(payload.message || "").trim(),
    message_type: payload.messageType || "guidance",
    campaign_key: payload.campaignKey || null,
    sent_by: payload.sentBy || "super-admin",
  };
  if (!row.message) throw new Error("message_required");

  const { data, error } = await supabase
    .from("clinic_guidance_messages")
    .insert(row)
    .select("id, clinic_id, message, message_type, campaign_key, sent_by, read_at, created_at")
    .maybeSingle();

  if (!error && data) return data;

  if (error && isMissingTableError(error)) {
    const { data: clinic } = await supabase.from("clinics").select("settings").eq("id", clinicId).maybeSingle();
    const settings = parseSettings(clinic?.settings);
    const prev = Array.isArray(settings?.successCenter?.guidanceMessages)
      ? settings.successCenter.guidanceMessages
      : [];
    const entry = {
      id: `local-${Date.now()}`,
      clinic_id: clinicId,
      message: row.message,
      message_type: row.message_type,
      campaign_key: row.campaign_key,
      sent_by: row.sent_by,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    const nextSettings = {
      ...settings,
      successCenter: {
        ...(settings.successCenter || {}),
        guidanceMessages: [entry, ...prev].slice(0, 50),
      },
    };
    await supabase.from("clinics").update({ settings: nextSettings }).eq("id", clinicId);
    return entry;
  }

  throw error || new Error("insert_failed");
}

async function markGuidanceMessageRead(supabase, clinicId, messageId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("clinic_guidance_messages")
    .update({ read_at: now })
    .eq("id", messageId)
    .eq("clinic_id", clinicId)
    .select("id, read_at")
    .maybeSingle();

  if (!error && data) return data;

  if (error && isMissingTableError(error)) {
    const { data: clinic } = await supabase.from("clinics").select("settings").eq("id", clinicId).maybeSingle();
    const settings = parseSettings(clinic?.settings);
    const list = Array.isArray(settings?.successCenter?.guidanceMessages)
      ? settings.successCenter.guidanceMessages
      : [];
    const next = list.map((m) =>
      String(m.id) === String(messageId) ? { ...m, read_at: now } : m,
    );
    await supabase
      .from("clinics")
      .update({
        settings: {
          ...settings,
          successCenter: { ...(settings.successCenter || {}), guidanceMessages: next },
        },
      })
      .eq("id", clinicId);
    return { id: messageId, read_at: now };
  }

  throw error || new Error("update_failed");
}

async function buildSuccessCenterPayload(supabase, clinicId) {
  const row = await fetchClinicRow(supabase, clinicId);
  if (!row) return null;
  const [doctorCount, aiProfile, guidanceMessages] = await Promise.all([
    countClinicDoctors(supabase, clinicId),
    getClinicAiProfile(clinicId).catch(() => ({ isConfigured: false })),
    listGuidanceMessages(supabase, clinicId).catch(() => []),
  ]);
  const settings = parseSettings(row.settings);
  const snapshot = computeSuccessCenterSnapshot({
    clinicRow: row,
    doctorCount,
    aiProfile,
    settings,
  });
  const unreadGuidanceCount = (guidanceMessages || []).filter((m) => !m.read_at).length;

  return {
    clinicId,
    clinicName: String(row.name || "").trim() || "Clinic",
    isListed: row.is_listed === true || row.is_listed === "true",
    ...snapshot,
    guidanceMessages,
    unreadGuidanceCount,
  };
}

/**
 * @param {import("express").Express} app
 * @param {{ supabase: object, requireAdminAuth: Function, superAdminGuard: Function }} deps
 */
function registerClinicSuccessCenterRoutes(app, deps) {
  const { supabase, requireAdminAuth, superAdminGuard } = deps;

  app.get("/api/admin/success-center/unread-count", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinic?.id || req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic" });
      }
      const unreadGuidanceCount = await countUnreadGuidanceMessages(supabase, clinicId);
      return res.json({ ok: true, unreadGuidanceCount });
    } catch (e) {
      console.error("[GET /api/admin/success-center/unread-count]", e?.message || e);
      return res.status(500).json({ ok: false, error: "success_center_failed" });
    }
  });

  app.get("/api/admin/success-center", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinic?.id || req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic" });
      }
      const payload = await buildSuccessCenterPayload(supabase, clinicId);
      if (!payload) return res.status(404).json({ ok: false, error: "clinic_not_found" });
      return res.json({ ok: true, successCenter: payload });
    } catch (e) {
      console.error("[GET /api/admin/success-center]", e?.message || e);
      return res.status(500).json({ ok: false, error: "success_center_failed" });
    }
  });

  app.patch("/api/admin/success-center/messages/:messageId/read", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinic?.id || req.clinicId || "").trim();
      const messageId = String(req.params?.messageId || "").trim();
      if (!UUID_RE.test(clinicId) || !messageId) {
        return res.status(400).json({ ok: false, error: "invalid_request" });
      }
      const updated = await markGuidanceMessageRead(supabase, clinicId, messageId);
      return res.json({ ok: true, message: updated });
    } catch (e) {
      console.error("[PATCH success-center message read]", e?.message || e);
      return res.status(500).json({ ok: false, error: "mark_read_failed" });
    }
  });

  app.get(
    "/api/super-admin/clinics/:clinicId/success-center",
    superAdminGuard,
    async (req, res) => {
      try {
        const clinicId = String(req.params?.clinicId || "").trim();
        if (!UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_clinic" });
        }
        const payload = await buildSuccessCenterPayload(supabase, clinicId);
        if (!payload) return res.status(404).json({ ok: false, error: "clinic_not_found" });
        return res.json({ ok: true, successCenter: payload });
      } catch (e) {
        console.error("[GET super-admin success-center]", e?.message || e);
        return res.status(500).json({ ok: false, error: "success_center_failed" });
      }
    },
  );

  app.post(
    "/api/super-admin/clinics/:clinicId/guidance-message",
    superAdminGuard,
    async (req, res) => {
      try {
        const clinicId = String(req.params?.clinicId || "").trim();
        if (!UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_clinic" });
        }
        const body = req.body && typeof req.body === "object" ? req.body : {};
        let message = String(body.message || "").trim();
        if (!message && body.useSuggested !== false) {
          const payload = await buildSuccessCenterPayload(supabase, clinicId);
          message = payload?.suggestedGuidanceMessage || "";
        }
        if (!message) {
          return res.status(400).json({ ok: false, error: "message_required" });
        }
        const sentBy = String(req.superAdmin?.email || "super-admin").trim();
        const saved = await insertGuidanceMessage(supabase, clinicId, {
          message,
          messageType: body.messageType || "guidance",
          campaignKey: body.campaignKey || null,
          sentBy,
        });
        return res.json({ ok: true, message: saved });
      } catch (e) {
        console.error("[POST guidance-message]", e?.message || e);
        return res.status(500).json({ ok: false, error: "send_guidance_failed" });
      }
    },
  );
}

module.exports = {
  registerClinicSuccessCenterRoutes,
  computeSuccessCenterSnapshot,
  buildAutoGuidanceMessage,
  SUCCESS_ITEM_DEFS,
  ONBOARDING_CAMPAIGN_STEPS,
};
