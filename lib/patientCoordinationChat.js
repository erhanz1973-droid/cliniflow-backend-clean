/**
 * Patient coordination chat — messaging workspace before a formal clinic proposal exists.
 * Uses a placeholder treatment_offer row for offer_messages only; not shown as a "doctor offer".
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { ensureLeadWorkspaceForClinic, LEAD_STATUS } = require("./patientLeadLifecycle");
const {
  ensurePatientClinicThread,
  linkTreatmentRequestToThread,
} = require("./patientClinicChatThread");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COORDINATION_NOTE = "__coordination_workspace__";

/**
 * @param {Record<string, unknown>|null|undefined} offer
 */
function isCoordinationPlaceholderOffer(offer) {
  if (!offer || typeof offer !== "object") return false;
  const note = String(offer.note || "").trim();
  if (note === COORDINATION_NOTE || note.includes("Coordination workspace")) return true;
  if (offer.is_coordination_placeholder === true) return true;
  const price = offer.price_text ?? offer.price_range;
  if (!price && note === COORDINATION_NOTE) return true;
  return false;
}

/**
 * @param {string} clinicId
 */
/** Whether the clinic can host patient messaging (approved doctor or env placeholder). */
async function clinicHasMessagingDoctor(clinicId) {
  return !!(await resolveDefaultDoctorForClinic(clinicId));
}

function doctorRowHasMessagingId(row) {
  const id = row?.id || row?.doctor_id;
  return id && UUID_RE.test(String(id)) ? String(id).trim() : null;
}

function doctorStatusEligible(statusRaw) {
  const st = String(statusRaw || "").trim().toUpperCase();
  return st === "APPROVED" || st === "ACTIVE";
}

/**
 * One doctors query for many clinics — avoids N× resolveDefaultDoctorForClinic round-trips on GET treatment-requests.
 * @param {string[]} clinicIds
 * @returns {Promise<Record<string, boolean>>}
 */
async function batchClinicHasMessagingDoctor(clinicIds) {
  const ids = [
    ...new Set(
      (clinicIds || [])
        .map((x) => String(x || "").trim())
        .filter((id) => UUID_RE.test(id)),
    ),
  ];
  const out = Object.fromEntries(ids.map((id) => [id, false]));
  if (!ids.length || !isSupabaseEnabled()) return out;

  const envDoctor = String(process.env.COORDINATION_PLACEHOLDER_DOCTOR_ID || "").trim();
  if (UUID_RE.test(envDoctor)) {
    for (const id of ids) out[id] = true;
    return out;
  }

  const { data: rows, error } = await supabase
    .from("doctors")
    .select("id, doctor_id, status, clinic_id, updated_at")
    .in("clinic_id", ids);
  if (error || !rows?.length) return out;

  const byClinic = new Map();
  for (const row of rows) {
    const cid = String(row.clinic_id || "").trim();
    if (!cid || !doctorRowHasMessagingId(row)) continue;
    if (!byClinic.has(cid)) byClinic.set(cid, []);
    byClinic.get(cid).push(row);
  }

  for (const cid of ids) {
    const list = byClinic.get(cid) || [];
    if (!list.length) continue;
    const approved = list.find((r) => doctorStatusEligible(r.status));
    if (approved && doctorRowHasMessagingId(approved)) {
      out[cid] = true;
      continue;
    }
    const sorted = [...list].sort(
      (a, b) =>
        (Date.parse(String(b.updated_at || "")) || 0) -
        (Date.parse(String(a.updated_at || "")) || 0),
    );
    if (sorted.some((r) => doctorRowHasMessagingId(r))) out[cid] = true;
  }
  return out;
}

/** Patient joined this clinic (shared-care). Formal offer threads archive; coordination placeholder does not. */
async function isPatientEnrolledAtClinic(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return false;

  try {
    const { data: prow } = await supabase
      .from("patients")
      .select("clinic_id, is_lead")
      .eq("id", pid)
      .maybeSingle();
    if (
      prow?.clinic_id != null &&
      String(prow.clinic_id).trim().toLowerCase() === cid.toLowerCase() &&
      prow.is_lead === false
    ) {
      return true;
    }
    const { data: enrolledThr } = await supabase
      .from("patient_chat_threads")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .eq("is_lead", false)
      .limit(1)
      .maybeSingle();
    return !!enrolledThr?.id;
  } catch (_) {
    return false;
  }
}

