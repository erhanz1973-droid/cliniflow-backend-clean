console.log("🔥 SCRIPT PARSE OK");
// public/find-clinic.js — Find Clinic: i18n + search / nearby clinics
console.log("🔥 FIND CLINIC SCRIPT LOADED");

// Requires /i18n.js before this file for shared lang (defines window.getFindClinicLang).
/** @returns {string} */
function __fcLang() {
  return typeof window.getFindClinicLang === "function"
    ? window.getFindClinicLang()
    : "en";
}

/** @type {Record<string, Record<string, string>>} */
const FIND_CLINIC_I18N = {
  title: {
    tr: "Klinik Bul",
    en: "Find Clinic",
    ru: "Найти клинику",
    ka: "კლინიკის პოვნა",
  },
  subtitle: {
    tr: "",
    en: "",
    ru: "",
    ka: "",
  },
  searchPlaceholder: {
    tr: "Klinik adı veya şehir yazın",
    en: "Search by clinic name or city",
    ru: "Введите название клиники или город",
    ka: "შეიყვანეთ კლინიკის სახელი ან ქალაქი",
  },
  useNearby: {
    tr: "Yakınımda",
    en: "Use my location",
    ru: "Рядом со мной",
    ka: "ჩემთან ახლოს",
  },
  retry: {
    tr: "Tekrar dene",
    en: "Retry",
    ru: "Повторить",
    ka: "ხელახლა ცდა",
  },
  backToLogin: {
    tr: "Geri",
    en: "Back",
    ru: "Назад",
    ka: "უკან",
  },
  noResults: {
    tr: "Sonuç yok",
    en: "No results",
    ru: "Нет результатов",
    ka: "შედეგები არ არის",
  },
  noClinics: {
    tr: "Klinik bulunamadı",
    en: "No clinics found",
    ru: "Клиники не найдены",
    ka: "კლინიკები ვერ მოიძებნა",
  },
  loading: {
    tr: "Konumunuza yakın klinikler yükleniyor…",
    en: "Loading clinics near you…",
    ru: "Загрузка клиник поблизости…",
    ka: "თქვენთან ახლოს საავადმყოფოების ჩატვირთვა…",
  },
  loadFailed: {
    tr: "Liste yüklenemedi.",
    en: "Could not load the list.",
    ru: "Не удалось загрузить список.",
    ka: "სიის ჩატვირთვა ვერ მოხერხდა.",
  },
  locationDenied: {
    tr: "Konum reddedildi. Ayarlardan izin vermelisin.",
    en: "Location denied. Allow access in Settings.",
    ru: "Доступ к геопозиции отклонён. Разрешите в Настройках.",
    ka: "პოზიცია აკრძალულია. დააჭირეთ ნებართვა პარამეტრებიდან.",
  },
  incompleteResults: {
    tr: "Sonuçlar eksik olabilir. Tekrar deneyin veya arama alanını genişletin.",
    en: "Results may be incomplete. Try again or widen your search.",
    ru: "Результаты могут быть неполными. Попробуйте снова или увеличьте радиус.",
    ka: "შედეგები შესაძლოა არასრული იყოს. სცადეთ თავიდან ან გაზარდეთ რადიუსი.",
  },
  geolocationUnsupported: {
    tr: "Konum özelliği bu cihazda desteklenmiyor.",
    en: "Geolocation isn’t supported on this device.",
    ru: "Геолокация не поддерживается на этом устройстве.",
    ka: "გამორჩეული კონტენტი ამ მოწყობილობაზე გეოლოკაცია არ იძლევა.",
  },
};

function t(key) {
  const lang = __fcLang();
  const row = FIND_CLINIC_I18N[key];
  return (row && (row[lang] || row.en)) || "";
}

