/**
 * Resolve clinic_id for AI / messaging when patients.clinic_id is null (archived, unlinked, marketplace).
 * Offer threads, treatment requests, lead profiles, and threads retain operational clinic context.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} label
 * @param {Record<string, unknown>} detail
 */
function logClinicResolution(label, detail) {
  console.log("[clinicOperationalContext]", label, detail);
}

/**
 * @param {unknown} clinicId
 */
function asClinicUuid(clinicId) {
  const id = String(clinicId || "").trim();
  return UUID_RE.test(id) ? id : null;
}

/**
 * @param {string} resolvedPatientId
 * @param {string} [clinicCode]
 */
async function clinicIdFromCode(clinicCode) {
  const code = String(clinicCode || "")
    .trim()
    .toUpperCase();
  if (!code || !isSupabaseEnabled()) return null;
  const attempts = [
    () => supabase.from("clinics").select("id").eq("clinic_code", code).maybeSingle(),
    () => supabase.from("clinics").select("id").ilike("clinic_code", code).maybeSingle(),
  ];
  for (const run of attempts) {
    const { data, error } = await run();
    if (!error && data?.id) return asClinicUuid(data.id);
  }
  return null;
}

/**
 * Explicit clinic membership (QR / invite registration).
 * @param {string} patientId
 * @param {string} [preferClinicId]
 */
async function fromPatientClinicLinks(patientId, preferClinicId) {
  const { data, error } = await supabase
    .from("patient_clinic_links")
    .select("clinic_id, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    const code = String(error.code || "");
    if (
      code === "42P01" ||
      code === "PGRST205" ||
      msg.includes("patient_clinic_links") ||
      msg.includes("does not exist")
    ) {
      return null;
    }
    return null;
  }
  if (!data?.length) return null;
  const prefer = asClinicUuid(preferClinicId);
  if (prefer) {
    const hit = data.find((r) => asClinicUuid(r.clinic_id) === prefer);
    if (hit) {
      return { clinicId: prefer, source: "patient_clinic_link_match" };
    }
  }
  const cid = asClinicUuid(data[0]?.clinic_id);
  return cid ? { clinicId: cid, source: "patient_clinic_link" } : null;
}

/**
 * @param {string} patientId
 */
async function fromPatientRow(patientId) {
  const selects = ["id, clinic_id, clinic_code, archived_at, archive_reason", "id, clinic_id, clinic_code"];
  for (const sel of selects) {
    const { data, error } = await supabase.from("patients").select(sel).eq("id", patientId).maybeSingle();
    if (error || !data) continue;
    const cid = asClinicUuid(data.clinic_id);
    if (cid) {
      return {
        clinicId: cid,
        source: "patient_row",
        archived: data.archived_at != null,
        archiveReason: data.archive_reason || null,
      };
    }
    if (data.clinic_code) {
      const fromCode = await clinicIdFromCode(data.clinic_code);
      if (fromCode) return { clinicId: fromCode, source: "patient_row_code" };
    }
    break;
  }
  return null;
}

/**
 * @param {string} patientId
 * @param {string} [preferClinicId]
 */
async function fromLeadProfiles(patientId, preferClinicId) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("clinic_id, updated_at, operational_intake_flags")
    .eq("patient_id", patientId)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error || !data?.length) return null;

  const prefer = asClinicUuid(preferClinicId);
  for (const row of data) {
    const flags =
      row.operational_intake_flags && typeof row.operational_intake_flags === "object"
        ? row.operational_intake_flags
        : {};
    const workspaceCid = asClinicUuid(flags.workspaceClinicId);
    if (workspaceCid) {
      if (!prefer || workspaceCid === prefer) {
        return { clinicId: workspaceCid, source: "lead_profile_workspace" };
      }
    }
  }

  const withClinic = data.filter((r) => asClinicUuid(r.clinic_id));
  if (prefer) {
    const hit = withClinic.find((r) => asClinicUuid(r.clinic_id) === prefer);
    if (hit) return { clinicId: prefer, source: "lead_profile_match" };
  }
  const cid = asClinicUuid(withClinic[0]?.clinic_id);
  return cid ? { clinicId: cid, source: "lead_profile" } : null;
}

/**
 * @param {string} patientId
 * @param {string} [preferClinicId]
 */
