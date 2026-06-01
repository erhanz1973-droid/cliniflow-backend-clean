/**
 * Shared clinic patient-invitation UI — QR modal, copy, download, print.
 * Used on dashboard, Patients → Invite Patients, and patients list quick bar.
 */
(function (global) {
  "use strict";

  var state = {
    loaded: false,
    clinicName: "",
    clinicCode: "",
    webUrl: "",
    /** Public PNG URL (no auth — safe for &lt;img&gt;) */
    qrSrc: "",
    /** Blob URL after fetch — used for modal / preview / download */
    qrObjectUrl: "",
  };

  function t(key, fallback) {
    if (global.i18n && typeof global.i18n.t === "function") {
      var v = global.i18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  function getApiBase() {
    if (typeof global.cliniflowAdminApiOrigin === "function") {
      var o = global.cliniflowAdminApiOrigin();
      if (o) return String(o).replace(/\/+$/, "");
    }
    if (global.API_BASE) return String(global.API_BASE).replace(/\/+$/, "");
    if (global.API) return String(global.API).replace(/\/+$/, "");
    return "";
  }

  function getToken() {
    try {
      return (
        localStorage.getItem("adminToken") ||
        localStorage.getItem("admin_token") ||
        ""
      );
    } catch (_e) {
      return "";
    }
  }

  function fetchJson(path) {
    var API = getApiBase();
    var token = getToken();
    return fetch(API + path, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    }).then(function (res) {
      if (res.status === 401 && typeof global.handle401 === "function") {
        global.handle401(401);
      }
      return res;
    });
  }

  function ensureModal() {
    if (document.getElementById("clinicInviteModal")) return;
    var wrap = document.createElement("div");
    wrap.id = "clinicInviteModal";
    wrap.className = "ci-modal-overlay";
    wrap.style.display = "none";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML =
      '<div class="ci-modal">' +
      '  <div class="ci-modal-header">' +
      '    <h3 id="ciModalTitle">' +
      t("patientInvite.modalTitle", "Patient invitation") +
      "</h3>" +
      '    <button type="button" class="ci-modal-close" id="ciModalClose" aria-label="Close">&times;</button>' +
      "  </div>" +
      '  <div class="ci-modal-body">' +
      '    <p class="ci-clinic-label" id="ciClinicLabel"></p>' +
      '    <div class="ci-qr-wrap"><img id="ciModalQr" class="ci-qr-large" alt="Invitation QR" width="280" height="280"/><p id="ciModalQrError" style="display:none;color:#b91c1c;font-size:13px;margin:8px 0 0;">' +
      t("patientInvite.qrLoadError", "QR could not be loaded. Try again or use Copy Link.") +
      "</p></div>" +
      '    <label class="ci-url-label">' +
      t("patientInvite.invitationUrl", "Invitation URL") +
      "</label>" +
      '    <input type="text" id="ciModalUrl" class="ci-url-input" readonly/>' +
      "  </div>" +
      '  <div class="ci-modal-footer">' +
      '    <button type="button" class="ci-btn ci-btn-primary" id="ciModalCopy">' +
      t("patientInvite.copyLink", "Copy Link") +
      "</button>" +
      '    <button type="button" class="ci-btn ci-btn-secondary" id="ciModalDownload">' +
      t("patientInvite.downloadQr", "Download QR") +
      "</button>" +
      '    <button type="button" class="ci-btn ci-btn-secondary" id="ciModalPrint">' +
      t("patientInvite.printPoster", "Print Poster") +
      "</button>" +
      "  </div>" +
      "</div>";
    document.body.appendChild(wrap);

    document.getElementById("ciModalClose").addEventListener("click", closeModal);
    wrap.addEventListener("click", function (e) {
      if (e.target === wrap) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && wrap.style.display !== "none") closeModal();
    });
    document.getElementById("ciModalCopy").addEventListener("click", copyLink);
    document.getElementById("ciModalDownload").addEventListener("click", downloadQr);
    document.getElementById("ciModalPrint").addEventListener("click", printPoster);

    if (!document.getElementById("ci-invite-styles")) {
      var style = document.createElement("style");
      style.id = "ci-invite-styles";
      style.textContent =
        ".ci-modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:10050;padding:16px;}" +
        ".ci-modal{background:#fff;border-radius:16px;width:min(440px,96vw);max-height:92vh;overflow:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,.35);}" +
        ".ci-modal-header{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e2e8f0;}" +
        ".ci-modal-header h3{margin:0;font-size:18px;font-weight:700;color:#0f172a;}" +
        ".ci-modal-close{background:none;border:none;font-size:28px;line-height:1;color:#64748b;cursor:pointer;padding:0 6px;}" +
        ".ci-modal-body{padding:20px;text-align:center;}" +
        ".ci-clinic-label{font-size:14px;color:#64748b;margin:0 0 12px;}" +
        ".ci-clinic-label strong{display:block;font-size:20px;color:#0f172a;margin-top:4px;}" +
        ".ci-qr-wrap{display:inline-block;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;}" +
        ".ci-qr-large{display:block;width:280px;height:280px;max-width:100%;}" +
        ".ci-url-label{display:block;text-align:left;font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px;}" +
        ".ci-url-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;color:#0f172a;background:#f8fafc;}" +
        ".ci-modal-footer{display:flex;flex-wrap:wrap;gap:8px;padding:16px 20px;border-top:1px solid #e2e8f0;justify-content:center;}" +
        ".ci-btn{padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;}" +
        ".ci-btn-primary{background:#2563eb;color:#fff;}" +
        ".ci-btn-secondary{background:#e2e8f0;color:#0f172a;}" +
        ".patient-invite-quick{margin-bottom:16px;}" +
        ".patient-invite-quick h2{margin:0 0 8px;font-size:17px;}" +
        ".patient-invite-quick p{margin:0 0 14px;font-size:13px;color:#64748b;line-height:1.45;}" +
        ".patient-invite-actions{display:flex;flex-wrap:wrap;gap:8px;}" +
        ".patient-invite-actions .ci-btn{text-decoration:none;display:inline-block;}" +
        ".invite-page-hero{text-align:center;padding:8px 0 24px;}" +
        ".invite-page-hero h1{margin:0 0 8px;font-size:26px;}" +
        ".invite-page-hero p{color:#64748b;margin:0 0 20px;}" +
        ".invite-page-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:24px;}" +
        ".invite-page-preview{max-width:320px;margin:0 auto;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;}" +
        ".invite-page-preview img{width:200px;height:200px;display:block;margin:0 auto 12px;}";
      document.head.appendChild(style);
    }
  }

  function buildPublicQrUrl(clinicCode) {
    var code = String(clinicCode || "").trim();
    if (!code) return "";
    return (
      getApiBase() +
      "/api/public/clinic-invite/" +
      encodeURIComponent(code) +
      "/qr.png"
    );
  }

  function revokeQrObjectUrl() {
    if (state.qrObjectUrl) {
      try {
        URL.revokeObjectURL(state.qrObjectUrl);
      } catch (_e) {
        /* ignore */
      }
      state.qrObjectUrl = "";
    }
  }

  function wireQrImg(img, placeholder) {
    if (!img) return;
    img.onerror = function () {
      console.warn("[patientInvite] QR image failed to load", state.qrSrc);
      img.style.display = "none";
      if (placeholder) placeholder.style.display = "flex";
    };
    img.onload = function () {
      img.style.display = "block";
      if (placeholder) placeholder.style.display = "none";
    };
  }

  function setQrOnElement(img, placeholder) {
    if (!img) return;
    var src = state.qrObjectUrl || state.qrSrc;
    if (!src) {
      img.style.display = "none";
      if (placeholder) placeholder.style.display = "flex";
      return;
    }
    wireQrImg(img, placeholder);
    img.src = src;
  }

  /** &lt;img&gt; cannot send Bearer token — load PNG via fetch (public, then admin fallback). */
  function hydrateQrImages() {
    var code = state.clinicCode;
    if (!code) return Promise.resolve();
    state.qrSrc = buildPublicQrUrl(code);

    function blobToObjectUrl(blob) {
      revokeQrObjectUrl();
      state.qrObjectUrl = URL.createObjectURL(blob);
      return state.qrObjectUrl;
    }

    var publicUrl = state.qrSrc + "?ts=" + Date.now();
    return fetch(publicUrl, { credentials: "omit" })
      .then(function (res) {
        if (res.ok) return res.blob();
        var token = getToken();
        if (!token) throw new Error("qr_unauthorized");
        return fetch(getApiBase() + "/api/admin/clinic-invitation/qr.png?ts=" + Date.now(), {
          headers: { Authorization: "Bearer " + token },
        }).then(function (r2) {
          if (!r2.ok) throw new Error("qr_http_" + r2.status);
          return r2.blob();
        });
      })
      .then(function (blob) {
        if (!blob || blob.size < 50) throw new Error("qr_empty");
        blobToObjectUrl(blob);
        setQrOnElement(document.getElementById("inviteQrImg"), document.getElementById("inviteQrPlaceholder"));
        setQrOnElement(document.getElementById("invitePageQr"), document.getElementById("invitePageQrPh"));
        setQrOnElement(document.getElementById("ciModalQr"), null);
        console.log("[patientInvite] QR loaded", { clinicCode: code, bytes: blob.size });
        var errEl = document.getElementById("ciModalQrError");
        if (errEl) errEl.style.display = "none";
      })
      .catch(function (err) {
        console.error("[patientInvite] QR hydrate failed:", err?.message || err);
        revokeQrObjectUrl();
        ["inviteQrImg", "invitePageQr", "ciModalQr"].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.style.display = "none";
        });
        var errEl = document.getElementById("ciModalQrError");
        if (errEl) errEl.style.display = "block";
      });
  }

  function refreshModalContent() {
    var label = document.getElementById("ciClinicLabel");
    var urlInput = document.getElementById("ciModalUrl");
    var qr = document.getElementById("ciModalQr");
    if (label) {
      label.innerHTML =
        t("patientInvite.clinicLabel", "Clinic") +
        ": <strong>" +
        escapeHtml(state.clinicName || state.clinicCode) +
        "</strong>";
    }
    if (urlInput) urlInput.value = state.webUrl || "";
    setQrOnElement(qr, null);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function openModal() {
    ensureModal();
    refreshModalContent();
    if (state.clinicCode && !state.qrObjectUrl) {
      hydrateQrImages().then(function () {
        refreshModalContent();
      });
    }
    var el = document.getElementById("clinicInviteModal");
    if (el) el.style.display = "flex";
  }

  function closeModal() {
    var el = document.getElementById("clinicInviteModal");
    if (el) el.style.display = "none";
  }

  function copyLink(btn) {
    var text = state.webUrl || "";
    if (!text) return;
    var done = function () {
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = t("patientInvite.copied", "Copied!");
        setTimeout(function () {
          btn.textContent = orig;
        }, 2000);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        alert(text);
      });
    } else {
      alert(text);
    }
  }

  function downloadQr() {
    var href = state.qrObjectUrl || state.qrSrc;
    if (!href) return;
    var a = document.createElement("a");
    a.href = href;
    a.download = "clinifly-invite-" + (state.clinicCode || "clinic") + ".png";
    a.click();
  }

  function printPoster() {
    var qrForPrint = state.qrObjectUrl || state.qrSrc;
    if (!qrForPrint) return;
    var clinicName = escapeHtml(state.clinicName || state.clinicCode || "Clinic");
    var w = global.open("", "_blank");
    if (!w) return alert(t("patientInvite.allowPopups", "Allow pop-ups to print the poster."));
    w.document.write(
      "<!DOCTYPE html><html><head><title>Clinifly Invitation</title>" +
        "<style>body{font-family:system-ui;text-align:center;padding:40px;} h1{font-size:28px;} img{width:280px;height:280px;} p{font-size:16px;color:#444;}</style></head><body>" +
        "<h1>" +
        clinicName +
        "</h1>" +
        "<p>" +
        t("patientInvite.posterTagline", "Scan to join our clinic on Clinifly") +
        "</p>" +
        '<img src="' +
        qrForPrint +
        '" alt="QR"/>' +
        "<p style='font-size:14px;margin-top:24px;'>" +
        escapeHtml(state.webUrl) +
        "</p></body></html>",
    );
    w.document.close();
    w.focus();
    setTimeout(function () {
      w.print();
    }, 500);
  }

  function bindActionButtons(root) {
    if (!root) return;
    root.querySelectorAll("[data-ci-action]").forEach(function (btn) {
      if (btn._ciBound) return;
      btn._ciBound = true;
      btn.addEventListener("click", function () {
        var action = btn.getAttribute("data-ci-action");
        if (action === "copy") copyLink(btn);
        else if (action === "show-qr") openModal();
        else if (action === "download") downloadQr();
        else if (action === "print") printPoster();
      });
    });
  }

  function actionButton(action, extraClass) {
    var labels = {
      copy: t("patientInvite.copyLink", "Copy Invitation Link"),
      "show-qr": t("patientInvite.showQr", "Show QR Code"),
      download: t("patientInvite.downloadQr", "Download QR"),
      print: t("patientInvite.printPoster", "Print Poster"),
    };
    var cls = "ci-btn " + (action === "copy" ? "ci-btn-primary" : "ci-btn-secondary");
    if (extraClass) cls += " " + extraClass;
    return (
      '<button type="button" class="' +
      cls +
      '" data-ci-action="' +
      action +
      '">' +
      labels[action] +
      "</button>"
    );
  }

  function mountQuickBar(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.className = (el.className || "") + " card patient-invite-quick";
    el.innerHTML =
      "<h2>" +
      t("patientInvite.quickTitle", "Invite patients") +
      "</h2>" +
      "<p>" +
      t(
        "patientInvite.quickHint",
        "Share your clinic link or QR so patients join automatically — no manual clinic code.",
      ) +
      "</p>" +
      '<div class="patient-invite-actions">' +
      actionButton("copy") +
      actionButton("show-qr") +
      actionButton("download") +
      actionButton("print") +
      '<a href="/admin-invite-patients.html" class="ci-btn ci-btn-secondary">' +
      t("patientInvite.openFullPage", "Open invite page") +
      "</a>" +
      "</div>";
    bindActionButtons(el);
  }

  function mountDashboardCard(containerId) {
    var card = document.getElementById(containerId);
    if (!card) return;
    var inner =
      card.querySelector(".ci-dashboard-inner") ||
      (function () {
        var d = document.createElement("div");
        d.className = "ci-dashboard-inner";
        while (card.firstChild) d.appendChild(card.firstChild);
        card.appendChild(d);
        return d;
      })();
    inner.innerHTML =
      "<h2 style=\"margin-top:0;\">📲 " +
      t("patientInvite.dashboardTitle", "Patient Invitation") +
      "</h2>" +
      "<p style=\"color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 16px;\">" +
      t(
        "patientInvite.quickHint",
        "Share your clinic link or QR so patients join automatically — no manual clinic code.",
      ) +
      "</p>" +
      '<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;">' +
      '  <div style="flex:0 0 auto;text-align:center;">' +
      '    <img id="inviteQrImg" alt="Invitation QR" width="180" height="180" style="background:#fff;border-radius:12px;padding:8px;display:none;"/>' +
      '    <div id="inviteQrPlaceholder" style="width:180px;height:180px;background:#0b1220;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">QR</div>' +
      "  </div>" +
      '  <div style="flex:1;min-width:240px;">' +
      '    <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;">' +
      t("patientInvite.invitationUrl", "Invitation URL") +
      "</label>" +
      '    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '      <input id="inviteUrlInput" type="text" readonly style="flex:1;min-width:180px;padding:10px 12px;border-radius:8px;border:1px solid var(--b);background:#0b1220;color:#e6eaf2;font-size:13px;"/>' +
      '      <button type="button" data-ci-action="copy" class="ci-btn ci-btn-primary" id="inviteCopyBtn">' +
      t("patientInvite.copyLink", "Copy Link") +
      "</button>" +
      "    </div>" +
      '    <div class="patient-invite-actions">' +
      actionButton("show-qr") +
      actionButton("download") +
      actionButton("print") +
      "</div>" +
      '    <p id="inviteCodeHint" style="margin:12px 0 0;font-size:12px;color:var(--muted);"></p>' +
      "  </div>" +
      "</div>";
    bindActionButtons(card);
  }

  function applyLoadedData(data) {
    var inv = data.invitation || {};
    state.clinicName = data.clinicName || inv.clinicName || "";
    state.clinicCode = data.clinicCode || inv.clinicCode || "";
    state.webUrl = inv.webUrl || "";
    state.qrSrc = buildPublicQrUrl(state.clinicCode);
    state.loaded = true;

    var urlInput = document.getElementById("inviteUrlInput");
    if (urlInput) urlInput.value = state.webUrl;
    var hint = document.getElementById("inviteCodeHint");
    if (hint) {
      hint.textContent =
        t("patientInvite.codeHint", "Clinic code: {code}").replace(
          "{code}",
          state.clinicCode,
        ) +
        " · " +
        t(
          "patientInvite.codeHintSuffix",
          "Patients who scan the QR are linked to your clinic after signup.",
        );
    }
    var pageUrl = document.getElementById("invitePageUrl");
    if (pageUrl) pageUrl.value = state.webUrl;
    var pageClinic = document.getElementById("invitePageClinic");
    if (pageClinic) {
      pageClinic.textContent = state.clinicName || state.clinicCode;
    }

    refreshModalContent();
    hydrateQrImages();

    ["patientInviteQuickBar", "patientInvitationCard", "invitePatientsPage"].forEach(
      function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = "block";
      },
    );
  }

  function load() {
    var token = getToken();
    if (!token) return Promise.resolve(null);
    return fetchJson("/api/admin/clinic-invitation")
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) return null;
        applyLoadedData(data);
        return data;
      })
      .catch(function (e) {
        console.error("[patientInvite] load error:", e);
        return null;
      });
  }

  global.ClinicInvitationAdmin = {
    load: load,
    openModal: openModal,
    closeModal: closeModal,
    copyLink: copyLink,
    downloadQr: downloadQr,
    printPoster: printPoster,
    mountQuickBar: mountQuickBar,
    mountDashboardCard: mountDashboardCard,
    mountInvitePage: function () {
      var page = document.getElementById("invitePatientsPage");
      if (!page) return;
      page.innerHTML =
        '<div class="invite-page-hero">' +
        "<h1>" +
        t("patientInvite.pageTitle", "Invite Patients") +
        "</h1>" +
        "<p>" +
        t(
          "patientInvite.pageSubtitle",
          "Share your invitation link or QR code. New patients are linked to your clinic automatically after signup.",
        ) +
        "</p>" +
        "</div>" +
        '<div class="invite-page-actions">' +
        actionButton("copy") +
        actionButton("show-qr") +
        actionButton("download") +
        actionButton("print") +
        "</div>" +
        '<div class="invite-page-preview">' +
        '<p class="ci-clinic-label" style="margin-bottom:12px;">' +
        t("patientInvite.clinicLabel", "Clinic") +
        ': <strong id="invitePageClinic">—</strong></p>' +
        '<div id="invitePageQrPh" style="width:200px;height:200px;margin:0 auto 12px;background:#e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#64748b;">QR</div>' +
        '<img id="invitePageQr" alt="QR" width="200" height="200" style="display:none;margin:0 auto 12px;"/>' +
        '<label class="ci-url-label">' +
        t("patientInvite.invitationUrl", "Invitation URL") +
        "</label>" +
        '<input type="text" id="invitePageUrl" class="ci-url-input" readonly/>' +
        "</div>";
      bindActionButtons(page);
    },
    getState: function () {
      return state;
    },
  };

  document.addEventListener("i18n:ready", function () {
    if (state.loaded) refreshModalContent();
  });
  document.addEventListener("admin-language-changed", function () {
    if (state.loaded) refreshModalContent();
  });
})(window);
