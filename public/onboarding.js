console.log("🔥 ONBOARDING SCRIPT LOADED");

// public/onboarding.js — Clinic onboarding (only clinic-onboarding.html); requires /i18n.js, not find-clinic.js

const ONBOARDING_I18N = {
  title: {
    tr: "Klinik Kaydı",
    en: "Clinic Registration",
    ru: "Регистрация клиники",
    ka: "კლინიკის რეგისტრაცია",
  },
  subtitle: {
    tr: "Lütfen bilgileri girin",
    en: "Please enter your details",
    ru: "Пожалуйста, введите данные",
    ka: "გთხოვთ შეიყვანეთ ინფორმაცია",
  },
};

function tOnboarding(key) {
  const lang =
    typeof window.getFindClinicLang === "function"
      ? window.getFindClinicLang()
      : "en";
  const row = ONBOARDING_I18N[key];
  return (row && (row[lang] || row.en)) || "";
}

function updateLangActiveState() {
  let current = "en";
  try {
    current = localStorage.getItem("lang") || "en";
  } catch (_e) {
    /* ignore */
  }
  current = String(current).trim().slice(0, 2).toLowerCase();

  document.querySelectorAll("#langBar button").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.getAttribute("data-lang") === current,
    );
  });
}

function applyOnboardingI18n() {
  try {
    if (typeof window.getFindClinicLang === "function") {
      document.documentElement.lang = window.getFindClinicLang();
    }

    const pageTitleEl = document.getElementById("pageTitle");
    const title = document.getElementById("onboardingTitle");
    const subtitle = document.getElementById("onboardingSubtitle");

    if (pageTitleEl) pageTitleEl.textContent = tOnboarding("title");
    if (title) title.textContent = tOnboarding("title");
    if (subtitle) subtitle.textContent = tOnboarding("subtitle");

    updateLangActiveState();
  } catch (e) {
    console.warn("applyOnboardingI18n:", e);
  }
}

window.applyOnboardingI18n = applyOnboardingI18n;
window.updateLangActiveState = updateLangActiveState;

/** Delegated click on #langBar so targets always resolve (closest button). */
function wireLangBar() {
  console.log("wireLangBar running");

  const bar = document.getElementById("langBar");
  if (!bar) {
    console.warn("wireLangBar: #langBar not in DOM yet");
    return;
  }

  if (bar.dataset.onboardingLangWired === "1") {
    console.warn("wireLangBar: already wired (skip duplicate listeners)");
    return;
  }
  bar.dataset.onboardingLangWired = "1";

  bar.querySelectorAll("button[data-lang]").forEach((btn) => {
    console.log("binding button:", btn);
    btn.disabled = false;
    btn.style.pointerEvents = "auto";
  });

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-lang]");
    if (!btn || !bar.contains(btn)) return;

    const lang = btn.getAttribute("data-lang");
    if (!lang) return;

    console.log("CLICK:", lang);

    try {
      if (typeof window.setAppLang === "function") {
        window.setAppLang(lang);
      } else {
        localStorage.setItem("lang", lang);
      }
    } catch (_err) {
      try {
        localStorage.setItem("lang", lang);
      } catch (_e2) {
        /* ignore */
      }
    }

    console.log("🌍 LANG SWITCH:", lang);

    try {
      applyOnboardingI18n();
    } catch (applyErr) {
      console.warn("applyOnboardingI18n after click:", applyErr);
    }

    if (typeof window.cliniflowUpdatePatientLanguage === "function") {
      Promise.resolve(window.cliniflowUpdatePatientLanguage(lang)).catch(() => {
        console.warn("Language sync failed");
      });
    }
  });
}

function bootOnboardingDomReady() {
  wireLangBar();
  applyOnboardingI18n();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "lang") return;
    applyOnboardingI18n();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootOnboardingDomReady);
  } else {
    bootOnboardingDomReady();
  }
}