async function fromTreatmentRequests(patientId, preferClinicId) {
  const { data, error } = await supabase
    .from("treatment_requests")
    .select("id, clinic_id, status, created_at")
    .eq("patient_id", patientId)
    .not("clinic_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error || !data?.length) return null;
  const prefer = asClinicUuid(preferClinicId);
  const rows = data.filter((r) => asClinicUuid(r.clinic_id));
  if (prefer) {
    const hit = rows.find((r) => asClinicUuid(r.clinic_id) === prefer);
    if (hit) {
      return {
        clinicId: prefer,
        source: "treatment_request_match",
        treatmentRequestId: hit.id,
      };
    }
  }
  const pending = rows.find((r) => String(r.status || "").toLowerCase() === "pending");
  const pick = pending || rows[0];
  const cid = asClinicUuid(pick?.clinic_id);
  return cid
    ? {
        clinicId: cid,
        source: pending ? "treatment_request_pending" : "treatment_request",
        treatmentRequestId: pick.id,
      }
    : null;
}

/**
 * @param {string} patientId
 * @param {string} [preferClinicId]
 */
async function fromTreatmentOffers(patientId, preferClinicId) {
  const { data: reqs } = await supabase
    .from("treatment_requests")
    .select("id, clinic_id")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(40);
  const requestIds = (reqs || []).map((r) => r.id).filter(Boolean);
  if (!requestIds.length) return null;

  let offerQ = supabase
    .from("treatment_offers")
    .select("id, clinic_id, request_id, created_at")
    .in("request_id", requestIds)
    .order("created_at", { ascending: false })
    .limit(12);
  const { data: offers, error } = await offerQ;
  if (error || !offers?.length) return null;

  const prefer = asClinicUuid(preferClinicId);
  for (const o of offers) {
    let cid = asClinicUuid(o.clinic_id);
    if (!cid) {
      const req = (reqs || []).find((r) => r.id === o.request_id);
      cid = asClinicUuid(req?.clinic_id);
    }
    if (!cid) continue;
    if (prefer && cid !== prefer) continue;
    return {
      clinicId: cid,
      source: "treatment_offer",
      offerId: o.id,
      treatmentRequestId: o.request_id,
    };
  }
  if (prefer) return null;
  const o0 = offers[0];
  let cid = asClinicUuid(o0.clinic_id);
  if (!cid) {
    const req = (reqs || []).find((r) => r.id === o0.request_id);
    cid = asClinicUuid(req?.clinic_id);
  }
  return cid
    ? {
        clinicId: cid,
        source: "treatment_offer",
        offerId: o0.id,
        treatmentRequestId: o0.request_id,
      }
    : null;
}

/**
 * @param {string} offerId
 */
async function fromOfferId(offerId) {
  const oid = String(offerId || "").trim();
  if (!UUID_RE.test(oid)) return null;
  const { data: offer } = await supabase
    .from("treatment_offers")
    .select("id, clinic_id, request_id")
    .eq("id", oid)
    .maybeSingle();
  if (!offer) return null;
  let cid = asClinicUuid(offer.clinic_id);
  if (!cid && offer.request_id) {
    const { data: tr } = await supabase
      .from("treatment_requests")
      .select("clinic_id, patient_id")
      .eq("id", offer.request_id)
      .maybeSingle();
    cid = asClinicUuid(tr?.clinic_id);
  }
  return cid
    ? {
        clinicId: cid,
        source: "offer_id",
        offerId: oid,
        treatmentRequestId: offer.request_id,
      }
    : null;
}

/**
 * @param {string} patientId
 * @param {string} [preferClinicId]
 */
async function fromChatThreads(patientId, preferClinicId) {
  const { data, error } = await supabase
    .from("patient_chat_threads")
    .select("clinic_id, lifecycle_status, archived_at, updated_at, is_lead")
    .eq("patient_id", patientId)
    .not("clinic_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error || !data?.length) return null;

  const prefer = asClinicUuid(preferClinicId);
  const score = (row) => {
    let s = 0;
    const cid = asClinicUuid(row.clinic_id);
    if (prefer && cid === prefer) s += 100;
    if (row.lifecycle_status !== "archived" && row.archived_at == null) s += 50;
    if (row.is_lead === true) s += 10;
    return s;
  };
  const sorted = [...data].sort((a, b) => score(b) - score(a));
  const pick = sorted[0];
  const cid = asClinicUuid(pick?.clinic_id);
  if (!cid) return null;
  const archived = pick.lifecycle_status === "archived" || pick.archived_at != null;
  return {
    clinicId: cid,
    source: archived ? "chat_thread_archived" : "chat_thread",
    threadArchived: archived,
  };
}

/**
 * @param {string} patientId
 */
async function fromMessageHistory(patientId) {
  for (const table of ["patient_messages", "messages"]) {
    const { data, error } = await supabase
      .from(table)
      .select("clinic_id, clinic_code, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) continue;
    const cid = asClinicUuid(data?.clinic_id);
    if (cid) return { clinicId: cid, source: `${table}_history` };
    if (data?.clinic_code) {
      const fromCode = await clinicIdFromCode(data.clinic_code);
      if (fromCode) return { clinicId: fromCode, source: `${table}_history_code` };
    }
  }
  return null;
}

/**
 * @param {string} treatmentRequestId
 */
async function fromTreatmentRequestId(treatmentRequestId) {
  const rid = String(treatmentRequestId || "").trim();
  if (!UUID_RE.test(rid)) return null;
  const { data } = await supabase
    .from("treatment_requests")
    .select("id, clinic_id, patient_id")
    .eq("id", rid)
    .maybeSingle();
  const cid = asClinicUuid(data?.clinic_id);
  return cid
    ? { clinicId: cid, source: "treatment_request_id", treatmentRequestId: rid }
    : null;
}

/**
 * Resolve operational clinic context for AI / inbound hooks.
 * @param {string} patientId — resolved patients.id UUID
 * @param {{
 *   contextClinicId?: string|null,
 *   contextClinicCode?: string|null,
 *   offerId?: string|null,
 *   treatmentRequestId?: string|null,
 *   logLabel?: string,
 * }} [opts]
 */
async function resolveOperationalClinicId(patientId, opts = {}) {
  const pid = String(patientId || "").trim();
  const logLabel = opts.logLabel || "resolve";
  if (!UUID_RE.test(pid) || !isSupabaseEnabled()) {
    return { clinicId: null, source: null, skippedReason: "invalid_patient_or_supabase" };
  }

  const ctxId = asClinicUuid(opts.contextClinicId);
  if (ctxId) {
    const hit = { clinicId: ctxId, source: "request_context_clinic_id" };
    logClinicResolution(logLabel, { patientId: pid.slice(0, 8), ...hit });
    return hit;
  }

  const ctxCode = String(opts.contextClinicCode || "").trim();
  if (ctxCode) {
    const fromCode = await clinicIdFromCode(ctxCode);
    if (fromCode) {
      const hit = { clinicId: fromCode, source: "request_context_clinic_code" };
      logClinicResolution(logLabel, { patientId: pid.slice(0, 8), ...hit });
      return hit;
    }
  }

  if (opts.offerId) {
    const fromOffer = await fromOfferId(opts.offerId);
    if (fromOffer?.clinicId) {
      logClinicResolution(logLabel, { patientId: pid.slice(0, 8), ...fromOffer });
      return fromOffer;
    }
  }

  if (opts.treatmentRequestId) {
    const fromTr = await fromTreatmentRequestId(opts.treatmentRequestId);
    if (fromTr?.clinicId) {
      logClinicResolution(logLabel, { patientId: pid.slice(0, 8), ...fromTr });
      return fromTr;
    }
  }

  const chain = [
    () => fromTreatmentOffers(pid, ctxId),
    () => fromTreatmentRequests(pid, ctxId),
    () => fromPatientClinicLinks(pid, ctxId),
    () => fromLeadProfiles(pid, ctxId),
    () => fromChatThreads(pid, ctxId),
    () => fromMessageHistory(pid),
    () => fromPatientRow(pid),
  ];

  for (const fn of chain) {
    const hit = await fn();
    if (hit?.clinicId) {
      logClinicResolution(logLabel, {
        patientId: pid.slice(0, 8),
        clinicId: hit.clinicId.slice(0, 8),
        source: hit.source,
        threadArchived: hit.threadArchived,
        archived: hit.archived,
        archiveReason: hit.archiveReason,
      });
      return hit;
    }
  }

  const envDefault = asClinicUuid(process.env.DEFAULT_CLINIC_ID);
  if (envDefault) {
    logClinicResolution(logLabel, {
      patientId: pid.slice(0, 8),
      clinicId: envDefault.slice(0, 8),
      source: "env_default_clinic_id",
    });
    return { clinicId: envDefault, source: "env_default_clinic_id" };
  }

  logClinicResolution(logLabel, {
    patientId: pid.slice(0, 8),
    clinicId: null,
    source: null,
    skippedReason: "no_operational_clinic_context",
  });
  return { clinicId: null, source: null, skippedReason: "no_operational_clinic_context" };
}

/**
 * @param {string} clinicId
 * @param {string} patientId
 * @param {Record<string, unknown>} resolution
 */
function logAiOrchestrationSkip(clinicId, patientId, resolution) {
  console.log("[aiOrchestration] skipped", {
    patientId: String(patientId || "").slice(0, 8),
    clinicId: clinicId ? String(clinicId).slice(0, 8) : null,
    clinicSource: resolution?.source || null,
    reason: resolution?.skippedReason || resolution?.reason || "unknown",
  });
}

/**
 * @param {Record<string, unknown>} delegation
 * @param {string} clinicId
 */
function logAiDelegationEvaluation(delegation, clinicId) {
  const payload = {
    clinicId: String(clinicId || "").slice(0, 8),
    aiPaused: delegation?.aiPaused,
    aiEscalationRequired: delegation?.aiEscalationRequired,
    autoReplyAllowed: delegation?.autoReplyAllowed,
    draftGenerationAllowed: delegation?.draftGenerationAllowed,
    aiMode: delegation?.aiMode,
    offerId: delegation?.offerId ? String(delegation.offerId).slice(0, 8) : undefined,
    source: delegation?.source,
  };
  console.log("[aiOrchestration] delegation", payload);
  console.log("[aiDelegation]", payload);
}

/**
 * Latest linked clinic for a patient (invite / QR membership).
 * @param {string} patientId
 * @param {string} [preferClinicId]
 * @returns {Promise<string|null>}
 */
async function resolveClinicIdFromPatientClinicLinks(patientId, preferClinicId) {
  const hit = await fromPatientClinicLinks(patientId, preferClinicId);
  return hit?.clinicId || null;
}

module.exports = {
  resolveOperationalClinicId,
  resolveClinicIdFromPatientClinicLinks,
  logAiOrchestrationSkip,
  logAiDelegationEvaluation,
  asClinicUuid,
};