function applyFindClinicI18n() {
  const lang = __fcLang();
  document.documentElement.lang = lang;

  const $ = (id) => document.getElementById(id);

  if ($("pageTitle")) $("pageTitle").textContent = t("title");
  if ($("findTitle")) $("findTitle").textContent = t("title");
  if ($("findSubtitle")) $("findSubtitle").textContent = t("subtitle");
  if ($("searchFieldLabel")) {
    $("searchFieldLabel").textContent = t("searchPlaceholder");
  }
  if ($("searchInput")) {
    $("searchInput").removeAttribute("placeholder");
  }
  if ($("nearbyBtn")) $("nearbyBtn").textContent = t("useNearby");
  if ($("retryBtn")) $("retryBtn").textContent = t("retry");
  if ($("backLogin")) $("backLogin").textContent = t("backToLogin");

  try {
    document.querySelectorAll(".lang-btn").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-lang") === lang);
    });
  } catch (e) {
    console.error("❌ FIND CLINIC lang bar:", e);
  }

  if (typeof window.renderFindClinicList === "function") {
    try {
      window.renderFindClinicList();
    } catch (e) {
      console.error("❌ FIND CLINIC list render:", e);
    }
  }
}

window.applyFindClinicI18n = applyFindClinicI18n;
window.t = t;

/** @typedef {{ id:string, name:string, city:string, country:string, distance?:number|string }} ClinicRow */

/** @type {ClinicRow[]} */
let allClinics = [];

/** @type {HTMLElement|null} */
const searchInputEl = typeof document !== "undefined" ? document.getElementById("searchInput") : null;

