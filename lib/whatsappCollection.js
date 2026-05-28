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
  /\b(no whatsapp|without whatsapp|don'?t use whatsapp|prefer (?:email|in[- ]?app|chat)|not on whatsapp|no phone|whatsapp\s*istemiyorum|numara\s*vermek\s*istemiyorum)\b/i;

/** Patient says they already shared the number (scan recent turns). */
const ALREADY_SHARED_RE =
  /\b(yukarida|yukarıda|az\s*once|az\s*önce|yazdim|yazdım|yazmistim|yazmıştım|verdim|paylastim|paylaştım|attim|attım|gonderdim|gönderdim|dedim\s*zaten|zaten\s*verdim|yazdigim|yazdığım|ustte|üstte|bir\s*ust|bir\s*üst|already\s*(?:shared|gave|sent)|wrote\s+(?:it\s+)?above|shared\s+(?:it\s+)?above|i\s+already|gave\s+you\s+(?:my\s+)?(?:number|phone))\b/i;

/** Coordinator recently asked for WhatsApp / phone. */
const WA_ASK_RE =
  /\b(whatsapp|what'?s\s*app|telefon|numara|phone\s*number|iletisim\s*numara|iletişim\s*numara|numaranizi|numaranızı|paylasir\s*misiniz|paylaşır\s*mısınız)\b/i;

const WHATSAPP_EXTRACT_RE =
  /(?:whatsapp|wa\.me|what'?s\s*app)[:\s]*([+\d][\d\s().-]{7,18}\d)|(?:my (?:number|phone|whatsapp)(?:\s+is)?|reach me (?:at|on)|numaram|telefonum|telefon\s*numaram)[:\s]*([+\d][\d\s().-]{7,18}\d)|(\+\d{10,15})/i;

/** TR mobile 5xx xxx xx xx / 05xx / +90 5xx — also used in loose mode. */
const TR_MOBILE_CHUNK_RE =
  /(?:\+?90[\s.-]?)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}|\b5\d{9}\b/g;

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
  let only = s.replace(/\D/g, "");
  if (!only) return null;
  if (only.length === 11 && only.startsWith("0")) only = only.slice(1);
  if (only.length === 10 && only.startsWith("5")) only = `90${only}`;
  if (only.length < 8 || only.length > 15) return null;
  return `+${only}`;
}

/**
 * @param {string} text
 */
function patientSaysAlreadyShared(text) {
  return ALREADY_SHARED_RE.test(String(text || ""));
}

/**
 * @param {Array<{ role: string, text: string }>} [recentTurns]
 */
function coordinatorRecentlyAskedForWhatsapp(recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0 && i >= turns.length - 4; i--) {
    const t = turns[i];
    if (t.role !== "assistant") continue;
    if (WA_ASK_RE.test(String(t.text || ""))) return true;
    break;
  }
  return false;
}

/**
 * @param {string} text
 * @param {{ awaiting?: boolean }} [opts]
 */
