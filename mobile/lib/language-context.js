/**
 * Same AsyncStorage contract as cliniflow-app (STORAGE_KEY, v3 migration — legacy `tr` → `en` once).
 * Use <LanguageProvider> at app root; FindClinicScreen uses useLanguage().currentLanguage.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { UI_STRINGS } from "../locales/uiStrings";

/** Metro/RN define `__DEV__` as false in production builds — logs must not spam release. */
const isDev =
  typeof __DEV__ !== "undefined" ? Boolean(__DEV__) : process.env.NODE_ENV !== "production";

/**
 * Optional targeted debug for `t()`: assign a key string to log only that lookup (e.g. `"find_clinic_search_label"`).
 * Ignored unless `isDev` is true. Keep `null` in normal development to avoid render spam.
 */
let DEBUG_TRANSLATE_LOOKUP_FOR_KEY = null;

export const STORAGE_KEY = "@cliniflow:language";
export const LEGACY_STORAGE_KEY = "lang";
export const APP_LANG_VERSION = "v3";
export const LANGUAGE_VERSION_KEY = "@cliniflow:language_version";
export const DEFAULT_APP_LANGUAGE = "en";

export const SUPPORTED_LANGUAGES = Object.freeze(["tr", "en", "ru", "ka"]);

export const i18n = { locale: DEFAULT_APP_LANGUAGE };

const LanguageContext = createContext(undefined);

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguageState] = useState(DEFAULT_APP_LANGUAGE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const initLanguage = async () => {
      try {
        setIsLoading(true);

        let raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);

        const storedVersion = await AsyncStorage.getItem(LANGUAGE_VERSION_KEY);

        let lang;
        if (storedVersion !== APP_LANG_VERSION) {
          lang = DEFAULT_APP_LANGUAGE;
          if (raw && SUPPORTED_LANGUAGES.includes(raw)) {
            if (raw === "tr") {
              if (isDev) {
                console.log("FORCING EN RESET:", { raw, storedVersion });
              }
              lang = DEFAULT_APP_LANGUAGE;
            } else {
              lang = raw;
            }
          }
          await AsyncStorage.setItem(STORAGE_KEY, lang);
          await AsyncStorage.setItem(LEGACY_STORAGE_KEY, lang);
          await AsyncStorage.setItem(LANGUAGE_VERSION_KEY, APP_LANG_VERSION);
          if (isDev) {
            console.warn("[mobile LanguageContext] language persistence migration", {
              fromVersion: storedVersion ?? "(none)",
              to: APP_LANG_VERSION,
              lang,
              droppedPreviousStored: raw ?? null,
            });
          }
        } else {
          lang =
            raw && SUPPORTED_LANGUAGES.includes(raw) ? raw : DEFAULT_APP_LANGUAGE;
          await AsyncStorage.setItem(STORAGE_KEY, lang);
          await AsyncStorage.setItem(LEGACY_STORAGE_KEY, lang);
        }

        if (cancelled) return;
        i18n.locale = lang;
        setCurrentLanguageState(lang);
        if (isDev) {
          console.log("[mobile LanguageContext] ACTIVE LANG:", i18n.locale);
        }
      } catch (e) {
        console.warn("[mobile LanguageContext] init error:", e?.message || e);
        if (!cancelled) {
          i18n.locale = DEFAULT_APP_LANGUAGE;
          setCurrentLanguageState(DEFAULT_APP_LANGUAGE);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void initLanguage();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = async (lang) => {
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      throw new Error(`Unsupported language: ${lang}`);
    }
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, lang);
    await AsyncStorage.setItem(LANGUAGE_VERSION_KEY, APP_LANG_VERSION);
    i18n.locale = lang;
    setCurrentLanguageState(lang);
    if (isDev) {
      console.log("[mobile LanguageContext] ACTIVE LANG:", i18n.locale);
    }
  };

  const t = useCallback(
    (key) => {
      if (
        isDev &&
        DEBUG_TRANSLATE_LOOKUP_FOR_KEY != null &&
        DEBUG_TRANSLATE_LOOKUP_FOR_KEY !== "" &&
        key === DEBUG_TRANSLATE_LOOKUP_FOR_KEY
      ) {
        console.log("[t]", key);
      }
      const row = UI_STRINGS[currentLanguage] || UI_STRINGS.en;
      const fallback = UI_STRINGS.en;
      if (typeof key === "string" && key.includes(".")) {
        /** @param {typeof row} blob */
        function getLeaf(blob, parts) {
          let o = blob;
          for (const p of parts) {
            if (o == null || typeof o !== "object") return undefined;
            o = o[p];
          }
          return typeof o === "string" ? o : undefined;
        }
        const parts = key.split(".");
        const fromRow = getLeaf(row, parts);
        if (fromRow !== undefined) return fromRow;
        const fromEn = getLeaf(fallback, parts);
        if (fromEn !== undefined) return fromEn;
      }
      if (typeof key === "string" && row[key] !== undefined) return row[key];
      if (typeof key === "string" && fallback[key] !== undefined) return fallback[key];
      return typeof key === "string" ? key : "";
    },
    [currentLanguage],
  );

  const value = { currentLanguage, setLanguage, t, isLoading };

  return React.createElement(
    LanguageContext.Provider,
    { value },
    children,
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (ctx === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