async function resolveDefaultDoctorForClinic(clinicId) {
  if (!UUID_RE.test(clinicId)) return null;

  const envDoctor = String(process.env.COORDINATION_PLACEHOLDER_DOCTOR_ID || "").trim();
  if (UUID_RE.test(envDoctor)) return envDoctor;

  const pickId = (row) => {
    const id = row?.id || row?.doctor_id;
    return id && UUID_RE.test(String(id)) ? String(id).trim() : null;
  };

  const { data: approved } = await supabase
    .from("doctors")
    .select("id, doctor_id, status")
    .eq("clinic_id", clinicId)
    .in("status", ["APPROVED", "ACTIVE"])
    .limit(1)
    .maybeSingle();
  const approvedId = pickId(approved);
  if (approvedId) return approvedId;

  const { data: anyDoc } = await supabase
    .from("doctors")
    .select("id, doctor_id, status")
    .eq("clinic_id", clinicId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const anyId = pickId(anyDoc);
  if (anyId) return anyId;

  const { data: legacy } = await supabase
    .from("doctors")
    .select("id, doctor_id")
    .eq("clinic_id", clinicId)
    .not("doctor_id", "is", null)
    .limit(1)
    .maybeSingle();
  return pickId(legacy);
}

/**
 * One coordination placeholder offer per patient+clinic (not per treatment_request).
 * @param {string} patientId
 * @param {string} clinicId
 */
async function findSharedCoordinationPlaceholderOffer(patientId, clinicId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !isSupabaseEnabled()) return null;

  try {
    const { data: requests } = await supabase
      .from("treatment_requests")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("created_at", { ascending: true })
      .limit(80);
    const requestIds = (requests || []).map((r) => String(r.id || "").trim()).filter(Boolean);
    if (!requestIds.length) return null;

    const { data: offers } = await supabase
      .from("treatment_offers")
      .select("id, request_id, note, price_text, price_range, doctor_id, created_at")
      .in("request_id", requestIds)
      .order("created_at", { ascending: true });

    for (const o of offers || []) {
      if (isCoordinationPlaceholderOffer(o) && o.id) {
        return {
          offerId: String(o.id),
          requestId: String(o.request_id || "").trim() || null,
        };
      }
    }
  } catch (e) {
    console.warn("[patientCoordinationChat] findSharedCoordinationPlaceholderOffer:", e?.message || e);
  }
  return null;
}

/**
 * Persist canonical offer id on lead profile flags (patient+clinic scope).
 */
async function persistSharedCoordinationOfferId(patientId, clinicId, offerId) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  const oid = String(offerId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid) || !UUID_RE.test(oid)) return;

  try {
    const { data: prof } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("id, operational_intake_flags")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prof?.id) return;
    const prev =
      prof.operational_intake_flags && typeof prof.operational_intake_flags === "object"
        ? prof.operational_intake_flags
        : {};
    const flags = {
      ...prev,
      coordinationOfferId: oid,
      coordination_offer_id: oid,
    };
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({ operational_intake_flags: flags, updated_at: new Date().toISOString() })
      .eq("id", prof.id);
  } catch (e) {
    console.warn("[patientCoordinationChat] persistSharedCoordinationOfferId:", e?.message || e);
  }
}

/**
 * @param {string} requestId
 * @param {{ createIfMissing?: boolean }} [opts]
 */
