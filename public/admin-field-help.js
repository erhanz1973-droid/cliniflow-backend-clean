/**
 * Shared field help UI — Clinic AI Training + Treatment Workflows.
 * Requires meta.fieldHelp + meta.visibilityTypes from /api/admin/clinic/ops-profile/meta
 */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function visBadge(visibility, types) {
    const t = (types && types[visibility]) || {};
    const cls = t.className || "vis-ai";
    const label = t.short || t.label || visibility;
    return `<span class="vis-badge ${esc(cls)}" title="${esc(t.label || "")}">${esc(label)}</span>`;
  }

  function opUi(key, fallback) {
    if (window.i18n && typeof window.i18n.t === "function") {
      const v = window.i18n.t("opsProfile.ui." + key);
      if (v && !String(v).startsWith("opsProfile.")) return v;
    }
    return fallback;
  }

  function aiUsedBadge() {
    return (
      '<span class="ai-used-badge" title="' +
      esc(opUi("usedByAiTitle", "This teaches your AI assistant")) +
      '">' +
      esc(opUi("usedByAi", "Used by AI replies")) +
      "</span>"
    );
  }

  /**
   * @param {object} def - field help definition
   * @param {string} controlHtml - input/textarea/select HTML
   * @param {{ visibilityTypes?: object, gridSpan?: number }} [opts]
   */
  function renderFieldBlock(def, controlHtml, opts) {
    if (!def) return `<div class="field-block">${controlHtml}</div>`;
    opts = opts || {};
    const types = opts.visibilityTypes || {};
    const span = opts.gridSpan || def.gridSpan ? ` style="grid-column:1/-1"` : "";
    const showAi =
      def.visibility === "ai_reply" || def.visibility === "patient_visible";
    const example = def.example
      ? `<details class="example-expander"><summary>${esc(opUi("seeExample", "See example"))}</summary><p class="example-text">${esc(def.example)}</p></details>`
      : "";

    return `<div class="field-block"${span}>
      <div class="field-label-row">
        <label class="field-label">${esc(def.label)}</label>
        <span class="field-badges">
          ${visBadge(def.visibility, types)}
          ${showAi ? aiUsedBadge() : ""}
          <button type="button" class="info-btn" aria-label="Help" data-help-toggle="${esc(def.id)}">?</button>
        </span>
      </div>
      <p class="field-helper">${esc(def.helper)}</p>
      ${def.aiUsage ? `<p class="field-ai-usage"><strong>${esc(opUi("aiPrefix", "AI:"))}</strong> ${esc(def.aiUsage)}</p>` : ""}
      ${controlHtml}
      ${example}
    </div>`;
  }

  function renderSectionHeader(sectionHelp, sectionId) {
    if (!sectionHelp) return "";
    return `<div class="section-intro" data-section-intro="${esc(sectionId)}">
      <p class="section-intro-text">${esc(sectionHelp.intro)}</p>
      <p class="section-ai-summary"><span class="ai-used-badge">${esc(opUi("usedByAiSection", "Used by AI"))}</span> ${esc(sectionHelp.aiUsageSummary)}</p>
    </div>`;
  }

  function getField(meta, id) {
    if (!meta || !meta.fieldHelp) return null;
    return meta.fieldHelp[id] || null;
  }

  function wireHelpToggles(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-help-toggle]").forEach((btn) => {
      if (btn.dataset.helpWired) return;
      btn.dataset.helpWired = "1";
      btn.addEventListener("click", () => {
        const block = btn.closest(".field-block");
        const helper = block && block.querySelector(".field-helper");
        if (helper) {
          const open = helper.classList.toggle("help-expanded");
          btn.setAttribute("aria-expanded", open ? "true" : "false");
        }
      });
    });
  }

  global.ClinicFieldHelp = {
    esc,
    renderFieldBlock,
    renderSectionHeader,
    getField,
    visBadge,
    wireHelpToggles,
  };
})(typeof window !== "undefined" ? window : global);
