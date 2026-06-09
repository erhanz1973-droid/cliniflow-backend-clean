/**
 * Clinic admin UI — impersonation warning banner + end session.
 */
(function () {
  var STORAGE_KEY = "cliniflow_impersonation";
  var BACKUP_SA_KEY = "super_admin_token_backup";

  function readMeta() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return j && j.active ? j : null;
    } catch (_) {
      return null;
    }
  }

  function writeMeta(meta) {
    try {
      if (!meta) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
    } catch (_) {
      /* ignore */
    }
  }

  function adminToken() {
    try {
      return localStorage.getItem("adminToken") || localStorage.getItem("admin_token") || "";
    } catch (_) {
      return "";
    }
  }

  function fetchUrl(path) {
    if (typeof window.adminFetchUrl === "function") return window.adminFetchUrl(path);
    if (typeof window.cliniflowAdminFetchUrl === "function") return window.cliniflowAdminFetchUrl(path);
    return path;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function clearClinicSession() {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("admin_token");
    localStorage.removeItem("clinic_code");
    localStorage.removeItem("clinic_name");
    localStorage.removeItem("user");
    localStorage.removeItem("selected_patient_id");
    writeMeta(null);
  }

  function restoreSuperAdminSession() {
    var backup = localStorage.getItem(BACKUP_SA_KEY) || "";
    if (backup) {
      localStorage.setItem("super_admin_token", backup);
    }
    localStorage.removeItem(BACKUP_SA_KEY);
  }

  async function endImpersonationSession(opts) {
    opts = opts || {};
    var token = adminToken();
    if (token) {
      try {
        await fetch(fetchUrl("/api/admin/impersonation/end"), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });
      } catch (_) {
        /* still restore locally */
      }
    }
    clearClinicSession();
    restoreSuperAdminSession();
    if (!opts.skipRedirect) {
      window.location.href = opts.redirectUrl || "/super-admin.html";
    }
  }

  function buildBanner(clinicName) {
    if (document.getElementById("cf-impersonation-banner")) return;
    var bar = document.createElement("div");
    bar.id = "cf-impersonation-banner";
    bar.setAttribute("role", "alert");
    bar.innerHTML =
      '<div class="cf-imp-inner">' +
      '<span class="cf-imp-dot" aria-hidden="true"></span>' +
      '<span class="cf-imp-text">You are currently viewing this account as <strong>' +
      esc(clinicName || "this clinic") +
      "</strong>.</span>" +
      '<div class="cf-imp-actions">' +
      '<button type="button" class="cf-imp-btn cf-imp-btn-primary" id="cfImpReturnAdmin">Return to Admin Account</button>' +
      '<button type="button" class="cf-imp-btn cf-imp-btn-ghost" id="cfImpEndSession">End Impersonation Session</button>' +
      "</div></div>";
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add("cf-impersonating");

    document.getElementById("cfImpReturnAdmin").addEventListener("click", function () {
      endImpersonationSession({ redirectUrl: "/super-admin.html" });
    });
    document.getElementById("cfImpEndSession").addEventListener("click", function () {
      endImpersonationSession({ redirectUrl: "/super-admin.html" });
    });
  }

  async function resolveStatus() {
    var meta = readMeta();
    var token = adminToken();
    if (!token && !meta) return null;

    try {
      var res = await fetch(fetchUrl("/api/admin/impersonation/status"), {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      });
      if (res.status === 401) return meta;
      var data = await res.json();
      if (!data.ok || !data.active) {
        if (meta) writeMeta(null);
        return null;
      }
      var next = {
        active: true,
        sessionId: data.sessionId,
        clinicId: data.clinicId,
        clinicCode: data.clinicCode,
        clinicName: data.clinicName,
        mode: data.mode || "support",
        startedAt: data.impersonationStartedAt,
        actorEmail: data.impersonatedBy,
      };
      writeMeta(next);
      return next;
    } catch (_) {
      return meta;
    }
  }

  async function initImpersonationBanner() {
    var p = window.location.pathname || "";
    if (p.includes("login") || p.includes("register") || p.includes("super-admin")) return;

    var meta = await resolveStatus();
    if (!meta || !meta.active) return;
    buildBanner(meta.clinicName || meta.clinicCode || "Clinic");
  }

  function consumeImpersonationHandoff() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      var token = params.get("cf_imp_token");
      if (!token) return;
      var clinicCode = String(params.get("cf_imp_clinic") || "").trim().toUpperCase();
      var clinicName = String(params.get("cf_imp_name") || clinicCode || "Clinic").trim();
      var sessionId = params.get("cf_imp_session") || null;
      localStorage.setItem("admin_token", token);
      localStorage.setItem("adminToken", token);
      if (clinicCode) localStorage.setItem("clinic_code", clinicCode);
      if (clinicName) localStorage.setItem("clinic_name", clinicName);
      localStorage.setItem(
        "user",
        JSON.stringify({
          role: "ADMIN",
          clinicCode: clinicCode,
          clinicName: clinicName,
          impersonation: true,
        }),
      );
      if (sessionId) {
        writeMeta({
          active: true,
          sessionId: sessionId,
          clinicCode: clinicCode,
          clinicName: clinicName,
          mode: "support",
        });
      }
      var clean = window.location.pathname + (window.location.hash || "");
      window.history.replaceState({}, document.title, clean);
    } catch (_) {
      /* ignore */
    }
  }

  window.endClinicImpersonation = endImpersonationSession;
  consumeImpersonationHandoff();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initImpersonationBanner);
  } else {
    initImpersonationBanner();
  }
})();
