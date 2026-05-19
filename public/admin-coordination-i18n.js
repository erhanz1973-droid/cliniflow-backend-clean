/**
 * Coordination Center i18n — lazy-loaded /locales/{lang}/coordination.js
 * Integrates with AdminI18n (admin_lang). Missing keys fall back to English.
 */
(function () {
  "use strict";

  var SUPPORTED = { en: 1, tr: 1, ru: 1, ka: 1 };
  var RTL_BASE = { ar: 1, he: 1, fa: 1, ur: 1 };
  var LOCALE_TAG = {
    en: "en-GB",
    tr: "tr-TR",
    ru: "ru-RU",
    ka: "ka-GE",
  };
  var CACHE_VERSION = "202605191";
  var loaded = Object.create(null);
  var currentLang = "en";
  var messages = {};

  function normalizeLang(raw) {
    var base = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .split("-")[0];
    return SUPPORTED[base] ? base : "en";
  }

  function readAdminLang() {
    try {
      if (window.AdminI18n && typeof window.AdminI18n.getLanguage === "function") {
        return normalizeLang(window.AdminI18n.getLanguage());
      }
      if (window.i18n && typeof window.i18n.getLang === "function") {
        return normalizeLang(window.i18n.getLang());
      }
      return normalizeLang(localStorage.getItem("admin_lang") || "en");
    } catch (e) {
      return "en";
    }
  }

  function mergeMessages(lang) {
    var w = window.__cliniflowCoordinationLocales;
    if (w && w[lang] && typeof w[lang] === "object") {
      messages = w[lang];
      return true;
    }
    return false;
  }

  function lookup(tree, keys) {
    var value = tree;
    for (var i = 0; i < keys.length; i++) {
      if (!value || typeof value !== "object") return null;
      value = value[keys[i]];
    }
    return typeof value === "string" ? value : null;
  }

  function t(key, params) {
    var keys = String(key || "").split(".");
    var value = lookup(messages, keys);
    if (value == null && currentLang !== "en") {
      var w = window.__cliniflowCoordinationLocales;
      if (w && w.en) value = lookup(w.en, keys);
    }
    if (value == null) value = String(key);
    var out = value;
    if (params && typeof params === "object") {
      Object.keys(params).forEach(function (p) {
        out = out.replace(new RegExp("\\{" + p + "\\}", "g"), String(params[p]));
      });
    }
    return out;
  }

  function getIntlLocale() {
    return LOCALE_TAG[currentLang] || "en-GB";
  }

  function fmtTime(iso, opts) {
    if (!iso) return t("common.dash");
    try {
      var d = iso instanceof Date ? iso : new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return new Intl.DateTimeFormat(getIntlLocale(), Object.assign(
        { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
        opts || {},
      )).format(d);
    } catch (e) {
      return String(iso);
    }
  }

  function fmtNumber(n, opts) {
    return new Intl.NumberFormat(getIntlLocale(), opts || {}).format(Number(n) || 0);
  }

  function applyDocumentLang(lang) {
    var L = normalizeLang(lang);
    var base = L.split("-")[0];
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = L;
      document.documentElement.dir = RTL_BASE[base] ? "rtl" : "ltr";
    }
  }

  function applyStaticDom() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("[data-coord-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-coord-i18n");
      if (!key) return;
      el.textContent = t(key);
    });
    document.querySelectorAll("[data-coord-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-coord-i18n-placeholder");
      if (key) el.placeholder = t(key);
    });
    document.querySelectorAll("[data-coord-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-coord-i18n-title");
      if (key) el.title = t(key);
    });
    var titleEl = document.querySelector("title[data-coord-i18n]");
    if (titleEl) {
      var tk = titleEl.getAttribute("data-coord-i18n");
      if (tk) document.title = t(tk) + " — Clinifly Admin";
    }
  }

  function loadLocaleScript(lang) {
    return new Promise(function (resolve, reject) {
      var L = normalizeLang(lang);
      if (loaded[L] && mergeMessages(L)) return resolve(messages);
      var s = document.createElement("script");
      s.async = true;
      s.src = "/locales/" + L + "/coordination.js?v=" + CACHE_VERSION;
      s.onload = function () {
        loaded[L] = true;
        if (!mergeMessages(L) && L !== "en") {
          loadLocaleScript("en").then(resolve, reject);
          return;
        }
        resolve(messages);
      };
      s.onerror = function () {
        if (L !== "en") loadLocaleScript("en").then(resolve, reject);
        else reject(new Error("coordination locale load failed"));
      };
      document.head.appendChild(s);
    });
  }

  function setLanguage(lang) {
    var L = normalizeLang(lang);
    currentLang = L;
    applyDocumentLang(L);
    return loadLocaleScript(L).then(function () {
      applyStaticDom();
      if (typeof window.rerenderCoordinationCenter === "function") {
        try {
          window.rerenderCoordinationCenter();
        } catch (e) {
          console.warn("rerenderCoordinationCenter", e);
        }
      }
      return L;
    });
  }

  function init() {
    var lang = readAdminLang();
    currentLang = lang;
    applyDocumentLang(lang);
    return loadLocaleScript(lang).then(function () {
      applyStaticDom();
      return lang;
    });
  }

  function uiLanguageHeader() {
    return currentLang;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("admin-language-changed", function (ev) {
      var lang =
        (ev && ev.detail && ev.detail.lang) ||
        readAdminLang();
      setLanguage(lang);
    });
    document.addEventListener("i18n:ready", function () {
      setLanguage(readAdminLang());
    });
  }

  window.CoordinationI18n = {
    t: t,
    ct: t,
    init: init,
    setLanguage: setLanguage,
    getLang: function () {
      return currentLang;
    },
    fmtTime: fmtTime,
    fmtNumber: fmtNumber,
    uiLanguageHeader: uiLanguageHeader,
    applyStaticDom: applyStaticDom,
    normalizeLang: normalizeLang,
  };
  window.ct = t;
})();
