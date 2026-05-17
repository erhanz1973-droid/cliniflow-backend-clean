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
    bodyHtml +
    `<div style="margin-top:12px"><button type="button" class="btn" data-save="${esc(id)}">${esc(
      saveLabel || "Save section",
    )}</button><span class="status" data-status="${esc(id)}"></span></div>`;
}

function renderAllSections() {
  const s = profile.sections || {};
  const c = profile.counts || {};

  renderSectionShell(
    "ai-profile",
    "Clinic AI Profile",
    "How the AI communicates — assigned doctor/coordinator remains primary owner.",
    `<form class="ops-form" data-form="ai-profile"><div class="form-grid">
      <div><label>Assistant name</label><input name="displayName" value="${esc(s.aiProfile?.displayName)}" /></div>
      <div><label>Tone / style</label><select name="toneStyle">${(meta.toneStyles || [])
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${s.aiProfile?.toneStyle === o.value ? " selected" : ""}>${esc(
              o.label,
            )}</option>`,
        )
        .join("")}</select></div>
      <div><label>Languages</label><input name="supportedLanguages" value="${esc(joinList(s.aiProfile?.supportedLanguages))}" /></div>
      <div><label>Signature</label><select name="signatureStyle">${(meta.signatureStyles || [])
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${s.aiProfile?.signatureStyle === o.value ? " selected" : ""}>${esc(
              o.label,
            )}</option>`,
        )
        .join("")}</select></div>
      <div style="grid-column:1/-1"><label>Profile tags</label><input name="profileTags" value="${esc(joinList(s.aiProfile?.profileTags))}" placeholder="luxury, friendly, premium" /></div>
    </div></form>`,
  );

  const catalog = s.treatmentsPricing || [];
  renderSectionShell(
    "treatments-pricing",
    "Treatments & Pricing",
    "Price ranges for AI — not binding quotes. Uses catalog items below.",
    `<div class="catalog-grid" id="catalogList">${
      catalog.length
        ? catalog
            .map(
              (t) =>
                `<div class="catalog-card" data-id="${esc(t.id)}"><div><h3>${esc(t.name)}</h3><div class="meta">${esc(
                  [t.category, t.priceMin != null ? t.priceMin + "–" + t.priceMax + " " + t.currency : null, t.durationLabel]
                    .filter(Boolean)
                    .join(" · "),
                )}</div></div><div><button type="button" class="btn secondary" data-edit-catalog="${esc(
                  t.id,
                )}">Edit</button></div></div>`,
            )
            .join("")
        : '<p class="hint">No treatments yet.</p>'
    }</div>
    <div id="catalogEditor" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px"></div>
    <button type="button" class="btn secondary" id="btnAddCatalog">+ Add treatment</button>`,
    "Save catalog item",
  );

  const m = s.materials || {};
  renderSectionShell(
    "materials",
    "Implant Brands & Materials",
    "Brands, labs, warranty — for explanatory AI replies.",
    `<form data-form="materials"><div class="form-grid">
      <div><label>Implant brands</label><input name="implantBrands" value="${esc(joinList(m.implantBrands))}" /></div>
      <div><label>Premium brands</label><input name="premiumBrands" value="${esc(joinList(m.premiumBrands))}" /></div>
      <div><label>Zirconium types</label><input name="zirconiumTypes" value="${esc(joinList(m.zirconiumTypes))}" /></div>
      <div><label>Lab partners</label><input name="labPartners" value="${esc(joinList(m.labPartners))}" /></div>
      <div style="grid-column:1/-1"><label>Warranty</label><textarea name="warrantyInformation">${esc(m.warrantyInformation)}</textarea></div>
      <div class="check-row"><label><input type="checkbox" name="sedationAvailability" ${m.sedationAvailability ? "checked" : ""}/> Sedation available</label></div>
    </div></form>`,
  );

  const hotels = (s.travel && s.travel.hotels) || [];
  renderSectionShell(
    "travel",
    "Travel & Accommodation",
    "Partner hotels for dental tourism coordination.",
    `<p class="link-out"><a href="/admin-settings-travel.html">Open full hotel manager →</a> (${c.hotels || 0} hotels)</p>
    <div class="catalog-grid">${hotels
      .slice(0, 6)
      .map(
        (h) =>
          `<div class="catalog-card"><div><h3>${esc(h.name)}</h3><div class="meta">${esc(
            [
              h.pricePerNight != null ? h.pricePerNight + "/night" : h.priceRange,
              h.distanceMinutes != null ? h.distanceMinutes + " min" : null,
              h.transferIncluded ? "transfer included" : null,
            ]
              .filter(Boolean)
              .join(" · "),
          )}</div></div></div>`,
      )
      .join("")}</div>`,
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
      <div><label>Timezone</label><input name="timezone" value="${esc(wh.timezone)}" /></div>
      <div><label>Weekday hours</label><input name="weekdays" value="${esc((wd.start || "") + " – " + (wd.end || ""))}" placeholder="09:00 – 18:00" /></div>
      <div><label>Response SLA (min)</label><input name="averageResponseSlaMinutes" type="number" value="${esc(lg.averageResponseSlaMinutes)}" /></div>
      <div><label>Emergency contact</label><input name="emergencyContact" value="${esc(lg.emergencyContact)}" /></div>
      <div><label>Languages spoken</label><input name="languagesSpoken" value="${esc(joinList(lg.languagesSpoken))}" /></div>
      <div class="check-row" style="grid-column:1/-1">
        <label><input type="checkbox" name="weekendAvailability" ${lg.weekendAvailability ? "checked" : ""}/> Weekend availability</label>
        <label><input type="checkbox" name="sameDayTreatmentAvailable" ${lg.sameDayTreatmentAvailable ? "checked" : ""}/> Same-day treatment</label>
        <label><input type="checkbox" name="airportTransferAvailable" ${lg.airportTransferAvailable ? "checked" : ""}/> Airport transfer</label>
      </div>
      <div style="grid-column:1/-1"><label>Transport notes</label><textarea name="transportationNotes">${esc(lg.transportationNotes)}</textarea></div>
    </div></form>`,
  );

  const pay = s.payment || {};
  renderSectionShell(
    "payment",
    "Payment & Financial Policies",
    "Deposits, financing, refunds — AI uses policy text, not guarantees.",
    `<form data-form="payment"><div class="form-grid">
      <div class="check-row"><label><input type="checkbox" name="depositRequired" ${pay.depositRequired ? "checked" : ""}/> Deposit required</label>
      <label><input type="checkbox" name="installmentAvailable" ${pay.installmentAvailable ? "checked" : ""}/> Installments</label>
      <label><input type="checkbox" name="financingSupport" ${pay.financingSupport ? "checked" : ""}/> Financing</label></div>
      <div><label>Accepted currencies</label><input name="acceptedCurrencies" value="${esc(joinList(pay.acceptedCurrencies))}" /></div>
      <div style="grid-column:1/-1"><label>Refund policy</label><textarea name="refundPolicy">${esc(pay.refundPolicy)}</textarea></div>
      <div style="grid-column:1/-1"><label>Cancellation policy</label><textarea name="cancellationPolicy">${esc(pay.cancellationPolicy)}</textarea></div>
    </div></form>`,
  );

  renderSectionShell(
    "workflow",
    "Treatment Workflow Knowledge",
    "Visit timelines, healing, temp teeth — operational not clinical diagnosis.",
    `<p class="link-out"><a href="/admin-settings-journeys.html">Manage treatment journey protocols →</a> (${c.protocols || 0} protocols)</p>
    <p class="hint">Workflow entries are stored as treatment protocols and injected into AI coordinator chats.</p>`,
    "Open journeys",
  );

  const autonomy = (s.aiSafety && s.aiSafety.autonomy && s.aiSafety.autonomy.categories) || {};
  const safety = (s.aiSafety && s.aiSafety.safetyRules && s.aiSafety.safetyRules.requireHumanReview) || {};
  renderSectionShell(
    "ai-safety",
    "AI Safety & Human Review",
    "Autonomy per category; pricing capped at SUGGEST_ONLY.",
    `<table class="autonomy"><thead><tr><th>Category</th><th>Level</th></tr></thead><tbody>${(
      meta.autonomyCategories || []
    )
      .map((cat) => {
        const opts = (meta.autonomyLevels || [])
          .map(
            (lv) =>
              `<option value="${esc(lv)}"${autonomy[cat.key] === lv ? " selected" : ""}>${esc(lv)}</option>`,
          )
          .join("");
        return `<tr><td>${esc(cat.label)}</td><td><select data-autonomy="${esc(cat.key)}">${opts}</select></td></tr>`;
      })
      .join("")}</tbody></table>
    <p class="hint" style="margin-top:12px">Always require human review:</p>
    <div class="check-row" id="safetyChecks">${(meta.hardHumanReviewKeys || [])
      .map(
        (h) =>
          `<label><input type="checkbox" data-safety="${esc(h.key)}" ${safety[h.key] !== false ? "checked" : ""}/> ${esc(
            h.label,
          )}</label>`,
      )
      .join("")}</div>`,
  );

  const handoff = s.handoff || {};
  renderSectionShell(
    "handoff",
    "Human Handoff Rules",
    "Escalate to coordinator when these triggers are detected.",
    `<div class="check-row" id="handoffChecks">${(meta.handoffTriggers || [])
      .map(
        (h) =>
          `<label><input type="checkbox" data-handoff="${esc(h.key)}" ${handoff[h.key] !== false ? "checked" : ""}/> ${esc(
            h.label,
          )}</label>`,
      )
      .join("")}</div>`,
  );

  const notes = s.internalNotes || {};
  renderSectionShell(
    "internal-notes",
    "Internal AI Knowledge Notes",
    "Clinic positioning — e.g. natural aesthetics, conservative planning, typical stay length.",
    `<form data-form="internal-notes">
      <label>Positioning bullets (one per line)</label>
      <textarea name="positioningNotes" rows="5">${esc((notes.positioningNotes || []).join("\n"))}</textarea>
      <label>Additional notes</label>
      <textarea name="freeformNotes">${esc(notes.freeformNotes)}</textarea>
    </form>`,
  );

  document.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveSection(btn.getAttribute("data-save")));
  });

  wireCatalogUi();
}

