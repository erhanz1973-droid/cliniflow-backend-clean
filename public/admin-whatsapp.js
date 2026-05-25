(function () {
  const token = localStorage.getItem("adminToken") || localStorage.getItem("token");

  const statusText = document.getElementById("statusText");
  const connectionsList = document.getElementById("connectionsList");
  const msgEl = document.getElementById("msg");
  const clinicAuditList = document.getElementById("clinicAuditList");
  const onboardSteps = document.getElementById("onboardSteps");

  const AI_MODES = [
    { value: "AI_ACTIVE", label: "AI active — auto-reply when appropriate" },
    { value: "HUMAN_ONLY", label: "Human only — no AI replies" },
    { value: "AI_DRAFT", label: "AI draft suggestions — coordinator sends" },
    { value: "AI_ASSISTED", label: "Require human approval before send" },
  ];

  function authHeaders() {
    return token ? { Authorization: "Bearer " + token, "Content-Type": "application/json" } : {};
  }

  function setMsg(text, isErr) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.className = isErr ? "err" : text ? "ok" : "wa-muted";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatTs(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function statusBadge(c) {
    const op = c.operationalStatus || (c.status === "disconnected" ? "disconnected" : c.is_enabled === false ? "paused" : "active");
    if (op === "active") return '<span class="badge badge-active">Active</span>';
    if (op === "paused") return '<span class="badge badge-paused">Paused</span>';
    return '<span class="badge badge-off">Disconnected</span>';
  }

  function healthBadge(label, ok, warn) {
    const cls = ok ? "badge-ok" : warn ? "badge-warn" : "badge-bad";
    return '<span class="badge ' + cls + '">' + escapeHtml(label) + "</span>";
  }

  function statBox(value, label) {
    return (
      '<div class="stat-box"><div class="n">' +
      escapeHtml(value != null ? String(value) : "—") +
      '</div><div class="l">' +
      escapeHtml(label) +
      "</div></div>"
    );
  }

  function aiModeSelect(connectionId, currentMode) {
    const opts = AI_MODES.map(function (m) {
      const sel = m.value === currentMode ? " selected" : "";
      return '<option value="' + m.value + '"' + sel + ">" + escapeHtml(m.label) + "</option>";
    }).join("");
    return (
      '<div class="ai-mode-row"><label for="aiMode-' +
      escapeHtml(connectionId) +
      '">AI mode for this number</label>' +
      '<select class="ai-mode-select" data-id="' +
      escapeHtml(connectionId) +
      '" id="aiMode-' +
      escapeHtml(connectionId) +
      '">' +
      opts +
      "</select></div>"
    );
  }

  function renderTestResult(c) {
    const t = c.lastTest;
    if (!t || !t.at) return "";
    const status = String(t.deliveryStatus || t.status || (t.ok ? "sent" : "failed")).toLowerCase();
    const cls = status === "delivered" || status === "read" || status === "sent" ? "ok" : "err";
    return (
      '<div class="test-result visible">' +
      "<strong>Last test</strong> (" +
      formatTs(t.at) +
      ")<br>" +
      "Status: <span class=\"" +
      cls +
      '">' +
      escapeHtml(status) +
      "</span>" +
      (t.messageId ? " · Message ID: <code>" + escapeHtml(String(t.messageId).slice(0, 24)) + "</code>" : "") +
      (t.latencyMs != null ? " · Latency: " + Math.round(t.latencyMs) + " ms" : "") +
      (t.hint ? "<br><span class=\"wa-muted\">" + escapeHtml(t.hint) + "</span>" : "") +
      "</div>"
    );
  }

  function renderConnectionCard(c) {
    const id = c.id;
    const op = c.operationalStatus || "active";
    const routingOn = c.routingEnabled !== false && op === "active";
    const h = c.health || {};
    const stats = c.stats || {};
    const title = c.displayName || c.display_name || "WhatsApp line";

    const healthRow =
      '<div class="health-row">' +
      healthBadge(h.webhookStatusLabel || (h.webhookActive ? "Webhook active" : "No webhook yet"), h.webhookActive) +
      (h.lastMessageAgo
        ? healthBadge("Last message " + h.lastMessageAgo, true)
        : "") +
      healthBadge(h.aiStatusLabel || (h.aiEnabled ? "AI on" : "AI off"), h.aiEnabled, !h.aiEnabled) +
      healthBadge(h.tokenValid ? "Token OK" : "Check token", h.tokenValid, !h.tokenValid) +
      "</div>";

    const meta =
      '<dl class="meta-grid">' +
      "<dt>WABA ID</dt><dd>" +
      escapeHtml(c.wabaId || c.waba_id || "—") +
      "</dd>" +
      "<dt>Display name</dt><dd>" +
      escapeHtml(c.displayName || c.display_name || "—") +
      "</dd>" +
      "<dt>Phone line</dt><dd>" +
      escapeHtml(c.phoneNumber || c.phone_number || "—") +
      "</dd>" +
      "<dt>Last inbound webhook</dt><dd>" +
      formatTs(c.lastWebhookAt || c.last_webhook_at) +
      "</dd>" +
      "<dt>Last outbound success</dt><dd>" +
      formatTs(h.lastOutboundSuccessAt) +
      (h.lastOutboundAgo ? " (" + escapeHtml(h.lastOutboundAgo) + ")" : "") +
      "</dd>" +
      "</dl>";

    const statsGrid =
      '<div class="stats-grid">' +
      statBox(stats.inbound, "Inbound today") +
      statBox(stats.outbound, "Outbound today") +
      statBox(stats.aiReplyCount, "AI replies") +
      statBox(
        stats.deliverySuccessRate != null ? stats.deliverySuccessRate + "%" : "—",
        "Delivery rate",
      ) +
      statBox(stats.failedSends != null ? stats.failedSends : 0, "Failed sends") +
      statBox(stats.messagesToday, "Messages today") +
      "</div>";

    const toggle =
      op !== "disconnected"
        ? '<div class="toggle-wrap">' +
          '<label><input type="checkbox" class="routing-toggle" data-id="' +
          escapeHtml(id) +
          '" ' +
          (routingOn ? "checked" : "") +
          " /> WhatsApp enabled</label></div>"
        : "";

    return (
      '<article class="conn-card" data-connection-id="' +
      escapeHtml(id) +
      '">' +
      '<div class="conn-hd">' +
      "<div><h3 class=\"conn-title\">" +
      escapeHtml(title) +
      " " +
      statusBadge(c) +
      "</h3>" +
      '<p class="wa-muted" style="margin:4px 0 0">ID: <code>' +
      escapeHtml(c.phone_number_id) +
      "</code></p></div>" +
      toggle +
      "</div>" +
      healthRow +
      meta +
      aiModeSelect(id, c.ai_mode || "AI_ACTIVE") +
      statsGrid +
      renderTestResult(c) +
      '<div class="wa-btn-row">' +
      '<button type="button" class="wa-btn-outline wa-btn btn-test" data-id="' +
      escapeHtml(id) +
      '" data-pid="' +
      escapeHtml(c.phone_number_id) +
      '">Send test message</button>' +
      '<button type="button" class="wa-btn-outline wa-btn btn-refresh-meta" data-id="' +
      escapeHtml(id) +
      '" data-pid="' +
      escapeHtml(c.phone_number_id) +
      '">Refresh from Meta</button>' +
      (op !== "disconnected"
        ? '<button type="button" class="wa-btn-outline wa-btn btn-reassign" data-id="' +
          escapeHtml(id) +
          '">Reassign clinic</button>' +
          '<button type="button" class="wa-btn-danger wa-btn btn-disconnect" data-id="' +
          escapeHtml(id) +
          '">Disconnect permanently</button>'
        : "") +
      "</div>" +
      '<div class="audit-list conn-audit" data-audit-for="' +
      escapeHtml(id) +
      '"></div>' +
      "</article>"
    );
  }

  async function loadOnboarding() {
    const res = await fetch("/api/integrations/whatsapp/onboarding", { headers: authHeaders() });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) return;

    const steps = json.steps || {};
    const order = ["connect", "verifyWebhook", "testMessage", "configureAi", "goLive"];
    let currentMarked = false;
    if (onboardSteps) {
      onboardSteps.querySelectorAll("li").forEach(function (li) {
        const key = li.getAttribute("data-step");
        li.classList.remove("done", "current");
        if (steps[key]) {
          li.classList.add("done");
        } else if (!currentMarked && order.includes(key)) {
          li.classList.add("current");
          currentMarked = true;
        }
      });
    }
    const hint = document.getElementById("webhookHint");
    if (hint && json.expectedWebhookUrl) {
      hint.textContent =
        "Callback URL for Meta: " + json.expectedWebhookUrl;
    }
  }

  function renderAuditList(el, events) {
    if (!el) return;
    if (!events || !events.length) {
      el.innerHTML = "<span class=\"wa-muted\">No events yet.</span>";
      return;
    }
    el.innerHTML = events
      .map(function (ev) {
        const label = formatAuditLabel(ev.event_type);
        return (
          '<div class="audit-item"><span>' +
          escapeHtml(label) +
          (ev.actor ? " · " + escapeHtml(ev.actor) : "") +
          '</span><span class="wa-muted">' +
          formatTs(ev.created_at) +
          "</span></div>"
        );
      })
      .join("");
  }

  function formatAuditLabel(type) {
    const map = {
      connected: "Connected",
      created: "Connected",
      updated: "Updated",
      enabled: "WhatsApp turned ON",
      disabled: "WhatsApp turned OFF (paused)",
      disconnected: "Disconnected",
      reassigned: "Reassigned to another clinic",
      ai_mode_updated: "AI mode changed",
      token_updated: "Access token updated",
      inbound_paused: "Inbound received (paused)",
    };
    return map[type] || type.replace(/_/g, " ");
  }

  async function loadClinicAudit() {
    const res = await fetch("/api/integrations/whatsapp/connections/audit?limit=30", {
      headers: authHeaders(),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    renderAuditList(clinicAuditList, json.events || []);
  }

  async function loadConnectionAudit(connectionId, el) {
    const res = await fetch(
      "/api/integrations/whatsapp/connections/audit?connectionId=" + encodeURIComponent(connectionId) + "&limit=15",
      { headers: authHeaders() },
    );
    const json = await res.json().catch(function () {
      return {};
    });
    if (el) renderAuditList(el, json.events || []);
  }

  async function loadStatus() {
    if (!token) {
      statusText.textContent = "Please log in to the admin dashboard first.";
      return;
    }
    const res = await fetch("/api/integrations/whatsapp/status", { headers: authHeaders() });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      statusText.textContent = json.error || "Could not load status";
      return;
    }
    const rows = json.connections || [];
    const live = rows.filter(function (c) {
      return c.operationalStatus === "active" || (c.status === "active" && c.is_enabled !== false);
    });
    statusText.textContent = json.enabled
      ? live.length
        ? live.length + " number(s) live. Paused numbers still receive webhooks but won't route to inbox or AI."
        : rows.length
          ? rows.length + " number(s) connected — turn WhatsApp ON when ready."
          : "No number connected yet. Complete step 1 below."
      : "WhatsApp is not configured on the server. Contact Clinifly support.";
  }

  async function loadConnections() {
    if (!token) {
      connectionsList.textContent = "Log in required.";
      return;
    }
    const res = await fetch("/api/integrations/whatsapp/connections", { headers: authHeaders() });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      connectionsList.textContent = json.error || "Could not load connections";
      return;
    }
    const rows = json.connections || [];
    if (!rows.length) {
      connectionsList.innerHTML =
        '<p class="wa-muted">No WhatsApp number linked yet. Use <strong>Connect WhatsApp</strong> above.</p>';
      return;
    }
    connectionsList.innerHTML = rows.map(renderConnectionCard).join("");
    wireConnectionButtons();
    rows.forEach(function (c) {
      const el = connectionsList.querySelector('.conn-audit[data-audit-for="' + c.id + '"]');
      if (c.id && el) void loadConnectionAudit(c.id, el);
    });
  }

  function wireConnectionButtons() {
    connectionsList.querySelectorAll(".routing-toggle").forEach(function (input) {
      input.addEventListener("change", function () {
        void setEnabled(input.getAttribute("data-id"), input.checked);
      });
    });
    connectionsList.querySelectorAll(".ai-mode-select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        void setAiMode(sel.getAttribute("data-id"), sel.value);
      });
    });
    connectionsList.querySelectorAll(".btn-disconnect").forEach(function (btn) {
      btn.addEventListener("click", function () {
        void disconnectConnection(btn.getAttribute("data-id"));
      });
    });
    connectionsList.querySelectorAll(".btn-reassign").forEach(function (btn) {
      btn.addEventListener("click", function () {
        void reassignConnection(btn.getAttribute("data-id"));
      });
    });
    connectionsList.querySelectorAll(".btn-test").forEach(function (btn) {
      btn.addEventListener("click", function () {
        void testSend(btn.getAttribute("data-id"), btn.getAttribute("data-pid"));
      });
    });
    connectionsList.querySelectorAll(".btn-refresh-meta").forEach(function (btn) {
      btn.addEventListener("click", function () {
        void refreshMetadata(btn.getAttribute("data-id"), btn.getAttribute("data-pid"));
      });
    });
  }

  async function setEnabled(connectionId, enabled) {
    const res = await fetch("/api/integrations/whatsapp/connections/set-enabled", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, enabled }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg(json.message || json.error || "Could not update WhatsApp toggle", true);
      await loadConnections();
      return;
    }
    setMsg(enabled ? "WhatsApp is ON — inbox routing and sends are active." : "WhatsApp is paused — webhooks still logged, no AI or sends.");
    await loadStatus();
    await loadConnections();
    await loadOnboarding();
    await loadClinicAudit();
  }

  async function setAiMode(connectionId, aiMode) {
    const res = await fetch("/api/integrations/whatsapp/connections/ai-mode", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, aiMode }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Could not save AI mode", true);
      return;
    }
    setMsg("AI mode saved.");
    await loadConnections();
    await loadOnboarding();
    await loadClinicAudit();
  }

  async function saveConnect() {
    const phoneNumberId = document.getElementById("inpPhoneNumberId").value.trim();
    if (!phoneNumberId) {
      setMsg("Phone number ID is required.", true);
      return;
    }
    const res = await fetch("/api/integrations/whatsapp/connections/connect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        phoneNumberId,
        displayName: document.getElementById("inpDisplayName").value.trim() || null,
        phoneNumber: document.getElementById("inpPhoneNumber").value.trim() || null,
        wabaId: document.getElementById("inpWabaId").value.trim() || null,
      }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Could not save connection", true);
      return;
    }
    setMsg("WhatsApp number connected. Complete the checklist above.");
    document.getElementById("manualConnectPanel").style.display = "none";
    await refreshAll();
  }

  async function disconnectConnection(connectionId) {
    if (
      !connectionId ||
      !confirm(
        "Disconnect permanently? You will need to connect again. Use the ON/OFF toggle to pause instead.",
      )
    ) {
      return;
    }
    const res = await fetch("/api/integrations/whatsapp/connections/disconnect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Disconnect failed", true);
      return;
    }
    setMsg("Number disconnected.");
    await refreshAll();
  }

  async function reassignConnection(connectionId) {
    const target = prompt("Target clinic ID (UUID). Cancel to abort:");
    if (!target || !target.trim()) return;
    const res = await fetch("/api/integrations/whatsapp/connections/reassign", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, targetClinicId: target.trim() }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Reassign failed", true);
      return;
    }
    setMsg("Reassigned.");
    await refreshAll();
  }

  async function refreshMetadata(connectionId, phoneNumberId) {
    setMsg("Refreshing from Meta…", false);
    const res = await fetch("/api/integrations/whatsapp/connections/refresh-metadata", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, phoneNumberId }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Refresh failed", true);
      return;
    }
    setMsg("Details updated from Meta.");
    await loadConnections();
  }

  async function testSend(connectionId, phoneNumberId) {
    const waId = prompt("Test recipient WhatsApp ID (digits only, country code without +):");
    if (!waId || !waId.trim()) return;
    const text =
      prompt("Test message:", "Hello from Clinifly — WhatsApp test") ||
      "Hello from Clinifly — WhatsApp test";
    setMsg("Sending test…", false);
    const res = await fetch("/api/integrations/whatsapp/test-send", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, phoneNumberId, waId: waId.trim(), text }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) {
      setMsg((json.message || json.error || "Test failed") + (json.code ? " (code " + json.code + ")" : ""), true);
      await loadConnections();
      return;
    }
    setMsg(
      "Test sent. Status: " +
        (json.deliveryStatus || "sent") +
        (json.latencyMs != null ? " · " + json.latencyMs + " ms" : "") +
        ". " +
        (json.hint || ""),
      false,
    );
    await loadConnections();
    await loadOnboarding();
  }

  async function loadClinicAiControls() {
    const res = await fetch("/api/integrations/whatsapp/clinic-ai-controls", { headers: authHeaders() });
    const json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !json.ok) return;
    const preset = String(json.controls?.preset || "ASSIST").toUpperCase();
    document.querySelectorAll('input[name="clinicAiPreset"]').forEach(function (el) {
      el.checked = el.value === preset || (preset === "DRAFT" && el.value === "ASSIST");
    });
  }

  async function saveClinicAi() {
    const presetEl = document.querySelector('input[name="clinicAiPreset"]:checked');
    const preset = presetEl ? presetEl.value : "ASSIST";
    const res = await fetch("/api/integrations/whatsapp/clinic-ai-controls", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ preset, aiActive: preset === "ACTIVE", humanOnly: preset === "OFF" }),
    });
    const json = await res.json().catch(function () {
      return {};
    });
    const el = document.getElementById("clinicAiMsg");
    if (!res.ok || !json.ok) {
      if (el) el.textContent = json.error || "Save failed";
      return;
    }
    if (el) el.textContent = "Clinic defaults saved.";
  }

  async function refreshAll() {
    await loadStatus();
    await loadConnections();
    await loadOnboarding();
    await loadClinicAudit();
  }

  document.getElementById("btnToggleManual").addEventListener("click", function () {
    const panel = document.getElementById("manualConnectPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
  document.getElementById("saveConnectBtn").addEventListener("click", function () {
    void saveConnect();
  });
  document.getElementById("saveClinicAiBtn").addEventListener("click", function () {
    void saveClinicAi();
  });

  if (!token) {
    setMsg("Log in to admin first.", true);
  } else {
    void loadClinicAiControls();
    void refreshAll();
  }
})();
