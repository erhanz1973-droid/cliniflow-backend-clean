/* Clinic Operations Profile — modular admin hub */

function adminFetch(path, opts) {
  const url = typeof adminFetchUrl === "function" ? adminFetchUrl(path) : path;
  const token = localStorage.getItem("adminToken") || localStorage.getItem("admin_token") || "";
  const headers = Object.assign(
    { Accept: "application/json", Authorization: "Bearer " + token },
    (opts && opts.headers) || {},
  );
  return fetch(url, Object.assign({}, opts, { headers }));
}

let meta = null;
let profile = null;
let activeSection = "ai-profile";

const SECTION_I18N_ID = {
  "ai-profile": "aiProfile",
  materials: "materials",
  travel: "travel",
  logistics: "logistics",
  payment: "payment",
  workflow: "workflow",
  "ai-safety": "aiSafety",
  handoff: "handoff",
  "internal-notes": "internalNotes",
};

function op(key, params) {
  const fullKey = "opsProfile." + key;
  if (window.i18n && typeof window.i18n.t === "function") {
    const v = window.i18n.t(fullKey, params);
    if (v != null && v !== "" && v !== fullKey) return v;
  }
  return null;
}

function secTitle(sectionId) {
  const sid = SECTION_I18N_ID[sectionId] || sectionId;
  return op("sections." + sid + ".title") || sid;
}

function secHint(sectionId) {
  const sid = SECTION_I18N_ID[sectionId] || sectionId;
  return op("sections." + sid + ".hint") || "";
}

function metaLabel(group, key, fallback) {
  return op(group + "." + key) || fallback;
}

function applyPageI18n() {
  if (typeof window.applyI18n === "function") window.applyI18n();
  if (window.i18n && typeof window.i18n.t === "function") {
    document.title = window.i18n.t("opsProfile.pageTitle");
  }
}

function updateCounts() {
  if (!profile) return;
  const c = profile.counts || {};
  const el = document.getElementById("opsCounts");
  if (el) el.textContent = op("counts", { hotels: c.hotels || 0, protocols: c.protocols || 0 });
}

window.rerenderOpsProfile = function rerenderOpsProfile() {
  if (!meta || !profile) return;
  applyPageI18n();
  buildNav();
  renderAllSections();
  updateCounts();
};


function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseList(s) {
  return String(s || "")
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinList(a) {
  return (a || []).join(", ");
}

function normalizeLangRows(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return [
      { code: "en", enabled: true, primary: true, humanSupport: true },
      { code: "tr", enabled: true, primary: false, humanSupport: true },
      { code: "ru", enabled: true, primary: false, humanSupport: true },
      { code: "ka", enabled: true, primary: false, humanSupport: true },
    ];
  }
  return raw.map((item) => {
    if (typeof item === "string") {
      return { code: item, enabled: true, primary: false, humanSupport: true };
    }
    return {
      code: item.code,
      enabled: item.enabled !== false,
      primary: item.primary === true,
      humanSupport: item.human_support !== false && item.humanSupport !== false,
    };
  });
}

