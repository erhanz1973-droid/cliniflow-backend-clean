/**
 * Single source of truth for Cliniflow API base URL (Expo).
 * TEMP: set FORCE_FIXED_API_BASE = false once EXPO_PUBLIC_API_URL verifies in Expo Go logs.
 */
export const FORCE_FIXED_API_BASE = true;

const HARD_BASE = "http://172.20.10.2:3000";

const FALLBACK_API_BASE_URL = HARD_BASE;

/**
 * @returns {string} No trailing slash
 */
export function getApiBaseUrl() {
  const envRaw =
    typeof process !== "undefined" && process.env ? process.env.EXPO_PUBLIC_API_URL : undefined;

  console.log("[apiConfig] EXPO_PUBLIC_API_URL (raw):", envRaw != null && envRaw !== "" ? envRaw : "(missing or empty)");

  if (FORCE_FIXED_API_BASE) {
    console.warn("[apiConfig] FORCE_FIXED_API_BASE — using:", HARD_BASE);
    console.log("API URL:", HARD_BASE);
    return HARD_BASE;
  }

  let base = String(envRaw || "").trim().replace(/\/+$/, "");
  if (!base) {
    base = FALLBACK_API_BASE_URL;
    console.warn("[apiConfig] EXPO_PUBLIC_API_URL unset — fallback:", FALLBACK_API_BASE_URL);
  }
  blockLocalhostMisconfig(base);
  console.log("API URL:", base);
  return base;
}

export function getPublicWebOrigin() {
  if (FORCE_FIXED_API_BASE) return HARD_BASE;
  const web = process.env.EXPO_PUBLIC_CLINIC_WEB_ORIGIN;
  if (web && String(web).trim())
    return String(web).trim().replace(/\/+$/, "");
  return getApiBaseUrl();
}

function blockLocalhostMisconfig(base) {
  try {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(base)) {
      console.error(
        "[apiConfig] localhost/127.0.0.1 will not work from a phone on LAN. Use your machine IP (e.g. 172.20.10.2:3000).",
      );
    }
  } catch (_e) {
    /* ignore */
  }
}
