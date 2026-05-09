/**
 * Backend API origin for standalone admin (static site on Render, etc.).
 *
 * Patient AI (both required):
 *   - POST /api/chat/ai-upload — multipart field `file` + `language` (use cliniflowFetchAiUpload or cliniflowAppendAiLanguageToFormData)
 *   - POST /api/chat/ai-analyze — JSON body with `language` (use cliniflowFetchAiAnalyze)
 * Patient account language (DB): PATCH /api/patient/language — from UI call cliniflowOnPatientLanguageChange(lang), or cliniflowUpdatePatientLanguage + cliniflowSyncSavedPatientLanguage on load.
 * To test without PATCH/localStorage writes from cliniflowUpdatePatientLanguage:
 *   window.__CLINIFLOW_DISABLE_PATCH_LANGUAGE__ = true
 * Language for AI: localStorage "lang" → navigator.language 2 chars → "en" (2-letter: en, tr, ru, ka).
 * Test: localStorage.setItem("lang", "ru"); then reload and run upload + analyze.
 * Test: window.__CLINIFLOW_FORCE_AI_LANG__ = 'tr'
 *
 * Override (any host):
 *   <script>window.CLINIFLOW_API_BASE_URL="https://your-api.example.com"</script> before this file
 *   or <meta name="cliniflow-api-base" content="https://your-api.example.com" />
 *
 * Architectural contract (do not blur these layers):
 *   1. Raw / untrusted — window.cliniflowApiBase() — first-pass cache from host/meta/env; may be '' or non-http(s); never build fetch URLs from this alone.
 *   2. Operational / trusted — window.cliniflowAdminApiOrigin() — normalized absolute http(s) origin for static HTML fetches; never ''; falls back to DEFAULT_BACKEND_API.
 *   3. Validation — window.assertValidApiOrigin(origin) — shared check: returns stripped origin or '' if missing/invalid; warns when non-empty but not http(s): (silent mode for internal retries).
 *   4. Hard fallback — HTML/script may substitute the production Railway URL when this file never runs (missing global).
 *
 * Globals:
 *   window.cliniflowAdminApiOrigin() — non-empty absolute http(s) URL for admin / patient static pages (meta + DEFAULT_BACKEND_API fallback).
 *   window.assertValidApiOrigin(origin) — validate a candidate API origin (prefer before concatenating paths).
 *   window.API_BASE_URL, window.API_BASE — same as cliniflowAdminApiOrigin() at load time (prefer calling cliniflowAdminApiOrigin() if meta loads late).
 *   window.cliniflowApiBase() — raw cached resolve (may be '' on unknown hosts; prefer cliniflowAdminApiOrigin for fetches).
 *   window.getApiBase — alias of cliniflowApiBase
 *
 * Production API is on Railway; admin UI may still be on Render:
 *   <script>window.__CLINIFLOW_RAILWAY_BACKEND__="https://YOUR-APP.up.railway.app"</script> before this file
 *   or <meta name="cliniflow-api-base" content="https://YOUR-APP.up.railway.app" />
 *
 * Defaults:
 *   localhost / 127.0.0.1 / ::1 → DEFAULT_BACKEND_API (static HTML on any port has no /api; do not use location.host)
 *   cliniflow-admin.onrender.com → DEFAULT_BACKEND_API (Railway production API)
 *   cliniflow-backend-*.onrender.com → https://cliniflow-admin.onrender.com (static HTML on legacy Render backend → admin API on admin service)
 *   *.netlify.app → DEFAULT_BACKEND_API (admin UI on Netlify → API on Railway)
 */
