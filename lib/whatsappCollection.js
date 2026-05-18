/**
 * Progressive, contextual WhatsApp collection for AI coordination.
 * Never aggressive at first touch — optional and operationally relevant.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLLECTION_STAGES = {
  EARLY: "early",
  QUOTE_REQUESTED: "quote_requested",
  RESPONDED: "responded",
  APPOINTMENT_PLANNING: "appointment_planning",
  TRAVEL_COORDINATION: "travel_coordination",
  COLLECTED: "collected",
  DECLINED: "declined",
};

const STAGE_RANK = {
  early: 0,
  quote_requested: 1,
  responded: 2,
  appointment_planning: 3,
  travel_coordination: 4,
  collected: 100,
  declined: 100,
};

const DEFAULT_WHATSAPP_SETTINGS = {
  requestWhatsappEnabled: true,
  askWhatsappAfterStage: COLLECTION_STAGES.RESPONDED,
  whatsappRequiredForBooking: false,
  coordinatorWhatsappEnabled: true,
};

const OPERATIONAL_MSG_RE =
  /\b(appointment|consultation|schedule|book(?:ing)?|travel|flight|hotel|airport|transfer|visit dates?|arrival|departure|quote follow|reschedule|cancel)\b/i;

const DECLINE_RE =
  /\b(no whatsapp|without whatsapp|don'?t use whatsapp|prefer (?:email|in[- ]?app|chat)|not on whatsapp|no phone)\b/i;

const WHATSAPP_EXTRACT_RE =
  /(?:whatsapp|wa\.me|what'?s\s*app)[:\s]*([+\d][\d\s().-]{7,18}\d)|(?:my (?:number|phone|whatsapp)(?:\s+is)?|reach me (?:at|on))[:\s]*([+\d][\d\s().-]{7,18}\d)|(\+\d{10,15})/i;

/**
 * @param {unknown} raw
 */
function buildDefaultWhatsappCollectionSettings(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const stage = String(o.askWhatsappAfterStage ?? o.ask_whatsapp_after_stage ?? DEFAULT_WHATSAPP_SETTINGS.askWhatsappAfterStage).trim();
  return {
    requestWhatsappEnabled:
      o.requestWhatsappEnabled !== false && o.request_whatsapp_enabled !== false,
    askWhatsappAfterStage: STAGE_RANK[stage] != null ? stage : DEFAULT_WHATSAPP_SETTINGS.askWhatsappAfterStage,
    whatsappRequiredForBooking:
      o.whatsappRequiredForBooking === true || o.whatsapp_required_for_booking === true,
    coordinatorWhatsappEnabled:
      o.coordinatorWhatsappEnabled !== false && o.coordinator_whatsapp_enabled !== false,
  };
}

/**
 * @param {Record<string, unknown>} communicationPolicy
 */
function readWhatsappSettingsFromClinicProfile(communicationPolicy) {
  const cp =
    communicationPolicy && typeof communicationPolicy === "object" ? communicationPolicy : {};
  const nested =
    cp.whatsappCollection && typeof cp.whatsappCollection === "object"
      ? cp.whatsappCollection
      : cp;
  return buildDefaultWhatsappCollectionSettings(nested);
}

/**
 * @param {string|null|undefined} raw
 */
function normalizeWhatsappNumber(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  const only = digits.replace(/\D/g, "");
  if (only.length < 8 || only.length > 15) return null;
  return digits.startsWith("+") ? `+${only}` : `+${only}`;
}

/**
 * @param {Record<string, unknown>} flags
 * @param {Record<string, unknown>} profileRow
 */
