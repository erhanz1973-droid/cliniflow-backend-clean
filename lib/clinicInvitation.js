/**
 * Clinic QR / invite URL onboarding — public invite URLs, patient_clinic_links, admin QR.
 */

const { supabase, isSupabaseEnabled, getClinicByCode } = require("./supabase");

const INVITE_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

const IOS_STORE_URL =
  process.env.CLINIFLY_IOS_STORE_URL ||
  "https://apps.apple.com/us/app/clinifly-patient-clinic-app/id6761667892";
const ANDROID_STORE_URL =
  process.env.CLINIFLY_ANDROID_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.clinifly.mobile&hl=en";

function normalizeInviteCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function isValidInviteCode(code) {
  const c = normalizeInviteCode(code);
  return Boolean(c) && INVITE_CODE_RE.test(c);
}

function resolvePublicBaseUrl(req) {
  const fromEnv = String(
    process.env.PUBLIC_INVITE_BASE_URL ||
      process.env.RAILWAY_PUBLIC_URL ||
      process.env.PUBLIC_API_URL ||
      "",
  )
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (req) {
    const host = (req.get("x-forwarded-host") || req.get("host") || "")
      .split(",")[0]
      .trim();
    const proto =
      String(req.get("x-forwarded-proto") || req.protocol || "https")
        .split(",")[0]
        .trim() || "https";
    if (host) return `${proto}://${host}`;
  }
  return "https://cliniflow-backend-clean-production.up.railway.app";
}

function buildAndroidPlayStoreUrl(clinicCode) {
  const base = ANDROID_STORE_URL;
  const ref = encodeURIComponent(`invite=${normalizeInviteCode(clinicCode)}`);
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}referrer=${ref}`;
}

/**
 * Deep link that opens an existing route on store builds (e.g. 125.6 / 65).
 * `/invite/CODE` was unmatched until invite/[code] shipped — register-patient is stable.
 */
function buildAppDeepLink(clinicCode) {
  const code = normalizeInviteCode(clinicCode);
  const q = new URLSearchParams({
    prefillClinicCode: code,
    fromClinicInvite: "1",
  }).toString();
  return `clinifly:///register-patient?${q}`;
}

/** Chrome/Android: open app or fall back to Play Store in one navigation. */
function buildAndroidIntentUrl(clinicCode, playStoreUrl) {
  const code = normalizeInviteCode(clinicCode);
  const q = new URLSearchParams({
    prefillClinicCode: code,
    fromClinicInvite: "1",
  }).toString();
  const path = `register-patient?${q}`;
  const fallback = encodeURIComponent(playStoreUrl || ANDROID_STORE_URL);
  return `intent://${path}#Intent;scheme=clinifly;package=com.clinifly.mobile;S.browser_fallback_url=${fallback};end`;
}

function buildInviteUrls(clinicCode, req) {
  const code = normalizeInviteCode(clinicCode);
  const base = resolvePublicBaseUrl(req);
  const invitePath = `/invite/${encodeURIComponent(code)}`;
  const androidStoreUrl = buildAndroidPlayStoreUrl(code);
  const appDeepLink = buildAppDeepLink(code);
  return {
    clinicCode: code,
    invitePath,
    webUrl: `${base}${invitePath}`,
    appDeepLink,
    /** Welcome screen (requires app build with clinic-invite route). */
    appDeepLinkWelcome: `clinifly://clinic-invite/${encodeURIComponent(code)}`,
    /** Path-style invite (requires invite/[code] route in the mobile app). */
    appDeepLinkInvitePath: `clinifly://invite/${encodeURIComponent(code)}`,
    appDeepLinkLegacy: `clinifly://clinic-invite/${encodeURIComponent(code)}`,
    iosStoreUrl: IOS_STORE_URL,
    androidStoreUrl,
    androidIntentUrl: buildAndroidIntentUrl(code, androidStoreUrl),
  };
}

