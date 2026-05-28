/**
 * Patient registration — user-facing errors (avoid generic "server error").
 */

const MESSAGES_TR = {
  email_required: "E-posta adresi gereklidir.",
  invalid_email: "Geçersiz e-posta adresi. Lütfen kontrol edip tekrar deneyin.",
  invalid_phone:
    "Geçersiz telefon numarası. Numarayı ülke kodu ile girin (örnek: Türkiye +905321234567, Gürcistan +995555123456).",
  invalid_phone_hint: "Başında + ve ülke kodu olmalı; sadece rakam ve boşluk kullanabilirsiniz.",
  invalid_clinic_code: (code) =>
    `"${code}" geçerli bir klinik kodu değil. Kodu kliniğinizden aldığınız şekilde yazın (ör. büyük harf, boşluksuz). Şehir veya klinik adı değil, özel koddur.`,
  clinic_not_found: (code) =>
    `"${code}" ile eşleşen klinik bulunamadı. Klinik kodunu kliniğinizden doğrulayın; şehir adı (ör. Trabzon) klinik kodu değildir.`,
  clinic_code_required: "Klinik kodu gereklidir. Kliniğiniz size verdiği kodu girin.",
  first_name_required: "Ad alanı gereklidir.",
  register_failed: "Kayıt tamamlanamadı. Bilgilerinizi kontrol edip tekrar deneyin.",
  register_failed_lookup:
    "Kayıt sırasında bir tutarsızlık oluştu. Lütfen tekrar deneyin veya klinik ile iletişime geçin.",
  phone_already_registered:
    "Bu telefon numarası başka bir hesaba bağlı. Farklı bir numara kullanın veya kayıtlı e-postanızla giriş yapın.",
  user_already_exists: "Bu e-posta ile zaten kayıt var. Lütfen giriş yapın.",
  internal_error:
    "İşleminiz tamamlanamadı. Lütfen bilgilerinizi kontrol edip tekrar deneyin; sorun sürerse klinik ile iletişime geçin.",
  supabase_unavailable:
    "Kayıt servisi geçici olarak kullanılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.",
  supabase_crash:
    "Kayıt servisine bağlanılamadı. Lütfen birkaç dakika sonra tekrar deneyin.",
  otp_send_failed: "Doğrulama kodu gönderilemedi. Lütfen bir süre sonra tekrar deneyin.",
  invalid_referral_code: (code) =>
    `"${code}" referans kodu geçersiz veya bulunamadı. Kodu kontrol edip tekrar deneyin.`,
};

const MESSAGES_EN = {
  email_required: "Email address is required.",
  invalid_email: "Invalid email address. Please check and try again.",
  invalid_phone:
    "Invalid phone number. Include your country code (e.g. Turkey +905321234567, Georgia +995555123456).",
  invalid_phone_hint: "Start with + and country code; digits and spaces only.",
  invalid_clinic_code: (code) =>
    `"${code}" is not a valid clinic code. Use the exact code from your clinic (not a city or clinic name).`,
  clinic_not_found: (code) =>
    `No clinic found for code "${code}". Confirm the code with your clinic — a city name (e.g. Trabzon) is not a clinic code.`,
  clinic_code_required: "Clinic code is required. Enter the code your clinic gave you.",
  first_name_required: "First name is required.",
  register_failed: "Registration could not be completed. Please check your details and try again.",
  register_failed_lookup:
    "A registration inconsistency occurred. Please try again or contact the clinic.",
  phone_already_registered:
    "This phone number is linked to another account. Use a different number or sign in with your registered email.",
  user_already_exists: "An account with this email already exists. Please sign in.",
  internal_error:
    "We could not complete your request. Please check your details and try again, or contact the clinic.",
  supabase_unavailable: "Registration is temporarily unavailable. Please try again in a few minutes.",
  supabase_crash: "Could not reach the registration service. Please try again shortly.",
  otp_send_failed: "Verification code could not be sent. Please try again later.",
  invalid_referral_code: (code) =>
    `Referral code "${code}" is invalid or not found. Please check and try again.`,
};

/**
 * @param {string|null|undefined} language
 */
