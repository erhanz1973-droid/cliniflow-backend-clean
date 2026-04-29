/**
 * Open clinic onboarding in the device browser / WebView shell.
 * Uses EXPO_PUBLIC_CLINIC_WEB_ORIGIN or the same LAN host as the API — not Metro (:8081).
 */
import { Linking } from "react-native";
import { getPublicWebOrigin } from "./apiConfig.js";
import { i18n } from "./language-context.js";

const ALLOWED_LANGS = ["tr", "en", "ru", "ka"];

/**
 * @param {string} [language] tr | en | ru | ka — omit to use {@link i18n.locale} from LanguageProvider.
 */
export function openClinicOnboarding(language) {
  const resolved =
    language !== undefined && language !== null && ALLOWED_LANGS.includes(language)
      ? language
      : ALLOWED_LANGS.includes(i18n.locale)
        ? i18n.locale
        : "en";
  const lang = resolved;
  const origin = getPublicWebOrigin();
  const url = `${origin}/clinic-onboarding?lang=${encodeURIComponent(lang)}`;
  return Linking.openURL(url);
}