(function () {
  'use strict';
  var w = typeof window !== 'undefined' ? window : {};

  /** Primary API (Railway). Legacy Render backend URL kept in comments only: cliniflow-backend-dg8a.onrender.com */
  var DEFAULT_BACKEND_API = 'https://cliniflow-backend-clean-production.up.railway.app';
  var DEFAULT_ADMIN_API_RENDER = 'https://cliniflow-admin.onrender.com';
  var RENDER_ADMIN_HOST = 'cliniflow-admin.onrender.com';

  function stripTrailingSlash(s) {
    return String(s || '').replace(/\/+$/, '');
  }

  /**
   * Shared validation for any candidate API origin (same semantics everywhere).
   * @param {*} origin
   * @param {boolean} [silent] — if true, no console.warn on invalid non-empty values (internal/cache probes).
   * @returns {string} stripped http(s) origin, or '' if missing or not absolute http(s)
   */
  function assertValidApiOrigin(origin, silent) {
    var raw = String(origin == null ? '' : origin).trim();
    if (!raw) return '';
    var s = stripTrailingSlash(raw);
    if (/^https?:\/\//i.test(s)) return s;
    if (!silent) {
      try {
        console.warn('[api-base] assertValidApiOrigin: expected http(s) absolute URL, got:', origin);
      } catch (_e) {}
    }
    return '';
  }

  w.assertValidApiOrigin = function (origin) {
    return assertValidApiOrigin(origin, false);
  };

  /** Admin UI is served from backend static; Node routes like /api/admin/messages/* live on cliniflow-admin service. */
  function isBackendStaticUiHost(hostname) {
    var h = String(hostname || '');
    if (h === 'cliniflow-backend-dg8a.onrender.com') return true;
    return /^cliniflow-backend[a-z0-9-]*\.onrender\.com$/i.test(h);
  }

  function isNetlifyUiHost(hostname) {
    return /\.netlify\.app$/i.test(String(hostname || ''));
  }

  function resolveOnce() {
    if (typeof w.CLINIFLOW_API_BASE_URL === 'string' && w.CLINIFLOW_API_BASE_URL.trim()) {
      return stripTrailingSlash(w.CLINIFLOW_API_BASE_URL);
    }
    var meta = typeof document !== 'undefined' ? document.querySelector('meta[name="cliniflow-api-base"]') : null;
    var fromMeta = meta && meta.getAttribute('content');
    if (fromMeta && String(fromMeta).trim()) {
      return stripTrailingSlash(fromMeta);
    }
    /** Set once when API is on Railway (public URL) and admin is on Render or another host. */
    if (typeof w.__CLINIFLOW_RAILWAY_BACKEND__ === 'string' && w.__CLINIFLOW_RAILWAY_BACKEND__.trim()) {
      return stripTrailingSlash(w.__CLINIFLOW_RAILWAY_BACKEND__);
    }
    var h = typeof w.location !== 'undefined' ? w.location.hostname : '';
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
      return stripTrailingSlash(DEFAULT_BACKEND_API);
    }
    if (isBackendStaticUiHost(h)) {
      return stripTrailingSlash(DEFAULT_ADMIN_API_RENDER);
    }
    if (h === RENDER_ADMIN_HOST) {
      return stripTrailingSlash(DEFAULT_BACKEND_API);
    }
    if (isNetlifyUiHost(h)) {
      return stripTrailingSlash(DEFAULT_BACKEND_API);
    }
    return '';
  }

  var cached = resolveOnce();

  /** Static admin from python/http-server on loopback: never treat the static origin as the API (returns HTML, not JSON). */
  (function coerceLoopbackStaticAdmin() {
    var pageHost = typeof w.location !== 'undefined' ? String(w.location.hostname || '') : '';
    if (pageHost !== 'localhost' && pageHost !== '127.0.0.1' && pageHost !== '::1') return;
    if (!cached) return;
    try {
      var u = new URL(cached);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        cached = stripTrailingSlash(DEFAULT_BACKEND_API);
      }
    } catch (_e) {
      /* ignore */
    }
  })();

  try {
    console.log('🌐 API BASE (raw cache):', cached || '(empty)');
  } catch (_e) {
    /* ignore */
  }

  w.cliniflowApiBase = function () {
    return cached;
  };

  var _adminApiFallbackWarned = false;

  /**
   * Use for all admin/register/login/patient static HTML fetches.
   * Never returns '' — falls back to meta cliniflow-api-base then DEFAULT_BACKEND_API.
   */
  function cliniflowAdminApiOriginImpl() {
    var b = assertValidApiOrigin(cached, true);
    if (b) return b;
    try {
      var meta = typeof document !== 'undefined' ? document.querySelector('meta[name="cliniflow-api-base"]') : null;
      var fm = meta && meta.getAttribute('content');
      if (fm && String(fm).trim()) {
        var m = assertValidApiOrigin(fm, true);
        if (m) return m;
      }
    } catch (_e) {}
    if (!_adminApiFallbackWarned) {
      _adminApiFallbackWarned = true;
      try {
        console.warn('[api-base] cliniflowAdminApiOrigin: invalid/empty cache — using DEFAULT_BACKEND_API');
      } catch (_e2) {}
    }
    return stripTrailingSlash(DEFAULT_BACKEND_API);
  }

  w.cliniflowAdminApiOrigin = cliniflowAdminApiOriginImpl;

  w.getApiBase = w.cliniflowApiBase;
  w.API_BASE_URL = cliniflowAdminApiOriginImpl();
  w.API_BASE = w.API_BASE_URL;

  try {
    console.log('🌐 API BASE (admin resolve):', w.API_BASE_URL);
  } catch (_e) {
    /* ignore */
  }

  w.apiUrl = function (path) {
    var p = String(path || '');
    if (!p.startsWith('/')) p = '/' + p;
    var base = cliniflowAdminApiOriginImpl();
    return base ? base + p : p;
  };

  /** Same origin as DEFAULT_ADMIN_API_RENDER — use in HTML fallbacks if this script is cached old. */
  w.CLINIFLOW_ADMIN_API_ORIGIN = DEFAULT_ADMIN_API_RENDER;

  /**
   * Same as: localStorage.getItem("lang") || navigator.language?.slice(0, 2) || "en" (2-letter, lowercased).
   */
  w.cliniflowGetUserLanguage = function () {
    try {
      var ls = localStorage.getItem("lang");
      if (ls != null && String(ls).trim() !== "") {
        return String(ls).trim().slice(0, 2).toLowerCase();
      }
    } catch (e) {}
    var nav =
      typeof navigator !== "undefined" && navigator.language
        ? String(navigator.language).slice(0, 2)
        : "";
    if (nav) return nav.toLowerCase();
    return "en";
  };

  w.cliniflowLogSendingLanguage = function (userLanguage) {
    console.log('🌍 Sending language:', userLanguage);
  };

  w.cliniflowLogUploadLanguage = function (userLanguage) {
    console.log('🌍 Upload language:', userLanguage);
  };

  w.cliniflowLogAnalyzeLanguage = function (userLanguage) {
    console.log('🌍 Analyze language:', userLanguage);
  };

  /** Resolves language for AI: __CLINIFLOW_FORCE_AI_LANG__ wins, else cliniflowGetUserLanguage() (localStorage → navigator → "en"). */
  w.cliniflowResolveAiLanguage = function () {
    var forced =
      typeof w.__CLINIFLOW_FORCE_AI_LANG__ === "string" && w.__CLINIFLOW_FORCE_AI_LANG__.trim();
    if (forced) {
      return String(forced).trim().slice(0, 2).toLowerCase();
    }
    return w.cliniflowGetUserLanguage();
  };

  /**
   * Append `language` to an existing FormData before POST /api/chat/ai-upload (React Native: fd.append('language', ...)).
   * @param {FormData} fd
   * @returns {FormData}
   */
  w.cliniflowAppendAiLanguageToFormData = function (fd) {
    if (!fd || typeof fd.append !== "function") return fd;
    var userLanguage = w.cliniflowResolveAiLanguage();
    console.log("🌍 FRONTEND LANG:", userLanguage);
    w.cliniflowLogUploadLanguage(userLanguage);
    fd.append("language", userLanguage);
    return fd;
  };

  /**
   * POST /api/chat/ai-upload — multipart: field "file" (binary) + "language" (string).
   * Do not use JSON for the file; backend expects multipart (multer), not body: JSON.stringify({ file, language }).
   * @param {string} token - patient JWT
   * @param {Blob|File} file
   * @param {string} [fileName] - default photo.jpg
   * @returns {Promise<Response>}
   */
  w.cliniflowFetchAiUpload = function (token, file, fileName) {
    var userLanguage = w.cliniflowResolveAiLanguage();
    console.log("🌍 FRONTEND LANG:", userLanguage);
    w.cliniflowLogUploadLanguage(userLanguage);
    var fd = new FormData();
    fd.append("file", file, fileName || "photo.jpg");
    fd.append("language", userLanguage);
    var base = typeof w.cliniflowAdminApiOrigin === 'function' ? w.cliniflowAdminApiOrigin() : '';
    var path = '/api/chat/ai-upload';
    var url = base ? String(base).replace(/\/+$/, '') + path : path;
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: token ? 'Bearer ' + String(token) : '',
      },
      body: fd,
    });
  };

  /**
   * POST /api/chat/ai-analyze with required `language` (and Bearer token). Use from WebView or PWA.
   * Quick test: window.__CLINIFLOW_FORCE_AI_LANG__ = 'tr' then call this.
   * @param {string} token - patient JWT
   * @param {object} body - must include imageUrl, patientId; optional photoType, userLocation, etc.
   * @returns {Promise<Response>}
   */
  w.cliniflowFetchAiAnalyze = function (token, body) {
    var b = body && typeof body === "object" ? Object.assign({}, body) : {};
    var userLanguage = w.cliniflowResolveAiLanguage();
    console.log("🌍 FRONTEND LANG:", userLanguage);
    w.cliniflowLogAnalyzeLanguage(userLanguage);
    b.language = userLanguage;
    var base = typeof w.cliniflowAdminApiOrigin === 'function' ? w.cliniflowAdminApiOrigin() : '';
    var path = '/api/chat/ai-analyze';
    var url = base ? String(base).replace(/\/+$/, '') + path : path;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? 'Bearer ' + String(token) : '',
      },
      body: JSON.stringify(b),
    });
  };

  w.cliniflowGetPatientToken = function () {
    try {
      return localStorage.getItem('patient_token') || '';
    } catch (e) {
      return '';
    }
  };

  /**
   * PATCH /api/patient/language — persist to DB; also localStorage "lang".
   * @param {string} language — en | tr | ru | ka
   * @param {string} [tokenOverride] — else patient_token from localStorage
   */
  w.cliniflowUpdatePatientLanguage = async function (language, tokenOverride) {
    if (w.__CLINIFLOW_DISABLE_PATCH_LANGUAGE__ === true) {
      console.warn('🌍 cliniflowUpdatePatientLanguage skipped (__CLINIFLOW_DISABLE_PATCH_LANGUAGE__ = true — test)');
      return { ok: true, skipped: true, disabledTest: true };
    }
    var tok =
      tokenOverride != null && String(tokenOverride) !== '' ? String(tokenOverride) : w.cliniflowGetPatientToken();
    var lang = String(language || '')
      .trim()
      .slice(0, 2)
      .toLowerCase();
    if (!lang) return { ok: false, error: 'empty_lang' };
    console.log('🌍 SETTING LANGUAGE:', lang);
    try {
      localStorage.setItem('lang', lang);
    } catch (e) {}
    if (!tok) {
      console.warn('🌍 No patient token — localStorage only');
      return { ok: false, skipped: true, local: true };
    }
    var base = typeof w.cliniflowAdminApiOrigin === 'function' ? w.cliniflowAdminApiOrigin() : '';
    var path = '/api/patient/language';
    var url = base ? String(base).replace(/\/+$/, '') + path : path;
    var res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + String(tok),
      },
      body: JSON.stringify({ language: lang }),
    });
    var j = await res.json().catch(function () { return {}; });
    console.log('🌍 LANGUAGE RESPONSE:', j);
    if (!res.ok || j.ok !== true) {
      console.warn('🌍 Patient language PATCH failed:', res.status, j);
      return j || { ok: false };
    }
    if (j.language && String(j.language) !== String(lang)) {
      console.warn('🌍 Language mismatch: sent', lang, 'got', j.language);
    }
    return j;
  };

  /**
   * On app load: if localStorage "lang" + patient_token, sync to backend once.
   */
  w.cliniflowSyncSavedPatientLanguage = async function () {
    var saved;
    var tok = w.cliniflowGetPatientToken();
    try {
      saved = localStorage.getItem('lang');
    } catch (e) {
      saved = null;
    }
    console.log('🌍 TOKEN:', tok || '(empty)');
    console.log('🌍 LANG TO SEND:', saved);
    if (!saved) return { ok: true, skipped: true };
    if (!tok) {
      console.warn('🌍 Sync skipped: no token yet');
      return { ok: true, skipped: true, reason: 'no_token' };
    }
    return w.cliniflowUpdatePatientLanguage(saved);
  };

  /**
   * Call when the patient selects a language (TR / EN / RU / KA). Updates `lang` in localStorage
   * and PATCHes `/api/patient/language` when a bearer token exists.
   * @returns {Promise<object>|undefined}
   */
  w.cliniflowOnPatientLanguageChange = function (lang) {
    var l = String(lang || '')
      .trim()
      .slice(0, 2)
      .toLowerCase();
    if (!l) return undefined;
    console.log('🌍 UI LANGUAGE SELECTED:', l);
    try {
      localStorage.setItem('lang', l);
    } catch (e) {}
    var token = w.cliniflowGetPatientToken();
    if (!token) {
      console.warn('❌ No token, cannot update backend language');
      return Promise.resolve({ ok: false, skipped: true, reason: 'no_token' });
    }
    console.log('🌍 PATCH CALLED WITH:', l);
    return w.cliniflowUpdatePatientLanguage(l);
  };

  w.updateLanguage = w.cliniflowUpdatePatientLanguage;
})();
