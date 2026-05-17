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
      return `<tr data-lang-row="${esc(p.code)}">
        <td><strong>${esc(p.label || p.code)}</strong>${p.priority === "future" ? ' <span style="font-size:0.65rem;color:var(--muted)">(future)</span>' : ""}</td>
        <td><input type="checkbox" data-lang-enabled="${esc(p.code)}" ${r.enabled ? "checked" : ""} /></td>
        <td><input type="radio" name="primaryLanguage" data-lang-primary="${esc(p.code)}" ${r.primary ? "checked" : ""} /></td>
        <td><input type="checkbox" data-lang-human="${esc(p.code)}" ${r.humanSupport ? "checked" : ""} /></td>
      </tr>`;
    })
    .join("");
  return `<table class="lang-matrix"><thead><tr><th>Language</th><th>AI enabled</th><th>Primary</th><th>Human staff</th></tr></thead><tbody>${body}</tbody></table>`;
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
        '" placeholder="Optional — AI can localize if empty" /></div>'
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

function fieldDef(id) {
  return meta && meta.fieldHelp ? meta.fieldHelp[id] : null;
}

function fld(id, inner, gridSpan) {
  if (!fh()) return `<div class="field-block"${gridSpan ? ' style="grid-column:1/-1"' : ""}>${inner}</div>`;
  return fh().renderFieldBlock(fieldDef(id), inner, {
    visibilityTypes: meta.visibilityTypes,
    gridSpan,
  });
}

function secIntro(sectionId) {
  if (!fh() || !meta.sectionHelp) return "";
  return fh().renderSectionHeader(meta.sectionHelp[sectionId], sectionId);
}