async function fetchClinicInvitePreview(code) {
  const normalized = normalizeInviteCode(code);
  if (!isValidInviteCode(normalized)) {
    return { ok: false, error: "invalid_invite_code" };
  }
  if (!isSupabaseEnabled()) {
    return { ok: false, error: "supabase_unavailable" };
  }
  const clinic = await getClinicByCode(normalized);
  if (!clinic?.id) {
    return { ok: false, error: "clinic_not_found" };
  }
  let logoUrl = null;
  try {
    const settings =
      typeof clinic.settings === "string"
        ? JSON.parse(clinic.settings)
        : clinic.settings;
    logoUrl =
      settings?.logoUrl ||
      settings?.logo_url ||
      clinic.logo_url ||
      clinic.logo ||
      null;
    if (logoUrl) logoUrl = String(logoUrl).trim();
  } catch (_e) {
    /* ignore */
  }

  return {
    ok: true,
    clinic: {
      id: clinic.id,
      name: clinic.name || clinic.clinic_name || normalized,
      clinicCode: clinic.clinic_code || normalized,
      city: clinic.city || null,
      country: clinic.country || null,
      logoUrl: logoUrl || null,
    },
  };
}

function loadQrCodeModule() {
  try {
    return require("qrcode");
  } catch (_e) {
    return null;
  }
}

/**
 * @param {string} targetUrl — encoded in the QR (invite web URL)
 * @returns {Promise<Buffer|null>}
 */
async function generateInviteQrPngBuffer(targetUrl) {
  const QRCode = loadQrCodeModule();
  if (!QRCode || !targetUrl) return null;
  try {
    return await QRCode.toBuffer(String(targetUrl), {
      type: "png",
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
    });
  } catch (e) {
    console.error("[INVITE_QR_RENDER] generate_failed", e?.message || e);
    return null;
  }
}

function buildPublicInviteQrUrl(req, clinicCode) {
  const base = resolvePublicBaseUrl(req);
  const code = normalizeInviteCode(clinicCode);
  return `${base}/api/public/clinic-invite/${encodeURIComponent(code)}/qr.png`;
}

function logInviteQrRender({ clinicCode, qrUrl, rendered, reason }) {
  console.log(
    "[INVITE_QR_RENDER]",
    JSON.stringify({
      clinicCode: clinicCode || null,
      qrUrl: qrUrl || null,
      rendered: Boolean(rendered),
      ...(reason ? { reason } : {}),
    }),
  );
}

function isMissingPatientClinicLinksTable(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("patient_clinic_links") ||
    msg.includes("does not exist")
  );
}

/**
 * Upsert membership row after registration / OAuth link.
 * @param {{ patientId: string, clinicId: string, joinedViaInvitation?: boolean }} params
 */
