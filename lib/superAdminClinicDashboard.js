/**
 * Super Admin — clinic operational cockpit (health, channels, AI, marketplace, subscription).
 */

const { getClinicAiProfile } = require("./clinicAiSettings");
const { normalizeAiRepliesConfig, REPLY_MODE } = require("./aiReplyOrchestration");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PACKAGE_LABELS = {
  FREE: "Free",
  BASIC: "Starter",
  STARTER: "Starter",
  PRO: "Professional",
  PROFESSIONAL: "Professional",
  PREMIUM: "Enterprise",
  ENTERPRISE: "Enterprise",
};

const PACKAGE_TIERS = ["FREE", "BASIC", "PRO", "PREMIUM"];

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

function displayPackage(plan) {
  const key = String(plan || "FREE")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return PACKAGE_LABELS[key] || key;
}

function normalizePackageKey(label) {
  const u = String(label || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (u === "STARTER") return "BASIC";
  if (u === "PROFESSIONAL") return "PRO";
  if (u === "ENTERPRISE") return "PREMIUM";
  if (PACKAGE_TIERS.includes(u)) return u;
  return "FREE";
}

function tierIndex(plan) {
  const p = normalizePackageKey(plan);
  const idx = PACKAGE_TIERS.indexOf(p);
  return idx >= 0 ? idx : 0;
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist|schema cache|could not find the table/i.test(msg)
  );
}

async function safeTableQuery(supabase, table, buildQuery) {
  try {
    const { data, error } = await buildQuery(supabase.from(table));
    if (error) {
      if (isMissingTableError(error)) return { ok: false, data: null, missing: true };
      return { ok: false, data: null, error: error.message };
    }
    return { ok: true, data: data || [] };
  } catch (e) {
    return { ok: false, data: null, error: e?.message || "query_failed" };
  }
}

function mediaGallery(clinicRow) {
  const mg = clinicRow?.media_gallery;
  if (mg && typeof mg === "object" && !Array.isArray(mg)) return mg;
  return {};
}