function wireCatalogUi() {
  const editor = document.getElementById("catalogEditor");
  if (!editor) return;

  function showEditor(item) {
    const t = item || {
      name: "",
      category: "general",
      priceMin: "",
      priceMax: "",
      currency: "EUR",
      durationLabel: "",
      visitCount: "",
      includedServices: [],
      excludedServices: [],
      aiNotes: "",
    };
    editor.innerHTML = `<form id="catalogForm"><input type="hidden" name="id" value="${esc(t.id || "")}" />
      <div class="form-grid">
        <div><label>Name *</label><input name="name" value="${esc(t.name)}" required /></div>
        <div><label>Category</label><select name="category">${(meta.treatmentCategories || [])
          .map(
            (o) =>
              `<option value="${esc(o.value)}"${t.category === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
          )
          .join("")}</select></div>
        <div><label>Min price</label><input name="priceMin" type="number" value="${esc(t.priceMin)}" /></div>
        <div><label>Max price</label><input name="priceMax" type="number" value="${esc(t.priceMax)}" /></div>
        <div><label>Currency</label><input name="currency" value="${esc(t.currency || "EUR")}" /></div>
        <div><label>Duration</label><input name="durationLabel" value="${esc(t.durationLabel)}" placeholder="2 visits / 3 months" /></div>
        <div style="grid-column:1/-1"><label>Included (comma)</label><input name="includedServices" value="${esc(joinList(t.includedServices))}" /></div>
        <div style="grid-column:1/-1"><label>Excluded (comma)</label><input name="excludedServices" value="${esc(joinList(t.excludedServices))}" /></div>
        <div style="grid-column:1/-1"><label>AI notes</label><textarea name="aiNotes">${esc(t.aiNotes)}</textarea></div>
      </div>
      <button type="submit" class="btn">Save treatment</button></form>`;
    document.getElementById("catalogForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = {
        name: fd.get("name"),
        category: fd.get("category"),
        priceMin: fd.get("priceMin") ? Number(fd.get("priceMin")) : null,
        priceMax: fd.get("priceMax") ? Number(fd.get("priceMax")) : null,
        currency: fd.get("currency"),
        durationLabel: fd.get("durationLabel"),
        visitCount: fd.get("visitCount") ? Number(fd.get("visitCount")) : null,
        includedServices: parseList(String(fd.get("includedServices"))),
        excludedServices: parseList(String(fd.get("excludedServices"))),
        aiNotes: fd.get("aiNotes"),
      };
      const id = String(fd.get("id") || "").trim();
      const path = id
        ? "/api/admin/clinic/ops-profile/catalog/" + id
        : "/api/admin/clinic/ops-profile/catalog";
      const res = await adminFetch(path, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadProfile();
        setStatus("Catalog saved.", true);
      } else setStatus("Catalog save failed.", false);
    });
  }

  document.getElementById("btnAddCatalog")?.addEventListener("click", () => showEditor(null));
  document.querySelectorAll("[data-edit-catalog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-catalog");
      const item = (profile.sections.treatmentsPricing || []).find((x) => x.id === id);
      showEditor(item);
    });
  });
}

function collectSectionPayload(sectionId) {
  const form = document.querySelector('[data-form="' + sectionId + '"]');
  if (!form) return null;
  const fd = new FormData(form);
  const chk = (name) => form.querySelector('[name="' + name + '"]')?.checked === true;

  switch (sectionId) {
    case "ai-profile":
      return {
        displayName: String(fd.get("displayName") || "").trim(),
        toneStyle: fd.get("toneStyle"),
        supportedLanguages: parseList(String(fd.get("supportedLanguages"))),
        signatureStyle: fd.get("signatureStyle"),
        profileTags: parseList(String(fd.get("profileTags"))),
      };
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
    "Catalog: " + (c.catalog || 0) + " · Hotels: " + (c.hotels || 0) + " · Workflow protocols: " + (c.protocols || 0);
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
