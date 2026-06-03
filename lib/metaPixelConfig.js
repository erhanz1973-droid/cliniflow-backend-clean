/**
 * Meta Pixel (browser) — separate from META_APP_ID (Messenger / WhatsApp OAuth).
 * Set META_PIXEL_ID in Railway: Events Manager → Data sources → your Pixel → ID below the name.
 */

const META_APP_ID_FOR_GUARD = String(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || "").trim();

function metaPixelId() {
  const id = String(process.env.META_PIXEL_ID || process.env.FACEBOOK_PIXEL_ID || "").trim();
  if (!id) return "";
  if (META_APP_ID_FOR_GUARD && id === META_APP_ID_FOR_GUARD) {
    console.warn(
      "[metaPixel] META_PIXEL_ID equals META_APP_ID — refusing to use App ID as Pixel. " +
        "Copy the Pixel / dataset ID from Events Manager → Data sources (not App settings).",
    );
    return "";
  }
  if (!/^\d{8,20}$/.test(id)) {
    console.warn("[metaPixel] META_PIXEL_ID invalid format (expected numeric 8–20 digits):", id.slice(0, 6));
    return "";
  }
  return id;
}

function metaPixelConfigError() {
  const raw = String(process.env.META_PIXEL_ID || process.env.FACEBOOK_PIXEL_ID || "").trim();
  if (!raw) return "META_PIXEL_ID not set on server";
  if (META_APP_ID_FOR_GUARD && raw === META_APP_ID_FOR_GUARD) {
    return "META_PIXEL_ID must not be the Meta App ID; use Events Manager Pixel / dataset ID";
  }
  if (!/^\d{8,20}$/.test(raw)) return "META_PIXEL_ID invalid format";
  return null;
}

module.exports = {
  metaPixelId,
  metaPixelConfigError,
  metaPixelConfigured: () => Boolean(metaPixelId()),
};