async function upsertPatientClinicLink(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const joinedViaInvitation = Boolean(params.joinedViaInvitation);
  if (!patientId || !clinicId || !isSupabaseEnabled()) {
    return { ok: false, skipped: true };
  }
  try {
    const row = {
      patient_id: patientId,
      clinic_id: clinicId,
      joined_via_invitation: joinedViaInvitation,
    };
    const { data, error } = await supabase
      .from("patient_clinic_links")
      .upsert(row, { onConflict: "patient_id,clinic_id" })
      .select("id, joined_via_invitation, created_at")
      .maybeSingle();
    if (error) {
      if (isMissingPatientClinicLinksTable(error)) {
        console.warn("[CLINIC_INVITE] patient_clinic_links table missing — run migration");
        return { ok: false, skipped: true, reason: "table_missing" };
      }
      console.error("[CLINIC_INVITE] upsert failed:", error.message || error);
      return { ok: false, error: error.message || "upsert_failed" };
    }
    return { ok: true, link: data };
  } catch (e) {
    console.error("[CLINIC_INVITE] upsert exception:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

function patientJoinedViaInvitation(body) {
  const b = body || {};
  if (b.joinedViaInvitation === true || b.joined_via_invitation === true) return true;
  const src = String(b.invitationSource || b.inviteSource || "").trim().toLowerCase();
  return src === "clinic_qr" || src === "clinic_invite" || src === "invite_url";
}

function renderInviteLandingHtml({ clinic, urls, qr }) {
  const name = clinic?.name || urls.clinicCode;
  const code = urls.clinicCode;
  const cookieVal = encodeURIComponent(code);
  const qrRendered = Boolean(qr?.rendered && qr?.url);
  const logoUrl = clinic?.logoUrl ? String(clinic.logoUrl).trim() : "";
  const logoBlock = logoUrl
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name)} logo" onerror="this.style.display='none'"/>`
    : `<div class="logo-fallback" aria-hidden="true">${escapeHtml(name.charAt(0) || "C")}</div>`;

  const qrBlock = qrRendered
    ? `<div class="qr-wrap">
        <img class="qr" src="${escapeHtml(qr.url)}" width="220" height="220" alt="QR code for ${escapeHtml(name)} invitation"/>
      </div>
      <p class="hint">Scan this QR code with another device or reopen this page after installing Clinifly.</p>`
    : `<p class="hint">After installing Clinifly, reopen this page to continue signup.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="apple-itunes-app" content="app-id=6761667892, app-argument=${escapeHtml(urls.appDeepLink)}"/>
  <title>Join ${escapeHtml(name)} on Clinifly</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:0;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{max-width:440px;width:100%;background:#1e293b;border-radius:16px;padding:28px;box-shadow:0 8px 32px rgba(0,0,0,.35);text-align:center;}
    h1{font-size:24px;margin:0 0 16px;font-weight:800;}
    .logo{width:72px;height:72px;border-radius:16px;object-fit:cover;margin:0 auto 16px;display:block;background:#0f172a;}
    .logo-fallback{width:72px;height:72px;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;background:#2563eb;color:#fff;font-size:32px;font-weight:700;}
    .lead{color:#94a3b8;font-size:15px;line-height:1.55;margin:0 0 24px;}
    a.btn{display:block;margin:10px 0;padding:14px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;}
    .primary{background:#2563eb;color:#fff;}
    .secondary{background:#334155;color:#e2e8f0;}
    .stores{display:flex;gap:10px;margin-top:8px;}
    .stores a{flex:1;font-size:14px;padding:12px 8px;}
    .qr-wrap{margin:20px auto 12px;padding:12px;background:#fff;border-radius:12px;display:inline-block;}
    .qr{display:block;width:220px;height:220px;}
    .hint{font-size:13px;color:#64748b;margin:0 0 8px;line-height:1.45;}
  </style>
</head>
<body>
  <div class="card">
    <h1>Welcome to ${escapeHtml(name)}</h1>
    ${logoBlock}
    <p class="lead">Create your Clinifly account to communicate with ${escapeHtml(name)}, receive treatment updates and manage appointments.</p>
    <a class="btn primary" id="openApp" href="${escapeHtml(urls.appDeepLink)}">Open Clinifly App</a>
    <p class="hint" id="storeHint" style="display:none;">Redirecting to the app store…</p>
    ${qrBlock}
    <div class="stores" id="storeButtons">
      <a class="btn secondary" id="iosStoreBtn" href="${escapeHtml(urls.iosStoreUrl)}">App Store</a>
      <a class="btn secondary" id="androidStoreBtn" href="${escapeHtml(urls.androidStoreUrl)}">Google Play</a>
    </div>
  </div>
  <script>
    document.cookie = "cf_clinic_invite=${cookieVal}; path=/; max-age=2592000; SameSite=Lax";
    try { localStorage.setItem("cf_clinic_invite", ${JSON.stringify(code)}); } catch (e) {}
    var clinicCode = ${JSON.stringify(code)};
    var appLink = ${JSON.stringify(urls.appDeepLink)};
    var androidIntent = ${JSON.stringify(urls.androidIntentUrl || urls.appDeepLink)};
    var iosStore = ${JSON.stringify(urls.iosStoreUrl)};
    var androidStore = ${JSON.stringify(urls.androidStoreUrl)};
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/i.test(ua);
    var isMobile = isIOS || isAndroid;
    var storeUrl = isIOS ? iosStore : (isAndroid ? androidStore : null);
    var appOpened = false;
    function logInvite(event, extra) {
      try {
        console.log("[INVITE_LANDING]", JSON.stringify(Object.assign({ event: event, clinicCode: clinicCode, isIOS: isIOS, isAndroid: isAndroid }, extra || {})));
      } catch (e) {}
    }
    function markAppOpened() { appOpened = true; }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") markAppOpened();
    });
    window.addEventListener("pagehide", markAppOpened);
    window.addEventListener("blur", markAppOpened);
    function goStore(reason) {
      if (!storeUrl) return;
      logInvite("redirect_store", { reason: reason || "fallback", storeUrl: storeUrl });
      var hint = document.getElementById("storeHint");
      if (hint) { hint.style.display = "block"; }
      window.location.replace(storeUrl);
    }
    function tryOpenApp(reason) {
      if (!isMobile) {
        logInvite("stay_web_desktop", { reason: reason });
        return;
      }
      logInvite("try_open_app", { reason: reason, target: isAndroid ? "intent" : "deeplink" });
      var openBtn = document.getElementById("openApp");
      if (openBtn) openBtn.textContent = isIOS ? "Open in App Store" : "Get Clinifly on Google Play";
      window.location.href = isAndroid ? androidIntent : appLink;
      setTimeout(function () {
        if (!appOpened && storeUrl) goStore("app_not_installed_timeout");
      }, 2200);
    }
    var openBtn = document.getElementById("openApp");
    if (openBtn) {
      if (isMobile) openBtn.textContent = "Get Clinifly App";
      openBtn.addEventListener("click", function (e) {
        e.preventDefault();
        tryOpenApp("button_click");
      });
    }
    if (isIOS) {
      var ab = document.getElementById("androidStoreBtn");
      if (ab) ab.style.display = "none";
    } else if (isAndroid) {
      var ib = document.getElementById("iosStoreBtn");
      if (ib) ib.style.display = "none";
    }
    logInvite("page_view", { storeUrl: storeUrl });
    setTimeout(function () { tryOpenApp("auto_mobile"); }, 600);
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function registerClinicInvitationRoutes(app, { requireAdminAuth }) {
  app.get("/api/public/clinic-invite/:code", async (req, res) => {
    try {
      const preview = await fetchClinicInvitePreview(req.params.code);
      if (!preview.ok) {
        const status =
          preview.error === "clinic_not_found"
            ? 404
            : preview.error === "invalid_invite_code"
              ? 400
              : 503;
        return res.status(status).json({ ok: false, error: preview.error });
      }
      const urls = buildInviteUrls(preview.clinic.clinicCode, req);
      return res.json({
        ok: true,
        clinic: preview.clinic,
        invitation: urls,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
    }
  });

  app.get("/api/public/clinic-invite/:code/qr.png", async (req, res) => {
    const code = normalizeInviteCode(req.params.code);
    const qrUrl = buildPublicInviteQrUrl(req, code);
    try {
      if (!isValidInviteCode(code)) {
        logInviteQrRender({ clinicCode: code, qrUrl, rendered: false, reason: "invalid_code" });
        return res.status(400).send("Invalid invite code");
      }
      const preview = await fetchClinicInvitePreview(code);
      if (!preview.ok) {
        logInviteQrRender({ clinicCode: code, qrUrl, rendered: false, reason: preview.error });
        return res.status(preview.error === "clinic_not_found" ? 404 : 400).send("Not found");
      }
      const urls = buildInviteUrls(preview.clinic.clinicCode, req);
      const png = await generateInviteQrPngBuffer(urls.webUrl);
      if (!png) {
        logInviteQrRender({ clinicCode: code, qrUrl, rendered: false, reason: "generate_failed" });
        return res.status(503).send("QR unavailable");
      }
      logInviteQrRender({ clinicCode: code, qrUrl, rendered: true });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(png);
    } catch (e) {
      logInviteQrRender({
        clinicCode: code,
        qrUrl,
        rendered: false,
        reason: e?.message || "exception",
      });
      return res.status(500).send("Server error");
    }
  });

  app.get("/invite/:code", async (req, res) => {
    const code = normalizeInviteCode(req.params.code);
    const qrUrl = buildPublicInviteQrUrl(req, code);
    try {
      const preview = await fetchClinicInvitePreview(req.params.code);
      if (!preview.ok) {
        logInviteQrRender({ clinicCode: code, qrUrl, rendered: false, reason: preview.error });
        return res.status(preview.error === "clinic_not_found" ? 404 : 400).send(
          preview.error === "clinic_not_found"
            ? "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:2rem'><h1>Clinic not found</h1><p>This invitation link is invalid.</p></body></html>"
            : "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:2rem'><h1>Invalid invitation</h1></body></html>",
        );
      }
      const urls = buildInviteUrls(preview.clinic.clinicCode, req);
      const qrModuleOk = Boolean(loadQrCodeModule());
      let qrRendered = false;
      if (qrModuleOk) {
        const probe = await generateInviteQrPngBuffer(urls.webUrl);
        qrRendered = Boolean(probe && probe.length > 0);
      }
      logInviteQrRender({
        clinicCode: preview.clinic.clinicCode,
        qrUrl,
        rendered: qrRendered,
        ...(qrRendered ? {} : { reason: qrModuleOk ? "generate_failed" : "qrcode_module_missing" }),
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.send(
        renderInviteLandingHtml({
          clinic: preview.clinic,
          urls,
          qr: { url: qrUrl, rendered: qrRendered },
        }),
      );
    } catch (e) {
      logInviteQrRender({
        clinicCode: code,
        qrUrl,
        rendered: false,
        reason: e?.message || "exception",
      });
      return res.status(500).send("Server error");
    }
  });

  app.get("/api/admin/clinic-invitation", requireAdminAuth, async (req, res) => {
    try {
      const clinic = req.clinic;
      if (!clinic) {
        return res.status(404).json({ ok: false, error: "clinic_not_found" });
      }
      const code =
        clinic.clinic_code || clinic.clinicCode || clinic.code || "";
      if (!code) {
        return res.status(400).json({
          ok: false,
          error: "clinic_code_missing",
          message: "This clinic has no invitation code configured.",
        });
      }
      const urls = buildInviteUrls(code, req);
      return res.json({
        ok: true,
        clinicName: clinic.name || clinic.clinic_name || code,
        clinicCode: urls.clinicCode,
        invitation: urls,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
    }
  });

  app.get("/api/admin/clinic-invitation/qr.png", requireAdminAuth, async (req, res) => {
    try {
      const clinic = req.clinic;
      const code =
        clinic?.clinic_code || clinic?.clinicCode || clinic?.code || "";
      if (!code) {
        return res.status(400).json({ ok: false, error: "clinic_code_missing" });
      }
      const urls = buildInviteUrls(code, req);
      const adminQrUrl = `${resolvePublicBaseUrl(req)}/api/admin/clinic-invitation/qr.png`;
      const png = await generateInviteQrPngBuffer(urls.webUrl);
      if (!png) {
        logInviteQrRender({
          clinicCode: normalizeInviteCode(code),
          qrUrl: adminQrUrl,
          rendered: false,
          reason: "qrcode_module_missing",
        });
        return res.status(503).json({
          ok: false,
          error: "qrcode_module_missing",
          message: "Install qrcode package on the server.",
        });
      }
      logInviteQrRender({
        clinicCode: normalizeInviteCode(code),
        qrUrl: adminQrUrl,
        rendered: true,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.send(png);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
    }
  });
}

module.exports = {
  normalizeInviteCode,
  isValidInviteCode,
  buildAppDeepLink,
  buildInviteUrls,
  buildAndroidIntentUrl,
  buildAndroidPlayStoreUrl,
  buildPublicInviteQrUrl,
  resolvePublicBaseUrl,
  fetchClinicInvitePreview,
  generateInviteQrPngBuffer,
  upsertPatientClinicLink,
  patientJoinedViaInvitation,
  registerClinicInvitationRoutes,
  logInviteQrRender,
  IOS_STORE_URL,
  ANDROID_STORE_URL,
};