function ph(id) {
  const d = fieldDef(id);
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
          i + 1 + ". " + s.title,
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
  el.innerHTML =
    `<h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p>` +
    secIntro(id) +
    bodyHtml +
    `<div style="margin-top:12px"><button type="button" class="btn" data-save="${esc(id)}">${esc(
      saveLabel || "Save section",
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
    "Clinic AI Profile",
    "Multilingual AI orchestration — one knowledge source; AI localizes ops data at reply time.",
    `<p class="link-out" style="margin-bottom:12px"><a href="/admin-settings.html">→ Treatment Price List</a> (operational + AI pricing)</p>
    <div class="multilingual-note"><strong>One clinic knowledge, many languages.</strong> Enable languages below. Brands, pricing, logistics, and workflow stay in a single structured source — the AI responds naturally without duplicating operational setup per language.</div>
    <form class="ops-form" data-form="ai-profile">
      ${fld("supportedLanguages", renderLanguageMatrix(langRows), true)}
      ${fld("displayNameLocalized", renderLocalizedInputs("displayNameLoc", ai.displayNameLocalized || {}, enabledCodes), true)}
      ${fld("welcomeMessageLocalized", renderLocalizedInputs("welcomeLoc", ai.welcomeMessageLocalized || {}, enabledCodes), true)}
      <div class="form-grid">
        ${fld("toneStyle", `<select name="toneStyle">${(meta.toneStyles || []).map((o) => `<option value="${esc(o.value)}"${ai.toneStyle === o.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`)}
        ${fld("signatureStyle", `<select name="signatureStyle">${(meta.signatureStyles || []).map((o) => `<option value="${esc(o.value)}"${ai.signatureStyle === o.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`)}
        ${fld("profileTags", `<input name="profileTags" value="${esc(joinList(ai.profileTags))}"${ph("profileTags")} />`, true)}
      </div>
    </form>`,
  );


  const m = s.materials || {};
  renderSectionShell(
    "materials",
    "Implant Brands & Materials",
    "Brands, labs, warranty — for explanatory AI replies.",
    `<form data-form="materials"><div class="form-grid">
      ${fld("implantBrands", `<input name="implantBrands" value="${esc(joinList(m.implantBrands))}"${ph("implantBrands")} />`)}
      ${fld("premiumBrands", `<input name="premiumBrands" value="${esc(joinList(m.premiumBrands))}"${ph("premiumBrands")} />`)}
      ${fld("zirconiumTypes", `<input name="zirconiumTypes" value="${esc(joinList(m.zirconiumTypes))}"${ph("zirconiumTypes")} />`)}
      ${fld("labPartners", `<input name="labPartners" value="${esc(joinList(m.labPartners))}"${ph("labPartners")} />`)}
      ${fld("warrantyInformation", `<textarea name="warrantyInformation"${ph("warrantyInformation")}>${esc(m.warrantyInformation)}</textarea>`, true)}
      <div class="check-row" style="grid-column:1/-1"><label><input type="checkbox" name="sedationAvailability" ${m.sedationAvailability ? "checked" : ""}/> Sedation available</label></div>
    </div></form>`,
  );

  const hotels = (s.travel && s.travel.hotels) || [];
  renderSectionShell(
    "travel",
    "Travel & Accommodation",
    "Partner hotels for dental tourism coordination.",
    `<p class="link-out"><a href="/admin-settings-travel.html">Open full hotel manager →</a> (${c.hotels || 0} hotels)</p>
    <div class="catalog-grid">${hotels.slice(0, 6).map((h) => `<div class="catalog-card"><div><h3>${esc(h.name)}</h3><div class="meta">${esc([h.pricePerNight != null ? h.pricePerNight + "/night" : h.priceRange, h.distanceMinutes != null ? h.distanceMinutes + " min" : null, h.transferIncluded ? "transfer included" : null].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>`,
    "Refresh",
  );

  const lg = s.logistics || {};
  const wh = lg.workingHours || {};
  const wd = wh.weekdays || {};
  renderSectionShell(
    "logistics",
    "Clinic Logistics",
    "Hours, SLA, emergency contact, same-day treatment.",
    `<form data-form="logistics"><div class="form-grid">
      ${fld("weekdayHours", `<input name="weekdays" value="${esc((wd.start || "") + " – " + (wd.end || ""))}"${ph("weekdayHours")} />`)}
      ${fld("timezone", `<input name="timezone" value="${esc(wh.timezone || "")}" placeholder="Europe/Istanbul" />`)}
      ${fld("averageResponseSlaMinutes", `<input name="averageResponseSlaMinutes" type="number" value="${esc(lg.averageResponseSlaMinutes)}"${ph("averageResponseSlaMinutes")} />`)}
      ${fld("emergencyContact", `<input name="emergencyContact" value="${esc(lg.emergencyContact)}"${ph("emergencyContact")} />`)}
      ${fld("transportationNotes", `<textarea name="transportationNotes"${ph("transportationNotes")}>${esc(lg.transportationNotes)}</textarea>`, true)}
      <div class="check-row" style="grid-column:1/-1">
        <label><input type="checkbox" name="weekendAvailability" ${lg.weekendAvailability ? "checked" : ""}/> Weekend availability</label>
        <label><input type="checkbox" name="sameDayTreatmentAvailable" ${lg.sameDayTreatmentAvailable ? "checked" : ""}/> Same-day treatment</label>
        <label><input type="checkbox" name="airportTransferAvailable" ${lg.airportTransferAvailable ? "checked" : ""}/> Airport transfer</label>
      </div>
    </div></form>`,
  );

  const pay = s.payment || {};
  renderSectionShell(
    "payment",
    "Payment & Financial Policies",
    "Deposits, financing, refunds — AI uses policy text, not guarantees.",
    `<form data-form="payment"><div class="form-grid">
      <div class="check-row" style="grid-column:1/-1">
        <label><input type="checkbox" name="depositRequired" ${pay.depositRequired ? "checked" : ""}/> Deposit required</label>
        <label><input type="checkbox" name="installmentAvailable" ${pay.installmentAvailable ? "checked" : ""}/> Installments</label>
        <label><input type="checkbox" name="financingSupport" ${pay.financingSupport ? "checked" : ""}/> Financing</label>
      </div>
      ${fld("refundPolicy", `<textarea name="refundPolicy"${ph("refundPolicy")}>${esc(pay.refundPolicy)}</textarea>`, true)}
      ${fld("cancellationPolicy", `<textarea name="cancellationPolicy"${ph("cancellationPolicy")}>${esc(pay.cancellationPolicy)}</textarea>`, true)}
    </div></form>`,
  );

  const postOpHelp = fieldDef("protocol.postOpNotes");
  renderSectionShell(
    "workflow",
    "Treatment Workflow Knowledge",
    "Visit timelines, healing, temp teeth — operational not clinical diagnosis.",
    `<p class="link-out"><a href="/admin-settings-journeys.html">Manage treatment journey protocols →</a> (${c.protocols || 0} protocols)</p>
    ${postOpHelp ? `<div class="section-intro" style="margin-top:12px"><p class="section-intro-text"><strong>Example field — Post-op coordination notes:</strong> ${esc(postOpHelp.helper)}</p><p class="example-text" style="margin:8px 0 0">${esc(postOpHelp.example || postOpHelp.placeholder || "")}</p></div>` : ""}
    <p class="hint">Configure per-treatment healing, post-op, and AI notes in Treatment Journeys.</p>`,
    "Open journeys",
  );

  const autonomy = (s.aiSafety && s.aiSafety.autonomy && s.aiSafety.autonomy.categories) || {};
  const safety = (s.aiSafety && s.aiSafety.safetyRules && s.aiSafety.safetyRules.requireHumanReview) || {};
  renderSectionShell(
    "ai-safety",
    "AI Safety & Human Review",
    "Autonomy per category; pricing capped at SUGGEST_ONLY. Not medical diagnosis.",
    `<p class="field-helper">Choose how independently the AI may respond. Medical topics always require a human.</p>
    <table class="autonomy"><thead><tr><th>Category</th><th>Level</th></tr></thead><tbody>${(meta.autonomyCategories || []).map((cat) => `<tr><td>${esc(cat.label)}</td><td><select data-autonomy="${esc(cat.key)}">${(meta.autonomyLevels || []).map((lv) => `<option value="${esc(lv)}"${autonomy[cat.key] === lv ? " selected" : ""}>${esc(lv)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table>
    <p class="hint" style="margin-top:12px">Always require human review (never auto-sent for medical advice):</p>
    <div class="check-row" id="safetyChecks">${(meta.hardHumanReviewKeys || []).map((h) => `<label><input type="checkbox" data-safety="${esc(h.key)}" ${safety[h.key] !== false ? "checked" : ""}/> ${esc(h.label)}</label>`).join("")}</div>`,
  );

  const handoff = s.handoff || {};
  renderSectionShell(
    "handoff",
    "Human Handoff Rules",
    "Escalate to coordinator when these triggers are detected.",
    `<p class="field-helper">When checked, the AI stops auto-replying and alerts your team.</p>
    <div class="check-row" id="handoffChecks">${(meta.handoffTriggers || []).map((h) => `<label><input type="checkbox" data-handoff="${esc(h.key)}" ${handoff[h.key] !== false ? "checked" : ""}/> ${esc(h.label)}</label>`).join("")}</div>`,
  );

  const notes = s.internalNotes || {};
  renderSectionShell(
    "internal-notes",
    "Internal AI Knowledge Notes",
    "Clinic positioning — not shown verbatim to patients.",
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
  if (statusEl) statusEl.textContent = "Saving…";
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
      statusEl.textContent = "Saved";
      statusEl.className = "status ok";
    }
    setStatus("", true);
  } else {
    if (statusEl) {
      statusEl.textContent = json.error || "Failed";
      statusEl.className = "status err";
    }
    setStatus(json.error || "Save failed", false);
  }
}

async function loadProfile() {
  const res = await adminFetch("/api/admin/clinic/ops-profile");
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "load_failed");
  profile = json;
  const c = json.counts || {};
  document.getElementById("opsCounts").textContent =
    "Hotels: " + (c.hotels || 0) + " · Workflow protocols: " + (c.protocols || 0);
  renderAllSections();
}

async function init() {
  setStatus("Loading…");
  const metaRes = await adminFetch("/api/admin/clinic/ops-profile/meta");
  meta = await metaRes.json();
  if (!metaRes.ok) {
    setStatus("Failed to load meta", false);
    return;
  }
  buildNav();
  await loadProfile();
  setStatus("");
  const hash = (location.hash || "#ai-profile").replace("#", "");
  if (document.getElementById("sec-" + hash)) showSection(hash);
  else showSection("ai-profile");
}

init().catch((e) => setStatus(String(e.message || e), false));
