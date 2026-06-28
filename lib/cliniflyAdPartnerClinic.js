/**
 * Featured partner clinic for Facebook / Instagram ad traffic (Messenger).
 * Default: Diş Güzelliği — override via env or channel_metadata.facebook_ad_partner_clinic
 *
 * Patient-visible copy must use a language-appropriate display name (not Turkish in Georgian replies).
 */

const DEFAULT_FB_AD_PARTNER_CLINIC =
  String(process.env.CLINIFLY_FB_AD_PARTNER_CLINIC || "").trim() || "Diş Güzelliği";

/** Canonical partner name → localized patient-facing display (empty = omit name in that language). */
const PARTNER_CLINIC_LOCALIZED_DISPLAY = {
  "Diş Güzelliği": {
    tr: "Diş Güzelliği",
    en: "Diş Güzelliği",
    ru: "Diş Güzelliği",
    ka: "",
  },
};

const TURKISH_PARTNER_NAME_RE = /diş\s*güzelliği|dis\s*guzelligi/i;

/**
 * @param {Record<string, unknown>|null|undefined} channelMetadata
 */
function resolveFacebookAdPartnerClinic(channelMetadata) {
  const meta = channelMetadata && typeof channelMetadata === "object" ? channelMetadata : {};
  const fromMeta =
    meta.facebook_ad_partner_clinic ||
    meta.ad_partner_clinic ||
    meta.featured_partner_clinic;
  const name = String(fromMeta || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  return name || DEFAULT_FB_AD_PARTNER_CLINIC;
}

/**
 * Patient-facing partner clinic name for a reply language.
 * Env override: CLINIFLY_FB_AD_PARTNER_CLINIC_KA, _TR, _RU, _EN
 * @param {string} lang
 * @param {string} clinicName
 * @returns {string} Empty string means omit the name from patient copy (avoid script mixing).
 */
function resolveFacebookAdPartnerClinicDisplayName(lang, clinicName) {
  const canonical = String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const envOverride = String(
    process.env[`CLINIFLY_FB_AD_PARTNER_CLINIC_${key.toUpperCase()}`] || "",
  ).trim();
  if (envOverride) return envOverride;

  const mapped = PARTNER_CLINIC_LOCALIZED_DISPLAY[canonical];
  if (mapped && Object.prototype.hasOwnProperty.call(mapped, key)) {
    return String(mapped[key] ?? "").trim();
  }

  if (key === "ka" && TURKISH_PARTNER_NAME_RE.test(canonical)) {
    return "";
  }

  return canonical;
}

/**
 * Strip Turkish partner clinic name from non-Turkish patient replies (safety net).
 * @param {string} text
 * @param {string} lang
 */
function sanitizePartnerClinicLanguageLeak(text, lang) {
  const reply = String(text || "");
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  if (!reply || key === "tr") return reply;

  let out = reply;
  out = out.replace(/✨\s*Diş Güzelliği-თან ერთად\s*/gi, "✨ ");
  out = out.replace(/Diş Güzelliği-ის\s+/gi, "");
  out = out.replace(/\bDiş Güzelliği\b/gi, "");
  out = out.replace(/\bDis Guzelligi\b/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * @param {string} lang
 * @param {string} clinicName
 */
function buildFacebookAdPartnerIntroLine(lang, clinicName) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const name = resolveFacebookAdPartnerClinicDisplayName(key, clinicName);

  if (key === "tr") {
    const label = name || String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
    return `${label} Facebook reklamı üzerinden bize ulaştınız — gülüş ve estetik konularında size yardımcı olabilirim.`;
  }
  if (key === "ka") {
    if (name) {
      return `თქვენ ${name}-ის Facebook რეკლამიდან მოხვედით — ღიმილსა და ესთეტიკაში დაგეხმარებით.`;
    }
    return "Facebook რეკლამიდან Clinifly-თან დაუკავშირდით — ღიმილსა და ესთეტიკაში დაგეხმარებით.";
  }
  if (key === "ru") {
    const label = name || String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
    return `Вы пришли по рекламе ${label} в Facebook — помогу с вопросами об улыбке и эстетике.`;
  }
  const label = name || String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  return `You reached us through ${label}'s Facebook ad — I can help with smile and aesthetic questions.`;
}

/**
 * @param {string} lang
 * @param {string} clinicName
 */
function buildFacebookAdPartnerSmileBridgeLine(lang, clinicName) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const name = resolveFacebookAdPartnerClinicDisplayName(key, clinicName);

  if (key === "tr") {
    const label = name || String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
    return `✨ ${label} iş birliğiyle Clinifly uygulamasında gülüş fotoğrafınızı yükleyin; AI Smile Score ve kişisel önerilerinizi saniyeler içinde alın.`;
  }
  if (key === "ka") {
    if (name) {
      return `✨ ${name}-თან ერთად Clinifly აპში ატვირთეთ ღიმილის ფოტო — Smile Score და პერსონალური რჩევები წამებში.`;
    }
    return "✨ Clinifly აპში ატვირთეთ ღიმილის ფოტო — Smile Score და პერსონალური რჩევები წამებში.";
  }
  if (key === "ru") {
    const label = name || String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
    return `✨ Вместе с ${label} загрузите фото улыбки в Clinifly — Smile Score и персональные советы за секунды.`;
  }
  const label = name || String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  return `✨ With ${label}, upload your smile photo in the Clinifly app for your Smile Score and personalized tips in seconds.`;
}

/**
 * System-prompt block for LLM turns (consumer ad flow).
 * @param {string} lang
 * @param {string} clinicName
 */
function buildFacebookAdPartnerPromptBlock(lang, clinicName) {
  const canonical = String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const displayName = resolveFacebookAdPartnerClinicDisplayName(key, canonical) || canonical;

  if (key === "tr") {
    return `FACEBOOK REKLAMI — PARTNER KLİNİK: Ziyaretçi ${displayName} Facebook/Instagram reklamından geldi. Yanıtları bu bağlama bağla; klinik temsilcisi sorma. Gülüş/estetik sorularında önce ${displayName} + Clinifly Smile Score akışını kısaca hatırlat, sonra uygulama indirme linklerini ver. Uzun tedavi eğitimi yapma.`;
  }
  if (key === "ka") {
    return `FACEBOOK AD — PARTNER CLINIC (reply language: Georgian ONLY):
Visitor from partner clinic Facebook/Instagram ad (${canonical} — internal reference only).
• Write the entire patient-visible reply in Georgian. Do NOT use Turkish words (e.g. Diş, Güzelliği, gülüş, tedavi).
• Do NOT paste the Turkish clinic name "${canonical}" into Georgian text unless a Georgian display name was provided.
• Tie replies to smile/aesthetic help + Clinifly Smile Score app flow + download links. No long dental lectures.`;
  }
  if (key === "ru") {
    return `FACEBOOK AD — PARTNER CLINIC: Visitor from ${displayName} ad. Reply in Russian only. Link answers to ${displayName} + Clinifly Smile Score. No long treatment lectures.`;
  }
  return `FACEBOOK AD — PARTNER CLINIC: Visitor came from ${displayName}'s Facebook/Instagram ad. Tie every consumer reply to ${displayName} + Clinifly Smile Score app flow. Do NOT ask clinic representative. No long dental education in Messenger.`;
}

module.exports = {
  DEFAULT_FB_AD_PARTNER_CLINIC,
  resolveFacebookAdPartnerClinic,
  resolveFacebookAdPartnerClinicDisplayName,
  sanitizePartnerClinicLanguageLeak,
  buildFacebookAdPartnerIntroLine,
  buildFacebookAdPartnerSmileBridgeLine,
  buildFacebookAdPartnerPromptBlock,
};
