/**
 * Treatment proposal / quote workflow — moves inquiries toward clinic offers, not only AI reassurance.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { getPricingKnowledgeForAi } = require("./clinicPricingForAi");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { getRelevantProtocolsForAi } = require("./clinicTreatmentProtocols");
const {
  LEAD_STATUS,
  ensureLeadWorkspaceForClinic,
  setTreatmentRequestLeadStatus,
} = require("./patientLeadLifecycle");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROPOSAL_STATUS = {
  WAITING_FOR_QUOTE: "waiting_for_quote",
  PROPOSAL_PENDING: "proposal_pending",
  QUOTE_IN_PROGRESS: "quote_in_progress",
  DOCTOR_REVIEW_REQUIRED: "doctor_review_required",
  READY_TO_SEND: "ready_to_send",
  QUOTE_SENT: "quote_sent",
};

const ACTIVE_QUOTE_STATUSES = new Set([
  PROPOSAL_STATUS.WAITING_FOR_QUOTE,
  PROPOSAL_STATUS.PROPOSAL_PENDING,
  PROPOSAL_STATUS.QUOTE_IN_PROGRESS,
  PROPOSAL_STATUS.DOCTOR_REVIEW_REQUIRED,
  PROPOSAL_STATUS.READY_TO_SEND,
]);

const PATIENT_STATUS_LABELS = {
  waiting_for_quote: {
    en: "Clinic is preparing your treatment estimate.",
    tr: "Klinik tedavi tahmininizi hazırlıyor.",
    ru: "Клиника готовит предварительную смету лечения.",
  },
  proposal_pending: {
    en: "Clinic is preparing your treatment estimate.",
    tr: "Klinik tedavi tahmininizi hazırlıyor.",
  },
  quote_in_progress: {
    en: "Your treatment estimate is being prepared.",
    tr: "Tedavi tahmininiz hazırlanıyor.",
  },
  doctor_review_required: {
    en: "A dentist is reviewing your treatment plan.",
    tr: "Diş hekimi tedavi planınızı inceliyor.",
  },
  ready_to_send: {
    en: "Your estimate is almost ready — the clinic will send it shortly.",
    tr: "Tahmininiz hazır — klinik kısa süre içinde gönderecek.",
  },
  quote_sent: {
    en: "Your clinic has sent a treatment estimate.",
    tr: "Klinik tedavi tahmininizi gönderdi.",
  },
};

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^treatment_requests\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

/**
 * @param {string} requestId
 * @param {Record<string, unknown>} patch
 */
async function patchTreatmentRequest(requestId, patch) {
  if (!isSupabaseEnabled() || !UUID_RE.test(requestId)) return { ok: false };
  let current = { ...patch, updated_at: new Date().toISOString() };
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabase.from("treatment_requests").update(current).eq("id", requestId);
    if (!error) return { ok: true };
    lastError = error;
    if (!isMissingColumnError(error)) break;
    const col = getMissingColumnName(error);
    if (!col || !(col in current)) break;
    delete current[col];
  }
  if (lastError) console.warn("[treatmentProposalWorkflow] patch:", lastError.message);
  return { ok: false, error: lastError };
}

/**
 * @param {string|null|undefined} raw
 * @param {boolean} hasOffers
 */
function normalizeProposalStatus(raw, hasOffers) {
  if (hasOffers) return PROPOSAL_STATUS.QUOTE_SENT;
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === PROPOSAL_STATUS.PROPOSAL_PENDING) return PROPOSAL_STATUS.WAITING_FOR_QUOTE;
  if (ACTIVE_QUOTE_STATUSES.has(s) || s === PROPOSAL_STATUS.QUOTE_SENT) return s;
  return PROPOSAL_STATUS.WAITING_FOR_QUOTE;
}

/**
 * @param {string} status
 * @param {string} [lang]
 */
function patientProposalLabel(status, lang = "en") {
  const code = String(lang || "en").slice(0, 2).toLowerCase();
  const map = PATIENT_STATUS_LABELS[status] || PATIENT_STATUS_LABELS.waiting_for_quote;
  return map[code] || map.en;
}

/**
 * @param {string|null|undefined} sinceIso
 */
