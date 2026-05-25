(function () {
  const token = localStorage.getItem("adminToken") || localStorage.getItem("token");
  const msgEl = document.getElementById("msg");
  const statusText = document.getElementById("statusText");
  const connectBtn = document.getElementById("connectBtn");
  const pagesCard = document.getElementById("pagesCard");
  const connectedList = document.getElementById("connectedList");
  const selectCard = document.getElementById("selectCard");
  const pageSelect = document.getElementById("pageSelect");
  const savePagesBtn = document.getElementById("savePagesBtn");

  function authHeaders() {
    return token ? { Authorization: "Bearer " + token, "Content-Type": "application/json" } : {};
  }

  function setMsg(text, isErr) {
    msgEl.textContent = text || "";
    msgEl.className = isErr ? "err" : text ? "ok" : "muted";
  }

  async function loadStatus() {
    if (!token) {
      statusText.textContent = "Please log in to the admin dashboard first.";
      connectBtn.disabled = true;
      return;
    }
    const res = await fetch("/api/integrations/meta/status", { headers: authHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      statusText.textContent = json.message || json.error || "Failed to load status";
      return;
    }
    statusText.textContent = json.enabled
      ? "Meta integration is configured."
      : "Meta app credentials are not set on the server.";
    connectBtn.disabled = !json.enabled;

    const pages = json.pages || [];
    if (pages.length) {
      pagesCard.style.display = "block";
      connectedList.innerHTML = pages
        .map(
          (p) =>
            `<div class="page-row"><span><strong>${escapeHtml(p.pageName || p.pageId)}</strong><br><span class="muted">${p.pageId}</span></span>` +
            `<button type="button" data-page-id="${escapeAttr(p.pageId)}" class="disconnect-btn">Disconnect</button></div>`,
        )
        .join("");
      connectedList.querySelectorAll(".disconnect-btn").forEach((btn) => {
        btn.addEventListener("click", () => disconnectPage(btn.getAttribute("data-page-id")));
      });
    } else {
      pagesCard.style.display = "none";
    }
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

  async function startOAuth() {
    setMsg("");
    const returnUrl = window.location.pathname + window.location.hash;
    const res = await fetch(
      "/api/integrations/meta/oauth/start?returnUrl=" + encodeURIComponent(returnUrl),
      { headers: authHeaders() },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.authUrl) {
      setMsg(json.message || json.error || "OAuth start failed", true);
      return;
    }
    window.location.href = json.authUrl;
  }

  function handleOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const meta = params.get("meta");
    if (!meta) return;
    if (meta === "select_pages") {
      const payload = params.get("payload");
      if (!payload) return;
      try {
        const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        showPagePicker(data.pages || []);
        setMsg("Select the Pages you want to connect.");
      } catch (e) {
        setMsg("Invalid page selection payload", true);
      }
      window.history.replaceState({}, "", window.location.pathname);
    } else if (meta === "error") {
      setMsg("Facebook connection failed: " + (params.get("reason") || "unknown"), true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  function showPagePicker(pages) {
    if (!pages.length) {
      setMsg("No Facebook Pages found on this account.", true);
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
    if (!res.ok || !json.ok) {
      setMsg(json.message || json.error || "Connect failed", true);
      return;
    }
    selectCard.style.display = "none";
    const lines = (json.connected || []).map((c) => {
      const sub = c.webhookSubscribed ? "webhook subscribed" : "webhook NOT subscribed — check Railway [metaTrace] logs";
      const err = c.subscribeMeta?.subscribe_error;
      return `${c.pageName || c.pageId}: ${sub}${err ? " — " + err : ""}`;
    });
    const failLines = (json.failed || []).map((f) => `${f.pageId}: ${f.error}`);
    setMsg(
      ["Connected " + (json.connected || []).length + " page(s).", ...lines, ...failLines].join("\n"),
      (json.connected || []).some((c) => !c.webhookSubscribed),
    );
    loadStatus();
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
    setMsg("Page disconnected.");
    loadStatus();
  }

  connectBtn.addEventListener("click", startOAuth);
  savePagesBtn.addEventListener("click", saveSelectedPages);
  handleOAuthReturn();
  loadStatus();
})();