function extractLoosePhoneCandidates(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  /** Message is only a phone number. */
  if (/^[\d\s().+-]{8,22}$/.test(raw)) {
    const n = normalizeWhatsappNumber(raw);
    if (n) return [n];
  }

  const found = [];
  const re = TR_MOBILE_CHUNK_RE;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const n = normalizeWhatsappNumber(m[0]);
    if (n) found.push(n);
  }

  if (opts.awaiting || found.length === 0) {
    const generic = raw.match(/(?:\+?\d[\d\s().-]{7,18}\d)/g) || [];
    for (const chunk of generic) {
      const n = normalizeWhatsappNumber(chunk);
      if (n && !found.includes(n)) found.push(n);
    }
  }

  return found;
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

  const msg = String(patientMessage || "");
  const awaitingReply =
    flags.whatsappCollectionPrompted === true ||
    stage === COLLECTION_STAGES.RESPONDED ||
    stage === COLLECTION_STAGES.APPOINTMENT_PLANNING;

  const looseInMessage = extractWhatsappFromPatientMessage(msg, { awaiting: true });
  if (looseInMessage?.number) {
    return {
      candidate: false,
      reason: "number_in_message",
      settings,
      whatsappNumber: looseInMessage.number,
    };
  }
  if (awaitingReply && patientSaysAlreadyShared(msg)) {
    return { candidate: false, reason: "patient_claims_already_shared", settings };
  }

  if (flags.whatsappCollectionPrompted === true && stage !== COLLECTION_STAGES.EARLY) {
    const promptedAt = flags.whatsappPromptedAt ? new Date(String(flags.whatsappPromptedAt)).getTime() : 0;
    const daysSince = promptedAt ? (Date.now() - promptedAt) / 86400000 : 999;
    if (daysSince < 3 && !awaitingReply) {
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
    const operationalQuestion = OPERATIONAL_MSG_RE.test(msg);
    const bookingHot = leadData.bookingIntent === "high" || leadData.bookingIntent === "medium";
    if (!operationalQuestion && !bookingHot) {
      return { candidate: false, reason: "stage_too_early", settings, operationalStage };
    }
  }

  const msgLower = msg.toLowerCase();
  const earlyPricingOnly =
    msgCount <= 3 &&
    !OPERATIONAL_MSG_RE.test(msgLower) &&
    /\b(price|cost|how much|quote|pricing)\b/i.test(msgLower) &&
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
* Suggested phrasing (adapt to patient's language): "Randevu ve seyahat koordinasyonu için WhatsApp numaranızı paylaşmak isterseniz buradan yazabilirsiniz 😊"
${required ? "* Clinic policy: WhatsApp is preferred before final appointment confirmation — still phrase as optional unless they are ready to book now." : "* If they decline or ignore, continue normally in-app — do not repeat the ask in the next 2 replies."}
* If the patient shares digits (e.g. 532… or 0532…) or says they already wrote the number above, treat it as WhatsApp/mobile — thank them and NEVER ask again.
* If leadData includes whatsappNumber from the patient message, set it in leadData.`;
}

/**
 * Patient sent only (or almost only) a phone number — not a language/meta question.
 * @param {string} text
 */
function isPhoneOnlyPatientMessage(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  const nonPhone = t.replace(/[\d\s().+-]/g, "");
  return nonPhone.length <= 2;
}

/**
 * Message includes a WhatsApp/mobile number with coordinating context (not digits-only).
 * @param {string} text
 */
function patientMessageSharesWhatsappNumber(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (isPhoneOnlyPatientMessage(t)) return true;
  const num = extractWhatsappFromPatientMessage(t, { awaiting: true })?.number;
  if (!num) return false;
  return /\b(numara|numaram|numaranız|numaranizi|whatsapp|telefon|what'?s\s*app|phone)\b/i.test(t);
}

/**
 * @param {string|null|undefined} raw
 */
function ackLangCode(raw) {
  const c = String(raw || "")
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return c || null;
}

/**
 * Phone ack should follow conversation Turkish, not default English template.
 * @param {{
 *   languageState?: { conversationLanguage?: string|null },
 *   profileRow?: Record<string, unknown>,
 *   message?: string,
 *   recentTurns?: Array<{ role: string, text: string }>,
 * }} opts
 */
function resolvePhoneAcknowledgmentLanguage(opts = {}) {
  const msg = String(opts.message || "");
  const recentTurns = Array.isArray(opts.recentTurns) ? opts.recentTurns : [];
  const profile = opts.profileRow && typeof opts.profileRow === "object" ? opts.profileRow : {};

  const fromProfile = ackLangCode(
    profile.conversation_primary_language || profile.preferred_language,
  );
  const fromState = ackLangCode(opts.languageState?.conversationLanguage);

  if (fromProfile === "tr" || fromProfile === "ru") return fromProfile;
  if (fromState === "tr" || fromState === "ru") return fromState;

  if (
    /\b(numaram|numaranız|numaranizi|türkçe|turkce|merhaba|selam|implant|randevu|teşekkür|tesekkur|yardımcı|yardimci)\b/i.test(
      msg,
    )
  ) {
    return "tr";
  }
  if (/[ğüşıöçĞÜŞİÖÇ]/.test(msg)) return "tr";

  for (let i = recentTurns.length - 1; i >= 0 && i >= recentTurns.length - 8; i--) {
    const tx = String(recentTurns[i]?.text || "");
    if (/[ğüşıöçĞÜŞİÖÇ]/.test(tx)) return "tr";
    if (/\b(türkçe|turkce|teşekkür|tesekkur|numaranız|numaranizi|aldık|aldik|yardımcı)\b/i.test(tx)) {
      return "tr";
    }
  }

  if (fromProfile) return fromProfile;
  if (fromState) return fromState;
  return "tr";
}

/**
 * @param {string|null} number
 * @param {string} [lang]
 */
function formatPhoneAcknowledgmentReply(number, lang = "tr") {
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  const display = number ? String(number) : "";
  if (code === "en") {
    return display
      ? `Thank you — we have your WhatsApp number (${display}). We'll use it only for appointment and travel coordination.`
      : "Thank you — we have your WhatsApp number. We'll use it only for appointment and travel coordination.";
  }
  if (code === "ru") {
    return display
      ? `Спасибо — мы получили ваш номер WhatsApp (${display}). Используем его только для координации визита.`
      : "Спасибо — мы получили ваш номер WhatsApp. Используем его только для координации визита.";
  }
  return display
    ? `Teşekkürler — WhatsApp numaranızı aldık (${display}). Randevu ve seyahat koordinasyonu için bu numarayı kullanacağız.`
    : "Teşekkürler — WhatsApp numaranızı aldık. Randevu ve seyahat koordinasyonu için bu numarayı kullanacağız.";
}

