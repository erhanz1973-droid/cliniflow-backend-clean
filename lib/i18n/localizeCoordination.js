/**
 * Localize Coordination Center API labels (filters, queues, lead badges).
 */

const { t, normalizeUiLang } = require("./coordinationLocales");

const PRIMARY_RESPONDER = {
  DOCTOR: "doctor",
  SHARED_QUEUE: "shared_queue",
  AI_COORDINATOR: "ai_coordinator",
};

/**
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 */
function opsT(lang, key, params) {
  return t(normalizeUiLang(lang), `ops.${key}`, params);
}

/**
 * @param {Array<{ id: string, label: string, description: string }>} filters
 * @param {string} lang
 */
function localizeOperationalFilters(filters, lang) {
  const L = normalizeUiLang(lang);
  return filters.map((f) => {
    const idKey = f.id || "all_active";
    return {
      ...f,
      label: opsT(L, `filter.${idKey}`),
      description: opsT(L, `filterDesc.${idKey}`),
    };
  });
}

/**
 * @param {Array<{ id: string, label: string, description: string }>} filters
 * @param {string} lang
 */
function localizeHandlingFilters(filters, lang) {
  const L = normalizeUiLang(lang);
  return filters.map((f) => {
    const idKey = f.id || "all_handling";
    return {
      ...f,
      label: opsT(L, `handlingFilter.${idKey}`),
      description: opsT(L, `handlingFilterDesc.${idKey}`),
    };
  });
}

/**
 * @param {Array<{ id: string, label: string, description: string }>} queues
 * @param {string} lang
 */
function localizeIntakeQueues(queues, lang) {
  const L = normalizeUiLang(lang);
  return queues.map((q) => ({
    ...q,
    label: opsT(L, `queue.${q.id}`),
    description: opsT(L, `queueDesc.${q.id}`),
  }));
}

/**
 * @param {string} status
 * @param {string} lang
 */
function localizeOperationalStatusLabel(status, lang) {
  const key = String(status || "").trim();
  if (!key) return null;
  const out = opsT(normalizeUiLang(lang), `status.${key}`);
  return out.startsWith("ops.status.") ? key.replace(/_/g, " ") : out;
}

/**
 * @param {Record<string, unknown>|null} meta
 * @param {string} lang
 */
function formatBlockingReason(meta, lang) {
  if (!meta) return null;
  const L = normalizeUiLang(lang);
  if (meta.key === "coordinator_queue" && meta.title) {
    return String(meta.title);
  }
  if (meta.key === "journey_stage" && meta.stage) {
    const stageKey = String(meta.stage)
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    const localized = opsT(L, `journeyStage.${stageKey}`);
    if (!localized.startsWith("ops.journeyStage.")) return localized;
    return String(meta.stage);
  }
  if (meta.key === "readiness_missing") {
    const item =
      meta.itemKey != null
        ? opsT(L, `readinessItem.${meta.itemKey}`)
        : String(meta.item || "");
    return opsT(L, "blocker.readiness_missing", { item });
  }
  if (meta.key) {
    const out = opsT(L, `blocker.${meta.key}`);
    return out.startsWith("ops.blocker.") ? null : out;
  }
  return null;
}

/**
 * @param {string|null} actionKey
 * @param {string} lang
 */
function formatNextAction(actionKey, lang) {
  if (!actionKey) return null;
  const out = opsT(normalizeUiLang(lang), `nextAction.${actionKey}`);
  return out.startsWith("ops.nextAction.") ? null : out;
}

/**
 * @param {{ type: string, label: string }} primary
 * @param {string} lang
 */
function localizePrimaryResponderLabel(primary, lang) {
  const L = normalizeUiLang(lang);
  if (primary.type === PRIMARY_RESPONDER.DOCTOR) {
    const m = String(primary.label || "").match(/^Dr\.\s*(.+)$/i);
    if (m) return opsT(L, "primaryResponder.doctor_named", { name: m[1] });
    return opsT(L, "primaryResponder.doctor");
  }
  if (primary.type === PRIMARY_RESPONDER.SHARED_QUEUE) {
    return opsT(L, "primaryResponder.shared_queue");
  }
  if (primary.type === PRIMARY_RESPONDER.AI_COORDINATOR) {
    return opsT(L, "primaryResponder.ai_coordinator");
  }
  return primary.label;
}

/**
 * @param {Record<string, unknown>} lead
 * @param {string} lang
 */
function localizeLeadLabels(lead, lang) {
  const L = normalizeUiLang(lang);
  const out = { ...lead };

  if (lead.operationalStatus) {
    out.operationalStatusLabel =
      localizeOperationalStatusLabel(String(lead.operationalStatus), L) ||
      lead.operationalStatusLabel;
  } else if (lead.operationalStatusLabel) {
    out.operationalStatusLabel = localizeOperationalStatusLabel(
      String(lead.operationalStatusLabel).replace(/\s+/g, "_").toLowerCase(),
      L,
    ) || lead.operationalStatusLabel;
  }

  if (lead.responderMode) {
    const rk = String(lead.responderMode);
    const localized = opsT(L, `responder.${rk}`);
    if (!localized.startsWith("ops.responder.")) {
      out.responderModeLabel = localized;
    }
  }

  if (lead.handlingState) {
    const hk = String(lead.handlingState);
    const localized = opsT(L, `handling.${hk}`);
    if (!localized.startsWith("ops.handling.")) {
      out.handlingStateLabel = localized;
    }
  }

  if (lead.primaryResponder && typeof lead.primaryResponder === "object") {
    out.primaryResponderLabel = localizePrimaryResponderLabel(lead.primaryResponder, L);
  } else if (lead.primaryResponderLabel) {
    out.primaryResponderLabel = localizePrimaryResponderLabel(
      { type: PRIMARY_RESPONDER.SHARED_QUEUE, label: String(lead.primaryResponderLabel) },
      L,
    );
  }

  if (lead.waitingParty === "patient") {
    out.waitingPartyLabel = opsT(L, "waitingParty.patient");
  } else if (lead.waitingParty === "clinic") {
    out.waitingPartyLabel = opsT(L, "waitingParty.clinic");
  }

  if (lead.operationalProjection && typeof lead.operationalProjection === "object") {
    out.operationalProjection = {
      ...lead.operationalProjection,
      operationalStatusLabel: out.operationalStatusLabel,
      blocker: out.blockingReason ?? lead.operationalProjection.blocker,
      nextStep: out.nextAction ?? lead.operationalProjection.nextStep,
    };
  }

  return out;
}

module.exports = {
  opsT,
  localizeOperationalFilters,
  localizeHandlingFilters,
  localizeIntakeQueues,
  localizeOperationalStatusLabel,
  formatBlockingReason,
  formatNextAction,
  localizePrimaryResponderLabel,
  localizeLeadLabels,
};