function normalize(q) {
  return String(q || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** @returns {typeof allClinics} */
function filterClinics() {
  const raw = searchInputEl ? searchInputEl.value : "";
  const q = normalize(raw).trim();

  let list = allClinics.slice();
  if (!q) return list;

  return list.filter((c) => {
    const name = normalize(c.name);
    const city = normalize(c.city);
    const cc = normalize(c.country);
    const blob = `${name} ${city} ${cc}`;
    return blob.includes(q);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderFindClinicList() {
  const box = document.getElementById("listContainer");
  if (!box) return;

  const items = filterClinics();
  if (!items.length) {
    const msg = !allClinics.length ? t("noClinics") : t("noResults");
    box.innerHTML = `<div class="muted">${escapeHtml(msg)}</div>`;
    return;
  }

  box.innerHTML = items
    .map((it) => {
      const subtitle = `${escapeHtml(it.city)}${it.country ? ", " + escapeHtml(it.country) : ""}`;
      const distTxt =
        it.distance !== undefined && String(it.distance) !== ""
          ? ` · ${escapeHtml(String(it.distance))} km`
          : "";

      const hrefSafe = `/patient-login.html?id=${encodeURIComponent(it.id)}`;

      return `
        <a href="${hrefSafe}" style="display:block;color:inherit;text-decoration:none;">
          <div class="clinic-card shadow">
            <div class="pill">${escapeHtml(it.name)} — ${subtitle}${distTxt}</div>
          </div>
        </a>
      `;
    })
    .join("");
}

/**
 * @param {string} msg
 * @param {boolean} [isError]
 */
function setStatus(msg, isError) {
  const el = document.getElementById("statusLine");
  if (!el) return;
  el.classList.remove("status-warn", "status-err");
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = msg;
  if (isError) el.classList.add("status-err");
}

/** @param {string} msg */
function showBanner(msg) {
  const el = document.getElementById("statusLine");
  if (!el) return;
  el.style.display = "block";
  el.classList.add("status-warn");
  el.textContent = msg;
}

/** Cancel previous nearby fetch; latest controller wins. */
let currentNearbyAbort = null;

function loadNearby() {
  setStatus(t("loading"));
  if (!navigator.geolocation) {
    setStatus(t("geolocationUnsupported"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      if (currentNearbyAbort) {
        try {
          currentNearbyAbort.abort();
        } catch (_e) {
          /* ignore */
        }
      }
      const controller = new AbortController();
      currentNearbyAbort = controller;

      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const baseRaw =
        typeof window.cliniflowApiBase === "function"
          ? window.cliniflowApiBase()
          : typeof window.cliniflowApiBase === "string"
            ? window.cliniflowApiBase
            : "";
      const base = String(baseRaw || "").replace(/\/+$/, "");
      const url = `${base}/api/clinics/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&limit=20`;

      try {
        console.log("🌐 clinics/nearby:", url);
        const r = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        /** @type {any} */
        const data = await r.json();

        if (controller !== currentNearbyAbort) return;

        console.log("📡 nearby response", data.req_id);

        if (!Array.isArray(data.clinics)) {
          console.warn("⚠️ invalid clinics response", data);
          allClinics = [];
          renderFindClinicList();
          const elStatus = document.getElementById("statusLine");
          if (elStatus) elStatus.classList.remove("status-warn", "status-err");
          setStatus("", false);
          return;
        }

        const rows = data.clinics;
        allClinics = rows.map((c) => ({
          ...c,
          distance:
            c.distance_km !== undefined && c.distance_km !== null
              ? c.distance_km
              : c.distance,
        }));

        renderFindClinicList();
        const elStatus = document.getElementById("statusLine");
        if (elStatus) elStatus.classList.remove("status-warn", "status-err");
        setStatus("", false);

        if (data.timeout) {
          console.warn("⏱️ Results may be incomplete");
          showBanner(t("incompleteResults"));
        }
        if (data.ratings_timeout) {
          console.warn("⭐ Ratings may be incomplete");
        }
      } catch (e) {
        if (e && e.name === "AbortError") {
          console.log("⛔ request aborted");
          setStatus("", false);
          return;
        }
        console.error("Nearby fetch failed", e);
        if (controller !== currentNearbyAbort) return;
        setStatus(t("loadFailed"), true);
      }
    },
    (_err) => {
      setStatus(t("locationDenied"));
    },
    { enableHighAccuracy: true, timeout: 25000 },
  );
}

function setLanguage(lang) {
  if (typeof window.setAppLang === "function") {
    window.setAppLang(lang);
  } else {
    try {
      const allowed = window.CLINIFLOW_ALLOWED_LANGS || ["tr", "en", "ru", "ka"];
      if (allowed.includes(lang)) localStorage.setItem("lang", lang);
    } catch (_e) {
      /* ignore */
    }
  }
  applyFindClinicI18n();
}

function bootFindClinicDom() {
  if (searchInputEl) {
    searchInputEl.removeEventListener("input", renderFindClinicList);
    searchInputEl.addEventListener("input", renderFindClinicList);
  }

  const nearbyBtn = document.getElementById("nearbyBtn");
  if (nearbyBtn) {
    nearbyBtn.removeEventListener("click", loadNearby);
    nearbyBtn.addEventListener("click", loadNearby);
  }

  const retryBtn = document.getElementById("retryBtn");
  if (retryBtn) {
    retryBtn.removeEventListener("click", loadNearby);
    retryBtn.addEventListener("click", loadNearby);
  }

  try {
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const l = btn.getAttribute("data-lang");
        setLanguage(l);
      });
    });
  } catch (e) {
    console.error("❌ FIND CLINIC lang click:", e);
  }

  console.log("🌍 FINAL LANG:", __fcLang());
  applyFindClinicI18n();
}

window.renderFindClinicList = renderFindClinicList;
window.setLanguage = setLanguage;
window.bootFindClinicDom = bootFindClinicDom;

function wireFindClinicListeners() {
  try {
    window.addEventListener("storage", (e) => {
      if (e.key !== "lang" || !document.getElementById("findTitle")) return;
      try {
        applyFindClinicI18n();
      } catch (err) {
        console.error("❌ FIND CLINIC i18n:", err);
      }
    });
  } catch (e) {
    console.error("❌ FIND CLINIC storage listener:", e);
  }
}

/**
 * Boots Find Clinic DOM only when this script is included on find-clinic.html (#findTitle).
 */
function initFindClinicUiIfApplicable() {
  if (!document.getElementById("findTitle")) {
    console.warn(
      "Find Clinic script loaded on wrong page (expected #findTitle); skipping Find Clinic boot.",
    );
    return;
  }

  try {
    bootFindClinicDom();
  } catch (e) {
    console.error("❌ FIND CLINIC CRASH:", e);
  }

  wireFindClinicListeners();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    try {
      document.addEventListener("DOMContentLoaded", initFindClinicUiIfApplicable);
    } catch (e) {
      console.error("❌ FIND CLINIC DOMContentLoaded:", e);
    }
  } else {
    initFindClinicUiIfApplicable();
  }
}
