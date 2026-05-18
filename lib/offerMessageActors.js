/**
 * Resolve valid UUID senders for clinic/AI rows in offer_messages.
 * Never use string literals like "clinic_ai" in sender_id (UUID column).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Logical actor — not stored in sender_id. */
const CLINIC_AI_ACTOR_KIND = "clinic_ai";

/**
 * @param {...unknown} vals
 * @returns {string|null}
 */
function pickUuid(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (UUID_RE.test(s)) return s;
  }
  return null;
}

/**
 * @param {string} offerId
 * @param {{ clinicId?: string|null, doctorId?: string|null }} [hints]
 * @returns {Promise<{ senderId: string, senderRole: string, actorKind: string }|null>}
 */
async function resolveClinicSideOfferSender(offerId, hints = {}) {
  const oid = String(offerId || "").trim();
  if (!isSupabaseEnabled() || !UUID_RE.test(oid)) return null;

  let senderId = pickUuid(hints.doctorId, hints.clinicId);

  const { data: offer, error: offerErr } = await supabase
    .from("treatment_offers")
    .select("id, doctor_id, clinic_id, request_id")
    .eq("id", oid)
    .maybeSingle();

  if (offerErr) {
    console.warn("[offerMessageActors] offer lookup:", offerErr.message);
  }

  if (offer) {
    senderId = pickUuid(senderId, offer.doctor_id, offer.clinic_id);
    if (!senderId && offer.request_id) {
      const { data: tr } = await supabase
        .from("treatment_requests")
        .select("clinic_id")
        .eq("id", offer.request_id)
        .maybeSingle();
      senderId = pickUuid(senderId, tr?.clinic_id);
    }
  }

  const envSystem = String(process.env.CLINIC_AI_SENDER_UUID || "").trim();
  senderId = pickUuid(senderId, envSystem);

  if (!senderId) {
    console.warn("[offerMessageActors] no UUID sender resolved", {
      offerId: oid.slice(0, 8),
      actorKind: CLINIC_AI_ACTOR_KIND,
    });
    return null;
  }

  return {
    senderId,
    senderRole: "doctor",
    actorKind: CLINIC_AI_ACTOR_KIND,
  };
}

/**
 * Build insert row for clinic/AI outbound offer_messages.
 * @param {{
 *   offerId: string,
 *   message: string,
 *   senderName?: string,
 *   clinicId?: string|null,
 *   doctorId?: string|null,
 * }} params
 */
async function buildClinicAiOfferMessageInsert(params) {
  const offerId = String(params.offerId || "").trim();
  const text = String(params.message || "").trim();
  const senderName = String(params.senderName || "Care Team").trim() || "Care Team";

  const actor = await resolveClinicSideOfferSender(offerId, {
    clinicId: params.clinicId,
    doctorId: params.doctorId,
  });
  if (!actor) {
    return { row: null, error: { message: "clinic_sender_uuid_unresolved" } };
  }

  const row = {
    offer_id: offerId,
    sender_id: actor.senderId,
    sender_role: actor.senderRole,
    sender_name: senderName,
    text,
    message_source: CLINIC_AI_ACTOR_KIND,
    actor_kind: CLINIC_AI_ACTOR_KIND,
  };

  return { row, actor, error: null };
}

module.exports = {
  CLINIC_AI_ACTOR_KIND,
  UUID_RE,
  pickUuid,
  resolveClinicSideOfferSender,
  buildClinicAiOfferMessageInsert,
};
