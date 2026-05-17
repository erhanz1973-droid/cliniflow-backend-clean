/**
 * Clinic Operations Profile — aggregated source of truth for AI orchestration.
 */

const { getClinicAiProfile, upsertClinicAiSettings } = require("./clinicAiSettings");
const { getPricingKnowledgeForAi } = require("./clinicPricingForAi");
const { listHotelsByClinic } = require("./clinicPartnerHotels");
const { listProtocolsByClinic } = require("./clinicTreatmentProtocols");
const { OPS_PROFILE_SECTIONS, OPS_PROFILE_SCHEMA_VERSION } = require("./clinicOpsProfileTypes");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Full operations profile for admin UI and orchestration bootstrap.
 * @param {string} clinicId
 */
async function getClinicOpsProfile(clinicId) {
  if (!UUID_RE.test(clinicId)) {
    return { ok: false, error: "invalid_clinic_id" };
  }

  let protocols = [];
  try {
    protocols = await listProtocolsByClinic(clinicId, { activeOnly: false });
  } catch (e) {
    if (e?.code !== "PROTOCOLS_TABLE_MISSING") throw e;
  }

  const [settings, hotels] = await Promise.all([
    getClinicAiProfile(clinicId),
    listHotelsByClinic(clinicId, { activeOnly: false }),
  ]);

  return {
    ok: true,
    schemaVersion: OPS_PROFILE_SCHEMA_VERSION,
    clinicId,
    isConfigured: settings.isConfigured || hotels.length > 0,
    sections: {
      aiProfile: settings.tone,
      materials: settings.materials,
      travel: { hotels, travelNotes: settings.logistics?.transportationNotes || null },
      logistics: settings.logistics,
      payment: settings.payment,
      workflow: protocols,
      aiSafety: {
        autonomy: settings.autonomy,
        safetyRules: settings.safetyRules,
        communicationPolicy: settings.communicationPolicy,
      },
      handoff: settings.escalation?.handoff || {},
      internalNotes: settings.internalNotes,
    },
    counts: {
      hotels: hotels.length,
      protocols: protocols.length,
    },
    pricingSource: {
      type: "treatment_prices",
      managePath: "/admin-settings.html",
      hint: "Operational and AI pricing are configured in Clinic Settings → Treatment Price List.",
    },
    settingsUpdatedAt: settings.updatedAt,
  };
}

/**
 * Patch a single hub section by id.
 * @param {string} clinicId
 * @param {string} sectionId
 * @param {Record<string, unknown>} body
 */
async function patchClinicOpsSection(clinicId, sectionId, body) {
  const id = String(sectionId || "").trim();
  /** @type {Record<string, unknown>} */
  const patch = {};

  switch (id) {
    case "ai-profile":
      patch.tone = body;
      break;
    case "materials":
      patch.materials = body;
      break;
    case "logistics":
      patch.logistics = body;
      break;
    case "payment":
      patch.payment = body;
      break;
    case "internal-notes":
      patch.internalNotes = body;
      break;
    case "ai-safety":
      if (body.autonomy) patch.autonomy = body.autonomy;
      if (body.safetyRules) patch.safetyRules = body.safetyRules;
      if (body.communicationPolicy) patch.communicationPolicy = body.communicationPolicy;
      break;
    case "handoff":
      patch.escalation = { handoff: body.handoff || body };
      break;
    default:
      return { ok: false, error: "unknown_section" };
  }

  return upsertClinicAiSettings(clinicId, patch);
}

/**
 * Structured knowledge bundle for AI orchestration (prompts, routing, offers).
 * @param {string} clinicId
 */
async function resolveClinicOpsKnowledge(clinicId) {
  let protocols = [];
  try {
    protocols = await listProtocolsByClinic(clinicId, { activeOnly: true });
  } catch (e) {
    if (e?.code !== "PROTOCOLS_TABLE_MISSING") throw e;
  }

  const [settings, pricing, hotels] = await Promise.all([
    getClinicAiProfile(clinicId),
    getPricingKnowledgeForAi(clinicId),
    listHotelsByClinic(clinicId, { activeOnly: true }),
  ]);

  return {
    schemaVersion: OPS_PROFILE_SCHEMA_VERSION,
    clinicId,
    identity: {
      displayName: settings.tone.displayName,
      toneStyle: settings.tone.toneStyle,
      profileTags: settings.tone.profileTags,
      languages: settings.tone.supportedLanguages,
      signatureStyle: settings.tone.signatureStyle,
    },
    treatmentsPricing: pricing.treatments,
    pricingLanguageGuidance: pricing.pricingLanguageGuidance,
    pricingSource: pricing.source,
    materials: settings.materials,
    travel: hotels.slice(0, 6).map((h) => ({
      name: h.name,
      pricePerNight: h.pricePerNight,
      priceRange: h.priceRange,
      distanceMinutes: h.distanceMinutes,
      transferIncluded: h.transferIncluded,
      vipTransfer: h.vipTransfer,
      notes: h.notes,
    })),
    logistics: settings.logistics,
    payment: settings.payment,
    workflow: protocols.slice(0, 8).map((p) => ({
      treatmentType: p.treatmentType,
      typicalVisitCount: p.typicalVisitCount,
      estimatedStayDuration: p.estimatedStayDuration,
      secondVisitAfter: p.secondVisitAfter,
      healingNotes: p.healingNotes,
      postOpNotes: p.postOpNotes,
      aiNotes: p.aiNotes,
    })),
    autonomy: settings.autonomy.categories,
    safetyRules: settings.safetyRules,
    handoff: settings.escalation.handoff,
    internalNotes: settings.internalNotes,
    updatedAt: settings.updatedAt,
  };
}

module.exports = {
  OPS_PROFILE_SECTIONS,
  getClinicOpsProfile,
  patchClinicOpsSection,
  resolveClinicOpsKnowledge,
};
