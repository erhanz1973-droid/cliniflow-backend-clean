/**
 * Featured partner clinic for Facebook / Instagram ad traffic (Messenger).
 * Default: Diş Güzelliği — override via env or channel_metadata.facebook_ad_partner_clinic
 */

const DEFAULT_FB_AD_PARTNER_CLINIC =
  String(process.env.CLINIFLY_FB_AD_PARTNER_CLINIC || "").trim() || "Diş Güzelliği";

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
 * @param {string} lang
 * @param {string} clinicName
 */
function buildFacebookAdPartnerIntroLine(lang, clinicName) {
  const name = String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return `${name} Facebook reklamı üzerinden bize ulaştınız — gülüş ve estetik konularında size yardımcı olabilirim.`;
  }
  if (key === "ka") {
    return `თქვენ ${name}-ის Facebook რეკლამიდან მოხვედით — ღიმილსა და ესთეტიკაში დაგეხმარებით.`;
  }
  if (key === "ru") {
    return `Вы пришли по рекламе ${name} в Facebook — помогу с вопросами об улыбке и эстетике.`;
  }
  return `You reached us through ${name}'s Facebook ad — I can help with smile and aesthetic questions.`;
}

/**
 * @param {string} lang
 * @param {string} clinicName
 */
function buildFacebookAdPartnerSmileBridgeLine(lang, clinicName) {
  const name = String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return `✨ ${name} iş birliğiyle Clinifly uygulamasında gülüş fotoğrafınızı yükleyin; AI Smile Score ve kişisel önerilerinizi saniyeler içinde alın.`;
  }
  if (key === "ka") {
    return `✨ ${name}-თან ერთად Clinifly აპში ატვირთეთ ღიმილის ფოტო — Smile Score და პერსონალური რჩევები წამებში.`;
  }
  if (key === "ru") {
    return `✨ Вместе с ${name} загрузите фото улыбки в Clinifly — Smile Score и персональные советы за секунды.`;
  }
  return `✨ With ${name}, upload your smile photo in the Clinifly app for your Smile Score and personalized tips in seconds.`;
}

/**
 * System-prompt block for LLM turns (consumer ad flow).
 * @param {string} lang
 * @param {string} clinicName
 */
function buildFacebookAdPartnerPromptBlock(lang, clinicName) {
  const name = String(clinicName || DEFAULT_FB_AD_PARTNER_CLINIC).trim();
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return `FACEBOOK REKLAMI — PARTNER KLİNİK: Ziyaretçi ${name} Facebook/Instagram reklamından geldi. Yanıtları bu bağlama bağla; klinik temsilcisi sorma. Gülüş/estetik sorularında önce ${name} + Clinifly Smile Score akışını kısaca hatırlat, sonra uygulama indirme linklerini ver. Uzun tedavi eğitimi yapma.`;
  }
  if (key === "ka") {
    return `FACEBOOK AD — PARTNER CLINIC: Visitor from ${name} Facebook/Instagram ad. Tie replies to this context. Smile Score app flow + download links.`;
  }
  if (key === "ru") {
    return `FACEBOOK AD — PARTNER CLINIC: Visitor from ${name} ad. Link answers to ${name} + Clinifly Smile Score. No long treatment lectures.`;
  }
  return `FACEBOOK AD — PARTNER CLINIC: Visitor came from ${name}'s Facebook/Instagram ad. Tie every consumer reply to ${name} + Clinifly Smile Score app flow. Do NOT ask clinic representative. No long dental education in Messenger.`;
}

module.exports = {
  DEFAULT_FB_AD_PARTNER_CLINIC,
  resolveFacebookAdPartnerClinic,
  buildFacebookAdPartnerIntroLine,
  buildFacebookAdPartnerSmileBridgeLine,
  buildFacebookAdPartnerPromptBlock,
};
