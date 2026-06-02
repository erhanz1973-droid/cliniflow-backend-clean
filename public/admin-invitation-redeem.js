(function (global) {
  "use strict";

  function getToken() {
    try {
      return localStorage.getItem("adminToken") || localStorage.getItem("admin_token") || "";
    } catch (_) {
      return "";
    }
  }

  function getApiBase() {
    if (typeof global.cliniflowAdminApiOrigin === "function") {
      const base = global.cliniflowAdminApiOrigin();
      if (base) return String(base).replace(/\/+$/, "");
    }
    return "";
  }

  function ensureCard() {
    if (document.getElementById("inviteRedeemCard")) return;
    const wrap = document.querySelector(".wrap");
    if (!wrap) return;
    const card = document.createElement("div");
    card.className = "card";
    card.id = "inviteRedeemCard";
    card.innerHTML =
      '<h2 style="margin-top:0">🎁 Redeem Invitation Code</h2>' +
      '<p class="muted" style="margin:0 0 12px">Enter invitation code</p>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap">' +
      '  <input id="inviteRedeemInput" type="text" placeholder="WELCOME60" style="min-width:220px; flex:1; background:#111827; border:1px solid #374151; color:#e6eaf2; border-radius:8px; padding:10px 12px;" />' +
      '  <button id="inviteRedeemBtn" type="button">Activate</button>' +
      "</div>" +
      '<div id="inviteRedeemResult" class="muted" style="margin-top:10px"></div>';
    wrap.prepend(card);
  }

  async function request(path, method, body) {
    const res = await fetch(getApiBase() + path, {
      method: method || "GET",
      headers: {
        Authorization: "Bearer " + getToken(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || data?.error || ("http_" + res.status));
    return data;
  }

  function paintStatus(data) {
    const el = document.getElementById("inviteRedeemResult");
    if (!el) return;
    if (!data?.redeemedInvitationCode) {
      el.textContent = "";
      return;
    }
    const trialText = data?.trialEndsAt
      ? "Trial ends: " + new Date(data.trialEndsAt).toLocaleDateString()
      : "Trial active";
    el.innerHTML =
      '<span style="color:#86efac; font-weight:600;">Code active: ' +
      String(data.redeemedInvitationCode) +
      "</span> • " +
      trialText;
  }

  async function loadStatus() {
    try {
      const data = await request("/api/admin/invitation-codes/redeem-status");
      paintStatus(data);
      const input = document.getElementById("inviteRedeemInput");
      const btn = document.getElementById("inviteRedeemBtn");
      if (data?.redeemedInvitationCode && input && btn) {
        input.disabled = true;
        btn.disabled = true;
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function redeem() {
    const input = document.getElementById("inviteRedeemInput");
    const btn = document.getElementById("inviteRedeemBtn");
    const out = document.getElementById("inviteRedeemResult");
    if (!input || !btn || !out) return;
    const code = String(input.value || "").trim();
    if (!code) {
      out.innerHTML = '<span style="color:#fca5a5">Please enter a code.</span>';
      return;
    }
    btn.disabled = true;
    try {
      const data = await request("/api/admin/invitation-codes/redeem", "POST", { code });
      out.innerHTML =
        '<span style="color:#86efac; font-weight:700">Premium plan activated for 60 days.</span>' +
        (data?.trialEndsAt ? " Trial ends: " + new Date(data.trialEndsAt).toLocaleDateString() : "");
      input.disabled = true;
      btn.disabled = true;
    } catch (e) {
      btn.disabled = false;
      out.innerHTML = '<span style="color:#fca5a5">' + String(e?.message || "Activation failed") + "</span>";
    }
  }

  function init() {
    ensureCard();
    const btn = document.getElementById("inviteRedeemBtn");
    if (btn) btn.addEventListener("click", redeem);
    loadStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
