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
 * Production API is on Railway; admin UI may still be on Render:
 *   <script>window.__CLINIFLOW_RAILWAY_BACKEND__="https://YOUR-APP.up.railway.app"</script> before this file
 *   or <meta name="cliniflow-api-base" content="https://YOUR-APP.up.railway.app" />
 *
 * Defaults:
 *   localhost / 127.0.0.1 → same origin as the page (e.g. :3000 when the app is served on port 3000)
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
    if (h === 'localhost' || h === '127.0.0.1') {
      if (typeof w.location !== 'undefined' && w.location.host) {
        return stripTrailingSlash(w.location.protocol + '//' + w.location.host);
      }
      return stripTrailingSlash('http://' + h + ':10000');
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

  try {
    console.log('🌐 API BASE:', cached || '(empty — use same-origin relative URLs)');
  } catch (_e) {
    /* ignore */
  }

  w.cliniflowApiBase = function () {
    return cached;
  };

  w.apiUrl = function (path) {
    var p = String(path || '');
    if (!p.startsWith('/')) p = '/' + p;
    return cached ? cached + p : p;
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
    var base = typeof w.cliniflowApiBase === 'function' ? w.cliniflowApiBase() : '';
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
    var base = typeof w.cliniflowApiBase === 'function' ? w.cliniflowApiBase() : '';
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
    var base = typeof w.cliniflowApiBase === 'function' ? w.cliniflowApiBase() : '';
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
