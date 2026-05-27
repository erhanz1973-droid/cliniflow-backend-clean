(function () {
  const STORAGE_PREFIX = "cliniflow_meta_";
  const token = localStorage.getItem("adminToken") || localStorage.getItem("token");

  const msgEl = document.getElementById("msg");
  const statusText = document.getElementById("statusText");
  const debugEl = document.getElementById("debugState");
  const connectBtn = document.getElementById("connectBtn");
  const connectForceBtn = document.getElementById("connectForceBtn");
  const resetBtn = document.getElementById("resetStateBtn");
  const pagesCard = document.getElementById("pagesCard");
  const connectedList = document.getElementById("connectedList");
  const selectCard = document.getElementById("selectCard");
  const pageSelect = document.getElementById("pageSelect");
  const savePagesBtn = document.getElementById("savePagesBtn");
  const helpBtn = document.getElementById("helpBtn");
  const helpModal = document.getElementById("helpModal");
  const helpModalClose = document.getElementById("helpModalClose");

  /** @type {Record<string, unknown>} */
  const uiState = {
    hasToken: Boolean(token),
    serverEnabled: null,
    serverConfigured: null,
    connectedPageCount: 0,
    activeConnections: [],
    connectDisabledReason: null,
    lastStatusFetch: null,
    oauthReturn: null,
    pendingPagePicker: false,
  };

  function authHeaders() {
    return token ? { Authorization: "Bearer " + token, "Content-Type": "application/json" } : {};
  }

  function metaUiLog(event, detail) {
    const line = { event, ...detail, ui: { ...uiState } };
    console.log("[admin-messenger]", line);
    if (debugEl) {
      debugEl.textContent = JSON.stringify(line, null, 2);
    }
  }

  function setMsg(text, isErr) {
    msgEl.textContent = text || "";
    msgEl.className = isErr ? "err" : text ? "ok" : "muted";
  }

  function clearOAuthUrlParams() {
    const path = window.location.pathname || "/admin-messenger.html";
    if (window.location.search) {
      window.history.replaceState({}, "", path);
    }
  }

  function clearSessionOAuthArtifacts() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => sessionStorage.removeItem(k));
    } catch (_e) {
      /* ignore */
    }
  }

  function hidePagePicker() {
    selectCard.style.display = "none";
    selectCard._pages = null;
    pageSelect.innerHTML = "";
  }

  /**
   * Connect is only disabled when admin is not logged in or server Meta env is missing.
   * "No pages" from Facebook never disables Connect.
   */
  function applyConnectButtonState() {
    let reason = null;
    let disabled = false;

    if (!uiState.hasToken) {
      disabled = true;
      reason = "no_admin_token";
    } else if (uiState.serverEnabled === false) {
      disabled = true;
      reason = "meta_not_configured_on_server";
    } else {
      disabled = false;
      reason = uiState.connectedPageCount > 0 ? "ready_has_connections" : "ready_no_connections";
    }

    uiState.connectDisabledReason = reason;
    connectBtn.disabled = disabled;
    if (connectForceBtn) connectForceBtn.disabled = disabled;

    metaUiLog("connect_buttons", {
      disabled,
      reason,
      connectedPageCount: uiState.connectedPageCount,
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return String(s || "").replace(/"/g, "&quot;");
  }

  function openHelpModal() {
    if (!helpModal) return;
    helpModal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeHelpModal() {
    if (!helpModal) return;
    helpModal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function setStatusLine(text, variant) {
    if (!statusText) return;
    statusText.textContent = text || "";
    statusText.className = "status-line" + (variant === "connected" ? "" : " muted-state");
  }

  async function loadStatus() {
    metaUiLog("loadStatus.start", {});

    if (!uiState.hasToken) {
      setStatusLine("Please log in to the admin dashboard first, then reopen this page.");
      uiState.serverEnabled = false;
      uiState.connectedPageCount = 0;
      applyConnectButtonState();
      return;
    }

    let res;
    let json = {};
    try {
      res = await fetch("/api/integrations/meta/status", { headers: authHeaders() });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      setStatusLine("Could not reach server: " + (e?.message || "network_error"));
      uiState.serverEnabled = null;
      uiState.lastStatusFetch = { ok: false, error: "network" };
      applyConnectButtonState();
      metaUiLog("loadStatus.network_error", { message: e?.message });
      return;
    }

    uiState.lastStatusFetch = { ok: res.ok && json.ok, status: res.status, body: json };

    if (!res.ok || !json.ok) {
      setStatusLine(json.message || json.error || "Failed to load Meta status (" + res.status + ")");
      uiState.serverEnabled = false;
      uiState.connectedPageCount = 0;
      applyConnectButtonState();
      metaUiLog("loadStatus.failed", { status: res.status, error: json.error });
      return;
    }

    uiState.serverEnabled = json.enabled === true;
    uiState.serverConfigured = json.configured === true;

    const pages = (json.pages || []).filter((p) => String(p.status || "active") === "active");
    uiState.connectedPageCount = pages.length;
    uiState.activeConnections = pages;

    if (!json.enabled) {
      setStatusLine(
        "Server Meta credentials are not configured (META_APP_ID / META_APP_SECRET on Railway).",
      );
    } else if (pages.length) {
      setStatusLine(
        "Connected to " +
          pages.length +
          " Facebook Page" +
          (pages.length === 1 ? "" : "s") +
          ". You can connect another Page or remove one below.",
        "connected",
      );
    } else {
      setStatusLine("No Facebook Page connected yet.");
    }

    if (pages.length) {
      pagesCard.style.display = "block";
      connectedList.innerHTML = pages
        .map(
          (p) =>
            `<div class="page-row"><span><strong>${escapeHtml(p.pageName || p.pageId)}</strong><br><span class="muted">${p.pageId}</span> · webhook: ${p.webhookSubscribed ? "yes" : "no"}</span></span>` +
            `<button type="button" data-page-id="${escapeAttr(p.pageId)}" class="disconnect-btn">Disconnect</button></div>`,
        )
        .join("");
      connectedList.querySelectorAll(".disconnect-btn").forEach((btn) => {
        btn.addEventListener("click", () => disconnectPage(btn.getAttribute("data-page-id")));
      });
    } else {
      pagesCard.style.display = "none";
      connectedList.innerHTML = "";
    }

    applyConnectButtonState();
    metaUiLog("loadStatus.ok", {
      enabled: uiState.serverEnabled,
      connectedPageCount: uiState.connectedPageCount,
    });
  }

  function resetMetaConnectionState() {
    metaUiLog("reset.start", {});
    clearOAuthUrlParams();
    clearSessionOAuthArtifacts();
    hidePagePicker();
    setMsg("");
    uiState.oauthReturn = null;
    uiState.pendingPagePicker = false;
    void loadStatus();
    metaUiLog("reset.done", {});
  }

  async function startOAuth(forceReauth) {
    setMsg("");
    hidePagePicker();
    metaUiLog("oauth.start_click", { forceReauth: Boolean(forceReauth) });

    if (!uiState.hasToken) {
      setMsg("Log in to admin first.", true);
      return;
    }

    const returnUrl = window.location.pathname || "/admin-messenger.html";
    const forceQ = forceReauth ? "&force=1" : "";
    const res = await fetch(
      "/api/integrations/meta/oauth/start?returnUrl=" + encodeURIComponent(returnUrl) + forceQ,
      { headers: authHeaders() },
    );
    const json = await res.json().catch(() => ({}));
    metaUiLog("oauth.start_response", { ok: res.ok, status: res.status, json });

    if (!res.ok || !json.authUrl) {
      setMsg(json.message || json.error || "OAuth start failed", true);
      applyConnectButtonState();
      return;
    }

    window.location.href = json.authUrl;
  }

  function handleOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const meta = params.get("meta");
    if (!meta) return;

    uiState.oauthReturn = meta;
    metaUiLog("oauth.return", { meta, scopes: params.get("scopes") });

    if (meta === "select_pages") {
      const payload = params.get("payload");
      clearOAuthUrlParams();
      if (!payload) {
        setMsg("Missing page list from Facebook. Try Connect again.", true);
        applyConnectButtonState();
        return;
      }
      try {
        const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        const pages = data.pages || [];
        metaUiLog("oauth.page_fetch_result", { pageCount: pages.length, pages: pages.map((p) => p.id) });
        showPagePicker(pages);
        setMsg(
          pages.length
            ? "Select the Page(s) to connect, then Save selected."
            : "No Pages returned from Facebook — this is usually account or permissions, not a permanent error. See Need help connecting?",
          !pages.length,
        );
        if (!pages.length) openHelpModal();
      } catch (e) {
        setMsg("Invalid page selection payload. Use Reset, then Connect again.", true);
        metaUiLog("oauth.payload_parse_error", { message: e?.message });
      }
      applyConnectButtonState();
      return;
    }

    clearOAuthUrlParams();

    if (meta === "no_pages") {
      const scopes = params.get("scopes") || "";
      metaUiLog("oauth.page_fetch_result", { pageCount: 0, scopes });
      setMsg(
        "No Pages found for that Facebook login — usually wrong account, missing Page admin role, or permissions denied.\n" +
          "Click Need help connecting? for steps, or Retry permissions.\n" +
          (scopes ? "Granted scopes: " + scopes : ""),
        true,
      );
      openHelpModal();
      hidePagePicker();
      applyConnectButtonState();
      return;
    }

    if (meta === "error") {
      setMsg("Facebook connection failed: " + (params.get("reason") || "unknown"), true);
      hidePagePicker();
      applyConnectButtonState();
    }
  }

  function showPagePicker(pages) {
    uiState.pendingPagePicker = pages.length > 0;
    if (!pages.length) {
      hidePagePicker();
      return;
    }
    selectCard.style.display = "block";
    pageSelect.innerHTML = pages
      .map(
        (p, i) =>
          `<label><input type="checkbox" name="page" value="${i}" checked /> ${escapeHtml(p.name)} (${p.id})</label>`,
      )
      .join("");
    selectCard._pages = pages;
  }

  async function saveSelectedPages() {
    const pages = selectCard._pages || [];
    const checked = [...pageSelect.querySelectorAll('input[name="page"]:checked')].map((el) =>
      Number(el.value),
    );
    const selected = checked.map((i) => pages[i]).filter(Boolean);
    if (!selected.length) {
      setMsg("Select at least one Page.", true);
      return;
    }
    const res = await fetch("/api/integrations/meta/pages/connect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        pages: selected.map((p) => ({
          pageId: p.id,
          pageName: p.name,
          accessToken: p.access_token,
        })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    metaUiLog("page_connect.result", { ok: res.ok, connected: json.connected, failed: json.failed });

    if (!res.ok || !json.ok) {
      setMsg(json.message || json.error || "Connect failed", true);
      applyConnectButtonState();
      return;
    }

    hidePagePicker();
    uiState.pendingPagePicker = false;
    const lines = (json.connected || []).map((c) => {
      const sub = c.webhookSubscribed ? "webhook subscribed" : "webhook NOT subscribed — check Railway logs";
      const err = c.subscribeMeta?.subscribe_error;
      return `${c.pageName || c.pageId}: ${sub}${err ? " — " + err : ""}`;
    });
    const failLines = (json.failed || []).map((f) => `${f.pageId}: ${f.error}`);
    setMsg(
      ["Connected " + (json.connected || []).length + " page(s).", ...lines, ...failLines].join("\n"),
      (json.connected || []).some((c) => !c.webhookSubscribed),
    );
    await loadStatus();
  }

  async function disconnectPage(pageId) {
    if (!pageId || !confirm("Disconnect this Page from Clinifly?")) return;
    const res = await fetch("/api/integrations/meta/pages/disconnect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ pageId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Disconnect failed", true);
      return;
    }
    setMsg("Page removed from Clinifly.");
    hidePagePicker();
    await loadStatus();
  }

  if (helpBtn) {
    helpBtn.addEventListener("click", openHelpModal);
  }
  if (helpModalClose) {
    helpModalClose.addEventListener("click", closeHelpModal);
  }
  if (helpModal) {
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) closeHelpModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && helpModal.classList.contains("open")) closeHelpModal();
    });
  }

  connectBtn.addEventListener("click", () => startOAuth(false));
  if (connectForceBtn) {
    connectForceBtn.addEventListener("click", () => startOAuth(true));
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", resetMetaConnectionState);
  }
  savePagesBtn.addEventListener("click", saveSelectedPages);

  const diagBtn = document.getElementById("diagBtn");
  if (diagBtn) {
    diagBtn.addEventListener("click", async () => {
      const pageId =
        (uiState.activeConnections && uiState.activeConnections[0] && uiState.activeConnections[0].pageId) ||
        "";
      const q = pageId ? "?pageId=" + encodeURIComponent(pageId) : "";
      setMsg("Running Graph self-test…");
      try {
        const res = await fetch("/api/integrations/meta/messenger/diagnostics" + q, {
          headers: authHeaders(),
        });
        const json = await res.json().catch(() => ({}));
        metaUiLog("messenger.diagnostics", { ok: res.ok, findings: json.report && json.report.findings });
        if (!res.ok || !json.ok) {
          setMsg(json.error || "Diagnostics failed", true);
          return;
        }
        const report = json.report || {};
        const findings = report.findings || [];
        const actionRequired = String(report.actionRequired || "").trim();
        let diagText = "";
        if (actionRequired) {
          diagText += "⚠ " + actionRequired + "\n\n";
        }
        if (findings.length) {
          diagText += "Diagnostics:\n• " + findings.join("\n• ");
        } else if (!actionRequired) {
          diagText = "Diagnostics OK — page token and probes look healthy.";
        }
        setMsg(diagText.trim() || "Diagnostics finished.", findings.length > 0 || Boolean(actionRequired));
        if (debugEl) debugEl.textContent = JSON.stringify(json.report, null, 2);
      } catch (e) {
        setMsg(e.message || "Diagnostics request failed", true);
      }
    });
  }

  handleOAuthReturn();
  void loadStatus();
})();