function renderLanguageMatrix(rows) {
  const presets = meta.languagePresets || [];
  const byCode = {};
  normalizeLangRows(rows).forEach((r) => {
    byCode[r.code] = r;
  });
  const list = presets.length
    ? presets
    : [
        { code: "en", label: "English" },
        { code: "tr", label: "Turkish" },
        { code: "ru", label: "Russian" },
        { code: "ka", label: "Georgian" },
      ];
  const body = list
    .map((p) => {
      const r = byCode[p.code] || { code: p.code, enabled: false, primary: false, humanSupport: true };
      const label = metaLabel("langs", p.code, p.label || p.code);
      return `<tr data-lang-row="${esc(p.code)}">
        <td><strong>${esc(label)}</strong>${p.priority === "future" ? ' <span style="font-size:0.65rem;color:var(--muted)">' + esc(op("langFuture")) + "</span>" : ""}</td>
        <td><input type="checkbox" data-lang-enabled="${esc(p.code)}" ${r.enabled ? "checked" : ""} /></td>
        <td><input type="radio" name="primaryLanguage" data-lang-primary="${esc(p.code)}" ${r.primary ? "checked" : ""} /></td>
        <td><input type="checkbox" data-lang-human="${esc(p.code)}" ${r.humanSupport ? "checked" : ""} /></td>
      </tr>`;
    })
    .join("");
  return `<table class="lang-matrix"><thead><tr><th>${esc(op("langColLanguage"))}</th><th>${esc(op("langColAi"))}</th><th>${esc(op("langColPrimary"))}</th><th>${esc(op("langColHuman"))}</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderLocalizedInputs(prefix, map, enabledCodes) {
  const codes = (enabledCodes && enabledCodes.length ? enabledCodes : ["en", "tr", "ru", "ka"]).slice(0, 6);
  const rows = codes
    .map((code) => {
      const val = (map && map[code]) || "";
      return (
        '<div class="i18n-row"><label>' +
        esc(code.toUpperCase()) +
        '</label><input name="' +
        esc(prefix) +
        "_" +
        esc(code) +
        '" value="' +
        esc(val) +
        '" placeholder="' + esc(op("localizedPlaceholder")) + '" /></div>'
      );
    })
    .join("");
  return '<div class="i18n-grid">' + rows + "</div>";
}

function collectLocalizedMap(form, prefix, enabledCodes) {
  const out = {};
  (enabledCodes || []).forEach((code) => {
    const v = String(form.querySelector('[name="' + prefix + "_" + code + '"]')?.value || "").trim();
    if (v) out[code] = v;
  });
  return out;
}

function collectSupportedLanguages(form) {
  const presets = meta.languagePresets || [];
  const codes = presets.length
    ? presets.map((p) => p.code)
    : ["en", "tr", "ru", "ka", "ar", "de", "fr"];
  const primary = form.querySelector('input[name="primaryLanguage"]:checked')?.getAttribute("data-lang-primary");
  return codes.map((code) => ({
    code,
    enabled: form.querySelector('[data-lang-enabled="' + code + '"]')?.checked === true,
    primary: code === primary,
    human_support: form.querySelector('[data-lang-human="' + code + '"]')?.checked !== false,
  }));
}

function fh() {
  return window.ClinicFieldHelp;
}

function fieldI18nKey(id) {
  return "fieldHelp." + String(id || "").replace(/\./g, "_");
}

function fieldDef(id) {
  return meta && meta.fieldHelp ? meta.fieldHelp[id] : null;
}

function localizedFieldDef(id) {
  const base = fieldDef(id);
  if (!base) return null;
  const prefix = fieldI18nKey(id);
  return {
    id,
    visibility: base.visibility,
    gridSpan: base.gridSpan,
    inputType: base.inputType,
    label: op(prefix + ".label") || "",
    helper: op(prefix + ".helper") || "",
    aiUsage: op(prefix + ".aiUsage") || "",
    placeholder: op(prefix + ".placeholder") || "",
    example: op(prefix + ".example") || "",
  };
}

function localizedVisibilityTypes() {
  if (!meta || !meta.visibilityTypes) return {};
  const out = {};
  Object.keys(meta.visibilityTypes).forEach((key) => {
    const base = meta.visibilityTypes[key];
    const short = op("visibility." + key + ".short");
    const label = op("visibility." + key + ".label");
    out[key] = {
      ...base,
      short: short || base.short,
      label: label || base.label,
    };
  });
  return out;
}

function localizedSectionHelp(sectionId) {
  const sid = SECTION_I18N_ID[sectionId] || sectionId;
  const intro = op("sectionHelp." + sid + ".intro");
  const aiUsageSummary = op("sectionHelp." + sid + ".aiUsageSummary");
  if (!intro) return null;
  return {
    intro,
    aiUsageSummary: aiUsageSummary || "",
  };
}

function optionLabel(group, value, fallback) {
  return op("options." + group + "." + value) || fallback;
}

function autonomyLevelLabel(level) {
  return op("autonomyLevels." + level) || level;
}

function fld(id, inner, gridSpan) {
  if (!fh()) return `<div class="field-block"${gridSpan ? ' style="grid-column:1/-1"' : ""}>${inner}</div>`;
  return fh().renderFieldBlock(localizedFieldDef(id), inner, {
    visibilityTypes: localizedVisibilityTypes(),
    gridSpan,
  });
}

function sectionIntroHtml(sectionId) {
  const sid = SECTION_I18N_ID[sectionId] || sectionId;
  const intro = op("sectionHelp." + sid + ".intro");
  const aiUsageSummary = op("sectionHelp." + sid + ".aiUsageSummary");
  if (!intro) return "";
  const usedBy = op("ui.usedByAiSection") || "";
  const summary = aiUsageSummary
    ? `<p class="section-ai-summary"><span class="ai-used-badge">${esc(usedBy)}</span> ${esc(aiUsageSummary)}</p>`
    : "";
  return `<div class="section-intro" data-section-intro="${esc(sectionId)}">
    <p class="section-intro-text">${esc(intro)}</p>
    ${summary}
  </div>`;
}

function secIntro(sectionId) {
  return sectionIntroHtml(sectionId);
}

function ph(id) {
  const d = localizedFieldDef(id);
  return d && d.placeholder ? ` placeholder="${esc(d.placeholder)}"` : "";
}

function setStatus(msg, ok) {
  const el = document.getElementById("globalStatus");
  el.textContent = msg || "";
  el.className = "status" + (ok ? " ok" : msg ? " err" : "");
}

function showSection(id) {
  activeSection = id;
  document.querySelectorAll(".section-panel").forEach((p) => {
    p.classList.toggle("active", p.getAttribute("data-section") === id);
  });
  document.querySelectorAll("#opsNav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-id") === id);
  });
  if (location.hash !== "#" + id) location.hash = id;
}

function buildNav() {
  const nav = document.getElementById("opsNav");
  nav.innerHTML = (meta.sections || [])
    .map(
      (s, i) =>
        `<a href="#${esc(s.id)}" data-id="${esc(s.id)}" class="${i === 0 ? "active" : ""}">${esc(
          i + 1 + ". " + secTitle(s.id),
        )}</a>`,
    )
    .join("");
  nav.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showSection(a.getAttribute("data-id"));
    });
  });
}

function renderSectionShell(id, title, hint, bodyHtml, saveLabel) {
  const el = document.getElementById("sec-" + id);
  if (!el) return;
  const introBlock = secIntro(id);
  el.innerHTML =
    `<h2>${esc(title)}</h2>` +
    (introBlock || (hint ? `<p class="hint">${esc(hint)}</p>` : "")) +
    bodyHtml +
    `<div style="margin-top:12px"><button type="button" class="btn" data-save="${esc(id)}">${esc(
      saveLabel || op("saveSection"),
    )}</button><span class="status" data-status="${esc(id)}"></span></div>`;
}

function renderAllSections() {
  const s = profile.sections || {};
  const c = profile.counts || {};

  const ai = s.aiProfile || {};
  const langRows = normalizeLangRows(ai.supportedLanguages);
  const enabledCodes = langRows.filter((r) => r.enabled).map((r) => r.code);

  renderSectionShell(
    "ai-profile",
    secTitle("ai-profile"),
    secHint("ai-profile"),
    `<p class="link-out" style="margin-bottom:12px"><a href="/admin-settings.html">${op("priceListLink")}</a> ${esc(op("priceListHint"))}</p>
    <div class="multilingual-note"><strong>${esc(op("multilingualNoteTitle"))}</strong> ${esc(op("multilingualNoteBody"))}</div>
    <form class="ops-form" data-form="ai-profile">
      ${fld("supportedLanguages", renderLanguageMatrix(langRows), true)}
      ${fld("displayNameLocalized", renderLocalizedInputs("displayNameLoc", ai.displayNameLocalized || {}, enabledCodes), true)}
      ${fld("welcomeMessageLocalized", renderLocalizedInputs("welcomeLoc", ai.welcomeMessageLocalized || {}, enabledCodes), true)}
      <div class="form-grid">
        ${fld("toneStyle", `<select name="toneStyle">${(meta.toneStyles || []).map((o) => `<option value="${esc(o.value)}"${ai.toneStyle === o.value ? " selected" : ""}>${esc(optionLabel("toneStyle", o.value, o.label))}</option>`).join("")}</select>`)}
        ${fld("signatureStyle", `<select name="signatureStyle">${(meta.signatureStyles || []).map((o) => `<option value="${esc(o.value)}"${ai.signatureStyle === o.value ? " selected" : ""}>${esc(optionLabel("signatureStyle", o.value, o.label))}</option>`).join("")}</select>`)}
        ${fld("profileTags", `<input name="profileTags" value="${esc(joinList(ai.profileTags))}"${ph("profileTags")} />`, true)}
      </div>
    </form>`,
  );


  const m = s.materials || {};
  renderSectionShell(
    "materials",
    secTitle("materials"),
    secHint("materials"),
    `<form data-form="materials"><div class="form-grid">
      ${fld("implantBrands", `<input name="implantBrands" value="${esc(joinList(m.implantBrands))}"${ph("implantBrands")} />`)}
      ${fld("premiumBrands", `<input name="premiumBrands" value="${esc(joinList(m.premiumBrands))}"${ph("premiumBrands")} />`)}
      ${fld("zirconiumTypes", `<input name="zirconiumTypes" value="${esc(joinList(m.zirconiumTypes))}"${ph("zirconiumTypes")} />`)}
      ${fld("labPartners", `<input name="labPartners" value="${esc(joinList(m.labPartners))}"${ph("labPartners")} />`)}
      ${fld("warrantyInformation", `<textarea name="warrantyInformation"${ph("warrantyInformation")}>${esc(m.warrantyInformation)}</textarea>`, true)}
      <div class="check-row" style="grid-column:1/-1"><label><input type="checkbox" name="sedationAvailability" ${m.sedationAvailability ? "checked" : ""}/> ${esc(op("sedationAvailable"))}</label></div>
    </div></form>`,
  );

  const hotels = (s.travel && s.travel.hotels) || [];
  renderSectionShell(
    "travel",
    secTitle("travel"),
    secHint("travel"),
    `<p class="link-out"><a href="/admin-settings-travel.html">${esc(op("openHotelManager"))}</a> (${op("hotelsCount", { count: c.hotels || 0 })})</p>
    <div class="catalog-grid">${hotels.slice(0, 6).map((h) => `<div class="catalog-card"><div><h3>${esc(h.name)}</h3><div class="meta">${esc([h.pricePerNight != null ? h.pricePerNight + esc(op("perNight")) : h.priceRange, h.distanceMinutes != null ? h.distanceMinutes + " min" : null, h.transferIncluded ? op("transferIncluded") : null].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>`,
    op("refresh"),
  );

  const lg = s.logistics || {};
  const wh = lg.workingHours || {};
  const wd = wh.weekdays || {};
  renderSectionShell(
    "logistics",
    secTitle("logistics"),
    secHint("logistics"),
    `<form data-form="logistics"><div class="form-grid">
      ${fld("weekdayHours", `<input name="weekdays" value="${esc((wd.start || "") + " – " + (wd.end || ""))}"${ph("weekdayHours")} />`)}
      ${fld("timezone", `<input name="timezone" value="${esc(wh.timezone || "")}" placeholder="Europe/Istanbul" />`)}
      ${fld("averageResponseSlaMinutes", `<input name="averageResponseSlaMinutes" type="number" value="${esc(lg.averageResponseSlaMinutes)}"${ph("averageResponseSlaMinutes")} />`)}
      ${fld("emergencyContact", `<input name="emergencyContact" value="${esc(lg.emergencyContact)}"${ph("emergencyContact")} />`)}
      ${fld("transportationNotes", `<textarea name="transportationNotes"${ph("transportationNotes")}>${esc(lg.transportationNotes)}</textarea>`, true)}
      <div class="check-row" style="grid-column:1/-1">
        <label><input type="checkbox" name="weekendAvailability" ${lg.weekendAvailability ? "checked" : ""}/> ${esc(op("weekendAvailability"))}</label>
        <label><input type="checkbox" name="sameDayTreatmentAvailable" ${lg.sameDayTreatmentAvailable ? "checked" : ""}/> ${esc(op("sameDayTreatment"))}</label>
        <label><input type="checkbox" name="airportTransferAvailable" ${lg.airportTransferAvailable ? "checked" : ""}/> ${esc(op("airportTransfer"))}</label>
      </div>
    </div></form>`,
  );

  const pay = s.payment || {};
  renderSectionShell(
    "payment",
    secTitle("payment"),
    secHint("payment"),
    `<form data-form="payment"><div class="form-grid">
      <div class="check-row" style="grid-column:1/-1">
        <label><input type="checkbox" name="depositRequired" ${pay.depositRequired ? "checked" : ""}/> ${esc(op("depositRequired"))}</label>
        <label><input type="checkbox" name="installmentAvailable" ${pay.installmentAvailable ? "checked" : ""}/> ${esc(op("installments"))}</label>
        <label><input type="checkbox" name="financingSupport" ${pay.financingSupport ? "checked" : ""}/> ${esc(op("financing"))}</label>
      </div>
      ${fld("refundPolicy", `<textarea name="refundPolicy"${ph("refundPolicy")}>${esc(pay.refundPolicy)}</textarea>`, true)}
      ${fld("cancellationPolicy", `<textarea name="cancellationPolicy"${ph("cancellationPolicy")}>${esc(pay.cancellationPolicy)}</textarea>`, true)}
    </div></form>`,
  );

  const postOpHelp = localizedFieldDef("protocol.postOpNotes");
  renderSectionShell(
    "workflow",
    secTitle("workflow"),
    secHint("workflow"),
    `<p class="link-out"><a href="/admin-settings-journeys.html">${esc(op("openJourneys"))}</a> (${c.protocols || 0} protocols)</p>
    ${postOpHelp ? `<div class="section-intro" style="margin-top:12px"><p class="section-intro-text"><strong>${esc(op("postOpExample"))}</strong> ${esc(postOpHelp.helper)}</p><p class="example-text" style="margin:8px 0 0">${esc(postOpHelp.example || postOpHelp.placeholder || "")}</p></div>` : ""}
    <p class="hint">${esc(op("workflowJourneysHint"))}</p>`,
    op("openJourneys"),
  );

  const autonomy = (s.aiSafety && s.aiSafety.autonomy && s.aiSafety.autonomy.categories) || {};
  const safety = (s.aiSafety && s.aiSafety.safetyRules && s.aiSafety.safetyRules.requireHumanReview) || {};
  renderSectionShell(
    "ai-safety",
    secTitle("ai-safety"),
    secHint("ai-safety"),
    `<p class="field-helper">${esc(op("autonomyIntro"))}</p>
    <table class="autonomy"><thead><tr><th>${esc(op("autonomyCategory"))}</th><th>${esc(op("autonomyLevel"))}</th></tr></thead><tbody>${(meta.autonomyCategories || []).map((cat) => `<tr><td>${esc(metaLabel("autonomy", cat.key, cat.label))}</td><td><select data-autonomy="${esc(cat.key)}">${(meta.autonomyLevels || []).map((lv) => `<option value="${esc(lv)}"${autonomy[cat.key] === lv ? " selected" : ""}>${esc(autonomyLevelLabel(lv))}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table>
    <p class="hint" style="margin-top:12px">${esc(op("safetyIntro"))}</p>
    <div class="check-row" id="safetyChecks">${(meta.hardHumanReviewKeys || []).map((h) => `<label><input type="checkbox" data-safety="${esc(h.key)}" ${safety[h.key] !== false ? "checked" : ""}/> ${esc(metaLabel("safety", h.key, h.label))}</label>`).join("")}</div>`,
  );

  const handoff = s.handoff || {};
  renderSectionShell(
    "handoff",
    secTitle("handoff"),
    secHint("handoff"),
    `<p class="field-helper">${esc(op("handoffIntro"))}</p>
    <div class="check-row" id="handoffChecks">${(meta.handoffTriggers || []).map((h) => `<label><input type="checkbox" data-handoff="${esc(h.key)}" ${handoff[h.key] !== false ? "checked" : ""}/> ${esc(metaLabel("handoff", h.key, h.label))}</label>`).join("")}</div>`,
  );

  const notes = s.internalNotes || {};
  renderSectionShell(
    "internal-notes",
    secTitle("internal-notes"),
    secHint("internal-notes"),
    `<form data-form="internal-notes">
      ${fld("positioningNotes", `<textarea name="positioningNotes" rows="5"${ph("positioningNotes")}>${esc((notes.positioningNotes || []).join("\n"))}</textarea>`, true)}
      ${fld("freeformNotes", `<textarea name="freeformNotes"${ph("freeformNotes")}>${esc(notes.freeformNotes)}</textarea>`, true)}
    </form>`,
  );

  document.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveSection(btn.getAttribute("data-save")));
  });

  if (fh()) fh().wireHelpToggles(document);
}


