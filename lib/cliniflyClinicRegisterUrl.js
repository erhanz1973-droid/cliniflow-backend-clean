/**
 * Canonical clinic admin registration URL for Clinifly Sales AI CTAs.
 * Override via CLINIFLY_CLINIC_REGISTER_URL or RAILWAY_PUBLIC_URL / PUBLIC_API_URL.
 */

const DEFAULT_CLINIC_REGISTER_URL =
  "https://cliniflow-backend-clean-production.up.railway.app/admin-register.html";

const DEFAULT_TUTORIAL_YOUTUBE_URL = "https://www.youtube.com/@Clinifly";

/** @type {RegExp[]} */
const BAD_REGISTRATION_URL_PATTERNS = [
  /https?:\/\/(?:www\.)?clinifly\.net\/sign-up[^\s]*/gi,
  /https?:\/\/clinifly\.net\/sign-up[^\s]*/gi,
  /https?:\/\/(?:www\.)?clinifly\.net\/ka[^\s]*/gi,
  /https?:\/\/(?:www\.)?clinifly\.net\/tr[^\s]*/gi,
  /https?:\/\/(?:www\.)?clinifly\.net(?:\/[^\s]*)?/gi,
  /\/sign-up[^\s]*/gi,
];

function getCliniflyClinicRegisterUrl() {
  const explicit = String(process.env.CLINIFLY_CLINIC_REGISTER_URL || "").trim();
  if (explicit) return explicit;

  const apiBase = String(process.env.RAILWAY_PUBLIC_URL || process.env.PUBLIC_API_URL || "").trim();
  if (apiBase) {
    const base = apiBase.replace(/\/$/, "");
    if (/\/admin-register\.html$/i.test(base)) return base;
    return `${base}/admin-register.html`;
  }

  return DEFAULT_CLINIC_REGISTER_URL;
}

function getCliniflyTutorialYoutubeUrl() {
  return String(process.env.CLINIFLY_TUTORIAL_YOUTUBE_URL || DEFAULT_TUTORIAL_YOUTUBE_URL).trim();
}

function buildTutorialVideosPromptRules() {
  const url = getCliniflyTutorialYoutubeUrl();
  return `TUTORIAL / HOW-TO VIDEOS (mandatory facts):
• Clinifly HAS official tutorial and training videos on YouTube: ${url}
• NEVER say "we don't have videos", "no usage videos", "videolarımız yok", or similar.
• When asked about tutorials, how-to videos, or "nasıl kullanılır videolar": confirm yes, share the YouTube link, briefly mention topics (registration, AI settings, WhatsApp/Messenger, admin panel).
• Do NOT push registration link as the primary answer when they only asked for videos.`;
}

function buildClinicRegistrationPromptRules() {
  const url = getCliniflyClinicRegisterUrl();
  return `CLINIC REGISTRATION URL (mandatory for clinic signup / free trial / join Clinifly):
${url}

When a clinic wants to register or try Clinifly for free:
• Explain: register free, no credit card, add clinic and start immediately (self-service).
• Include the exact URL above in the CTA.

FORBIDDEN — never send these for clinic registration (broken or wrong):
• clinifly.net/sign-up, /sign-up, or any "sign up" marketing URL
• www.clinifly.net, clinifly.net/ka, clinifly.net/tr as registration links
• Do not invent other registration URLs`;
}

/**
 * Replace known-bad registration links in an outbound sales reply.
 * @param {string} replyText
 */
function sanitizeSalesRegistrationUrls(replyText) {
  const correct = getCliniflyClinicRegisterUrl();
  let out = String(replyText || "");
  for (const pattern of BAD_REGISTRATION_URL_PATTERNS) {
    out = out.replace(pattern, correct);
  }
  if (/\bsign-up\b/i.test(out) && !out.includes(correct)) {
    out = `${out.trim()}\n\n${correct}`;
  }
  return out.trim();
}

module.exports = {
  DEFAULT_CLINIC_REGISTER_URL,
  DEFAULT_TUTORIAL_YOUTUBE_URL,
  getCliniflyClinicRegisterUrl,
  getCliniflyTutorialYoutubeUrl,
  buildClinicRegistrationPromptRules,
  buildTutorialVideosPromptRules,
  sanitizeSalesRegistrationUrls,
};
