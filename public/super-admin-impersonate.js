/**
 * Super Admin — Login as Clinic (impersonation) helper.
 * Requires super_admin_token in localStorage.
 */
(function (global) {
  function apiBase() {
    if (typeof cliniflowApiBase === "function") return cliniflowApiBase();
    return "";
  }

  function superAdminToken() {
    try {
      return localStorage.getItem("super_admin_token") || "";
    } catch (_) {
      return "";
    }
  }

  function persistImpersonationMeta(data) {
    try {
      localStorage.setItem(
        "cliniflow_impersonation",
        JSON.stringify({
          active: true,
          sessionId: data.sessionId,
          clinicId: data.clinicId,
          clinicCode: data.clinicCode,
          clinicName: data.clinicName,
          mode: data.mode || "support",
          startedAt: data.impersonationStartedAt || new Date().toISOString(),
          actorEmail: data.actor && data.actor.email ? data.actor.email : null,
        }),
      );
    } catch (_) {
      /* ignore */
    }
  }

  function persistClinicAdminSession(data) {
    const token = String(data.token || "").trim();
    if (!token) throw new Error("Missing impersonation token");
    const clinicCode = String(data.clinicCode || "").trim().toUpperCase();
    const clinicName = String(data.clinicName || clinicCode || "Clinic").trim();
    const saToken = superAdminToken();
    if (saToken) {
      localStorage.setItem("super_admin_token_backup", saToken);
    }
    localStorage.setItem("admin_token", token);
    localStorage.setItem("adminToken", token);
    localStorage.setItem("clinic_code", clinicCode);
    localStorage.setItem("clinic_name", clinicName);
    localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ADMIN",
        clinicCode,
        clinicName,
        impersonation: true,
        impersonationMode: data.mode || "support",
      }),
    );
    persistImpersonationMeta(data);
  }

  async function startClinicImpersonation(clinicId, options) {
    options = options || {};
    const id = String(clinicId || "").trim();
    if (!id) throw new Error("Clinic ID required");
    const token = superAdminToken();
    if (!token) {
      window.location.href = "/super-admin-login.html";
      return;
    }
    const res = await fetch(
      apiBase() + "/api/super-admin/clinics/" + encodeURIComponent(id) + "/impersonate",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ mode: options.mode || "support" }),
      },
    );
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || "Impersonation failed");
    }
    persistClinicAdminSession(data);
    var redirect = data.redirectUrl || "/admin.html";
    try {
      if (/^https?:\/\//i.test(redirect)) {
        var target = new URL(redirect);
        if (target.origin !== window.location.origin) {
          target.searchParams.set("cf_imp_token", token);
          target.searchParams.set("cf_imp_clinic", clinicCode);
          target.searchParams.set("cf_imp_name", clinicName);
          if (data.sessionId) target.searchParams.set("cf_imp_session", data.sessionId);
          redirect = target.toString();
        }
      }
    } catch (_) {
      /* use redirect as-is */
    }
    window.location.href = redirect;
  }

  global.startClinicImpersonation = startClinicImpersonation;
  global.persistClinicAdminSession = persistClinicAdminSession;
})(typeof window !== "undefined" ? window : global);