const LANGUAGE_CAPABILITY_DEFLECTION_RE =
  /\b(türkçe\s+biliyorum|turkce\s+biliyorum|türkçe\s+olarak|turkce\s+olarak|turkish|ingilizce\s+biliyorum|know\s+turkish|speak\s+turkish|size\s+türkçe\s+yardımcı|size\s+turkce\s+yardimci|can\s+help\s+you\s+in\s+turkish|reply\s+in\s+turkish|yardımcı\s+olabilirim.*türkçe|yardimci\s+olabilirim.*turkce)\b/i;

/**
 * Replace "Evet Türkçe biliyorum…" style replies when the patient only shared a phone number.
 * @param {string} reply
 * @param {string} patientMessage
 * @param {{ lang?: string, whatsappNumber?: string|null }} [opts]
 */
function repairPhoneNumberTurnReply(reply, patientMessage, opts = {}) {
  const patient = String(patientMessage || "").trim();
  const out = String(reply || "").trim();
  if (!patient || !patientMessageSharesWhatsappNumber(patient)) return out;

  const ackLang =
    opts.lang ||
    resolvePhoneAcknowledgmentLanguage({
      languageState: opts.languageState,
      profileRow: opts.profileRow,
      message: patient,
      recentTurns: opts.recentTurns,
    });

  const num =
    normalizeWhatsappNumber(patient) ||
    normalizeWhatsappNumber(opts.whatsappNumber) ||
    null;
  const thanksRe =
    /\b(teşekkür|tesekkur|aldık|aldik|kaydettik|numaranız|numaranizi|whatsapp|получил|thank you|received your)\b/i;
  const mentionsDigits =
    num && out.replace(/\D/g, "").includes(String(num).replace(/\D/g, "").slice(-9));

  if (thanksRe.test(out) && mentionsDigits && !LANGUAGE_CAPABILITY_DEFLECTION_RE.test(out)) {
    return out;
  }
  if (thanksRe.test(out) && !LANGUAGE_CAPABILITY_DEFLECTION_RE.test(out)) {
    return out;
  }
  if (LANGUAGE_CAPABILITY_DEFLECTION_RE.test(out) || isGenericPhoneTurnMisreply(out)) {
    console.warn("[whatsappCollection] repaired phone-only misreply", {
      preview: out.slice(0, 100),
    });
    return formatPhoneAcknowledgmentReply(num, ackLang);
  }
  if (
    /\b(thank you|we have your whatsapp|appointment and travel coordination)\b/i.test(out) &&
    (ackLang === "tr" || ackLang === "ru")
  ) {
    console.warn("[whatsappCollection] replaced English phone ack with localized template", {
      lang: ackLang,
    });
    return formatPhoneAcknowledgmentReply(num, ackLang);
  }
  return out;
}

/**
 * Replace "Türkçe biliyorum / implant…" style replies when the patient only picked a time.
 * @param {string} reply
 * @param {string} patientMessage
 * @param {{ lang?: string }} [opts]
 */