function waitingMinutesSince(sinceIso) {
  if (!sinceIso) return null;
  const t = Date.parse(String(sinceIso));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

/**
 * @param {number|null} minutes
 */
function formatCoordinatorQueueTitle(minutes) {
  const m = minutes != null && minutes >= 0 ? minutes : 0;
  if (m < 60) return `Patient waiting for treatment estimate — ${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `Patient waiting for treatment estimate — ${h}h`;
  return `Patient waiting for treatment estimate — ${h}h ${rem}m`;
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ offerCount?: number }} [opts]
 */
function enrichRequestProposalFields(row, opts = {}) {
  const offerCount = opts.offerCount ?? 0;
  const hasOffers = offerCount > 0;
  const proposalStatus = normalizeProposalStatus(row.proposal_status, hasOffers);
  const since =
    row.proposal_waiting_since || row.proposal_status_at || row.created_at || null;
  const waitingMinutes = hasOffers ? null : waitingMinutesSince(since);
  const draft =
    row.proposal_draft && typeof row.proposal_draft === "object" ? row.proposal_draft : null;

  return {
    proposal_status: proposalStatus,
    proposal_status_at: row.proposal_status_at || null,
    proposal_waiting_since: since,
    proposal_waiting_minutes: waitingMinutes,
    proposal_status_label: patientProposalLabel(proposalStatus),
    proposal_draft: draft,
    proposal_draft_available: Boolean(draft),
    proposal_escalation_level:
      row.proposal_escalation_level != null ? Number(row.proposal_escalation_level) : 0,
    coordinator_queue_title:
      !hasOffers && ACTIVE_QUOTE_STATUSES.has(proposalStatus)
        ? formatCoordinatorQueueTitle(waitingMinutes)
        : null,
    needs_quote_action: !hasOffers && ACTIVE_QUOTE_STATUSES.has(proposalStatus),
  };
}

/**
 * @param {string} requestId
 * @param {string} clinicId
 * @param {string} patientId
 */
async function linkTreatmentRequestToLeadProfile(requestId, clinicId, patientId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) return;

  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, operational_intake_flags")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const profile = profiles?.[0];
  if (!profile?.id) return;

  const prev =
    profile.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};
  const now = new Date().toISOString();
  const flags = {
    ...prev,
    treatmentRequestId: requestId,
    proposalStatus: PROPOSAL_STATUS.WAITING_FOR_QUOTE,
    proposalWaitingSince: now,
    coordinatorQueueTitle: formatCoordinatorQueueTitle(0),
    proposalEscalationLevel: 0,
    leadStatus: LEAD_STATUS.INQUIRY,
    membershipType: "inquiry",
    workspaceClinicId: clinicId,
  };

  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({ operational_intake_flags: flags, updated_at: now })
    .eq("id", profile.id);

  void insertTimelineEvent({
    profileId: profile.id,
    eventType: "system",
    eventMetadata: {
      kind: "proposal_workflow_started",
      treatmentRequestId: requestId,
      proposalStatus: PROPOSAL_STATUS.WAITING_FOR_QUOTE,
    },
  }).catch(() => {});
}

/**
 * @param {{ id: string, clinic_id?: string, patient_id?: string }} requestRow
 */
async function initProposalOnRequestCreate(requestRow) {
  const requestId = String(requestRow?.id || "").trim();
  if (!UUID_RE.test(requestId)) return;

  const now = new Date().toISOString();
  await patchTreatmentRequest(requestId, {
    proposal_status: PROPOSAL_STATUS.WAITING_FOR_QUOTE,
    proposal_status_at: now,
    proposal_waiting_since: now,
    proposal_escalation_level: 0,
    lead_status: LEAD_STATUS.INQUIRY,
  });
  await setTreatmentRequestLeadStatus(requestId, LEAD_STATUS.INQUIRY);

  const clinicId = String(requestRow.clinic_id || "").trim();
  const patientId = String(requestRow.patient_id || "").trim();
  if (UUID_RE.test(clinicId) && UUID_RE.test(patientId)) {
    await ensureLeadWorkspaceForClinic(patientId, clinicId, {
      source: "quote_request",
      leadStatus: LEAD_STATUS.INQUIRY,
      treatmentRequestId: requestId,
    });
    await linkTreatmentRequestToLeadProfile(requestId, clinicId, patientId);
  }

  setImmediate(() => {
    generateProposalDraftForRequest(requestId).catch((e) => {
      console.warn("[treatmentProposalWorkflow] draft:", e?.message || e);
    });
  });
}

/**
 * @param {string} preferred
 * @param {Array<{ treatmentCode?: string, name?: string, basePrice?: number|null, currency?: string, variants?: unknown[] }>} treatments
 */
function matchPricingRows(preferred, treatments) {
  const pref = String(preferred || "").trim().toLowerCase();
  if (!pref) return treatments.slice(0, 6);
  const hits = treatments.filter((t) => {
    const code = String(t.treatmentCode || "").toLowerCase();
    const name = String(t.name || "").toLowerCase();
    return code.includes(pref) || name.includes(pref) || pref.includes(code) || pref.includes(name);
  });
  return (hits.length ? hits : treatments).slice(0, 8);
}

/**
 * @param {string} requestId
 */
async function generateProposalDraftForRequest(requestId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(requestId)) return null;

  const { data: row, error } = await supabase
    .from("treatment_requests")
    .select(
      "id, clinic_id, patient_id, description, budget, preferred_treatment, proposal_status, proposal_draft",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (error || !row) return null;

  const clinicId = String(row.clinic_id || "").trim();
  if (!UUID_RE.test(clinicId)) return null;

  await patchTreatmentRequest(requestId, {
    proposal_status: PROPOSAL_STATUS.QUOTE_IN_PROGRESS,
    proposal_status_at: new Date().toISOString(),
  });

  const pricing = await getPricingKnowledgeForAi(clinicId);
  const treatments = pricing.treatments || [];
  const matched = matchPricingRows(row.preferred_treatment, treatments);

  let protocols = [];
  try {
    protocols = await getRelevantProtocolsForAi(clinicId, {
      treatmentInterest: row.preferred_treatment,
      max: 3,
    });
  } catch {
    protocols = [];
  }

  const currency = matched[0]?.currency || treatments[0]?.currency || "EUR";
  const lines = matched.map((t) => {
    const base = t.basePrice != null ? Number(t.basePrice) : null;
    const variantPrices = (t.variants || [])
      .map((v) => (v && v.price != null ? Number(v.price) : null))
      .filter((n) => Number.isFinite(n));
    const min =
      variantPrices.length > 0
        ? Math.min(...variantPrices, base ?? Infinity)
        : base;
    const max =
      variantPrices.length > 0
        ? Math.max(...variantPrices, base ?? -Infinity)
        : base;
    let rangeText = null;
    if (min != null && Number.isFinite(min) && max != null && Number.isFinite(max)) {
      rangeText =
        min === max ? `${min} ${currency}` : `${min}–${max} ${currency}`;
    } else if (base != null) {
      rangeText = `${base} ${currency}`;
    }
    return {
      treatmentCode: t.treatmentCode,
      name: t.name,
      suggestedRangeText: rangeText,
      variantCount: (t.variants || []).length,
    };
  });

  const budgetHint = row.budget ? String(row.budget).trim() : null;
  const suggestedPriceText =
    lines.find((l) => l.suggestedRangeText)?.suggestedRangeText ||
    (budgetHint ? `Align with patient budget: ${budgetHint}` : null);

  const draft = {
    generatedAt: new Date().toISOString(),
    source: "clinic_pricing_and_protocols",
    aiAssisted: true,
    requiresHumanApproval: true,
    patientBudget: budgetHint,
    preferredTreatment: row.preferred_treatment || null,
    suggestedTreatments: lines,
    suggestedPriceText,
    structure: {
      sections: [
        { id: "summary", title: "Treatment summary", body: String(row.description || "").slice(0, 2000) },
        {
          id: "pricing",
          title: "Suggested pricing (from clinic list)",
          items: lines,
        },
        {
          id: "workflow",
          title: "Relevant workflows",
          protocolCount: protocols.length,
        },
      ],
    },
    coordinatorNotes:
      "Review ranges against clinical exam. Send official offer only after dentist approval.",
  };

  await patchTreatmentRequest(requestId, {
    proposal_status: PROPOSAL_STATUS.DOCTOR_REVIEW_REQUIRED,
    proposal_status_at: new Date().toISOString(),
    proposal_draft: draft,
  });

  const waitingMin = waitingMinutesSince(row.proposal_waiting_since || row.created_at);
  await syncLeadProposalFlags(requestId, clinicId, String(row.patient_id || ""), {
    proposalStatus: PROPOSAL_STATUS.DOCTOR_REVIEW_REQUIRED,
    proposalDraftReady: true,
    coordinatorQueueTitle: formatCoordinatorQueueTitle(waitingMin),
  });

  return draft;
}

/**
 * @param {string} requestId
 * @param {string} clinicId
 * @param {string} patientId
 * @param {Record<string, unknown>} patch
 */
async function syncLeadProposalFlags(requestId, clinicId, patientId, patch) {
  if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) return;
  const { data: profiles } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, operational_intake_flags")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const profile = profiles?.[0];
  if (!profile?.id) return;
  const prev =
    profile.operational_intake_flags && typeof profile.operational_intake_flags === "object"
      ? profile.operational_intake_flags
      : {};
  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      operational_intake_flags: {
        ...prev,
        treatmentRequestId: requestId,
        ...patch,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
}

/**
 * @param {string} requestId
 * @param {string} status
 */
async function setProposalStatus(requestId, status) {
  const normalized = normalizeProposalStatus(status, false);
  const now = new Date().toISOString();
  const patch = {
    proposal_status: normalized,
    proposal_status_at: now,
  };
  if (normalized === PROPOSAL_STATUS.QUOTE_SENT) {
    patch.proposal_waiting_since = null;
  }
  await patchTreatmentRequest(requestId, patch);

  const { data: row } = await supabase
    .from("treatment_requests")
    .select("clinic_id, patient_id")
    .eq("id", requestId)
    .maybeSingle();
  if (row?.clinic_id && row?.patient_id) {
    await syncLeadProposalFlags(requestId, String(row.clinic_id), String(row.patient_id), {
      proposalStatus: normalized,
    });
  }
  return normalized;
}

/**
 * @param {string} requestId
 */
async function markProposalQuoteSent(requestId) {
  await setTreatmentRequestLeadStatus(requestId, LEAD_STATUS.QUOTED);
  return setProposalStatus(requestId, PROPOSAL_STATUS.QUOTE_SENT);
}

/**
 * @param {string} clinicId
 * @param {{ limit?: number }} [opts]
 */
async function listProposalQueueForClinic(clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  const limit = Math.min(200, Math.max(1, opts.limit || 80));
  const { data: rows, error } = await supabase
    .from("treatment_requests")
    .select(
      "id, patient_id, clinic_id, description, budget, preferred_treatment, status, created_at, proposal_status, proposal_status_at, proposal_waiting_since, proposal_draft, proposal_escalation_level",
    )
    .eq("clinic_id", clinicId)
    .in("proposal_status", [
      PROPOSAL_STATUS.WAITING_FOR_QUOTE,
      PROPOSAL_STATUS.PROPOSAL_PENDING,
      PROPOSAL_STATUS.QUOTE_IN_PROGRESS,
      PROPOSAL_STATUS.DOCTOR_REVIEW_REQUIRED,
      PROPOSAL_STATUS.READY_TO_SEND,
    ])
    .order("proposal_waiting_since", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.warn("[treatmentProposalWorkflow] queue:", error.message);
    return [];
  }

  const ids = (rows || []).map((r) => r.id).filter(Boolean);
  const offerCountByReq = {};
  if (ids.length) {
    const { data: offers } = await supabase
      .from("treatment_offers")
      .select("request_id")
      .in("request_id", ids);
    for (const o of offers || []) {
      const rid = o.request_id;
      offerCountByReq[rid] = (offerCountByReq[rid] || 0) + 1;
    }
  }

  const pids = [...new Set((rows || []).map((r) => r.patient_id).filter((id) => UUID_RE.test(String(id))))];
  const nameById = {};
  if (pids.length) {
    const { data: patients } = await supabase
      .from("patients")
      .select("id, full_name, name")
      .in("id", pids.slice(0, 200));
    for (const p of patients || []) {
      nameById[p.id] = String(p.full_name || p.name || "Patient").trim();
    }
  }

  return (rows || [])
    .filter((r) => !(offerCountByReq[r.id] > 0))
    .map((r) => {
      const enriched = enrichRequestProposalFields(r, { offerCount: 0 });
      return {
        requestId: r.id,
        patientId: r.patient_id,
        patientName: nameById[r.patient_id] || "Patient",
        preferredTreatment: r.preferred_treatment,
        budget: r.budget,
        description: String(r.description || "").slice(0, 400),
        createdAt: r.created_at,
        ...enriched,
        priority: enriched.proposal_escalation_level >= 2 ? "high" : "normal",
      };
    });
}

/**
 * SLA reminders when quote not sent.
 */
async function runProposalSlaSweep() {
  if (!isSupabaseEnabled() || process.env.PROPOSAL_SLA_SWEEP_ENABLED === "false") return;

  const { data: rows, error } = await supabase
    .from("treatment_requests")
    .select(
      "id, clinic_id, patient_id, proposal_status, proposal_waiting_since, created_at, proposal_escalation_level",
    )
    .in("proposal_status", [
      PROPOSAL_STATUS.WAITING_FOR_QUOTE,
      PROPOSAL_STATUS.QUOTE_IN_PROGRESS,
      PROPOSAL_STATUS.DOCTOR_REVIEW_REQUIRED,
      PROPOSAL_STATUS.READY_TO_SEND,
    ])
    .order("proposal_waiting_since", { ascending: true })
    .limit(120);

  if (error || !rows?.length) return;

  const requestIds = rows.map((r) => r.id);
  const { data: offers } = await supabase
    .from("treatment_offers")
    .select("request_id")
    .in("request_id", requestIds);
  const withOffer = new Set((offers || []).map((o) => o.request_id));

  for (const row of rows) {
    if (withOffer.has(row.id)) {
      void markProposalQuoteSent(String(row.id));
      continue;
    }
    const clinicId = String(row.clinic_id || "").trim();
    if (!UUID_RE.test(clinicId)) continue;

    const since = row.proposal_waiting_since || row.created_at;
    const minutes = waitingMinutesSince(since);
    if (minutes == null) continue;

    const profile = await getClinicAiProfile(clinicId);
    const coordMin = Number(profile.escalation?.coordinatorEscalationAfterMinutes) || 60;
    const doctorMin = coordMin * 2;
    const level = Number(row.proposal_escalation_level) || 0;
    let targetLevel = 0;
    if (minutes >= doctorMin) targetLevel = 2;
    else if (minutes >= coordMin) targetLevel = 1;

    if (targetLevel <= level) continue;

    await patchTreatmentRequest(String(row.id), {
      proposal_escalation_level: targetLevel,
    });

    const { data: leadProfiles } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("patient_id", row.patient_id)
      .limit(1);
    const profileId = leadProfiles?.[0]?.id;
    if (!profileId) continue;

    const kind =
      targetLevel >= 2 ? "proposal_sla_doctor_reminder" : "proposal_sla_coordinator_reminder";
    void insertTimelineEvent({
      profileId,
      eventType: "system",
      eventMetadata: {
        kind,
        treatmentRequestId: row.id,
        waitingMinutes: minutes,
        coordinatorQueueTitle: formatCoordinatorQueueTitle(minutes),
      },
    }).catch(() => {});
  }
}

function setupProposalSlaSweep() {
  if (process.env.PROPOSAL_SLA_SWEEP_ENABLED === "false") return;
  const ms = Math.max(
    120_000,
    parseInt(process.env.PROPOSAL_SLA_SWEEP_MS || String(5 * 60 * 1000), 10) || 300_000,
  );
  setInterval(() => {
    runProposalSlaSweep().catch((e) => {
      console.warn("[treatmentProposalWorkflow] SLA sweep:", e?.message || e);
    });
  }, ms).unref?.();
  console.log("[treatmentProposalWorkflow] proposal SLA sweep every", ms, "ms");
}

module.exports = {
  PROPOSAL_STATUS,
  ACTIVE_QUOTE_STATUSES,
  normalizeProposalStatus,
  patientProposalLabel,
  enrichRequestProposalFields,
  initProposalOnRequestCreate,
  generateProposalDraftForRequest,
  setProposalStatus,
  markProposalQuoteSent,
  listProposalQueueForClinic,
  runProposalSlaSweep,
  setupProposalSlaSweep,
  formatCoordinatorQueueTitle,
};