function collectSectionPayload(sectionId) {
  const form = document.querySelector('[data-form="' + sectionId + '"]');
  if (!form) return null;
  const fd = new FormData(form);
  const chk = (name) => form.querySelector('[name="' + name + '"]')?.checked === true;

  switch (sectionId) {
    case "ai-profile": {
      const supportedLanguages = collectSupportedLanguages(form);
      const enabledCodes = supportedLanguages.filter((l) => l.enabled).map((l) => l.code);
      const displayNameLocalized = collectLocalizedMap(form, "displayNameLoc", enabledCodes);
      const welcomeMessageLocalized = collectLocalizedMap(form, "welcomeLoc", enabledCodes);
      const primaryLanguage =
        supportedLanguages.find((l) => l.primary && l.enabled)?.code ||
        enabledCodes[0] ||
        "en";
      const displayName =
        displayNameLocalized[primaryLanguage] ||
        displayNameLocalized.en ||
        Object.values(displayNameLocalized)[0] ||
        "Clinic Assistant";
      return {
        version: 3,
        displayName,
        primaryLanguage,
        supportedLanguages,
        displayNameLocalized,
        welcomeMessageLocalized,
        toneStyle: fd.get("toneStyle"),
        signatureStyle: fd.get("signatureStyle"),
        profileTags: parseList(String(fd.get("profileTags"))),
      };
    }
    case "materials":
      return {
        implantBrands: parseList(String(fd.get("implantBrands"))),
        premiumBrands: parseList(String(fd.get("premiumBrands"))),
        zirconiumTypes: parseList(String(fd.get("zirconiumTypes"))),
        labPartners: parseList(String(fd.get("labPartners"))),
        warrantyInformation: String(fd.get("warrantyInformation") || "").trim() || null,
        sedationAvailability: chk("sedationAvailability"),
      };
    case "logistics": {
      const parts = String(fd.get("weekdays") || "").split("–");
      return {
        workingHours: {
          timezone: String(fd.get("timezone") || "Europe/Istanbul").trim(),
          weekdays: { start: (parts[0] || "09:00").trim(), end: (parts[1] || "18:00").trim() },
        },
        averageResponseSlaMinutes: Number(fd.get("averageResponseSlaMinutes")) || 120,
        emergencyContact: String(fd.get("emergencyContact") || "").trim() || null,
        languagesSpoken: parseList(String(fd.get("languagesSpoken"))),
        weekendAvailability: chk("weekendAvailability"),
        sameDayTreatmentAvailable: chk("sameDayTreatmentAvailable"),
        airportTransferAvailable: chk("airportTransferAvailable"),
        transportationNotes: String(fd.get("transportationNotes") || "").trim() || null,
      };
    }
    case "payment":
      return {
        depositRequired: chk("depositRequired"),
        installmentAvailable: chk("installmentAvailable"),
        financingSupport: chk("financingSupport"),
        acceptedCurrencies: parseList(String(fd.get("acceptedCurrencies"))),
        refundPolicy: String(fd.get("refundPolicy") || "").trim() || null,
        cancellationPolicy: String(fd.get("cancellationPolicy") || "").trim() || null,
      };
    case "internal-notes":
      return {
        positioningNotes: String(fd.get("positioningNotes") || "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        freeformNotes: String(fd.get("freeformNotes") || "").trim(),
      };
    case "ai-safety": {
      const categories = {};
      document.querySelectorAll("[data-autonomy]").forEach((sel) => {
        categories[sel.getAttribute("data-autonomy")] = sel.value;
      });
      const requireHumanReview = {};
      document.querySelectorAll("[data-safety]").forEach((cb) => {
        requireHumanReview[cb.getAttribute("data-safety")] = cb.checked;
      });
      return { autonomy: { categories }, safetyRules: { requireHumanReview } };
    }
    case "handoff": {
      const handoff = {};
      document.querySelectorAll("[data-handoff]").forEach((cb) => {
        handoff[cb.getAttribute("data-handoff")] = cb.checked;
      });
      return { handoff };
    }
    default:
      return null;
  }
}

async function saveSection(sectionId) {
  const statusEl = document.querySelector('[data-status="' + sectionId + '"]');
  if (statusEl) statusEl.textContent = op("saving");
  const payload = collectSectionPayload(sectionId);
  if (!payload) {
    if (sectionId === "travel") location.href = "/admin-settings-travel.html";
    if (sectionId === "workflow") location.href = "/admin-settings-journeys.html";
    return;
  }
  const res = await adminFetch("/api/admin/clinic/ops-profile/sections/" + sectionId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (res.ok && json.ok) {
    profile = json.profile;
    renderAllSections();
    if (statusEl) {
      statusEl.textContent = op("saved");
      statusEl.className = "status ok";
    }
    setStatus("", true);
  } else {
    if (statusEl) {
      statusEl.textContent = json.error || op("failed");
      statusEl.className = "status err";
    }
    setStatus(json.error || op("saveFailed"), false);
  }
}

async function loadProfile() {
  const res = await adminFetch("/api/admin/clinic/ops-profile");
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || op("loadFailed"));
  profile = json;
  const c = json.counts || {};
  updateCounts();
  renderAllSections();
}

function ensureAdminI18nReady() {
  return new Promise((resolve) => {
    const boot = () => {
      if (window.i18n && typeof window.i18n.init === "function") window.i18n.init();
      resolve();
    };
    if (window.i18n) boot();
    else document.addEventListener("i18n:ready", boot, { once: true });
  });
}

async function init() {
  await ensureAdminI18nReady();

  setStatus(op("loading") || "Loading…");
  const metaRes = await adminFetch("/api/admin/clinic/ops-profile/meta");
  meta = await metaRes.json();
  if (!metaRes.ok) {
    setStatus(op("loadMetaFailed") || "Failed to load meta", false);
    return;
  }
  buildNav();
  await loadProfile();
  if (typeof window.rerenderOpsProfile === "function") window.rerenderOpsProfile();
  else applyPageI18n();
  setStatus("");
  const hash = (location.hash || "#ai-profile").replace("#", "");
  if (document.getElementById("sec-" + hash)) showSection(hash);
  else showSection("ai-profile");
}

document.addEventListener("admin-language-changed", () => {
  if (typeof window.rerenderOpsProfile === "function") window.rerenderOpsProfile();
});

init().catch((e) => setStatus(String(e.message || e), false));