function computeMarketplaceChecklist(clinicRow, doctorCount) {
  const mg = mediaGallery(clinicRow);
  const photos = [
    ...(Array.isArray(mg.photos) ? mg.photos : []),
    ...(Array.isArray(mg.gallery) ? mg.gallery : []),
  ].filter(Boolean);
  const hasSocial =
    hasUrl(clinicRow?.website_url) ||
    hasUrl(clinicRow?.facebook_url) ||
    hasUrl(clinicRow?.instagram_url) ||
    hasUrl(clinicRow?.tiktok_url) ||
    hasUrl(clinicRow?.youtube_url) ||
    hasUrl(clinicRow?.linkedin_url);
  const hasGoogleReviews =
    (Number(clinicRow?.google_review_count) || 0) > 0 ||
    (Number(clinicRow?.google_rating) || 0) > 0 ||
    hasUrl(clinicRow?.google_reviews_url);

  const checklist = {
    logo: hasUrl(mg.logoUrl || mg.logo_url || clinicRow?.logo_url || clinicRow?.cover_photo_url),
    description: hasText(clinicRow?.short_description) || hasText(clinicRow?.about_text),
    doctors: doctorCount > 0,
    photos: photos.length > 0 || hasUrl(clinicRow?.cover_photo_url),
    specialties: arrLen(clinicRow?.specialties) > 0,
    languages: arrLen(clinicRow?.languages) > 0,
    googleReviews: hasGoogleReviews,
    socialLinks: hasSocial,
  };

  const keys = Object.keys(checklist);
  const done = keys.filter((k) => checklist[k]).length;
  const percent = keys.length ? Math.round((done / keys.length) * 100) : 0;

  return { checklist, percent, completed: done, total: keys.length };
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

function computeTrainingSources(profile, settings) {
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

  const clinicInformation =
    objectHasMeaningfulContent(tone) ||
    objectHasMeaningfulContent(logistics) ||
    hasText(settings?.clinicDescription);

  const treatments =
    arrLen(materials.treatments) > 0 ||
    arrLen(materials.services) > 0 ||
    arrLen(materials.procedures) > 0;

  const faqs = arrLen(learned.faqs) > 0 || arrLen(kb.faqs) > 0;

  const uploadedDocuments = arrLen(docs) > 0 || arrLen(kb.files) > 0;

  const websiteImported =
    settings?.aiTraining?.websiteImported === true ||
    hasText(kb.websiteImportUrl) ||
    hasText(kb.websiteSnapshot) ||
    objectHasMeaningfulContent(kb.websiteContent);

  const manualKnowledgeBase =
    arrLen(learned.phrases) > 0 ||
    arrLen(learned.insights) > 0 ||
    arrLen(learned.greetings) > 0 ||
    objectHasMeaningfulContent(profile?.internalNotes);

  const sources = {
    clinicInformation,
    treatments,
    faqs,
    uploadedDocuments,
    websiteImported,
    manualKnowledgeBase,
  };

  const keys = Object.keys(sources);
  const done = keys.filter((k) => sources[k]).length;
  const percent = keys.length ? Math.round((done / keys.length) * 100) : 0;

  return { sources, percent, completed: done, total: keys.length };
}

function resolveAiEnabled(profile) {
  const comm = profile?.communicationPolicy || {};
  const aiReplies = normalizeAiRepliesConfig(comm);
  const replyMode = String(aiReplies.replyMode || REPLY_MODE.INSTANT).toLowerCase();
  const globalEnabled =
    profile?.isConfigured === true &&
    replyMode !== REPLY_MODE.HUMAN_ONLY &&
    aiReplies.instantEnabled !== false;
  return { globalEnabled, replyMode, aiReplies };
}

async function fetchChannelConnections(supabase, clinicId) {
  const out = {
    whatsapp: { connected: false, connectionCount: 0, rows: [] },
    messenger: { connected: false, connectionCount: 0, rows: [] },
  };

  const tables = [
    { channel: "whatsapp", tables: ["whatsapp_phone_connections", "clinic_whatsapp_connections"] },
    { channel: "messenger", tables: ["meta_page_connections", "clinic_meta_page_connections"] },
  ];

  for (const spec of tables) {
    for (const table of spec.tables) {
      const res = await safeTableQuery(supabase, table, (q) =>
        q.select("*").eq("clinic_id", clinicId).limit(20),
      );
      if (res.ok && Array.isArray(res.data) && res.data.length) {
        const active = res.data.filter(
          (r) =>
            r.is_active !== false &&
            String(r.status || "active").toLowerCase() !== "disconnected" &&
            String(r.status || "active").toLowerCase() !== "revoked",
        );
        out[spec.channel].rows = active.length ? active : res.data;
        out[spec.channel].connectionCount = out[spec.channel].rows.length;
        out[spec.channel].connected = out[spec.channel].connectionCount > 0;
        break;
      }
    }
  }

  // Fallback: channel identities prove at least one linked conversation existed
  const identRes = await safeTableQuery(supabase, "channel_identities", (q) =>
    q.select("channel, updated_at, created_at").eq("clinic_id", clinicId).limit(200),
  );
  if (identRes.ok && Array.isArray(identRes.data)) {
    for (const row of identRes.data) {
      const ch = String(row.channel || "").toLowerCase();
      if (ch === "whatsapp" && !out.whatsapp.connected) {
        out.whatsapp.connected = true;
        out.whatsapp.connectionCount = Math.max(1, out.whatsapp.connectionCount);
      }
      if (ch === "messenger" && !out.messenger.connected) {
        out.messenger.connected = true;
        out.messenger.connectionCount = Math.max(1, out.messenger.connectionCount);
      }
    }
  }

  return out;
}

async function fetchLastChannelMessageDates(supabase, clinicId, patientIds) {
  const result = { whatsapp: null, messenger: null, cliniflyChat: null, any: null };

  if (!patientIds.length) return result;

  const msgRes = await safeTableQuery(supabase, "messages", (q) =>
    q
      .select("created_at, channel, delivery_channel, metadata, patient_id")
      .in("patient_id", patientIds.slice(0, 500))
      .order("created_at", { ascending: false })
      .limit(400),
  );

  if (msgRes.ok && Array.isArray(msgRes.data)) {
    for (const row of msgRes.data) {
      const at = row.created_at || null;
      if (!at) continue;
      const ch = String(
        row.channel || row.delivery_channel || row.metadata?.channel || "",
      ).toLowerCase();
      if (ch.includes("whatsapp") && !result.whatsapp) result.whatsapp = at;
      if (ch.includes("messenger") && !result.messenger) result.messenger = at;
      if (
        (ch.includes("in_app") || ch.includes("clinifly") || ch === "app" || !ch) &&
        !result.cliniflyChat
      ) {
        result.cliniflyChat = at;
      }
      if (!result.any) result.any = at;
    }
  }

  // Coordinator profiles often carry omnichannel timestamps
  const leadRes = await safeTableQuery(supabase, "ai_coordinator_lead_profiles", (q) =>
    q
      .select("primary_channel, last_channel_message_at, last_patient_message_at, updated_at")
      .eq("clinic_id", clinicId)
      .order("last_channel_message_at", { ascending: false })
      .limit(100),
  );
  if (leadRes.ok && Array.isArray(leadRes.data)) {
    for (const row of leadRes.data) {
      const at =
        row.last_channel_message_at || row.last_patient_message_at || row.updated_at || null;
      if (!at) continue;
      const ch = String(row.primary_channel || "").toLowerCase();
      if (ch.includes("whatsapp") && !result.whatsapp) result.whatsapp = at;
      if (ch.includes("messenger") && !result.messenger) result.messenger = at;
      if ((ch.includes("in_app") || ch === "app" || !ch) && !result.cliniflyChat) {
        result.cliniflyChat = at;
      }
    }
  }

  return result;
}

function channelAiEnabled(globalAi, channelConnected) {
  return globalAi && channelConnected;
}

function buildAlerts(payload) {
  const alerts = [];
  const mp = payload.marketplace?.checklist || {};
  const comm = payload.communication || {};
  const ai = payload.ai || {};
  const activity = payload.activity || {};

  if (!comm.whatsapp?.connected) {
    alerts.push({
      type: "missing_whatsapp",
      severity: "warn",
      message: "WhatsApp not connected",
    });
  }
  if (!comm.messenger?.connected) {
    alerts.push({
      type: "missing_messenger",
      severity: "warn",
      message: "Messenger not connected",
    });
  }
  if ((payload.marketplace?.completionPercent || 0) < 70) {
    alerts.push({
      type: "profile_incomplete",
      severity: "info",
      message: "Marketplace profile incomplete",
    });
  }
  if ((ai.trainingProgress || 0) < 40 || !ai.enabled) {
    alerts.push({
      type: "ai_not_trained",
      severity: "warn",
      message: ai.enabled ? "AI training incomplete" : "AI not enabled",
    });
  }
  if (!mp.doctors) {
    alerts.push({
      type: "no_doctors",
      severity: "warn",
      message: "No doctors added",
    });
  }
  if (!mp.googleReviews) {
    alerts.push({
      type: "no_google_reviews",
      severity: "info",
      message: "No Google reviews added",
    });
  }
  if ((activity.patients || 0) === 0) {
    alerts.push({
      type: "no_patients",
      severity: "info",
      message: "No patients yet",
    });
  }
  if ((activity.messages || 0) === 0 && (activity.patients || 0) > 0) {
    alerts.push({
      type: "no_messages",
      severity: "info",
      message: "No messages recorded",
    });
  }

  return alerts;
}

function computeHealthScore(payload) {
  let score = 0;
  const comm = payload.communication || {};
  const ai = payload.ai || {};
  const mp = payload.marketplace || {};
  const act = payload.activity || {};

  if (comm.whatsapp?.connected) score += 12;
  if (comm.messenger?.connected) score += 8;
  if (comm.cliniflyChat?.enabled) score += 5;
  if (ai.enabled) score += 10;
  score += Math.round((ai.trainingProgress || 0) * 0.2);
  score += Math.round((mp.completionPercent || 0) * 0.25);
  if ((act.patients || 0) >= 5) score += 10;
  else if ((act.patients || 0) >= 1) score += 5;
  if ((act.messages || 0) >= 20) score += 10;
  else if ((act.messages || 0) >= 1) score += 4;
  if ((act.doctors || 0) >= 1) score += 8;
  if ((act.appointments || 0) >= 1) score += 7;
  if ((act.activeUsers || 0) >= 1) score += 5;

  score = Math.min(100, Math.max(0, score));

  let healthLabel = "Critical";
  if (score >= 80) healthLabel = "Healthy";
  else if (score >= 60) healthLabel = "Good";
  else if (score >= 40) healthLabel = "Needs attention";

  const fullyConfigured =
    mp.completionPercent >= 70 &&
    ai.trainingProgress >= 50 &&
    (comm.whatsapp?.connected || comm.messenger?.connected || comm.cliniflyChat?.enabled);

  const activelyUsing = (act.messages || 0) > 0 || (act.appointments || 0) > 0;

  return {
    healthScore: score,
    healthLabel,
    fullyConfigured,
    aiReady: ai.enabled && ai.trainingProgress >= 40,
    channelsConnected:
      comm.whatsapp?.connected || comm.messenger?.connected || comm.cliniflyChat?.enabled,
    activelyUsing,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} clinicId
 * @param {{ resolveClinicSubscriptionSnapshot?: Function, planToMaxPatients?: Function }} helpers
 */
async function buildSuperAdminClinicOperationalDashboard(clinicId, supabase, helpers = {}) {
  if (!UUID_RE.test(clinicId)) {
    return { ok: false, error: "invalid_clinic_id" };
  }

  const { data: clinicRow, error: clinicErr } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();

  if (clinicErr) return { ok: false, error: "clinic_load_failed", message: clinicErr.message };
  if (!clinicRow?.id) return { ok: false, error: "clinic_not_found" };

  const settings = parseSettings(clinicRow.settings);
  const sub = helpers.resolveClinicSubscriptionSnapshot
    ? helpers.resolveClinicSubscriptionSnapshot(clinicRow)
    : {
        subscriptionPlan: clinicRow.subscription_plan || clinicRow.plan || "FREE",
        subscriptionStatus: clinicRow.subscription_status || clinicRow.status || "ACTIVE",
        trialEndsAt: clinicRow.trial_ends_at || null,
        subscriptionStartsAt: clinicRow.subscription_starts_at || null,
        settings,
      };

  const [
    patientsRes,
    doctorsRes,
    appointmentsRes,
    offersRes,
    aiProfile,
    connections,
  ] = await Promise.all([
    safeTableQuery(supabase, "patients", (q) =>
      q.select("id, patient_id, role, created_at, updated_at").eq("clinic_id", clinicId),
    ),
    safeTableQuery(supabase, "doctors", (q) =>
      q.select("id, status, is_active").eq("clinic_id", clinicId),
    ),
    safeTableQuery(supabase, "appointments", (q) =>
      q.select("id").eq("clinic_id", clinicId).limit(1000),
    ),
    safeTableQuery(supabase, "treatment_offers", (q) =>
      q.select("id").eq("clinic_id", clinicId).limit(1000),
    ),
    getClinicAiProfile(clinicId),
    fetchChannelConnections(supabase, clinicId),
  ]);

  const patientRows = patientsRes.ok ? patientsRes.data || [] : [];
  const patientRoleRows = patientRows.filter(
    (p) => String(p.role || "PATIENT").toUpperCase() === "PATIENT",
  );
  const patientIds = patientRows
    .map((p) => String(p.patient_id || p.id || "").trim())
    .filter(Boolean);

  let doctorCount = 0;
  if (doctorsRes.ok) {
    doctorCount = (doctorsRes.data || []).filter((d) => {
      const st = String(d.status || "").toUpperCase();
      if (d.is_active === false) return false;
      return st === "APPROVED" || st === "ACTIVE" || !d.status;
    }).length;
  }
  if (!doctorCount) {
    doctorCount = patientRows.filter((p) => String(p.role || "").toUpperCase() === "DOCTOR").length;
  }

  let appointmentCount = appointmentsRes.ok ? (appointmentsRes.data || []).length : 0;
  if (!appointmentCount) {
    const txRes = await safeTableQuery(supabase, "encounter_treatments", (q) =>
      q.select("id").eq("clinic_id", clinicId).limit(500),
    );
    appointmentCount = txRes.ok ? (txRes.data || []).length : 0;
  }

  let messageCount = 0;
  if (patientIds.length) {
    const cntRes = await safeTableQuery(supabase, "messages", (q) =>
      q.select("id").in("patient_id", patientIds.slice(0, 800)).limit(2000),
    );
    messageCount = cntRes.ok ? (cntRes.data || []).length : 0;
  }

  const offersCount = offersRes.ok ? (offersRes.data || []).length : 0;

  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const activeUsers = patientRows.filter(
    (p) => p.updated_at && String(p.updated_at) >= d30,
  ).length;

  const aiLeadRes = await safeTableQuery(supabase, "ai_coordinator_lead_profiles", (q) =>
    q.select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
  );
  let aiConversationCount = 0;
  if (aiLeadRes.ok) {
    const full = await safeTableQuery(supabase, "ai_coordinator_lead_profiles", (q) =>
      q.select("id").eq("clinic_id", clinicId).limit(1000),
    );
    aiConversationCount = full.ok ? (full.data || []).length : 0;
  }

  const lastDates = await fetchLastChannelMessageDates(supabase, clinicId, patientIds);
  const { globalEnabled, replyMode } = resolveAiEnabled(aiProfile);
  const training = computeTrainingSources(aiProfile, settings);
  const marketplace = computeMarketplaceChecklist(clinicRow, doctorCount);

  const cliniflyChatEnabled =
    settings.cliniflyChatEnabled !== false && settings.chatEnabled !== false;

  const communication = {
    whatsapp: {
      connected: connections.whatsapp.connected,
      lastMessageAt: lastDates.whatsapp,
      aiEnabled: channelAiEnabled(globalEnabled, connections.whatsapp.connected),
    },
    messenger: {
      connected: connections.messenger.connected,
      lastMessageAt: lastDates.messenger,
      aiEnabled: channelAiEnabled(globalEnabled, connections.messenger.connected),
    },
    cliniflyChat: {
      enabled: cliniflyChatEnabled,
      lastMessageAt: lastDates.cliniflyChat,
    },
  };

  const aiLanguages =
    aiProfile?.tone?.supportedLanguages ||
    aiProfile?.tone?.languages ||
    clinicRow.languages ||
    [];
  const configuredLanguages = Array.isArray(clinicRow.languages) ? clinicRow.languages : [];
  const specialties = Array.isArray(clinicRow.specialties) ? clinicRow.specialties : [];
  const dentalTourismEnabled =
    settings.dentalTourismEnabled === true ||
    specialties.some((s) => /tourism|international|foreign/i.test(String(s))) ||
    configuredLanguages.length >= 2;

  const activityLog = Array.isArray(settings.subscriptionActivityLog)
    ? settings.subscriptionActivityLog.slice(0, 20)
    : [];

  const payload = {
    clinicId,
    clinic: {
      id: clinicRow.id,
      name: clinicRow.name || "",
      clinicCode: clinicRow.clinic_code || "",
      status: clinicRow.status || sub.subscriptionStatus || "ACTIVE",
      email: clinicRow.email || "",
      phone: clinicRow.phone || "",
      city: clinicRow.city || "",
      country: clinicRow.country || "",
      contactName: clinicRow.contact_name || "",
      notes: clinicRow.notes || "",
      crmStatus: clinicRow.crm_status || "active",
      lastContactAt: clinicRow.last_contact_at || null,
      createdAt: clinicRow.created_at || null,
      plan: clinicRow.plan || "FREE",
      planExpiry: clinicRow.plan_expiry || null,
    },
    communication,
    ai: {
      enabled: globalEnabled,
      configured: aiProfile?.isConfigured === true,
      replyMode,
      trainingProgress: training.percent,
      trainingSources: training.sources,
      lastTrainingDate: aiProfile?.updatedAt || aiProfile?.createdAt || null,
      conversationCount: aiConversationCount,
    },
    marketplace: {
      completionPercent: marketplace.percent,
      checklist: marketplace.checklist,
      isListed: clinicRow.is_listed === true,
      isVerified: clinicRow.is_verified === true,
    },
    subscription: {
      package: displayPackage(sub.subscriptionPlan || clinicRow.plan),
      plan: sub.subscriptionPlan || clinicRow.plan || "FREE",
      status: sub.subscriptionStatus || "ACTIVE",
      trialEndsAt: sub.trialEndsAt,
      subscriptionStartsAt: sub.subscriptionStartsAt,
      planExpiry: clinicRow.plan_expiry || null,
      maxPatients: clinicRow.max_patients ?? null,
      superAdminNotes: settings.superAdminNotes || settings.super_admin_notes || "",
      activityLog,
    },
    activity: {
      patients: patientRoleRows.length,
      doctors: doctorCount,
      appointments: appointmentCount,
      messages: messageCount,
      offersSent: offersCount,
      activeUsers: Math.max(activeUsers, doctorCount > 0 ? 1 : 0),
    },
    international: {
      languagesConfigured: configuredLanguages,
      aiLanguagesSupported: Array.isArray(aiLanguages) ? aiLanguages : [],
      dentalTourismEnabled,
    },
  };

  payload.summary = computeHealthScore(payload);
  payload.alerts = buildAlerts(payload);

  return { ok: true, dashboard: payload };
}

/**
 * Apply super-admin operational subscription action.
 */
async function applySuperAdminOperationalAction(clinicId, body, supabase, helpers) {
  const action = String(body?.action || "").trim().toLowerCase();
  const notes = String(body?.notes || "").trim();
  const days = Math.max(0, Math.round(Number(body?.days ?? 30)));

  const { data: currentRow, error } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) return { ok: false, error: "clinic_load_failed", message: error.message };
  if (!currentRow?.id) return { ok: false, error: "clinic_not_found" };

  const before = helpers.resolveClinicSubscriptionSnapshot(currentRow);
  const settings = parseSettings(currentRow.settings);
  let targetPlan = before.subscriptionPlan;
  let targetStatus = before.subscriptionStatus;
  let trialEndsAt = before.trialEndsAt;
  let planExpiry = currentRow.plan_expiry || null;
  const now = Date.now();
  const actor = String(body?.actor || "super-admin").trim();

  if (body?.plan) {
    targetPlan = normalizePackageKey(body.plan);
  }

  switch (action) {
    case "upgrade":
      targetPlan = PACKAGE_TIERS[Math.min(tierIndex(before.subscriptionPlan) + 1, PACKAGE_TIERS.length - 1)];
      targetStatus = "ACTIVE";
      break;
    case "downgrade":
      targetPlan = PACKAGE_TIERS[Math.max(tierIndex(before.subscriptionPlan) - 1, 0)];
      break;
    case "extend":
      if (planExpiry) {
        planExpiry = new Date(Math.max(Date.parse(planExpiry), now) + days * 86400000).toISOString();
      } else {
        planExpiry = new Date(now + days * 86400000).toISOString();
      }
      targetStatus = "ACTIVE";
      break;
    case "grant_temporary":
      targetStatus = "TRIAL";
      trialEndsAt = new Date(now + days * 86400000).toISOString();
      if (body?.plan) targetPlan = normalizePackageKey(body.plan);
      break;
    case "add_bonus":
      settings.bonusFeatures = {
        ...(settings.bonusFeatures && typeof settings.bonusFeatures === "object"
          ? settings.bonusFeatures
          : {}),
        ...(body?.bonusFeatures && typeof body.bonusFeatures === "object" ? body.bonusFeatures : {}),
        updatedAt: new Date().toISOString(),
      };
      if (body?.bonusModules && Array.isArray(body.bonusModules)) {
        settings.bonusModules = [...new Set([...(settings.bonusModules || []), ...body.bonusModules])];
      }
      break;
    case "remove_limits":
      settings.limitsRemoved = true;
      settings.limitsRemovedAt = new Date().toISOString();
      break;
    default:
      return { ok: false, error: "invalid_action" };
  }

  if (notes) {
    settings.superAdminNotes = notes;
  }

  const logEntry = {
    at: new Date().toISOString(),
    by: actor,
    message: notes || `Super Admin action: ${action}${targetPlan ? ` → ${targetPlan}` : ""}`,
    action,
  };
  const oldLog = Array.isArray(settings.subscriptionActivityLog)
    ? settings.subscriptionActivityLog.filter((x) => x && typeof x === "object")
    : [];
  settings.subscriptionActivityLog = [logEntry, ...oldLog].slice(0, 100);

  const mappedPlan = targetPlan === "PREMIUM" ? "PRO" : targetPlan;
  const patch = {
    plan: mappedPlan,
    subscription_plan: targetPlan,
    subscription_status: targetStatus,
    trial_ends_at: trialEndsAt,
    max_patients:
      settings.limitsRemoved === true
        ? 999999
        : helpers.planToMaxPatients(mappedPlan),
    settings,
    updated_at: new Date().toISOString(),
  };
  if (planExpiry) patch.plan_expiry = planExpiry;
  if (targetStatus !== "SUSPENDED") patch.status = "ACTIVE";

  const { data: updated, error: updErr } = await supabase
    .from("clinics")
    .update(patch)
    .eq("id", clinicId)
    .select("*")
    .maybeSingle();

  if (updErr) return { ok: false, error: "update_failed", message: updErr.message };

  return {
    ok: true,
    clinic: updated,
    subscription: helpers.resolveClinicSubscriptionSnapshot(updated),
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ superAdminGuard: Function, supabase: object, resolveClinicSubscriptionSnapshot: Function, planToMaxPatients: Function }} deps
 */
function registerSuperAdminClinicDashboardRoutes(app, deps) {
  const { superAdminGuard, supabase, resolveClinicSubscriptionSnapshot, planToMaxPatients } = deps;
  const helpers = { resolveClinicSubscriptionSnapshot, planToMaxPatients };

  app.get(
    "/api/super-admin/clinics/:clinicId/operational-dashboard",
    superAdminGuard,
    async (req, res) => {
      try {
        const clinicId = String(req.params?.clinicId || "").trim();
        const result = await buildSuperAdminClinicOperationalDashboard(clinicId, supabase, helpers);
        if (!result.ok) {
          const status =
            result.error === "clinic_not_found"
              ? 404
              : result.error === "invalid_clinic_id"
                ? 400
                : 500;
          return res.status(status).json(result);
        }
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ ok: false, error: "internal_error", message: e?.message });
      }
    },
  );

  app.post(
    "/api/super-admin/clinics/:clinicId/operational-actions",
    superAdminGuard,
    async (req, res) => {
      try {
        const clinicId = String(req.params?.clinicId || "").trim();
        if (!UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_clinic_id" });
        }
        const actor = String(req.superAdmin?.email || "super-admin").trim();
        const result = await applySuperAdminOperationalAction(
          clinicId,
          { ...(req.body || {}), actor },
          supabase,
          helpers,
        );
        if (!result.ok) {
          const status = result.error === "clinic_not_found" ? 404 : result.error === "invalid_action" ? 400 : 500;
          return res.status(status).json(result);
        }
        return res.json(result);
      } catch (e) {
        return res.status(500).json({ ok: false, error: "internal_error", message: e?.message });
      }
    },
  );
}

module.exports = {
  registerSuperAdminClinicDashboardRoutes,
  buildSuperAdminClinicOperationalDashboard,
  computeMarketplaceChecklist,
  computeTrainingSources,
  displayPackage,
};
