(function () {
  const token = localStorage.getItem("adminToken") || localStorage.getItem("token");

  const statusText = document.getElementById("statusText");
  const connectionsList = document.getElementById("connectionsList");
  const msgEl = document.getElementById("msg");
  const connectForm = document.getElementById("connectForm");

  function authHeaders() {
    return token ? { Authorization: "Bearer " + token, "Content-Type": "application/json" } : {};
  }

  function setMsg(text, isErr) {
    msgEl.textContent = text || "";
    msgEl.className = isErr ? "err" : text ? "ok" : "muted";
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

  async function loadStatus() {
    if (!token) {
      statusText.textContent = "Log in to admin first.";
      return;
    }
    const res = await fetch("/api/integrations/whatsapp/status", { headers: authHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      statusText.textContent = json.error || "Failed to load status";
      return;
    }
    const n = (json.connections || []).length;
    statusText.textContent = json.enabled
      ? n
        ? `${n} active WhatsApp number(s) for this clinic. Routing: database first.`
        : "No WhatsApp numbers linked to this clinic yet. Connect below."
      : "Server WhatsApp not configured (WHATSAPP_ACCESS_TOKEN on Railway).";
  }

  async function loadConnections() {
    if (!token) {
      connectionsList.textContent = "Log in required.";
      return;
    }
    const res = await fetch("/api/integrations/whatsapp/connections", { headers: authHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      connectionsList.textContent = json.error || "Failed to load connections";
      return;
    }
    const rows = json.connections || [];
    if (!rows.length) {
      connectionsList.innerHTML = "<p class=\"muted\">No connections yet.</p>";
      return;
    }
    connectionsList.innerHTML = rows
      .map((c) => {
        const active = String(c.status) === "active";
        const badge = active
          ? '<span class="badge badge-active">active</span>'
          : '<span class="badge badge-off">' + escapeHtml(c.status) + "</span>";
        return (
          `<div class="conn-row" data-id="${escapeHtml(c.id)}">` +
          `<div><strong>${escapeHtml(c.display_name || c.phone_number_id)}</strong> ${badge}</div>` +
          `<div class="muted" style="margin-top:6px;font-size:13px;">` +
          `Clinic: ${escapeHtml(c.clinicName || c.clinic_id)}<br>` +
          `Phone number ID: <code>${escapeHtml(c.phone_number_id)}</code><br>` +
          `WABA: ${escapeHtml(c.waba_id || "—")} · Display: ${escapeHtml(c.phone_number || "—")}<br>` +
          `Last inbound webhook: ${formatTs(c.last_webhook_at)}` +
          `</div>` +
          `<div class="btn-row">` +
          `<button type="button" class="btn btn-outline btn-test" data-id="${escapeHtml(c.id)}" data-pid="${escapeHtml(c.phone_number_id)}">Send test</button>` +
          `<button type="button" class="btn btn-secondary btn-reassign" data-id="${escapeHtml(c.id)}">Reassign clinic</button>` +
          (active
            ? `<button type="button" class="btn btn-danger btn-disconnect" data-id="${escapeHtml(c.id)}">Disconnect</button>`
            : "") +
          `</div></div>`
        );
      })
      .join("");

    connectionsList.querySelectorAll(".btn-disconnect").forEach((btn) => {
      btn.addEventListener("click", () => disconnectConnection(btn.getAttribute("data-id")));
    });
    connectionsList.querySelectorAll(".btn-reassign").forEach((btn) => {
      btn.addEventListener("click", () => reassignConnection(btn.getAttribute("data-id")));
    });
    connectionsList.querySelectorAll(".btn-test").forEach((btn) => {
      btn.addEventListener("click", () =>
        testSend(btn.getAttribute("data-id"), btn.getAttribute("data-pid")),
      );
    });
  }

  async function saveConnect() {
    const phoneNumberId = document.getElementById("inpPhoneNumberId").value.trim();
    if (!phoneNumberId) {
      setMsg("Phone number ID is required.", true);
      return;
    }
    const body = {
      phoneNumberId,
      displayName: document.getElementById("inpDisplayName").value.trim() || null,
      phoneNumber: document.getElementById("inpPhoneNumber").value.trim() || null,
      wabaId: document.getElementById("inpWabaId").value.trim() || null,
    };
    const res = await fetch("/api/integrations/whatsapp/connections/connect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Connect failed", true);
      return;
    }
    setMsg("WhatsApp connection saved (" + (json.eventType || "ok") + ").");
    connectForm.style.display = "none";
    await loadStatus();
    await loadConnections();
  }

  async function disconnectConnection(connectionId) {
    if (!connectionId || !confirm("Disconnect this WhatsApp number?")) return;
    const res = await fetch("/api/integrations/whatsapp/connections/disconnect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Disconnect failed", true);
      return;
    }
    setMsg("Disconnected.");
    await loadStatus();
    await loadConnections();
  }

  async function reassignConnection(connectionId) {
    const target = prompt(
      "Target clinic UUID (must exist in clinics table).\nLeave empty to cancel:",
    );
    if (!target || !target.trim()) return;
    const res = await fetch("/api/integrations/whatsapp/connections/reassign", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, targetClinicId: target.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      setMsg(json.error || "Reassign failed", true);
      return;
    }
    setMsg("Reassigned to " + (json.clinicName || target.trim()) + ".");
    await loadConnections();
  }

  async function testSend(connectionId, phoneNumberId) {
    const waId = prompt("Recipient WhatsApp ID (wa_id, digits only):");
    if (!waId || !waId.trim()) return;
    const text = prompt("Test message:", "Clinifly WhatsApp test") || "Clinifly WhatsApp test";
    const res = await fetch("/api/integrations/whatsapp/test-send", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ connectionId, phoneNumberId, waId: waId.trim(), text }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      setMsg((json.error || "Test send failed") + (json.code ? " (code " + json.code + ")" : ""), true);
      return;
    }
    setMsg("Test sent. Message id: " + (json.messageId || "—"));
  }

  document.getElementById("showConnectBtn").addEventListener("click", () => {
    connectForm.style.display = connectForm.style.display === "block" ? "none" : "block";
  });
  document.getElementById("cancelConnectBtn").addEventListener("click", () => {
    connectForm.style.display = "none";
  });
  document.getElementById("saveConnectBtn").addEventListener("click", () => void saveConnect());
  document.getElementById("refreshBtn").addEventListener("click", () => {
    void loadStatus();
    void loadConnections();
  });

  void loadStatus();
  void loadConnections();
})();