function pickRegisterLang(language) {
  const code = String(language || "tr")
    .trim()
    .slice(0, 2)
    .toLowerCase();
  return code === "en" ? "en" : "tr";
}

/**
 * @param {string} errorCode
 * @param {string} lang
 * @param {{ clinicCode?: string, referralCode?: string }} [ctx]
 */
function messageForRegisterError(errorCode, lang, ctx = {}) {
  const table = lang === "en" ? MESSAGES_EN : MESSAGES_TR;
  const key = String(errorCode || "register_failed").trim();
  const clinicCode = String(ctx.clinicCode || "").trim().toUpperCase();
  const referralCode = String(ctx.referralCode || "").trim();

  if (key === "clinic_not_found" || key === "invalid_clinic_code") {
    const fn = table.invalid_clinic_code || table.clinic_not_found;
    return typeof fn === "function" ? fn(clinicCode || "?") : String(fn);
  }
  if (key === "invalid_referral_code") {
    const fn = table.invalid_referral_code;
    return typeof fn === "function" ? fn(referralCode || "?") : String(fn);
  }
  const raw = table[key];
  if (typeof raw === "function") return raw(clinicCode);
  if (raw) return String(raw);
  return table.register_failed;
}

/**
 * HTTP status for client apps (prefer 4xx for user-fixable validation).
 * @param {string} errorCode
 */
function httpStatusForRegisterError(errorCode) {
  const key = String(errorCode || "").trim();
  const map = {
    email_required: 400,
    invalid_email: 400,
    invalid_phone: 400,
    invalid_clinic_code: 400,
    clinic_not_found: 400,
    clinic_code_required: 400,
    first_name_required: 400,
    invalid_name: 400,
    phone_already_registered: 409,
    user_already_exists: 409,
    email_oauth_mismatch: 400,
    oauth_link_incomplete: 400,
    invalid_oauth_provider: 400,
    invalid_oauth_token: 401,
    oauth_already_registered: 409,
    invalid_referral_code: 400,
    self_referral_not_allowed: 400,
    referral_create_failed: 400,
    otp_delivery_not_configured: 503,
    otp_send_failed: 503,
    supabase_unavailable: 503,
    supabase_crash: 503,
    register_failed: 500,
    register_failed_lookup: 500,
    db_insert_failed: 500,
    internal_error: 500,
    phone_identity_ambiguous: 500,
  };
  return map[key] ?? 400;
}

/**
 * Optional short hint for mobile/web UI.
 * @param {string} errorCode
 * @param {string} lang
 */
function hintForRegisterError(errorCode, lang) {
  const tr = lang !== "en";
  const key = String(errorCode || "").trim();
  if (key === "invalid_phone") {
    return tr ? MESSAGES_TR.invalid_phone_hint : MESSAGES_EN.invalid_phone_hint;
  }
  if (key === "clinic_not_found" || key === "invalid_clinic_code") {
    return tr
      ? "Klinik kodu genelde harf/rakamdan oluşur; kliniğinizden paylaşılan kodu aynen yazın."
      : "Clinic codes are assigned by the clinic — not the city name.";
  }
  return null;
}

/**
 * @param {import('express').Response} res
 * @param {string} errorCode
 * @param {{ language?: string, clinicCode?: string, referralCode?: string, message?: string, hint?: string, details?: string, status?: number }} [ctx]
 */
function sendRegisterUserError(res, errorCode, ctx = {}) {
  const lang = pickRegisterLang(ctx.language);
  const error = String(errorCode || "register_failed").trim();
  const status = ctx.status ?? httpStatusForRegisterError(error);
  const message =
    String(ctx.message || "").trim() || messageForRegisterError(error, lang, ctx);
  const hint = ctx.hint ?? hintForRegisterError(error, lang);
  const body = {
    ok: false,
    error,
    message,
    userFacing: true,
  };
  if (hint) body.hint = hint;
  if (ctx.details && !String(process.env.NODE_ENV || "").includes("prod")) {
    body.details = String(ctx.details).slice(0, 200);
  }
  return res.status(status).json(body);
}

module.exports = {
  pickRegisterLang,
  messageForRegisterError,
  httpStatusForRegisterError,
  hintForRegisterError,
  sendRegisterUserError,
  MESSAGES_TR,
  MESSAGES_EN,
};
