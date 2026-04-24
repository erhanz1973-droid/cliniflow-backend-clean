/**
 * Production phone + email identity helpers for patients.
 * Storage: E.164 with leading + (e.g. +9955XXXXXXXX, +905XXXXXXXXX).
 * SMS default calling code: OTP_SMS_DEFAULT_CALLING_CODE (default 995).
 */

const DEFAULT_CC = String(process.env.OTP_SMS_DEFAULT_CALLING_CODE || "995")
  .replace(/\D/g, "")
  .trim() || "995";

/**
 * @param {string} email
 * @returns {string}
 */
function normalizeRegisterEmail(email) {
  return String(email == null ? "" : email)
    .trim()
    .toLowerCase();
}

/**
 * E.164 storage form: + then 8–15 digits (no spaces).
 * Aligns with SMS / Twilio and DB uniqueness.
 * @param {string} phone
 * @returns {string} e.g. "+9955XXXXXXXX" or "" if invalid/empty
 */
function normalizePhone(phone) {
  if (phone == null) return "";
  const e164 = tryParseE164(phone);
  return e164 || "";
}

/**
 * @returns {string|null} e.g. "+995..." or null
 */
function tryParseE164(phoneInput) {
  if (phoneInput == null) return null;
  let s = String(phoneInput).trim();
  if (!s) return null;
  s = s.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const cc = DEFAULT_CC;
  if (digits.length >= 11 && digits.length <= 15 && digits.startsWith(cc)) {
    return `+${digits}`;
  }
  if (cc === "995" && digits.length === 9) {
    return `+${cc}${digits}`;
  }
  if (cc === "90" && digits.length === 10) {
    return `+${cc}${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

/**
 * Values to match in DB: current E.164 plus legacy storage (digits-only, local TR, etc.).
 * @param {string} e164
 * @returns {string[]}
 */
function phoneSearchVariants(e164) {
  if (!e164) return [];
  const s = String(e164).trim();
  const out = new Set();
  if (s.startsWith("+")) out.add(s);
  const d = s.replace(/\D/g, "");
  if (d) {
    out.add(d);
    if (d.length > 3) out.add(`+${d}`);
  }
  // Legacy: Turkish 10-digit mobile without country
  if (d.length === 12 && d.startsWith("90")) {
    out.add(d.slice(2));
    out.add("0" + d.slice(2));
  }
  if (d.length === 10 && d[0] === "5" && DEFAULT_CC === "90") {
    out.add(d);
    out.add("0" + d);
  }
  // Georgia 9 after 995
  if (d.length === 12 && d.startsWith("995") && DEFAULT_CC === "995") {
    out.add(d.slice(3));
  }
  return [...out].filter(Boolean);
}

module.exports = {
  normalizePhone,
  tryParseE164,
  normalizeRegisterEmail,
  phoneSearchVariants,
  DEFAULT_CC,
};
