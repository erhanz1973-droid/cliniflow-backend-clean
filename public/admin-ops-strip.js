/**
 * Admin footer — API resolution source + backend/frontend version visibility.
 * Requires api-base.js (cliniflowAdminApiOrigin, cliniflowGetApiResolution).
 */
(function () {
  "use strict";

  var FRONTEND_BUILD = "2026.05.18-v36";

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function apiOrigin() {
    if (typeof window.cliniflowAdminApiOrigin === "function") {
      return window.cliniflowAdminApiOrigin();
    }
    return "";
  }

  function resolutionLine() {
    var r =
      typeof window.cliniflowGetApiResolution === "function"
        ? window.cliniflowGetApiResolution()
        : null;
    if (!r) return "";
    var host = "";
    try {
      host = r.origin ? new URL(r.origin).host : "";
    } catch (_e) {}
    return (
      '<span class="al-ops-item" title="' +
      esc(r.origin || "") +
      '">API: <strong>' +
      esc(host || r.origin || "—") +
      "</strong></span>" +
      '<span class="al-ops-item">Source: <strong>' +
      esc(r.sourceLabel || r.source || "—") +
      "</strong></span>"
    );
  }

  function renderStrip(backend) {
    var el = document.getElementById("alOpsStrip");
    if (!el) return;

    var env =
      backend && backend.environment
        ? String(backend.environment)
        : "unknown";
    var region =
      (backend && (backend.region || backend.railwayRegion)) || "—";
    var apiVer =
      (backend && (backend.apiBuild || backend.version)) || "—";
    var commit = backend && backend.commit ? String(backend.commit).slice(0, 7) : "";
    var schema =
      backend && backend.schemaMigrationsHead
        ? backend.schemaMigrationsHead
        : "—";
    var ai =
      backend && backend.aiOrchestration === true
        ? "active"
        : backend && backend.aiOrchestration === false
          ? "off"
          : "—";
    var db =
      backend && backend.database
        ? backend.database.ok
          ? "connected"
          : "error"
        : "—";

    el.innerHTML =
      '<div class="al-ops-strip-inner">' +
      resolutionLine() +
      '<span class="al-ops-item">Backend: <strong>' +
      esc(env) +
      (region && region !== "—" ? " · " + esc(region) : "") +
      "</strong></span>" +
      '<span class="al-ops-item">API version: <strong>' +
      esc(apiVer) +
      (commit ? " (" + esc(commit) + ")" : "") +
      "</strong></span>" +
      '<span class="al-ops-item">Frontend: <strong>' +
      esc(FRONTEND_BUILD) +
      "</strong></span>" +
      '<span class="al-ops-item">DB schema: <strong>' +
      esc(schema) +
      "</strong>" +
      (db !== "—" ? " · " + esc(db) : "") +
      "</span>" +
      '<span class="al-ops-item">AI orchestration: <strong>' +
      esc(ai) +
      "</strong></span>" +
      "</div>";
  }

  function injectStyles() {
    if (document.getElementById("alOpsStripStyles")) return;
    var style = document.createElement("style");
    style.id = "alOpsStripStyles";
    style.textContent =
      "#alOpsStrip{position:fixed;bottom:0;left:0;right:0;z-index:40;background:#0f172a;color:#94a3b8;font-size:11px;border-top:1px solid #1e293b;padding:6px 12px 6px 240px;box-sizing:border-box}" +
      "body.al-ready #alMain{padding-bottom:36px}" +
      "@media (max-width:600px){#alOpsStrip{padding-left:12px}}" +
      ".al-ops-strip-inner{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}" +
      ".al-ops-item{white-space:nowrap}" +
      ".al-ops-item strong{color:#e2e8f0;font-weight:600}";
    document.head.appendChild(style);
  }

  function mount() {
    if (document.getElementById("alOpsStrip")) return;
    if (!document.body.classList.contains("al-ready")) return;
    injectStyles();
    var strip = document.createElement("footer");
    strip.id = "alOpsStrip";
    strip.setAttribute("aria-label", "Environment and API debug");
    strip.innerHTML = '<div class="al-ops-strip-inner">Loading environment…</div>';
    document.body.appendChild(strip);
    renderStrip(null);
    refreshBackend();
  }

  async function refreshBackend() {
    var origin = apiOrigin();
    if (!origin) return;
    try {
      var res = await fetch(origin.replace(/\/+$/, "") + "/api/health", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      var json = await res.json().catch(function () {
        return {};
      });
      if (json && json.ok) renderStrip(json);
    } catch (_e) {
      var el = document.getElementById("alOpsStrip");
      if (el) {
        var inner = el.querySelector(".al-ops-strip-inner");
        if (inner) {
          inner.insertAdjacentHTML(
            "beforeend",
            '<span class="al-ops-item" style="color:#f87171">Backend health: unreachable</span>',
          );
        }
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(mount, 0);
    });
  } else {
    setTimeout(mount, 0);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var obs = new MutationObserver(function () {
      if (document.body.classList.contains("al-ready")) {
        mount();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  });
})();