function repairTimeSelectionMisreply(reply, patientMessage, opts = {}) {
  const patient = String(patientMessage || "").trim();
  const out = String(reply || "").trim();
  if (!patient || !out) return out;

  const {
    parseConversationalTimeToMinutes,
    formatMinutesAsHm,
    messageExpressesTimeIntent,
    isTimeOnlyPatientMessage,
  } = require("./conversationalTimeParse");

  if (!messageExpressesTimeIntent(patient) && !isTimeOnlyPatientMessage(patient)) {
    return out;
  }

  const lang = String(opts.lang || "tr").slice(0, 2).toLowerCase();
  const timeHm = formatMinutesAsHm(parseConversationalTimeToMinutes(patient));
  const deflectsLanguage = LANGUAGE_CAPABILITY_DEFLECTION_RE.test(out);
  const pivotsUnaskedTreatment =
    isTimeOnlyPatientMessage(patient) &&
    /\b(implant|implantasyon|köprü|kopru|veneer|kaplama)\b/i.test(out) &&
    !/\b(implant|köprü)\b/i.test(patient);

  if (!deflectsLanguage && !pivotsUnaskedTreatment) return out;

  console.warn("[whatsappCollection] repaired time-selection misreply", {
    preview: out.slice(0, 100),
    timeHm,
  });

  if (lang === "tr") {
    return timeHm
      ? `Teşekkürler — ${timeHm} için randevu talebinizi aldım. Uygunluğu kontrol edip kısa süre içinde onaylayacağız.`
      : "Teşekkürler — randevu saatinizi aldım. Kısa süre içinde onaylayıp size döneceğiz.";
  }
  if (lang === "ru") {
    return timeHm
      ? `Спасибо — запрос на ${timeHm} получен. Проверим и подтвердим запись.`
      : "Спасибо — время получено. Скоро подтвердим запись.";
  }
  return timeHm
    ? `Thank you — we received your request for ${timeHm}. We will confirm availability shortly.`
    : "Thank you — we received your preferred time and will confirm shortly.";
}

/**
 * Post-process coordinator replies for phone-only and time-only patient turns.
 * @param {string} reply
 * @param {string} patientMessage
 * @param {Record<string, unknown>} [opts]
 */
function repairCoordinatorCapabilityMisreply(reply, patientMessage, opts = {}) {
  let out = repairPhoneNumberTurnReply(reply, patientMessage, opts);
  out = repairTimeSelectionMisreply(out, patientMessage, opts);
  return out;
}

/** Reply ignores the number and talks about languages / generic help. */
function isGenericPhoneTurnMisreply(reply) {
  const r = String(reply || "").trim();
  if (!r || r.length > 400) return false;
  if (LANGUAGE_CAPABILITY_DEFLECTION_RE.test(r)) return true;
  if (
    /^(evet|yes)[,.]?\s/i.test(r) &&
    /\b(türkçe|turkce|turkish|dil|language|yardımcı olabilirim|yardimci olabilirim)\b/i.test(r) &&
    !/\b(numara|whatsapp|telefon|aldık|aldik)\b/i.test(r)
  ) {
    return true;
  }
  return false;
}

/**
 * Highest-priority turn block when the patient message is their WhatsApp/mobile number.
 * @param {string|null} number E.164
 * @param {string} [lang]
 */
function buildPhoneNumberAcknowledgmentTurnBlock(number, lang = "tr") {
  const display = number ? String(number) : "";
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  const example = formatPhoneAcknowledgmentReply(number, code);
  return (
    "PHONE / WHATSAPP NUMBER RECEIVED (mandatory — overrides language/meta replies this turn):\n" +
    `* The patient's latest message IS their mobile/WhatsApp number${display ? ` (${display})` : ""} — not a question about languages.\n` +
    "* Thank them briefly, confirm you saved it for appointment/travel coordination only.\n" +
    '* Do NOT say "I know Turkish", "I can help you in Turkish", or similar meta language replies.\n' +
    "* Do NOT ask for the number again.\n" +
    `* Example tone (adapt, do not copy verbatim if unnatural): ${example}`
  );
}

/**
 * @param {string} message
 * @param {{ awaiting?: boolean }} [opts]
 */
function extractWhatsappFromPatientMessage(message, opts = {}) {
  const text = String(message || "").trim();
  if (!text) return null;
  if (DECLINE_RE.test(text)) return { declined: true };
  const m = text.match(WHATSAPP_EXTRACT_RE);
  const raw = m ? m[1] || m[2] || m[3] : null;
  let normalized = normalizeWhatsappNumber(raw);
  if (normalized) return { number: normalized };

  const awaiting = opts.awaiting === true;
  if (awaiting || text.length <= 24) {
    const loose = extractLoosePhoneCandidates(text, { awaiting: true });
    if (loose[0]) return { number: loose[0] };
  }

  return null;
}

