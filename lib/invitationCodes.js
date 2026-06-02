"use strict";

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PLAN = "PREMIUM";
const DEFAULT_TRIAL_DAYS = 60;

function normalizeInvitationCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function parseSettings(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return raw && typeof raw === "object" ? { ...raw } : {};
}

function mapCampaignPlanToClinicPlan(planRaw) {
  const p = String(planRaw || DEFAULT_PLAN).trim().toUpperCase();
  if (p === "PREMIUM") return "PRO";
  if (p === "PROFESSIONAL") return "PRO";
  if (p === "PRO" || p === "BASIC" || p === "FREE") return p;
  return "FREE";
}

function planPatientCap(planRaw) {
  const p = mapCampaignPlanToClinicPlan(planRaw);
  if (p === "PRO") return 999999;
  if (p === "BASIC") return 15;
  return 3;
}

function normalizeTrialDays(raw) {
  const n = Number.parseInt(String(raw ?? DEFAULT_TRIAL_DAYS), 10);
  if (!Number.isFinite(n)) return DEFAULT_TRIAL_DAYS;
  return Math.max(0, Math.min(3650, n));
}

function trialEndsAtIso(trialDays) {
  const ms = Math.max(0, Number(trialDays) || 0) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

async function getCodeByValue(code) {
  const normalized = normalizeInvitationCode(code);
  if (!normalized || !isSupabaseEnabled()) return null;
  const { data, error } = await supabase
    .from("invitation_codes")
    .select("*")
    .eq("code", normalized)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function validateCodeRedeemable(row) {
  if (!row) return { ok: false, reason: "code_not_found" };
  if (row.is_active === false) return { ok: false, reason: "code_inactive" };
  if (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now()) {
    return { ok: false, reason: "code_expired" };
  }
  const maxUses = row.max_uses == null ? null : Number(row.max_uses);
  const currentUses = Number(row.current_uses || 0);
  if (Number.isFinite(maxUses) && currentUses >= maxUses) {
    return { ok: false, reason: "code_max_uses_reached" };
  }
  return { ok: true };
}

async function redeemInvitationCodeForClinic(clinicId, codeInput) {
  if (!isSupabaseEnabled()) return { ok: false, reason: "supabase_required" };
  const code = normalizeInvitationCode(codeInput);
  if (!UUID_RE.test(String(clinicId || "")) || !code) {
    return { ok: false, reason: "invalid_params" };
  }

  const { data: clinic, error: clinicError } = await supabase
    .from("clinics")
    .select("id, plan, max_patients, settings, redeemed_invitation_code, invitation_redeemed_at")
    .eq("id", clinicId)
    .maybeSingle();
  if (clinicError) return { ok: false, reason: "clinic_load_failed", error: clinicError.message };
  if (!clinic?.id) return { ok: false, reason: "clinic_not_found" };
  if (clinic.redeemed_invitation_code || clinic.invitation_redeemed_at) {
    return { ok: false, reason: "clinic_already_redeemed" };
  }

  const codeRow = await getCodeByValue(code);
  const codeValidity = validateCodeRedeemable(codeRow);
  if (!codeValidity.ok) return { ok: false, reason: codeValidity.reason };

  const plan = String(codeRow.plan || DEFAULT_PLAN).trim().toUpperCase();
  const trialDays = normalizeTrialDays(codeRow.trial_days);
  const redeemedAt = new Date().toISOString();
  const trialEndsAt = trialEndsAtIso(trialDays);
  const nextSettings = parseSettings(clinic.settings);
  const prevLog = Array.isArray(nextSettings.invitationActivityLog)
    ? nextSettings.invitationActivityLog.filter((x) => x && typeof x === "object").slice(0, 49)
    : [];
  nextSettings.subscriptionPlan = plan;
  nextSettings.subscriptionStatus = "TRIAL";
  nextSettings.trialEndsAt = trialEndsAt;
  nextSettings.invitationCodeRedeemed = code;
  nextSettings.invitationRedeemedAt = redeemedAt;
  nextSettings.invitationActivityLog = [
    {
      at: redeemedAt,
      message: `Clinic redeemed invitation code ${code} and received ${trialDays}-day Premium trial.`,
    },
    ...prevLog,
  ];

  const { error: redemptionErr } = await supabase.from("invitation_code_redemptions").insert({
    invitation_code_id: codeRow.id,
    clinic_id: clinicId,
    code,
    plan,
    trial_days: trialDays,
    redeemed_at: redeemedAt,
    trial_ends_at: trialEndsAt,
  });
  if (redemptionErr) {
    if (String(redemptionErr.code || "") === "23505") {
      return { ok: false, reason: "clinic_already_redeemed" };
    }
    return { ok: false, reason: "redemption_insert_failed", error: redemptionErr.message };
  }
  const rollbackRedemption = async () => {
    try {
      await supabase
        .from("invitation_code_redemptions")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("invitation_code_id", codeRow.id)
        .eq("redeemed_at", redeemedAt);
    } catch (_) {
      /* non-fatal */
    }
  };

  const { data: usageRows, error: usageErr } = await supabase
    .from("invitation_codes")
    .select("current_uses")
    .eq("id", codeRow.id)
    .limit(1);
  if (usageErr || !usageRows?.length) {
    return { ok: false, reason: "code_usage_load_failed", error: usageErr?.message || "missing_code" };
  }
  const currentUses = Number(usageRows[0].current_uses || 0);
  const { data: codeUpdateRows, error: codeUpdateErr } = await supabase
    .from("invitation_codes")
    .update({ current_uses: currentUses + 1 })
    .eq("id", codeRow.id)
    .eq("current_uses", currentUses)
    .select("id");
  if (codeUpdateErr || !codeUpdateRows?.length) {
    await rollbackRedemption();
    return { ok: false, reason: "code_usage_update_failed", error: codeUpdateErr?.message || "conflict" };
  }

  const mappedClinicPlan = mapCampaignPlanToClinicPlan(plan);
  const { error: clinicUpdateErr } = await supabase
    .from("clinics")
    .update({
      plan: mappedClinicPlan,
      max_patients: planPatientCap(mappedClinicPlan),
      redeemed_invitation_code: code,
      invitation_redeemed_at: redeemedAt,
      settings: nextSettings,
    })
    .eq("id", clinicId);
  if (clinicUpdateErr) {
    await rollbackRedemption();
    await supabase
      .from("invitation_codes")
      .update({ current_uses: Math.max(0, currentUses) })
      .eq("id", codeRow.id)
      .eq("current_uses", currentUses + 1);
    return { ok: false, reason: "clinic_update_failed", error: clinicUpdateErr.message };
  }

  console.log("[invitationCodes] redeemed", {
    clinicId: String(clinicId).slice(0, 8),
    code,
    plan,
    trialDays,
  });

  return { ok: true, code, plan, trialDays, trialEndsAt, subscriptionStatus: "TRIAL" };
}

async function applyExpiredInvitationTrials(limit = 200) {
  if (!isSupabaseEnabled()) return { ok: false, reason: "supabase_required" };
  const { data: clinics, error } = await supabase
    .from("clinics")
    .select("id, plan, settings, redeemed_invitation_code, invitation_redeemed_at")
    .not("redeemed_invitation_code", "is", null)
    .limit(limit);
  if (error) return { ok: false, reason: "load_failed", error: error.message };

  const nowMs = Date.now();
  let downgraded = 0;
  for (const clinic of clinics || []) {
    const settings = parseSettings(clinic.settings);
    const status = String(settings.subscriptionStatus || "").trim().toUpperCase();
    const trialEndsAt = settings.trialEndsAt ? Date.parse(String(settings.trialEndsAt)) : NaN;
    if (status !== "TRIAL" || !Number.isFinite(trialEndsAt) || trialEndsAt > nowMs) continue;
    const logItems = Array.isArray(settings.invitationActivityLog)
      ? settings.invitationActivityLog.filter((x) => x && typeof x === "object").slice(0, 49)
      : [];
    const nowIso = new Date().toISOString();
    const nextSettings = {
      ...settings,
      subscriptionPlan: "FREE",
      subscriptionStatus: "FREE",
      trialEndedAt: nowIso,
      invitationActivityLog: [
        {
          at: nowIso,
          message: `Invitation trial ended and clinic was downgraded to FREE plan.`,
        },
        ...logItems,
      ],
    };
    const { error: updateErr } = await supabase
      .from("clinics")
      .update({
        plan: "FREE",
        max_patients: planPatientCap("FREE"),
        settings: nextSettings,
      })
      .eq("id", clinic.id);
    if (!updateErr) downgraded += 1;
  }
  if (downgraded > 0) {
    console.log("[invitationCodes] trial downgrade sweep", { downgraded });
  }
  return { ok: true, downgraded };
}

function registerInvitationCodeRoutes(app, deps) {
  const requireAdminAuth = deps?.requireAdminAuth;
  const superAdminGuard = deps?.superAdminGuard;
  if (!app || !requireAdminAuth || !superAdminGuard) return;

  app.post("/api/admin/invitation-codes/redeem", requireAdminAuth, async (req, res) => {
    try {
      if (!req.clinic?.id) return res.status(404).json({ ok: false, error: "clinic_not_found" });
      const code = String(req.body?.code || "").trim();
      const result = await redeemInvitationCodeForClinic(String(req.clinic.id), code);
      if (!result.ok) {
        const status = result.reason === "clinic_already_redeemed" ? 409 : 400;
        return res.status(status).json({ ok: false, error: result.reason, message: result.error || result.reason });
      }
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "redeem_failed", message: e?.message || "internal_error" });
    }
  });

  app.get("/api/admin/invitation-codes/redeem-status", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinic?.id || "").trim();
      if (!UUID_RE.test(clinicId)) return res.status(404).json({ ok: false, error: "clinic_not_found" });
      const { data, error } = await supabase
        .from("clinics")
        .select("plan, redeemed_invitation_code, invitation_redeemed_at, settings")
        .eq("id", clinicId)
        .maybeSingle();
      if (error) return res.status(500).json({ ok: false, error: "load_failed", message: error.message });
      const settings = parseSettings(data?.settings);
      return res.json({
        ok: true,
        plan: data?.plan || "FREE",
        redeemedInvitationCode: data?.redeemed_invitation_code || null,
        invitationRedeemedAt: data?.invitation_redeemed_at || null,
        subscriptionPlan: settings.subscriptionPlan || null,
        subscriptionStatus: settings.subscriptionStatus || null,
        trialEndsAt: settings.trialEndsAt || null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "load_failed", message: e?.message || "internal_error" });
    }
  });

  app.get("/api/super-admin/invitation-codes", superAdminGuard, async (_req, res) => {
    const { data, error } = await supabase
      .from("invitation_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: "list_failed", message: error.message });
    return res.json({ ok: true, items: data || [] });
  });

  app.post("/api/super-admin/invitation-codes", superAdminGuard, async (req, res) => {
    const payload = req.body || {};
    const code = normalizeInvitationCode(payload.code);
    if (!code) return res.status(400).json({ ok: false, error: "code_required" });
    const plan = String(payload.plan || DEFAULT_PLAN).trim().toUpperCase();
    const trialDays = normalizeTrialDays(payload.trial_days ?? payload.trialDays ?? DEFAULT_TRIAL_DAYS);
    const maxUsesRaw = payload.max_uses ?? payload.maxUses;
    const maxUses = maxUsesRaw == null || String(maxUsesRaw).trim() === "" ? null : Number.parseInt(String(maxUsesRaw), 10);
    const expiresAtRaw = String(payload.expires_at ?? payload.expiresAt ?? "").trim();
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;
    const { data, error } = await supabase
      .from("invitation_codes")
      .insert({
        code,
        description: payload.description ? String(payload.description) : null,
        plan,
        trial_days: trialDays,
        max_uses: Number.isFinite(maxUses) ? Math.max(0, maxUses) : null,
        expires_at: expiresAt,
        is_active: payload.is_active === false ? false : true,
      })
      .select("*")
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: "create_failed", message: error.message });
    return res.json({ ok: true, item: data });
  });

  app.patch("/api/super-admin/invitation-codes/:id", superAdminGuard, async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const body = req.body || {};
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, "code")) {
      patch.code = normalizeInvitationCode(body.code);
    }
    if (Object.prototype.hasOwnProperty.call(body, "description")) patch.description = body.description ? String(body.description) : null;
    if (Object.prototype.hasOwnProperty.call(body, "plan")) patch.plan = String(body.plan || DEFAULT_PLAN).trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(body, "trial_days") || Object.prototype.hasOwnProperty.call(body, "trialDays")) {
      patch.trial_days = normalizeTrialDays(body.trial_days ?? body.trialDays);
    }
    if (Object.prototype.hasOwnProperty.call(body, "max_uses") || Object.prototype.hasOwnProperty.call(body, "maxUses")) {
      const maxUsesRaw = body.max_uses ?? body.maxUses;
      patch.max_uses = maxUsesRaw == null || String(maxUsesRaw).trim() === "" ? null : Math.max(0, Number.parseInt(String(maxUsesRaw), 10) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(body, "expires_at") || Object.prototype.hasOwnProperty.call(body, "expiresAt")) {
      const raw = String(body.expires_at ?? body.expiresAt ?? "").trim();
      patch.expires_at = raw ? new Date(raw).toISOString() : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_active") || Object.prototype.hasOwnProperty.call(body, "isActive")) {
      patch.is_active = body.is_active != null ? Boolean(body.is_active) : Boolean(body.isActive);
    }
    const { data, error } = await supabase
      .from("invitation_codes")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: "update_failed", message: error.message });
    return res.json({ ok: true, item: data });
  });

  app.delete("/api/super-admin/invitation-codes/:id", superAdminGuard, async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const { error } = await supabase.from("invitation_codes").delete().eq("id", id);
    if (error) return res.status(500).json({ ok: false, error: "delete_failed", message: error.message });
    return res.json({ ok: true });
  });

  app.get("/api/super-admin/invitation-codes/:id/clinics", superAdminGuard, async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const { data, error } = await supabase
      .from("invitation_code_redemptions")
      .select("id, code, plan, trial_days, redeemed_at, trial_ends_at, clinic_id, clinics:clinic_id(id, clinic_code, name, email, plan)")
      .eq("invitation_code_id", id)
      .order("redeemed_at", { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: "clinics_load_failed", message: error.message });
    return res.json({ ok: true, items: data || [] });
  });
}

function startInvitationTrialDowngradeWorker() {
  if (!isSupabaseEnabled()) return;
  const intervalMs = Math.max(60 * 1000, Number.parseInt(String(process.env.INVITATION_TRIAL_SWEEP_MS || "600000"), 10) || 600000);
  applyExpiredInvitationTrials(300).catch((e) =>
    console.warn("[invitationCodes] initial trial sweep:", e?.message || e),
  );
  setInterval(() => {
    applyExpiredInvitationTrials(300).catch((e) =>
      console.warn("[invitationCodes] trial sweep:", e?.message || e),
    );
  }, intervalMs);
}

module.exports = {
  normalizeInvitationCode,
  redeemInvitationCodeForClinic,
  applyExpiredInvitationTrials,
  registerInvitationCodeRoutes,
  startInvitationTrialDowngradeWorker,
};