async function ensureCoordinationOfferForRequest(requestId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(requestId)) {
    return { ok: false, reason: "invalid_request" };
  }

  const { data: tr, error: trErr } = await supabase
    .from("treatment_requests")
    .select("id, patient_id, clinic_id, preferred_treatment, status, lead_status, thread_id")
    .eq("id", requestId)
    .maybeSingle();

  if (trErr || !tr?.id) {
    return { ok: false, reason: "request_not_found" };
  }

  const patientId = String(tr.patient_id || "").trim();
  const clinicId = String(tr.clinic_id || "").trim();
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { ok: false, reason: "invalid_request_context" };
  }

  const enrolled = await isPatientEnrolledAtClinic(patientId, clinicId);

  const threadResult = await ensurePatientClinicThread(patientId, clinicId, { isLead: !enrolled });
  const threadId = threadResult.threadId || tr.thread_id || null;
  if (threadId && !tr.thread_id) {
    await linkTreatmentRequestToThread(requestId, threadId);
  } else if (tr.thread_id) {
    await linkTreatmentRequestToThread(requestId, String(tr.thread_id));
  }

  const { data: existingOffers } = await supabase
    .from("treatment_offers")
    .select("id, request_id, note, price_text, price_range, doctor_id, created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });

  const rows = existingOffers || [];
  const realOffers = rows.filter((o) => !isCoordinationPlaceholderOffer(o));
  if (realOffers.length > 0) {
    const latest = realOffers[realOffers.length - 1];
    const offerId = String(latest.id);
    await persistSharedCoordinationOfferId(patientId, clinicId, offerId);
    return {
      ok: true,
      offerId,
      threadId,
      patientId,
      clinicId,
      route: "offer_chat",
      enrolled,
      hasFormalOffer: true,
      offerCreated: false,
    };
  }

  const shared = await findSharedCoordinationPlaceholderOffer(patientId, clinicId);
  if (shared?.offerId) {
    await persistSharedCoordinationOfferId(patientId, clinicId, shared.offerId);
    if (threadId) await linkTreatmentRequestToThread(requestId, threadId);
    console.log("[patientCoordinationChat] reusing shared coordination offer", {
      requestId: requestId.slice(0, 8),
      offerId: shared.offerId.slice(0, 8),
      patientId: patientId.slice(0, 8),
      clinicId: clinicId.slice(0, 8),
    });
    return {
      ok: true,
      offerId: shared.offerId,
      threadId,
      patientId,
      clinicId,
      route: "offer_chat",
      enrolled,
      hasFormalOffer: false,
      offerCreated: false,
      reusedSharedOffer: true,
    };
  }

  const placeholder = rows.find((o) => isCoordinationPlaceholderOffer(o));
  if (placeholder?.id) {
    const offerId = String(placeholder.id);
    await persistSharedCoordinationOfferId(patientId, clinicId, offerId);
    return {
      ok: true,
      offerId,
      threadId,
      patientId,
      clinicId,
      route: "offer_chat",
      enrolled,
      hasFormalOffer: false,
      offerCreated: false,
    };
  }

  if (opts.createIfMissing === false) {
    return { ok: false, reason: "no_coordination_offer", patientId, clinicId, threadId };
  }

  const doctorId = await resolveDefaultDoctorForClinic(clinicId);
  if (!doctorId) {
    return { ok: false, reason: "no_clinic_doctor", patientId, clinicId, threadId };
  }

  const pref = String(tr.preferred_treatment || "inquiry").trim() || "inquiry";
  const insert = {
    request_id: requestId,
    doctor_id: doctorId,
    clinic_id: clinicId,
    treatment_type: pref,
    price_text: null,
    price_range: null,
    duration: null,
    note: COORDINATION_NOTE,
    created_at: new Date().toISOString(),
  };

  const { data: inserted, error: insErr } = await supabase
    .from("treatment_offers")
    .insert(insert)
    .select("id")
    .maybeSingle();

  if (insErr || !inserted?.id) {
    console.warn("[patientCoordinationChat] placeholder offer insert:", insErr?.message || insErr);
    return { ok: false, reason: "offer_create_failed", patientId, clinicId, threadId };
  }

  const offerId = String(inserted.id);
  await persistSharedCoordinationOfferId(patientId, clinicId, offerId);

  await ensureLeadWorkspaceForClinic(patientId, clinicId, {
    source: "coordination_chat",
    leadStatus: tr.lead_status || LEAD_STATUS.INQUIRY,
  });

  console.log("[patientCoordinationChat] coordination workspace offer created (shared thread)", {
    requestId: requestId.slice(0, 8),
    offerId: offerId.slice(0, 8),
    threadId: threadId ? String(threadId).slice(0, 8) : null,
    clinicId: clinicId.slice(0, 8),
  });

  return {
    ok: true,
    offerId,
    threadId,
    patientId,
    clinicId,
    route: "offer_chat",
    enrolled,
    hasFormalOffer: false,
    offerCreated: true,
  };
}

/**
 * Canonical offer thread for lead/coordination chat (patient offer-chat + doctor workspace).
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ createIfMissing?: boolean }} [opts]
 */