/**
 * Resolve WhatsApp from current message + recent patient turns (after coordinator asked).
 * @param {string} message
 * @param {{
 *   recentTurns?: Array<{ role: string, text: string }>,
 *   flags?: Record<string, unknown>,
 *   profileRow?: Record<string, unknown>,
 * }} [ctx]
 */
function resolveWhatsappFromPatientTurn(message, ctx = {}) {
  const flags = ctx.flags && typeof ctx.flags === "object" ? ctx.flags : {};
  const profileRow = ctx.profileRow || {};
  const recentTurns = Array.isArray(ctx.recentTurns) ? ctx.recentTurns : [];
  const existing = normalizeWhatsappNumber(profileRow.whatsapp_number);
  if (existing) return { number: existing, source: "profile" };

  const awaiting =
    flags.whatsappCollectionPrompted === true || coordinatorRecentlyAskedForWhatsapp(recentTurns);

  let result = extractWhatsappFromPatientMessage(message, { awaiting: true });
  if (result?.declined) return result;
  if (result?.number) return { ...result, source: "current_message" };

  if (awaiting && patientSaysAlreadyShared(message)) {
    for (let i = recentTurns.length - 1; i >= 0; i--) {
      const t = recentTurns[i];
      if (t.role !== "patient") continue;
      const hist = extractWhatsappFromPatientMessage(t.text, { awaiting: true });
      if (hist?.number) {
        return { number: hist.number, source: "prior_patient_turn", fromPriorTurn: true };
      }
    }
  }

  if (awaiting) {
    for (let i = recentTurns.length - 1; i >= 0; i--) {
      const t = recentTurns[i];
      if (t.role !== "patient") continue;
      const hist = extractWhatsappFromPatientMessage(t.text, { awaiting: true });
      if (hist?.number) return { ...hist, source: "recent_patient_turn" };
    }
  }

  return null;
}

/**
 * Prompt block when number is known — do not ask again.
 * @param {string|null} number E.164
 * @param {string} [lang]
 */
function buildWhatsappAcknowledgmentPromptBlock(number, lang = "tr") {
  const code = String(lang || "tr").slice(0, 2).toLowerCase();
  const display = number ? String(number) : "";
  const tr =
    "WHATSAPP / TELEFON (hasta zaten verdi — kritik):\n" +
    `* Hasta WhatsApp veya cep telefonu numarasını paylaştı${display ? ` (${display})` : " (önceki mesajda)"}.\n` +
    "* Bu turda numarayı TEKRAR İSTEME. Teşekkür et ve sadece randevu/seyahat koordinasyonu için kullanacağınızı kısaca belirt.\n" +
    '* "Türkçe biliyorum" / "size Türkçe yardımcı olabilirim" gibi dil yeteneği cümleleri YAZMA — hasta numara gönderdi.\n' +
    "* \"Numarayı paylaşır mısınız?\" veya benzeri ifade KULLANMA.";
  const en =
    "WHATSAPP / PHONE (patient already provided — critical):\n" +
    `* The patient already shared their WhatsApp/mobile number${display ? ` (${display})` : " in a prior message"}.\n` +
    "* Do NOT ask for the number again this turn. Thank them briefly and confirm coordination-only use.\n" +
    '* Never say "could you share your number" again.';
  return code === "en" ? en : tr;
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

  const extracted = extractWhatsappFromPatientMessage(params.patientMessage || "", {
    awaiting: true,
  });
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
  isPhoneOnlyPatientMessage,
  patientMessageSharesWhatsappNumber,
  resolvePhoneAcknowledgmentLanguage,
  formatPhoneAcknowledgmentReply,
  repairPhoneNumberTurnReply,
  repairTimeSelectionMisreply,
  repairCoordinatorCapabilityMisreply,
  buildPhoneNumberAcknowledgmentTurnBlock,
  inferOperationalCollectionStage,
  evaluateWhatsappCollectionCandidate,
  buildWhatsappCollectionPromptBlock,
  buildWhatsappAcknowledgmentPromptBlock,
  extractWhatsappFromPatientMessage,
  resolveWhatsappFromPatientTurn,
  patientSaysAlreadyShared,
  coordinatorRecentlyAskedForWhatsapp,
  persistWhatsappCollection,
  markWhatsappPromptOffered,
  enrichLeadWhatsappContact,
  processWhatsappAfterCoordinationTurn,
};
