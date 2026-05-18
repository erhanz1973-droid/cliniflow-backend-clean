/**
 * Patient coordination chat — messaging workspace before a formal clinic proposal exists.
 * Uses a placeholder treatment_offer row for offer_messages only; not shown as a "doctor offer".
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { ensureLeadWorkspaceForClinic, LEAD_STATUS } = require("./patientLeadLifecycle");

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
async function resolveDefaultDoctorForClinic(clinicId) {
  if (!UUID_RE.test(clinicId)) return null;
  const { data } = await supabase
    .from("doctors")
    .select("id, doctor_id, status")
    .eq("clinic_id", clinicId)
    .in("status", ["APPROVED", "ACTIVE"])
    .limit(1)
    .maybeSingle();
  const id = data?.id || data?.doctor_id;
  return id ? String(id).trim() : null;
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
    .select("id, patient_id, clinic_id, preferred_treatment, status, lead_status")
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

  const { data: existingOffers } = await supabase
    .from("treatment_offers")
    .select("id, request_id, note, price_text, price_range, doctor_id, created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });

  const rows = existingOffers || [];
  const realOffers = rows.filter((o) => !isCoordinationPlaceholderOffer(o));
  if (realOffers.length > 0) {
    const latest = realOffers[realOffers.length - 1];
    return {
      ok: true,
      offerId: String(latest.id),
      patientId,
      clinicId,
      route: "offer_chat",
      hasFormalOffer: true,
      offerCreated: false,
    };
  }

  const placeholder = rows.find((o) => isCoordinationPlaceholderOffer(o));
  if (placeholder?.id) {
    return {
      ok: true,
      offerId: String(placeholder.id),
      patientId,
      clinicId,
      route: "offer_chat",
      hasFormalOffer: false,
      offerCreated: false,
    };
  }

  if (opts.createIfMissing === false) {
    return { ok: false, reason: "no_coordination_offer", patientId, clinicId };
  }

  const doctorId = await resolveDefaultDoctorForClinic(clinicId);
  if (!doctorId) {
    return { ok: false, reason: "no_clinic_doctor", patientId, clinicId };
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
    return { ok: false, reason: "offer_create_failed", patientId, clinicId };
  }

  await ensureLeadWorkspaceForClinic(patientId, clinicId, {
    source: "coordination_chat",
    leadStatus: tr.lead_status || LEAD_STATUS.INQUIRY,
  });

  console.log("[patientCoordinationChat] coordination workspace offer created", {
    requestId: requestId.slice(0, 8),
    offerId: String(inserted.id).slice(0, 8),
    clinicId: clinicId.slice(0, 8),
  });

  return {
    ok: true,
    offerId: String(inserted.id),
    patientId,
    clinicId,
    route: "offer_chat",
    hasFormalOffer: false,
    offerCreated: true,
  };
}

module.exports = {
  COORDINATION_NOTE,
  isCoordinationPlaceholderOffer,
  ensureCoordinationOfferForRequest,
};
