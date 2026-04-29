/**
 * Shared app language (localStorage key: "lang").
 * Load before pages that rely on window.getFindClinicLang.
 */
(function () {
  "use strict";

  window.CLINIFLOW_ALLOWED_LANGS = ["tr", "en", "ru", "ka"];

  function getLangFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("lang");
    } catch (_e) {
      /* ignore */
    }
    return null;
  }

  /** Normalize to a 2-letter lang code or "". */
  function normalizeLangCode(v) {
    const s = v ? String(v).trim().slice(0, 2).toLowerCase() : "";
    return window.CLINIFLOW_ALLOWED_LANGS.includes(s) ? s : "";
  }

  /** When ?lang= is present, persist so the rest of the shell matches (Expo / WebView). */
  function applyLangFromUrlToStorage() {
    try {
      const fromUrl = normalizeLangCode(getLangFromUrl());
      if (fromUrl) localStorage.setItem("lang", fromUrl);
    } catch (_e) {
      /* ignore */
    }
  }

  applyLangFromUrlToStorage();

  function getFindClinicLang() {
    try {
      const urlLang = normalizeLangCode(getLangFromUrl());
      if (urlLang) return urlLang;
    } catch (_e) {
      /* ignore */
    }
    try {
      const ls = localStorage.getItem("lang");
      const s = ls ? String(ls).trim().slice(0, 2).toLowerCase() : "";
      if (window.CLINIFLOW_ALLOWED_LANGS.includes(s)) return s;
    } catch (_e) {
      /* ignore */
    }
    return "en";
  }

  /** @param {string} lang */
  function setAppLang(lang) {
    try {
      if (window.CLINIFLOW_ALLOWED_LANGS.includes(lang)) {
        localStorage.setItem("lang", lang);
      }
    } catch (_e) {
      /* ignore */
    }
  }

  window.getFindClinicLang = getFindClinicLang;
  window.setAppLang = setAppLang;
  window.getLangFromUrl = getLangFromUrl;

  try {
    console.log("🌍 LANG BEFORE INIT:", localStorage.getItem("lang"));
  } catch (_u) {
    console.log("🌍 LANG BEFORE INIT:", "(unavailable)");
  }

  /** First visit only: default to English so TR device locale does not override ?lang-less loads. */
  function initDefaultLangIfUnset() {
    try {
      const existing = localStorage.getItem("lang");
      if (existing != null && String(existing).trim() !== "") return;
      const detected = "en";
      localStorage.setItem("lang", detected);
      console.log("🌍 LANG INITIAL DEFAULT (was unset):", detected);
    } catch (_e) {
      /* ignore */
    }
  }

  initDefaultLangIfUnset();

  console.log("🌐 i18n.js loaded; lang =", getFindClinicLang());
})();
