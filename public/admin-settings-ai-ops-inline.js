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

const SAFETY_KEYS = [
  ["surgeryAdvice", "Surgery advice"],
  ["diagnosis", "Diagnosis"],
  ["medications", "Medications"],
  ["complications", "Complications"],
  ["emergencies", "Emergencies"],
];
const HANDOFF_KEYS = [
  ["angryPatient", "Angry patient"],
  ["refundRequest", "Refund request"],
  ["severePain", "Severe pain"],
  ["emergencyLanguage", "Emergency language"],
  ["legalThreat", "Legal threat"],
];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}

function parseList(s) {
  return String(s || "")
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinList(a) {
  return (a || []).join(", ");
}

function fillSelect(id, options, value) {
  const el = document.getElementById(id);
  el.innerHTML = options
    .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
    .join("");
  if (value) el.value = value;
}

function renderAutonomyTable() {
  const body = document.getElementById("autonomyBody");
  const cats = meta.autonomyCategories || [];
  const levels = meta.autonomyLevels || [];
  const current = (profile.autonomy && profile.autonomy.categories) || {};
  const floor = new Set(meta.autonomySafetyFloorKeys || []);
  body.innerHTML = cats
    .map((c) => {
      const opts = levels
        .map(
          (lv) =>
            `<option value="${esc(lv)}"${current[c.key] === lv ? " selected" : ""}>${esc(lv)}</option>`,
        )
        .join("");
      return `<tr><td>${esc(c.label)}${
        floor.has(c.key) ? '<span class="floor-tag">max SUGGEST_ONLY</span>' : ""
      }</td><td><select data-autonomy="${esc(c.key)}">${opts}</select></td></tr>`;
    })
    .join("");
}

function renderCheckboxGroup(id, keys, obj) {
  document.getElementById(id).innerHTML = keys
    .map(([key, label]) => {
      const checked = obj && obj[key] !== false;
      return `<label><input type="checkbox" data-key="${esc(key)}"${
        checked ? " checked" : ""
      }> ${esc(label)}</label>`;
    })
    .join("");
}

function readCheckboxGroup(id) {
  const out = {};
  document.querySelectorAll(`#${id} input[type="checkbox"]`).forEach((cb) => {
    out[cb.getAttribute("data-key")] = cb.checked;
  });
  return out;
}

function applyProfileToForm() {
  const t = profile.tone || {};
  const e = profile.escalation || {};
  const bh = e.businessHours || {};
  const wd = bh.weekdays || {};
  const kb = profile.knowledgeBase || {};
  const cp = profile.communicationPolicy || {};

  document.getElementById("toneDisplayName").value = t.displayName || "";
  document.getElementById("toneLanguages").value = joinList(t.supportedLanguages);
  fillSelect("tonePersonality", meta.tonePersonalities, t.personality);
  fillSelect("toneSignature", meta.signatureStyles, t.signatureStyle);
  renderAutonomyTable();

  document.getElementById("slaDoctor").value = e.doctorResponseSlaMinutes ?? 120;
  document.getElementById("slaAiFallback").value = e.aiFallbackAfterMinutes ?? 30;
  document.getElementById("slaCoordinator").value = e.coordinatorEscalationAfterMinutes ?? 60;
  document.getElementById("bhTimezone").value = bh.timezone || "";
  document.getElementById("bhStart").value = wd.start || "";
  document.getElementById("bhEnd").value = wd.end || "";
  fillSelect("bhWeekend", meta.weekendModes, bh.weekendMode);

  document.getElementById("kbBrands").value = joinList(kb.implantBrands);
  document.getElementById("kbLanguages").value = joinList(kb.workingLanguages);
  document.getElementById("kbTransfer").value = kb.transferAvailability || "";
  document.getElementById("kbWarranty").value = kb.warrantyPolicy || "";
  document.getElementById("kbNotes").value = kb.operationalNotes || "";
  document.getElementById("kbSedation").checked = kb.sedationAvailability === true;
  document.getElementById("kbAirport").checked = kb.airportPickup === true;
  document.getElementById("kbFinancing").checked = kb.financingAvailability === true;

  document.getElementById("commPricing").checked = cp.canDiscussPricing !== false;
  document.getElementById("commDiscounts").checked = cp.canNegotiateDiscounts === true;
  document.getElementById("commBooking").checked = cp.canAutoBookAppointments === true;
  document.getElementById("commPayment").checked = cp.canSendPaymentLinks === true;
  document.getElementById("commMedicalRisk").checked = cp.canAnswerMedicalRiskQuestions === true;

  renderCheckboxGroup("safetyChecks", SAFETY_KEYS, (profile.safetyRules || {}).requireHumanReview || {});
  renderCheckboxGroup("handoffChecks", HANDOFF_KEYS, e.handoff || {});

  const badge = document.getElementById("configuredBadge");
  if (profile.isConfigured) {
    badge.textContent = "configured";
    badge.className = "badge configured";
  }
}

function collectPatch() {
  const categories = {};
  document.querySelectorAll("[data-autonomy]").forEach((sel) => {
    categories[sel.getAttribute("data-autonomy")] = sel.value;
  });
  return {
    tone: {
      displayName: document.getElementById("toneDisplayName").value.trim(),
      supportedLanguages: parseList(document.getElementById("toneLanguages").value),
      personality: document.getElementById("tonePersonality").value,
      signatureStyle: document.getElementById("toneSignature").value,
    },
    autonomy: { categories },
    escalation: {
      doctorResponseSlaMinutes: Number(document.getElementById("slaDoctor").value) || 120,
      aiFallbackAfterMinutes: Number(document.getElementById("slaAiFallback").value) || 30,
      coordinatorEscalationAfterMinutes:
        Number(document.getElementById("slaCoordinator").value) || 60,
      businessHours: {
        timezone: document.getElementById("bhTimezone").value.trim() || "Europe/Istanbul",
        weekdays: {
          start: document.getElementById("bhStart").value.trim() || "09:00",
          end: document.getElementById("bhEnd").value.trim() || "18:00",
        },
        weekendMode: document.getElementById("bhWeekend").value,
      },
      handoff: readCheckboxGroup("handoffChecks"),
    },
    knowledgeBase: {
      implantBrands: parseList(document.getElementById("kbBrands").value),
      workingLanguages: parseList(document.getElementById("kbLanguages").value),
      transferAvailability: document.getElementById("kbTransfer").value.trim() || null,
      warrantyPolicy: document.getElementById("kbWarranty").value.trim() || null,
      operationalNotes: document.getElementById("kbNotes").value.trim(),
      sedationAvailability: document.getElementById("kbSedation").checked,
      airportPickup: document.getElementById("kbAirport").checked,
      financingAvailability: document.getElementById("kbFinancing").checked,
    },
    communicationPolicy: {
      canDiscussPricing: document.getElementById("commPricing").checked,
      canNegotiateDiscounts: document.getElementById("commDiscounts").checked,
      canAutoBookAppointments: document.getElementById("commBooking").checked,
      canSendPaymentLinks: document.getElementById("commPayment").checked,
      canAnswerMedicalRiskQuestions: document.getElementById("commMedicalRisk").checked,
    },
    safetyRules: { requireHumanReview: readCheckboxGroup("safetyChecks") },
  };
}

async function loadAll() {
  const status = document.getElementById("saveStatus");
  status.textContent = "Loading…";
  const metaRes = await adminFetch("/api/admin/clinic/ai-ops/meta");
  const profileRes = await adminFetch("/api/admin/clinic/ai-ops/settings");
  if (!metaRes.ok || !profileRes.ok) {
    status.textContent = "Failed to load.";
    status.className = "status err";
    return;
  }
  meta = await metaRes.json();
  const profileJson = await profileRes.json();
  profile = profileJson.profile;
  applyProfileToForm();
  status.textContent = "";
}

document.getElementById("aiOpsForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = document.getElementById("btnSave");
  const status = document.getElementById("saveStatus");
  btn.disabled = true;
  status.textContent = "Saving…";
  status.className = "status";
  try {
    const res = await adminFetch("/api/admin/clinic/ai-ops/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPatch()),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      status.textContent = json.error || "Save failed";
      status.className = "status err";
      return;
    }
    profile = json.profile;
    applyProfileToForm();
    status.textContent = "Saved.";
    status.className = "status ok";
  } catch (e) {
    status.textContent = String(e.message || e);
    status.className = "status err";
  } finally {
    btn.disabled = false;
  }
});

loadAll();
