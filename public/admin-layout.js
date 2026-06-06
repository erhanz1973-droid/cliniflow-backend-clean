/**
 * admin-layout.js — Clinifly Admin Shared Layout
 * Injects sidebar + topbar, handles auth, active nav, clinic name.
 * All labels are i18n-aware and update on language change.
 */
(function () {

  /** When admin HTML is on backend static but API lives on cliniflow-admin service (must match login + JWT_SECRET there). */
  var RENDER_ADMIN_API_FALLBACK =
    (typeof window !== 'undefined' && window.CLINIFLOW_ADMIN_API_ORIGIN) ||
    'https://cliniflow-admin.onrender.com';
  function isBackendUiHost() {
    var h = typeof location !== 'undefined' ? String(location.hostname || '') : '';
    return /^cliniflow-backend[a-z0-9-]*\.onrender\.com$/i.test(h);
  }
  /** Always hit the same API origin as admin-login (avoids 401 when token was signed on admin service). */
  function getStoredAdminToken() {
    try {
      return localStorage.getItem('adminToken') || localStorage.getItem('admin_token') || '';
    } catch (_) {
      return '';
    }
  }

  function adminFetchUrl(path) {
    var p = String(path || '');
    if (!p.startsWith('/')) p = '/' + p;
    var u;
    if (typeof cliniflowAdminApiOrigin === 'function') {
      var adminBase = cliniflowAdminApiOrigin();
      if (adminBase) return String(adminBase).replace(/\/+$/, '') + p;
    }
    if (typeof apiUrl === 'function') {
      u = apiUrl(p);
      if (String(u).indexOf('http') === 0) return u;
      if (isBackendUiHost() && (u === p || (u && u.charAt(0) === '/'))) {
        return String(RENDER_ADMIN_API_FALLBACK).replace(/\/+$/, '') + p;
      }
      return u;
    }
    if (typeof cliniflowApiBase === 'function') {
      var b = cliniflowApiBase();
      if (b) return String(b).replace(/\/+$/, '') + p;
    }
    if (isBackendUiHost()) return String(RENDER_ADMIN_API_FALLBACK).replace(/\/+$/, '') + p;
    return p;
  }

  function loadOpsStrip() {
    if (window.__CLINIFLOW_OPS_STRIP_LOADED__) return;
    var p = window.location.pathname || '';
    if (p.includes('login') || p.includes('register')) return;
    window.__CLINIFLOW_OPS_STRIP_LOADED__ = true;
    var s = document.createElement('script');
    s.src = '/admin-ops-strip.js?v=202605183';
    s.defer = true;
    document.body.appendChild(s);
  }

  /* ── Navigation items (key maps to dashboard.nav.{key}) ────── */
  const NAV = [
    { href: '/admin.html', icon: iconGrid(),     key: 'dashboard' },
    {
      href: '/admin-patients.html',
      icon: iconUsers(),
      key: 'patients',
      badge: 'sbPatients',
      children: [
        { href: '/admin-invite-patients.html', icon: iconQr(), key: 'invitePatients' },
      ],
    },
    { href: '/admin-treatment.html', icon: iconTooth(),    key: 'treatment' },
    { href: '/admin-schedule.html',  icon: iconCal(),      key: 'schedule' },
  ];
  const NAV2_BASE = [
    { href: '/admin-doctor-applications-v2.html', icon: iconDoctor(), key: 'doctors', badge: 'sbDoctors' },
    { href: '/admin-leads.html?queue=needs_assignment', icon: iconLeads(), key: 'leads',
      children: [
        { href: '/admin-leads.html?queue=needs_assignment', icon: iconLeads(), key: 'leadsNeedsAssignment' },
        { href: '/admin-leads.html?queue=recent_routed', icon: iconLeads(), key: 'leadsRecentlyRouted' },
        { href: '/admin-leads.html?queue=assigned', icon: iconLeads(), key: 'leadsAssigned' },
      ],
    },
    { href: '/admin-ai-leads.html', icon: iconAi(),       key: 'aiLeads' },
    { href: '/admin-chat.html',     icon: iconChat(),     key: 'chat',    badge: 'sbChat' },
    { href: '/admin-files.html',    icon: iconFiles(),    key: 'files' },
    { href: '/admin-referrals.html', icon: iconReferrals(), key: 'referrals', badge: 'sbReferrals' },
    { href: '/admin-marketplace-profile.html', icon: iconGlobe(), key: 'marketplaceProfile' },
    { href: '/admin-help-center.html', icon: iconHelp(), key: 'helpCenter' },
    { href: '/admin-settings.html', icon: iconSettings(), key: 'settings' },
  ];
  const NAV2_AI_LEARNING = {
    href: '/admin-learning-candidates.html',
    icon: iconAi(),
    key: 'learningCandidates',
  };

  function isAiLearningNavEnabled() {
    if (window.__CLINIFLOW_AI_LEARNING_ENABLED__ === true) return true;
    var flags = window.CLINIFLOW_ADMIN_FEATURES;
    return !!(flags && flags.aiLearningEnabled === true);
  }

  function getNav2Items() {
    if (!isAiLearningNavEnabled()) return NAV2_BASE.slice();
    var items = NAV2_BASE.slice();
    var aiLeadsIdx = items.findIndex(function (i) { return i.key === 'aiLeads'; });
    var insertAt = aiLeadsIdx >= 0 ? aiLeadsIdx + 1 : 3;
    items.splice(insertAt, 0, NAV2_AI_LEARNING);
    return items;
  }

  /* ── i18n helper ─────────────────────────────────────────────── */
  function tn(key) {
    if (window.i18n && typeof window.i18n.t === 'function') return window.i18n.t(key);
    // Fallbacks
    const fallbacks = {
      'dashboard.nav.dashboard': 'Dashboard', 'dashboard.nav.patients': 'Patients',
      'dashboard.nav.invitePatients': 'Invite Patients',
      'dashboard.nav.treatment': 'Treatments', 'dashboard.nav.schedule': 'Calendar',
      'dashboard.nav.doctors': 'Doctors', 'dashboard.nav.leads': 'Lead inbox',
      'dashboard.nav.leadsNeedsAssignment': 'Needs assignment',
      'dashboard.nav.leadsRecentlyRouted': 'Recently routed',
      'dashboard.nav.leadsAssigned': 'Assigned',
      'dashboard.nav.aiLeads': 'Coordination Center',
      'dashboard.nav.learningCandidates': 'AI Learning',
      'dashboard.nav.chat': 'Messages',
      'dashboard.nav.files': 'Files', 'dashboard.nav.referrals': 'Referrals', 'dashboard.nav.marketplaceProfile': 'Directory Profile', 'dashboard.nav.helpCenter': 'Help Center', 'dashboard.nav.settings': 'Settings',
      'dashboard.sidebar.mainMenu': 'Main Menu', 'dashboard.sidebar.management': 'Management',
      'dashboard.sidebar.logout': 'Logout', 'dashboard.sidebar.clinic': 'Clinic',
      'dashboard.sidebar.openMenu': 'Open menu', 'dashboard.sidebar.closeMenu': 'Close menu',
    };
    return fallbacks[key] || key.split('.').pop();
  }

  /* ── SVG Icons ─────────────────────────────────────────────── */
  function svg(d, extra) {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra||''}>${d}</svg>`;
  }
  function iconGrid()     { return svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'); }
  function iconUsers()    { return svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'); }
  function iconTooth()    { return svg('<path d="M12 2C9.2 2 7 4.2 7 7c0 1.5.6 2.8 1.4 3.8-.2 1.2-.4 2.5-.4 3.2 0 3.3 1.3 5 2.5 5s2-1.2 2-2.4c0-.8-.5-1.8-.5-1.8s-.5 1-.5 1.8c0 .9-.4 1.4-1 1.4S9 16.8 9 14c0-.8.2-2 .4-3.2C10 11.7 10.7 13 12 13s2.1-.3 2.6-2.2c.2 1.1.4 2.2.4 3.2 0 2.8-.8 5-2 5s-1-.5-1-1.4c0-.8-.5-1.8-.5-1.8s-.5 1-.5 1.8c0 1.2 1 2.4 2 2.4s2.5-1.7 2.5-5c0-.8-.2-2-.4-3.2C15.4 9.8 16 8.5 16 7c0-2.8-1.8-5-4-5z"/>'); }
  function iconCal()      { return svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'); }
  function iconDoctor()   { return svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'); }
  function iconChat()     { return svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'); }
  /** Leads / inbox / assignment queue */
  function iconLeads() {
    return svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>');
  }
  function iconAi() {
    return svg('<path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1-3-3v-1a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>');
  }
  function iconHelp() {
    return svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
  }
  function iconSettings() { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'); }
  function iconGlobe() { return svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'); }
  function iconFiles()    { return svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'); }
  /** Referrals / invite network */
  function iconReferrals() {
    return svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>');
  }
  function iconQr() {
    return svg(
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>',
    );
  }
  function iconLogout()   { return svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'); }
  function iconMenu()     { return svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'); }

  function hrefMatchesPage(currentHref, href) {
    if (!href) return false;
    const pathOnly = String(href).split('?')[0];
    const file = pathOnly.split('/').pop() || pathOnly;
    if (currentHref.indexOf(file) === -1) return false;
    const qIdx = String(href).indexOf('?');
    if (qIdx === -1) {
      if (file === 'admin-leads.html') {
        try {
          const have = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
          const q = have.get('queue');
          return !q || q === 'needs_assignment';
        } catch (_) {
          return true;
        }
      }
      return true;
    }
    try {
      const want = new URLSearchParams(String(href).slice(qIdx + 1));
      const have = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
      for (const [k, v] of want.entries()) {
        if (have.get(k) !== v) return false;
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  function navItemActive(currentHref, item) {
    if (hrefMatchesPage(currentHref, item.href)) return true;
    if (item.children && item.children.some(function (c) { return hrefMatchesPage(currentHref, c.href); })) {
      return true;
    }
    return false;
  }

  /* ── Build nav item HTML ──────────────────────────────────── */
  function navItem(item, active, opts) {
    opts = opts || {};
    const cls = active ? 'al-nav-item active' : 'al-nav-item';
    const sub = opts.sub ? ' al-nav-sub' : '';
    const badge = item.badge && !opts.sub ? `<span class="al-nav-badge" id="${item.badge}"></span>` : '';
    return `<a href="${item.href}" class="${cls}${sub}" data-nav-key="${item.key}">
      <span class="al-nav-icon">${item.icon}</span>
      <span class="al-nav-label">${tn('dashboard.nav.' + item.key)}</span>
      ${badge}
    </a>`;
  }

  function buildNavGroup(currentHref, items) {
    return items
      .map(function (i) {
        var html = navItem(i, navItemActive(currentHref, i));
        if (i.children && i.children.length) {
          html += i.children
            .map(function (c) {
              return navItem(c, hrefMatchesPage(currentHref, c.href), { sub: true });
            })
            .join('');
        }
        return html;
      })
      .join('');
  }

  /* ── Build full sidebar HTML ─────────────────────────────── */
  function buildSidebar(currentHref) {
    const nav1 = buildNavGroup(currentHref, NAV);
    const nav2 = buildNavGroup(currentHref, getNav2Items());
    return `
      <a href="/admin.html" class="al-logo" style="text-decoration:none;">
        <div class="al-logo-icon">🦷</div>
        <div>
          <div class="al-logo-brand">Clinifly</div>
          <div class="al-logo-clinic" id="alClinicName">${tn('dashboard.sidebar.clinic')}</div>
        </div>
      </a>
      <nav class="al-nav">
        <div class="al-nav-section" id="alNavSection1">${tn('dashboard.sidebar.mainMenu')}</div>
        ${nav1}
        <div class="al-nav-section" id="alNavSection2" style="margin-top:14px;">${tn('dashboard.sidebar.management')}</div>
        ${nav2}
      </nav>
      <div class="al-sidebar-footer">
        <button class="al-logout-btn" id="alLogoutBtn" onclick="window.__alLogout()">
          <span class="al-nav-icon">${iconLogout()}</span>
          <span id="alLogoutLabel">${tn('dashboard.sidebar.logout')}</span>
        </button>
      </div>
    `;
  }

  /* ── Update sidebar labels (called on language change) ───── */
  function updateSidebarLabels() {
    // Nav item labels
    document.querySelectorAll('.al-nav-item[data-nav-key]').forEach(el => {
      const key = el.getAttribute('data-nav-key');
      const labelEl = el.querySelector('.al-nav-label');
      if (labelEl) labelEl.textContent = tn('dashboard.nav.' + key);
    });
    // Section headers
    const s1 = document.getElementById('alNavSection1');
    if (s1) s1.textContent = tn('dashboard.sidebar.mainMenu');
    const s2 = document.getElementById('alNavSection2');
    if (s2) s2.textContent = tn('dashboard.sidebar.management');
    // Logout
    const logoutLabel = document.getElementById('alLogoutLabel');
    if (logoutLabel) logoutLabel.textContent = tn('dashboard.sidebar.logout');
    const menuBtn = document.getElementById('alMenuBtn');
    if (menuBtn) {
      const open = document.body.classList.contains('al-nav-open');
      menuBtn.setAttribute('aria-label', tn(open ? 'dashboard.sidebar.closeMenu' : 'dashboard.sidebar.openMenu'));
    }
  }

  /* ── Build topbar HTML ───────────────────────────────────── */
  function buildTopbar(pageTitle) {
    return `
      <div class="al-topbar-left">
        <button type="button" class="al-menu-btn" id="alMenuBtn" aria-label="${tn('dashboard.sidebar.openMenu')}" aria-expanded="false" aria-controls="alSidebar">
          ${iconMenu()}
        </button>
        <span class="al-page-title" id="alPageTitle">${pageTitle}</span>
      </div>
      <div class="al-topbar-right">
        <div class="al-lang" id="alLang">
          <span id="lang-tr" onclick="if(window.onLanguageChange)window.onLanguageChange('tr')">TR</span>
          <span id="lang-en" onclick="if(window.onLanguageChange)window.onLanguageChange('en')">EN</span>
          <span id="lang-ru" onclick="if(window.onLanguageChange)window.onLanguageChange('ru')">RU</span>
          <span id="lang-ka" onclick="if(window.onLanguageChange)window.onLanguageChange('ka')">KA</span>
        </div>
      </div>
    `;
  }

  /* ── Inject layout ───────────────────────────────────────── */
  function inject() {
    // Auth guard (must match admin.html: adminToken OR admin_token)
    const token = getStoredAdminToken();
    const p = window.location.pathname || '';
    if (!token && !p.includes('login') && !p.includes('register')) {
      window.location.href = '/admin-login.html';
      return;
    }

    // Already injected?
    if (document.getElementById('alSidebar')) return;

    const href = window.location.pathname;
    const pageTitle = document.title.replace(/ ?[-–|] ?Clinifly.*/i, '').replace(/🦷\s*/,'').trim() || 'Admin';

    // Create sidebar
    const sidebar = document.createElement('aside');
    sidebar.className = 'al-sidebar';
    sidebar.id = 'alSidebar';
    sidebar.innerHTML = buildSidebar(href);

    // Create topbar
    const topbar = document.createElement('header');
    topbar.className = 'al-topbar';
    topbar.id = 'alTopbar';
    topbar.innerHTML = buildTopbar(pageTitle);

    // Create main wrapper
    const main = document.createElement('div');
    main.className = 'al-main';
    main.id = 'alMain';

    // Move existing body children into main
    while (document.body.firstChild) {
      main.appendChild(document.body.firstChild);
    }

    // Prepend topbar inside main
    main.insertBefore(topbar, main.firstChild);

    // Mobile drawer backdrop
    const overlay = document.createElement('div');
    overlay.className = 'al-nav-overlay';
    overlay.id = 'alNavOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('tabindex', '-1');

    // Add overlay, sidebar + main to body
    document.body.appendChild(overlay);
    document.body.appendChild(sidebar);
    document.body.appendChild(main);
    document.body.classList.add('al-ready');

    setupMobileNav();

    // Load clinic name
    loadClinicName();

    // Start unread badge polling
    startBadgePolling();

    loadOpsStrip();

    // Hook into i18n updates to refresh sidebar labels
    const prevOnI18nUpdated = window.onI18nUpdated;
    window.onI18nUpdated = function () {
      updateSidebarLabels();
      if (typeof prevOnI18nUpdated === 'function') prevOnI18nUpdated();
    };
    document.addEventListener('i18n:ready', function () {
      try { updateSidebarLabels(); } catch (e) { /* ignore */ }
    });
    document.addEventListener('admin-language-changed', function () {
      try { updateSidebarLabels(); } catch (e) { /* ignore */ }
    });
  }

  /* ── Mobile drawer navigation ────────────────────────────── */
  var alMobileNavMq = null;

  function setupMobileNav() {
    const btn = document.getElementById('alMenuBtn');
    const overlay = document.getElementById('alNavOverlay');
    const sidebar = document.getElementById('alSidebar');
    if (!btn || !overlay || !sidebar) return;

    if (!alMobileNavMq) {
      alMobileNavMq = window.matchMedia('(max-width: 600px)');
    }

    function isMobile() {
      return alMobileNavMq.matches;
    }

    function setNavOpen(open) {
      document.body.classList.toggle('al-nav-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', tn(open ? 'dashboard.sidebar.closeMenu' : 'dashboard.sidebar.openMenu'));
      overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    function closeNav() {
      setNavOpen(false);
    }

    function toggleNav() {
      if (!isMobile()) return;
      setNavOpen(!document.body.classList.contains('al-nav-open'));
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleNav();
    });

    overlay.addEventListener('click', closeNav);

    sidebar.querySelectorAll('.al-nav-item, .al-nav-sub, .al-logo').forEach(function (el) {
      el.addEventListener('click', function () {
        if (isMobile()) closeNav();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('al-nav-open')) closeNav();
    });

    function onMqChange() {
      if (!isMobile()) closeNav();
    }

    if (typeof alMobileNavMq.addEventListener === 'function') {
      alMobileNavMq.addEventListener('change', onMqChange);
    } else if (typeof alMobileNavMq.addListener === 'function') {
      alMobileNavMq.addListener(onMqChange);
    }

    window.__alCloseNav = closeNav;
    window.__alToggleNav = toggleNav;
  }

  /* ── Load clinic name ────────────────────────────────────── */
  async function loadClinicName() {
    try {
      const token = getStoredAdminToken();
      if (!token) return;
      const res = await fetch(adminFetchUrl('/api/admin/clinic'), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const d = await res.json();
        const name = d.branding?.clinicName || d.name || tn('dashboard.sidebar.clinic');
        const el = document.getElementById('alClinicName');
        if (el) el.textContent = name;
      } else if (res.status === 401 && typeof window.handle401 === 'function') {
        window.handle401(401);
      }
    } catch (_) {}
  }

  /* ── Logout ──────────────────────────────────────────────── */
  window.__alLogout = function () {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('selected_patient_id');
    window.location.href = '/admin-login.html';
  };

  /* ── Global 401 handler — call after any failing fetch ───── */
  window.handle401 = function (status) {
    if (status === 401) {
      var p = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
      if (p.includes('admin-login.html')) return false;
      console.warn('[AUTH] 401 — token geçersiz veya süresi dolmuş, login sayfasına yönlendiriliyor.');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('admin_token');
      window.location.href = '/admin-login.html?reason=session_expired';
      return true;
    }
    return false;
  };

  /* ── Unread chat badge polling ───────────────────────────── */
  function updateChatBadge(count) {
    const el = document.getElementById('sbChat');
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  }

  /** Bekleyen doktor başvuruları (Doktorlar menüsü — #sbDoctors) */
  function updateDoctorsBadge(count) {
    const el = document.getElementById('sbDoctors');
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  }

  function updateReferralsBadge(count) {
    const el = document.getElementById('sbReferrals');
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  }

  async function pollUnreadCount() {
    try {
      const token = getStoredAdminToken();
      if (!token) return;
      const res = await fetch(adminFetchUrl('/api/admin/messages/unread-counts?totalOnly=1'), {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (!res.ok) {
        if (res.status === 401 && typeof window.handle401 === 'function') window.handle401(401);
        return;
      }
      const data = await res.json();
      if (!data.ok) return;
      const total = Number(data.total || 0);
      updateChatBadge(total);
    } catch (_) {}
  }

  async function pollPendingReferrals() {
    try {
      const token = getStoredAdminToken();
      if (!token) return;
      const res = await fetch(adminFetchUrl('/api/admin/referrals?status=PENDING'), {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (!res.ok) {
        if (res.status === 401 && typeof window.handle401 === 'function') window.handle401(401);
        return;
      }
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.referrals) ? data.referrals : []);
      updateReferralsBadge(items.length);
    } catch (_) {}
  }

  async function pollPendingDoctorApplications() {
    try {
      const token = getStoredAdminToken();
      if (!token) return;
      // admin-doctor-applications-v2.html ile aynı kaynak (clinic_code); /api/admin/doctors clinic_id kullanır, sayım sapabilir.
      const res = await fetch(adminFetchUrl('/admin/doctor-list'), {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (!res.ok) {
        if (res.status === 401 && typeof window.handle401 === 'function') window.handle401(401);
        return;
      }
      const data = await res.json();
      if (!data.ok) return;
      const doctors = Array.isArray(data.doctors) ? data.doctors : [];
      const pending = doctors.filter(function (d) {
        return String(d.status || '').toUpperCase() === 'PENDING';
      }).length;
      updateDoctorsBadge(pending);
    } catch (_) {}
  }

  function startBadgePolling() {
    if (window.__ADMIN_LAYOUT_BADGE_POLLING_STARTED__) return;
    window.__ADMIN_LAYOUT_BADGE_POLLING_STARTED__ = true;
    window.__ADMIN_LAYOUT_BADGES_ACTIVE = true;
    pollUnreadCount();
    pollPendingDoctorApplications();
    pollPendingReferrals();
    setInterval(function () {
      if (typeof document !== 'undefined' && document.hidden) return;
      pollUnreadCount();
      pollPendingDoctorApplications();
      pollPendingReferrals();
    }, 45000);
  }

  function loadAdminFeatureFlags(done) {
    if (window.CLINIFLOW_ADMIN_FEATURES) {
      done();
      return;
    }
    var s = document.createElement('script');
    s.src = '/admin-feature-flags.js?v=1';
    s.onload = done;
    s.onerror = done;
    (document.head || document.documentElement).appendChild(s);
  }

  function bootAdminLayout() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      inject();
    }
  }

  loadAdminFeatureFlags(bootAdminLayout);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      pollUnreadCount();
      pollPendingDoctorApplications();
      pollPendingReferrals();
    }
  });

  window.adminFetchUrl = adminFetchUrl;
  window.cliniflowAdminFetchUrl = adminFetchUrl;

})();
