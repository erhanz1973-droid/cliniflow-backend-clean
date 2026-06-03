/**
 * Clinic admin password reset — OTP via Brevo, verified session before reset.
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_MIN_MS = 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * @param {import('express').Express} app
 * @param {{
 *   DATA_DIR: string,
 *   bcrypt: typeof import('bcrypt'),
 *   isSupabaseEnabled: () => boolean,
 *   supabase: import('@supabase/supabase-js').SupabaseClient,
 *   getAdminByEmailAndClinicCode: (email: string, code: string) => Promise<object|null>,
 *   getClinicByCode: (code: string) => Promise<object|null>,
 *   updateClinic: (id: string, patch: object) => Promise<unknown>,
 *   readJson: (file: string, fallback: object) => object,
 *   writeJson: (file: string, obj: object) => void,
 *   CLINIC_FILE: string,
 *   deliverPasswordResetOtp: (opts: { email: string, otpCode: string, lang?: string }) => Promise<unknown>,
 *   isTransactionalEmailConfigured: () => boolean,
 *   REGISTER_USER_MSG?: { otpCouldNotBeSent?: string, otpEmailNotConfigured?: string },
 * }} deps
 */
function registerAdminPasswordResetRoutes(app, deps) {
  const STORE_FILE = path.join(deps.DATA_DIR, "admin_password_reset.json");
  const resendRate = new Map();

  function storageKey(clinicCode, email) {
    return `${String(clinicCode).trim().toUpperCase()}:${String(email).trim().toLowerCase()}`;
  }

  function readStore() {
    try {
      if (!fs.existsSync(STORE_FILE)) return {};
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeStore(obj) {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), "utf8");
  }

  function clientIp(req) {
    const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return xf || req.ip || req.socket?.remoteAddress || null;
  }

  async function auditLog(eventType, req, meta = {}) {
    const row = {
      event_type: eventType,
      email: meta.email ? String(meta.email).toLowerCase() : null,
      clinic_code: meta.clinicCode ? String(meta.clinicCode).toUpperCase() : null,
      ip_address: clientIp(req),
      metadata: meta.extra && typeof meta.extra === "object" ? meta.extra : {},
      created_at: new Date().toISOString(),
    };
    console.log("[admin_password_reset_audit]", JSON.stringify(row));
    if (!deps.isSupabaseEnabled()) return;
    try {
      await deps.supabase.from("admin_security_audit_log").insert(row);
    } catch (e) {
      console.warn("[admin_password_reset_audit] supabase insert skipped:", e?.message || e);
    }
  }

  async function validateAdminIdentity(emailLower, code) {
    const admin = await deps.getAdminByEmailAndClinicCode(emailLower, code);
    if (admin) return { ok: true, via: "admin" };

    const clinicRow = await deps.getClinicByCode(code);
    if (!clinicRow) return { ok: false };

    const dbEmail = String(clinicRow.email || "").trim().toLowerCase();
    if (dbEmail !== emailLower) return { ok: false };

    return { ok: true, via: "clinic", clinicId: clinicRow.id };
  }

  async function loadSession(clinicCode, emailLower) {
    const code = String(clinicCode).trim().toUpperCase();
    const key = storageKey(code, emailLower);

    if (deps.isSupabaseEnabled()) {
      try {
        const { data, error } = await deps.supabase
          .from("admin_password_reset_sessions")
          .select("*")
          .eq("email", emailLower)
          .eq("clinic_code", code)
          .is("used_at", null)
          .maybeSingle();
        if (!error && data) {
          return { ...data, storageKey: key, source: "supabase" };
        }
      } catch (e) {
        console.warn("[admin_password_reset] supabase load:", e?.message || e);
      }
    }

    const store = readStore();
    const row = store[key];
    if (!row || row.used_at) return null;
    return { ...row, storageKey: key, source: "file" };
  }

  async function saveOtpSession(clinicCode, emailLower, otpHash) {
    const code = String(clinicCode).trim().toUpperCase();
    const key = storageKey(code, emailLower);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();
    const lastSentAt = new Date().toISOString();

    if (deps.isSupabaseEnabled()) {
      try {
        await deps.supabase.from("admin_password_reset_sessions").delete().match({
          email: emailLower,
          clinic_code: code,
        });
        const { data, error } = await deps.supabase
          .from("admin_password_reset_sessions")
          .insert({
            email: emailLower,
            clinic_code: code,
            otp_hash: otpHash,
            expires_at: expiresAt,
            attempts: 0,
            last_sent_at: lastSentAt,
            verified_at: null,
            reset_token_hash: null,
            reset_token_expires_at: null,
            used_at: null,
          })
          .select()
          .single();
        if (error) throw error;
        return { ...data, storageKey: key, source: "supabase" };
      } catch (e) {
        console.warn("[admin_password_reset] supabase save, file fallback:", e?.message || e);
      }
    }

    const store = readStore();
    store[key] = {
      otp_hash: otpHash,
      expires_at: expiresAt,
      attempts: 0,
      last_sent_at: lastSentAt,
      verified_at: null,
      reset_token_hash: null,
      reset_token_expires_at: null,
      used_at: null,
    };
    writeStore(store);
    return { ...store[key], storageKey: key, source: "file" };
  }

  async function updateSession(clinicCode, emailLower, patch) {
    const code = String(clinicCode).trim().toUpperCase();
    const key = storageKey(code, emailLower);
    const session = await loadSession(code, emailLower);
    if (!session) return null;

    if (session.source === "supabase" && session.id) {
      const { error } = await deps.supabase
        .from("admin_password_reset_sessions")
        .update(patch)
        .eq("id", session.id);
      if (error) console.warn("[admin_password_reset] supabase update:", error.message);
      return { ...session, ...patch };
    }

    const store = readStore();
    const row = store[key];
    if (!row) return null;
    Object.assign(row, patch);
    writeStore(store);
    return { ...row, storageKey: key, source: "file" };
  }

  function generateOtp() {
    let otp = "";
    for (let i = 0; i < 6; i++) otp += String(Math.floor(Math.random() * 10));
    return otp;
  }

  function genericOk(res) {
    return res.json({
      ok: true,
      message: "If this email is registered for the clinic, a verification code has been sent.",
    });
  }

  function checkResendAllowed(clinicCode, emailLower) {
    const key = storageKey(clinicCode, emailLower);
    const now = Date.now();
    const entry = resendRate.get(key);
    if (!entry || now >= entry.nextAllowedAt) {
      resendRate.set(key, { nextAllowedAt: now + RESEND_MIN_MS });
      return true;
    }
    return false;
  }

  async function sendOtpFlow(req, res, { isResend = false } = {}) {
    const clinicCode = String(req.body?.clinicCode || "").trim().toUpperCase();
    const emailLower = String(req.body?.email || "").trim().toLowerCase();

    if (!clinicCode) {
      return res.status(400).json({ ok: false, error: "clinic_code_required" });
    }
    if (!emailLower || !emailLower.includes("@")) {
      return res.status(400).json({ ok: false, error: "email_required" });
    }

    if (!checkResendAllowed(clinicCode, emailLower)) {
      return res.status(429).json({
        ok: false,
        error: "resend_rate_limited",
        message: "Please wait one minute before requesting another code.",
        retryAfterSeconds: 60,
      });
    }

    const identity = await validateAdminIdentity(emailLower, clinicCode);
    if (!identity.ok) {
      await auditLog(
        isResend ? "password_reset_otp_resend_unknown" : "password_reset_otp_requested_unknown",
        req,
        { email: emailLower, clinicCode, extra: { matched: false } },
      );
      return genericOk(res);
    }

    if (!deps.isTransactionalEmailConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "otp_delivery_not_configured",
        message:
          deps.REGISTER_USER_MSG?.otpEmailNotConfigured ||
          "Email delivery is not configured.",
      });
    }

    const otpPlain = generateOtp();
    const otpHash = await deps.bcrypt.hash(otpPlain, 10);
    await saveOtpSession(clinicCode, emailLower, otpHash);

    try {
      await deps.deliverPasswordResetOtp({ email: emailLower, otpCode: otpPlain, lang: "tr" });
    } catch (sendErr) {
      console.error("[admin_password_reset] deliver failed:", sendErr?.message || sendErr);
      return res.status(500).json({
        ok: false,
        error: "otp_send_failed",
        message: deps.REGISTER_USER_MSG?.otpCouldNotBeSent || "Could not send verification code.",
      });
    }

    await auditLog(isResend ? "password_reset_otp_resent" : "password_reset_otp_sent", req, {
      email: emailLower,
      clinicCode,
      extra: { via: identity.via },
    });

    return res.json({
      ok: true,
      message: isResend ? "Verification code resent." : "Verification code sent to your email.",
      expiresInMinutes: 10,
    });
  }

  app.post("/api/admin/forgot-password/request-otp", (req, res) =>
    sendOtpFlow(req, res, { isResend: false }),
  );

  app.post("/api/admin/forgot-password/resend-otp", (req, res) =>
    sendOtpFlow(req, res, { isResend: true }),
  );

  app.post("/api/admin/forgot-password/verify-otp", async (req, res) => {
    try {
      const clinicCode = String(req.body?.clinicCode || "").trim().toUpperCase();
      const emailLower = String(req.body?.email || "").trim().toLowerCase();
      const otp = String(req.body?.otp || "").trim();

      if (!clinicCode || !emailLower || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ ok: false, error: "invalid_request" });
      }

      const session = await loadSession(clinicCode, emailLower);
      if (!session?.otp_hash) {
        await auditLog("password_reset_otp_verify_failed", req, {
          email: emailLower,
          clinicCode,
          extra: { reason: "no_session" },
        });
        return res.status(400).json({ ok: false, error: "otp_not_found" });
      }

      const expiresMs = new Date(session.expires_at).getTime();
      if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
        return res.status(400).json({ ok: false, error: "otp_expired" });
      }

      if ((session.attempts || 0) >= MAX_ATTEMPTS) {
        return res.status(429).json({ ok: false, error: "otp_max_attempts" });
      }

      const valid = await deps.bcrypt.compare(otp, session.otp_hash);
      if (!valid) {
        const attempts = (session.attempts || 0) + 1;
        await updateSession(clinicCode, emailLower, { attempts });
        await auditLog("password_reset_otp_verify_failed", req, {
          email: emailLower,
          clinicCode,
          extra: { reason: "invalid_code", attempts },
        });
        return res.status(400).json({
          ok: false,
          error: "invalid_otp",
          remainingAttempts: Math.max(0, MAX_ATTEMPTS - attempts),
        });
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = await deps.bcrypt.hash(resetToken, 10);

      await updateSession(clinicCode, emailLower, {
        verified_at: new Date().toISOString(),
        reset_token_hash: resetTokenHash,
        reset_token_expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
      });

      await auditLog("password_reset_otp_verified", req, { email: emailLower, clinicCode });

      return res.json({
        ok: true,
        resetToken,
        resetTokenExpiresInMinutes: 15,
      });
    } catch (e) {
      console.error("[admin_password_reset] verify-otp:", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  async function applyPasswordReset(emailLower, clinicCode, newPassword) {
    const hashedPassword = await deps.bcrypt.hash(String(newPassword).trim(), 10);

    if (deps.isSupabaseEnabled()) {
      let verified = false;
      const admin = await deps.getAdminByEmailAndClinicCode(emailLower, clinicCode);
      if (admin) {
        verified = true;
        const { error: adminErr } = await deps.supabase
          .from("admins")
          .update({ password_hash: hashedPassword })
          .eq("id", admin.id);
        if (adminErr) throw new Error(adminErr.message);
      }

      const clinicRow = await deps.getClinicByCode(clinicCode);
      if (clinicRow) {
        const dbEmail = String(clinicRow.email || "").trim().toLowerCase();
        if (dbEmail === emailLower) {
          verified = true;
          await deps.updateClinic(clinicRow.id, { password_hash: hashedPassword });
        }
      }

      if (!verified) throw new Error("invalid_clinic_code_or_email");
      return;
    }

    const clinic = deps.readJson(deps.CLINIC_FILE, {});
    if (!clinic.clinicCode || clinic.clinicCode.toUpperCase() !== clinicCode) {
      throw new Error("invalid_clinic_code_or_email");
    }
    if (!clinic.email || clinic.email.toLowerCase() !== emailLower) {
      throw new Error("invalid_clinic_code_or_email");
    }
    clinic.password = hashedPassword;
    clinic.updatedAt = new Date().toISOString();
    deps.writeJson(deps.CLINIC_FILE, clinic);
  }

  app.post("/api/admin/forgot-password/reset", async (req, res) => {
    try {
      const clinicCode = String(req.body?.clinicCode || "").trim().toUpperCase();
      const emailLower = String(req.body?.email || "").trim().toLowerCase();
      const newPassword = String(req.body?.newPassword || "");
      const resetToken = String(req.body?.resetToken || "").trim();

      if (!clinicCode || !emailLower) {
        return res.status(400).json({ ok: false, error: "invalid_request" });
      }
      if (!resetToken) {
        await auditLog("password_reset_blocked", req, {
          email: emailLower,
          clinicCode,
          extra: { reason: "missing_reset_token" },
        });
        return res.status(403).json({
          ok: false,
          error: "reset_token_required",
          message: "OTP verification is required before resetting the password.",
        });
      }
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: "password_too_short" });
      }

      const session = await loadSession(clinicCode, emailLower);
      if (!session?.reset_token_hash || !session?.verified_at) {
        await auditLog("password_reset_blocked", req, {
          email: emailLower,
          clinicCode,
          extra: { reason: "no_verified_session" },
        });
        return res.status(403).json({
          ok: false,
          error: "otp_not_verified",
          message: "Verify the email code before setting a new password.",
        });
      }

      const tokenExp = new Date(session.reset_token_expires_at || 0).getTime();
      if (!Number.isFinite(tokenExp) || Date.now() > tokenExp) {
        return res.status(403).json({ ok: false, error: "reset_token_expired" });
      }

      const tokenOk = await deps.bcrypt.compare(resetToken, session.reset_token_hash);
      if (!tokenOk) {
        await auditLog("password_reset_blocked", req, {
          email: emailLower,
          clinicCode,
          extra: { reason: "invalid_reset_token" },
        });
        return res.status(403).json({ ok: false, error: "invalid_reset_token" });
      }

      await applyPasswordReset(emailLower, clinicCode, newPassword);
      await updateSession(clinicCode, emailLower, { used_at: new Date().toISOString() });

      const key = storageKey(clinicCode, emailLower);
      const store = readStore();
      delete store[key];
      writeStore(store);

      await auditLog("password_reset_completed", req, { email: emailLower, clinicCode });

      return res.json({ ok: true, message: "Password updated successfully." });
    } catch (e) {
      const msg = e?.message || "internal_error";
      if (msg === "invalid_clinic_code_or_email") {
        return res.status(401).json({ ok: false, error: msg });
      }
      console.error("[admin_password_reset] reset:", msg);
      return res.status(500).json({ ok: false, error: "reset_failed" });
    }
  });

  app.post("/api/admin/forgot-password/verify", (_req, res) => {
    return res.status(410).json({
      ok: false,
      error: "deprecated_use_otp",
      message: "Use POST /api/admin/forgot-password/request-otp, verify-otp, then reset with resetToken.",
    });
  });
}

module.exports = { registerAdminPasswordResetRoutes };
