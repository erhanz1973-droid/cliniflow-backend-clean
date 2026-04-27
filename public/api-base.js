/**
 * Backend API origin for standalone admin (static site on Render, etc.).
 *
 * Patient AI (both required):
 *   - POST /api/chat/ai-upload — multipart field `file` + `language` (use cliniflowFetchAiUpload or cliniflowAppendAiLanguageToFormData)
 *   - POST /api/chat/ai-analyze — JSON body with `language` (use cliniflowFetchAiAnalyze)
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
 *   localhost / 127.0.0.1 → http://<host>:10000
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
   * Patient / chat UI: language for POST /api/chat/ai-analyze (JSON field `language`, required for translation).
   * Matches: localStorage "lang" → navigator → "en"
   */
  w.cliniflowGetUserLanguage = function () {
    try {
      var s = localStorage.getItem('lang');
      if (s && String(s).trim()) return String(s).trim().slice(0, 2).toLowerCase();
    } catch (e) {}
    var nav = typeof navigator !== 'undefined' && navigator.language ? String(navigator.language) : '';
    if (nav) return nav.slice(0, 2).toLowerCase();
    return 'en';
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

  /** Resolves language for AI calls (localStorage lang → navigator → en), or __CLINIFLOW_FORCE_AI_LANG__. */
  w.cliniflowResolveAiLanguage = function () {
    var forced =
      typeof w.__CLINIFLOW_FORCE_AI_LANG__ === 'string' && w.__CLINIFLOW_FORCE_AI_LANG__.trim();
    return (forced || w.cliniflowGetUserLanguage()).toString().slice(0, 2).toLowerCase();
  };

  /**
   * Append `language` to an existing FormData before POST /api/chat/ai-upload (React Native: fd.append('language', ...)).
   * @param {FormData} fd
   * @returns {FormData}
   */
  w.cliniflowAppendAiLanguageToFormData = function (fd) {
    if (!fd || typeof fd.append !== 'function') return fd;
    var userLanguage = w.cliniflowResolveAiLanguage();
    w.cliniflowLogUploadLanguage(userLanguage);
    fd.append('language', userLanguage);
    return fd;
  };

  /**
   * POST /api/chat/ai-upload — multipart: `file` + `language`.
   * @param {string} token - patient JWT
   * @param {Blob|File} file
   * @param {string} [fileName] - default photo.jpg
   * @returns {Promise<Response>}
   */
  w.cliniflowFetchAiUpload = function (token, file, fileName) {
    var userLanguage = w.cliniflowResolveAiLanguage();
    w.cliniflowLogUploadLanguage(userLanguage);
    var fd = new FormData();
    fd.append('file', file, fileName || 'photo.jpg');
    fd.append('language', userLanguage);
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
    var b = body && typeof body === 'object' ? Object.assign({}, body) : {};
    var userLanguage = w.cliniflowResolveAiLanguage();
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
})();