async function resolveCoordinationOfferIdForPatientClinic(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) return null;

  const createIfMissing = opts.createIfMissing !== false;

  try {
    const { data: profile } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select("operational_intake_flags")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const flags =
      profile?.operational_intake_flags && typeof profile.operational_intake_flags === "object"
        ? profile.operational_intake_flags
        : {};

    const fromFlags = String(
      flags.coordinationOfferId || flags.coordination_offer_id || "",
    ).trim();
    if (UUID_RE.test(fromFlags)) return fromFlags;

    const shared = await findSharedCoordinationPlaceholderOffer(pid, cid);
    if (shared?.offerId) {
      await persistSharedCoordinationOfferId(pid, cid, shared.offerId);
      return shared.offerId;
    }

    const requestId = String(
      flags.treatmentRequestId || flags.treatment_request_id || "",
    ).trim();
    if (UUID_RE.test(requestId)) {
      const ensured = await ensureCoordinationOfferForRequest(requestId, { createIfMissing });
      if (ensured.ok && ensured.offerId) return String(ensured.offerId);
    }

    const { data: tr } = await supabase
      .from("treatment_requests")
      .select("id")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tr?.id) {
      const ensured = await ensureCoordinationOfferForRequest(String(tr.id), { createIfMissing });
      if (ensured.ok && ensured.offerId) return String(ensured.offerId);
    }
  } catch (e) {
    console.warn(
      "[patientCoordinationChat] resolveCoordinationOfferId:",
      e?.message || e,
    );
  }

  return null;
}

const CLINIC_DOCTOR_NOT_ASSIGNED = {
  error: "clinic_doctor_not_assigned",
  message:
    "Bu klinik henüz mesajlarınıza yanıt verecek bir doktor atamadı. Lütfen daha sonra tekrar deneyin.",
  message_en:
    "This clinic has not assigned a doctor to respond to messages yet. Please try again later.",
};

/**
 * Discovery "Chat with clinic" — patient+clinic without an existing treatment request.
 * Reuses shared coordination thread or creates a minimal inquiry request first.
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ createIfMissing?: boolean }} [opts]
 */
async function ensureCoordinationOfferForPatientClinic(patientId, clinicId, opts = {}) {
  const pid = String(patientId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(pid) || !UUID_RE.test(cid)) {
    return { ok: false, reason: "invalid_ids" };
  }

  const createIfMissing = opts.createIfMissing !== false;

  const existingOfferId = await resolveCoordinationOfferIdForPatientClinic(pid, cid, {
    createIfMissing: false,
  });
  if (existingOfferId) {
    const enrolled = await isPatientEnrolledAtClinic(pid, cid);
    await ensureLeadWorkspaceForClinic(pid, cid, {
      source: "discovery_chat",
      leadStatus: LEAD_STATUS.INQUIRY,
    });
    return {
      ok: true,
      offerId: existingOfferId,
      patientId: pid,
      clinicId: cid,
      route: "offer_chat",
      enrolled,
      hasFormalOffer: false,
      offerCreated: false,
      reusedSharedOffer: true,
    };
  }

  if (!createIfMissing) {
    return { ok: false, reason: "no_coordination_offer", patientId: pid, clinicId: cid };
  }

  const { data: tr } = await supabase
    .from("treatment_requests")
    .select("id")
    .eq("patient_id", pid)
    .eq("clinic_id", cid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let requestId = tr?.id ? String(tr.id) : null;

  if (!requestId) {
    const doctorId = await resolveDefaultDoctorForClinic(cid);
    if (!doctorId) {
      return { ok: false, reason: "no_clinic_doctor", patientId: pid, clinicId: cid };
    }

    const nowIso = new Date().toISOString();
    const insert = {
      patient_id: pid,
      clinic_id: cid,
      preferred_treatment: "inquiry",
      description: "",
      status: "pending",
      lead_status: LEAD_STATUS.INQUIRY,
      created_at: nowIso,
      updated_at: nowIso,
    };
    const { data: inserted, error: insErr } = await supabase
      .from("treatment_requests")
      .insert(insert)
      .select("id")
      .maybeSingle();
    if (insErr || !inserted?.id) {
      console.warn(
        "[patientCoordinationChat] inquiry request insert:",
        insErr?.message || insErr,
      );
      return { ok: false, reason: "request_create_failed", patientId: pid, clinicId: cid };
    }
    requestId = String(inserted.id);
    await ensureLeadWorkspaceForClinic(pid, cid, {
      source: "discovery_chat",
      leadStatus: LEAD_STATUS.INQUIRY,
      treatmentRequestId: requestId,
    });
  }

  return ensureCoordinationOfferForRequest(requestId, { createIfMissing: true });
}

module.exports = {
  COORDINATION_NOTE,
  isCoordinationPlaceholderOffer,
  isPatientEnrolledAtClinic,
  clinicHasMessagingDoctor,
  batchClinicHasMessagingDoctor,
  resolveDefaultDoctorForClinic,
  CLINIC_DOCTOR_NOT_ASSIGNED,
  findSharedCoordinationPlaceholderOffer,
  ensureCoordinationOfferForRequest,
  ensureCoordinationOfferForPatientClinic,
  resolveCoordinationOfferIdForPatientClinic,
  persistSharedCoordinationOfferId,
};
