/**
 * Clinifly Meta Pixel — loads ID from /api/public/meta-pixel-config.js (META_PIXEL_ID on Railway).
 * Never uses META_APP_ID.
 */
(function () {
  "use strict";

  var PAGE = String(location.pathname || location.href || "unknown");

  function log(event, extra) {
    try {
      console.log(
        "[META_PIXEL]",
        Object.assign({ page: PAGE, event: event }, extra && typeof extra === "object" ? extra : {}),
      );
    } catch (_) {
      /* non-fatal */
    }
  }

  function getPixelId() {
    var fromWin = String(window.CLINIFLOW_META_PIXEL_ID || "").trim();
    if (fromWin) return fromWin;
    var meta = document.querySelector('meta[name="cliniflow-meta-pixel-id"]');
    if (meta) return String(meta.getAttribute("content") || "").trim();
    return "";
  }

  function installFbqStub() {
    if (window.fbq) return;
    var n = (window.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
  }

  function loadFbevents() {
    return new Promise(function (resolve, reject) {
      if (document.getElementById("cliniflow-fbevents")) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.id = "cliniflow-fbevents";
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("fbevents_load_failed"));
      };
      document.head.appendChild(s);
    });
  }

  var pageViewSent = false;

  function sendPageView() {
    if (!window.fbq || pageViewSent) return;
    window.fbq("track", "PageView");
    pageViewSent = true;
    log("pageViewSent", { pixelLoaded: true });
  }

  function initPixel() {
    var pixelId = getPixelId();
    var configErr = window.CLINIFLOW_META_PIXEL_CONFIG_ERROR || null;

    if (configErr) {
      log("pixelSkipped", { reason: configErr });
      return;
    }
    if (!pixelId) {
      log("pixelSkipped", { reason: "no_pixel_id" });
      return;
    }

    installFbqStub();
    loadFbevents()
      .then(function () {
        window.fbq("init", pixelId);
        log("pixelLoaded", { pixelIdPrefix: pixelId.slice(0, 6) });
        sendPageView();
      })
      .catch(function (e) {
        log("pixelLoadFailed", { message: e && e.message ? e.message : String(e) });
      });
  }

  function trackStandard(eventName, logKey) {
    if (!window.fbq) {
      log(logKey + "Skipped", { reason: "fbq_not_ready" });
      return false;
    }
    window.fbq("track", eventName);
    log(logKey, { pixelLoaded: true });
    return true;
  }

  window.CliniflowMetaPixel = {
    trackLead: function () {
      return trackStandard("Lead", "leadSent");
    },
    trackCompleteRegistration: function () {
      return trackStandard("CompleteRegistration", "registrationSent");
    },
    trackClinicRegistration: function () {
      return trackStandard("ClinicRegistration", "clinicRegistrationSent");
    },
    trackDoctorRegistration: function () {
      return trackStandard("DoctorRegistration", "doctorRegistrationSent");
    },
    trackPhotoUpload: function () {
      return trackStandard("PhotoUpload", "photoUploadSent");
    },
    trackContactClinic: function () {
      return trackStandard("ContactClinic", "contactClinicSent");
    },
    trackPageView: function () {
      sendPageView();
      return pageViewSent;
    },
  };

  function start() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initPixel);
    } else {
      initPixel();
    }
  }

  window.addEventListener("cliniflow-meta-pixel-config-ready", start);
  if (window.CLINIFLOW_META_PIXEL_CONFIG_READY) start();
  else setTimeout(start, 800);
})();