function inferOperationalCollectionStage(flags, profileRow) {
  const journey = String(flags.journeyStage || "").toLowerCase();
  const ps = String(flags.proposalStatus || "").toLowerCase();
  if (journey === "appointment_scheduled" || flags.appointmentScheduled === true) {
    return COLLECTION_STAGES.APPOINTMENT_PLANNING;
  }
  if (flags.activeAppointment || journey === "waiting_for_consultation") {
    return COLLECTION_STAGES.APPOINTMENT_PLANNING;
  }
  if (profileRow.travel_timeline || flags.missingTravelTimeline === false) {
    if (journey.includes("travel") || String(profileRow.travel_timeline || "").trim()) {
      return COLLECTION_STAGES.TRAVEL_COORDINATION;
    }
  }
  if (ps === "quote_sent" || flags.hasFormalOffer === true) {
    return COLLECTION_STAGES.RESPONDED;
  }
  if (
    ps === "coordinator_responded" ||
    flags.firstClinicResponseAt ||
    profileRow.last_ai_reply_at ||
    profileRow.last_human_reply_at
  ) {
    return COLLECTION_STAGES.RESPONDED;
  }
  if (flags.treatmentRequestId) {
    return COLLECTION_STAGES.QUOTE_REQUESTED;
  }
  return COLLECTION_STAGES.EARLY;
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {Record<string, unknown>} flags
 * @param {import('./leadIntelligence').LeadData} [leadData]
 * @param {string} [patientMessage]
 */
function evaluateWhatsappCollectionCandidate(profileRow, flags, leadData = {}, patientMessage = "") {
  const settings = readWhatsappSettingsFromClinicProfile(
    profileRow._whatsappClinicPolicy || profileRow.communicationPolicy,
  );

  if (!settings.requestWhatsappEnabled || !settings.coordinatorWhatsappEnabled) {
    return { candidate: false, reason: "disabled", settings };
  }

  const existing = normalizeWhatsappNumber(profileRow.whatsapp_number);
  if (existing) {
    return { candidate: false, reason: "has_whatsapp", settings, whatsappNumber: existing };
  }

  const stage = String(profileRow.whatsapp_collection_stage || flags.whatsappCollectionStage || "").toLowerCase();
  if (stage === COLLECTION_STAGES.COLLECTED || stage === COLLECTION_STAGES.DECLINED) {
    return { candidate: false, reason: stage, settings };
  }

  if (flags.whatsappCollectionPrompted === true && stage !== COLLECTION_STAGES.EARLY) {
    const promptedAt = flags.whatsappPromptedAt ? new Date(String(flags.whatsappPromptedAt)).getTime() : 0;
    const daysSince = promptedAt ? (Date.now() - promptedAt) / 86400000 : 999;
    if (daysSince < 3) {
      return { candidate: false, reason: "recently_prompted", settings };
    }
  }

  const msgCount = Number(profileRow.message_count || 0) || 0;
  if (msgCount < 2) {
    return { candidate: false, reason: "too_early", settings };
  }

  const operationalStage = inferOperationalCollectionStage(flags, profileRow);
  const required = String(settings.askWhatsappAfterStage || COLLECTION_STAGES.RESPONDED).toLowerCase();
  const opRank = STAGE_RANK[operationalStage] ?? 0;
  const reqRank = STAGE_RANK[required] ?? STAGE_RANK.responded;

  if (opRank < reqRank) {
    const msg = String(patientMessage || "");
    const operationalQuestion = OPERATIONAL_MSG_RE.test(msg);
    const bookingHot = leadData.bookingIntent === "high" || leadData.bookingIntent === "medium";
    if (!operationalQuestion && !bookingHot) {
      return { candidate: false, reason: "stage_too_early", settings, operationalStage };
    }
  }

  const msg = String(patientMessage || "").toLowerCase();
  const earlyPricingOnly =
    msgCount <= 3 &&
    !OPERATIONAL_MSG_RE.test(msg) &&
    /\b(price|cost|how much|quote|pricing)\b/i.test(msg) &&
    opRank < STAGE_RANK.responded;
  if (earlyPricingOnly) {
    return { candidate: false, reason: "early_pricing_inquiry", settings };
  }

  return {
    candidate: true,
    reason: "operational_stage",
    settings,
    operationalStage,
    requiredStage: required,
    whatsappRequiredForBooking: settings.whatsappRequiredForBooking,
  };
}

/**
 * @param {{ candidate: boolean, settings?: Record<string, unknown>, operationalStage?: string, whatsappRequiredForBooking?: boolean }} evalResult
 * @param {string} [contextMode]
 */
function buildWhatsappCollectionPromptBlock(evalResult, contextMode = "coordinator") {
  if (contextMode === "treatment_guide" || !evalResult?.candidate) return "";

  const required = evalResult.whatsappRequiredForBooking === true;
  const stage = evalResult.operationalStage || "active coordination";

  return `WHATSAPP COLLECTION (progressive — optional, not a lead-capture funnel):
* The patient is in ${stage}. You MAY politely offer WhatsApp once this turn — only if it fits naturally after answering their question.
* Do NOT ask for phone/WhatsApp in the first messages, during basic pricing questions, or before operational coordination is relevant.
* Tone: optional, helpful, operationally relevant — never mandatory or pushy.
* Suggested phrasing (adapt to patient's language): "If you'd like, you can also share your WhatsApp number for easier coordination regarding appointments, travel details, and clinic updates 😊"
${required ? "* Clinic policy: WhatsApp is preferred before final appointment confirmation — still phrase as optional unless they are ready to book now." : "* If they decline or ignore, continue normally in-app — do not repeat the ask in the next 2 replies."}
* If the patient shares a number in this message, thank them briefly and confirm it is for coordination only (not spam).
* If leadData includes whatsappNumber from the patient message, set it in leadData.`;
}

/**
 * @param {string} message
 */
function extractWhatsappFromPatientMessage(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  if (DECLINE_RE.test(text)) return { declined: true };
  const m = text.match(WHATSAPP_EXTRACT_RE);
  const raw = m ? m[1] || m[2] || m[3] : null;
  const normalized = normalizeWhatsappNumber(raw);
  if (normalized) return { number: normalized };
  return null;
}

/**
 * @param {string} profileId
 * @param {{ number?: string, declined?: boolean, source?: string }} input
 */
async function persistWhatsappCollection(profileId, input) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) {
    return { ok: false, reason: "invalid" };
  }

  const now = new Date().toISOString();
  /** @type {Record<string, unknown>} */
  const patch = { updated_at: now };

  if (input.declined) {
    patch.whatsapp_collection_stage = COLLECTION_STAGES.DECLINED;
  } else if (input.number) {
    const n = normalizeWhatsappNumber(input.number);
    if (!n) return { ok: false, reason: "invalid_number" };
    patch.whatsapp_number = n;
    patch.whatsapp_verified = false;
    patch.whatsapp_collection_stage = COLLECTION_STAGES.COLLECTED;
    patch.whatsapp_consent_at = now;
  }

  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("operational_intake_flags")
    .eq("id", profileId)
    .maybeSingle();

  const flags =
    row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? { ...row.operational_intake_flags }
      : {};

  if (input.declined) {
    flags.whatsappCollectionStage = COLLECTION_STAGES.DECLINED;
  } else if (input.number) {
    flags.whatsappCollectionStage = COLLECTION_STAGES.COLLECTED;
    flags.hasWhatsapp = true;
  }

  patch.operational_intake_flags = flags;

  const { error } = await supabase.from("ai_coordinator_lead_profiles").update(patch).eq("id", profileId);
  if (error) {
    console.warn("[whatsappCollection] persist:", error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

/**
 * Mark that the AI was given permission to offer WhatsApp this turn.
 * @param {string} profileId
 * @param {string} operationalStage
 */
async function markWhatsappPromptOffered(profileId, operationalStage) {
  if (!isSupabaseEnabled() || !UUID_RE.test(profileId)) return;
  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("operational_intake_flags, whatsapp_collection_stage")
    .eq("id", profileId)
    .maybeSingle();

  const flags =
    row?.operational_intake_flags && typeof row.operational_intake_flags === "object"
      ? { ...row.operational_intake_flags }
      : {};

  const stage = String(row?.whatsapp_collection_stage || "").toLowerCase();
  const opStage = operationalStage || inferOperationalCollectionStage(flags, row || {});

  flags.whatsappCollectionPrompted = true;
  flags.whatsappPromptedAt = new Date().toISOString();

  const { error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      whatsapp_collection_stage:
        stage === COLLECTION_STAGES.COLLECTED || stage === COLLECTION_STAGES.DECLINED
          ? stage
          : opStage,
      operational_intake_flags: flags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);

  if (error) console.warn("[whatsappCollection] markPrompted:", error.message);
}

/**
 * @param {Record<string, unknown>} lead
 */
function enrichLeadWhatsappContact(lead) {
  const wa = normalizeWhatsappNumber(lead.whatsappNumber || lead.whatsapp_number);
  const stage = String(lead.whatsappCollectionStage || lead.whatsapp_collection_stage || "").toLowerCase();
  const hasWhatsapp = !!wa || stage === COLLECTION_STAGES.COLLECTED;
  const primary = String(lead.primaryChannel || "in_app").toLowerCase();
  let preferredContactChannel = hasWhatsapp ? "whatsapp" : primary || "in_app";
  if (stage === COLLECTION_STAGES.DECLINED) preferredContactChannel = primary || "in_app";

  return {
    ...lead,
    whatsappNumber: wa,
    hasWhatsapp,
    whatsappMissing: !hasWhatsapp && stage !== COLLECTION_STAGES.DECLINED,
    whatsappCollectionStage: stage || COLLECTION_STAGES.EARLY,
    preferredContactChannel,
    preferredContactChannelLabel:
      preferredContactChannel === "whatsapp"
        ? "WhatsApp"
        : preferredContactChannel === "in_app"
          ? "In-app chat"
          : preferredContactChannel,
  };
}

/**
 * Process inbound patient text + optional GPT leadData after a coordination turn.
 * @param {object} params
 */
async function processWhatsappAfterCoordinationTurn(params) {
  const profileId = String(params.profileId || "").trim();
  if (!UUID_RE.test(profileId)) return;

  const extracted = extractWhatsappFromPatientMessage(params.patientMessage || "");
  if (extracted?.declined) {
    await persistWhatsappCollection(profileId, { declined: true, source: params.source });
    return;
  }
  if (extracted?.number) {
    await persistWhatsappCollection(profileId, { number: extracted.number, source: params.source });
    return;
  }

  const fromLead = normalizeWhatsappNumber(
    params.leadData?.whatsappNumber ?? params.leadData?.whatsapp_number,
  );
  if (fromLead) {
    await persistWhatsappCollection(profileId, { number: fromLead, source: "lead_data" });
  }
}

module.exports = {
  COLLECTION_STAGES,
  DEFAULT_WHATSAPP_SETTINGS,
  buildDefaultWhatsappCollectionSettings,
  readWhatsappSettingsFromClinicProfile,
  normalizeWhatsappNumber,
  inferOperationalCollectionStage,
  evaluateWhatsappCollectionCandidate,
  buildWhatsappCollectionPromptBlock,
  extractWhatsappFromPatientMessage,
  persistWhatsappCollection,
  markWhatsappPromptOffered,
  enrichLeadWhatsappContact,
  processWhatsappAfterCoordinationTurn,
};
