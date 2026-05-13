/**
 * Brute-force / spam guards for auth surfaces (express-rate-limit).
 * Tune via env RL_* (see factories below).
 */
const rateLimit = require("express-rate-limit");

function numEnv(name, def) {
  const n = parseInt(String(process.env[name] != null ? process.env[name] : def), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "rate_limit_exceeded", message: "Too many requests. Try again later." },
    handler: (req, res, _next, options) => {
      const ra = Math.ceil(options.windowMs / 1000);
      res.set("Retry-After", String(ra));
      res.status(options.statusCode).json(options.message);
    },
  });
}

const patientOauthLimiter = createLimiter({
  windowMs: numEnv("RL_PATIENT_OAUTH_WINDOW_MS", 15 * 60 * 1000),
  max: numEnv("RL_PATIENT_OAUTH_MAX", 40),
});

const authRequestOtpLimiter = createLimiter({
  windowMs: numEnv("RL_AUTH_REQUEST_OTP_WINDOW_MS", 60 * 60 * 1000),
  max: numEnv("RL_AUTH_REQUEST_OTP_MAX", 12),
});

const authVerifyOtpLimiter = createLimiter({
  windowMs: numEnv("RL_AUTH_VERIFY_OTP_WINDOW_MS", 15 * 60 * 1000),
  max: numEnv("RL_AUTH_VERIFY_OTP_MAX", 40),
});

const patientLoginLimiter = createLimiter({
  windowMs: numEnv("RL_PATIENT_LOGIN_WINDOW_MS", 15 * 60 * 1000),
  max: numEnv("RL_PATIENT_LOGIN_MAX", 60),
});

const doctorVerifyOtpLimiter = createLimiter({
  windowMs: numEnv("RL_DOCTOR_VERIFY_OTP_WINDOW_MS", 15 * 60 * 1000),
  max: numEnv("RL_DOCTOR_VERIFY_OTP_MAX", 40),
});

/** Ops observability routes (/api/ops/*) — per-IP cap even when key is wrong (404). */
const opsObservabilityLimiter = createLimiter({
  windowMs: numEnv("RL_OPS_OBSERVABILITY_WINDOW_MS", 15 * 60 * 1000),
  max: numEnv("RL_OPS_OBSERVABILITY_MAX", 120),
});

module.exports = {
  patientOauthLimiter,
  authRequestOtpLimiter,
  authVerifyOtpLimiter,
  patientLoginLimiter,
  doctorVerifyOtpLimiter,
  opsObservabilityLimiter,
};
