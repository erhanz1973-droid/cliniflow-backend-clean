/**
 * Inbound AI routing — single workflow selection, burst merge, duplicate reply guards.
 */

const { parsePreferredDateFromMessage } = require("./bookingDateParse");
const { readDurableBookingState, IN_PROGRESS_STAGES } = require("./aiBookingState");

const SCHEDULING_INTENT_RE =
  /\b(randevu|appointment|consultation|müsait|musait|uygun\s+saat|available|slot|cuma|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|öğleden\s+sonra|ogleden\s+sonra|afternoon|morning|sabah|akşam|akşamüstü)\b/i;

const CONTINUATION_FRAGMENT_RE =
  /^(istiyorum|istiyor|olur|tamam|evet|peki|ok|okay|yes|please|sure|tabii|uygun|kabul|olsun|lütfen|lutfen|devam)[\s!.?]*$/i;

/** @param {string} text */
function normalizeContinuationText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

/** @param {string} message */
function messageHasSchedulingIntent(message) {
  return SCHEDULING_INTENT_RE.test(String(message || "").trim());
}

/**
 * Bare continuation after a split WhatsApp burst ("Cuma randevu" + "istiyorum").
 * @param {string} message
 * @param {Array<{ role?: string, text?: string, body?: string }>} [recentTurns]
 */
function isSchedulingContinuationFragment(message, recentTurns = []) {
  const msg = normalizeContinuationText(message);
  if (!msg || msg.length > 48) return false;
  if (!CONTINUATION_FRAGMENT_RE.test(msg)) return false;
  for (let i = recentTurns.length - 1; i >= 0 && i >= recentTurns.length - 6; i -= 1) {
    const t = recentTurns[i];
    const role = String(t?.role || "").toLowerCase();
    if (role !== "patient" && role !== "user") continue;
    const text = String(t?.text || t?.body || "").trim();
    if (text && messageHasSchedulingIntent(text)) return true;
  }
  return false;
}

/**
 * @param {string} message
 * @param {string|null|undefined} lastPatientMessage
 */
function shouldMergeWithLastPatientMessage(message, lastPatientMessage) {
  const cur = normalizeContinuationText(message);
  const prev = String(lastPatientMessage || "").trim();
  if (!cur || !prev) return false;
  if (patientMessagesNearDuplicate(cur, prev)) return false;
  if (isSchedulingContinuationFragment(message, [{ role: "patient", text: prev }])) return true;
  if (CONTINUATION_FRAGMENT_RE.test(cur) && messageHasSchedulingIntent(prev)) return true;
  return false;
}

/**
 * @param {string} a
 * @param {string} b
 */
function patientMessagesNearDuplicate(a, b) {
  const na = String(a || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const nb = String(b || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * @param {Record<string, unknown>|null|undefined} profileRow
 * @param {number} [windowMs]
 */
function aiRepliedRecentlyInBurst(profileRow, windowMs = 15_000) {
  const flags =
    profileRow?.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {};
  const burstAt = Date.parse(String(flags.lastAiSchedulingBurstReplyAt || ""));
  if (Number.isFinite(burstAt) && Date.now() - burstAt < windowMs) return true;
  const replyAt = Date.parse(String(profileRow?.last_ai_reply_at || ""));
  return Number.isFinite(replyAt) && Date.now() - replyAt < windowMs;
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 * @param {string} message
 * @param {string} timezone
 */
function buildStaleSchedulingResetPatch(flags, message, timezone = "Europe/Istanbul") {
  const f = flags && typeof flags === "object" ? flags : {};
  const d = readDurableBookingState(f);
  if (d.rescheduleMode === true) return null;

  const newDate = parsePreferredDateFromMessage(message, timezone);
  if (!newDate) return null;

  const stage = String(d.stage || "idle").toLowerCase();
  if (!IN_PROGRESS_STAGES.has(stage) && stage !== "awaiting_slot_confirm") return null;

  const stalePreferred = d.preferredDateYmd ? String(d.preferredDateYmd) : null;
  const activeStart = f.activeAppointment?.startAt ? String(f.activeAppointment.startAt) : null;
  let activeDateYmd = null;
  if (activeStart) {
    try {
      const { formatInTimeZone } = require("date-fns-tz");
      activeDateYmd = formatInTimeZone(new Date(activeStart), timezone, "yyyy-MM-dd");
    } catch {
      activeDateYmd = null;
    }
  }

  const conflictsWithStale =
    (stalePreferred && stalePreferred !== newDate) ||
    (Array.isArray(d.offeredSlots) &&
      d.offeredSlots.length > 0 &&
      d.offeredSlots.some((s) => s?.dateYmd && String(s.dateYmd) !== newDate));

  if (!conflictsWithStale && stalePreferred === newDate) return null;

  if (!conflictsWithStale && !stalePreferred && !d.offeredSlots?.length) return null;

  return {
    aiBooking: {
      ...d,
      preferredDateYmd: newDate,
      preferredTimeMin: null,
      offeredSlots: [],
      slotListId: null,
      selectedSlot: null,
      selectedDate: null,
      pendingAction: null,
      pending_action: null,
      awaitingAction: null,
      appointmentOfferPending: false,
      stage: "slots_offered",
    },
  };
}

/**
 * @param {Record<string, unknown>} payload
 */
function logAiRouter(payload) {
  try {
    console.log(
      "[AI_ROUTER]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (e) {
    console.warn("[AI_ROUTER] log_failed:", e?.message || e);
  }
}

/**
 * @param {Record<string, unknown>} payload
 */
function logDuplicateReplyDetected(payload) {
  try {
    console.log(
      "[DUPLICATE_REPLY_DETECTED]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (e) {
    console.warn("[DUPLICATE_REPLY_DETECTED] log_failed:", e?.message || e);
  }
}

/** Block "share your WhatsApp number" when patient is already on WhatsApp. */
const WHATSAPP_ASK_FOR_NUMBER_RE =
  /\b(whatsapp\s*numaran[ıi]z[ıi]|numaran[ıi]z[ıi]\s*payla[sş]|telefon\s*(?:veya|ve)?\s*whatsapp\s*numaran|share\s*(?:your\s*)?(?:whatsapp|phone)\s*number|what\s*is\s*your\s*whatsapp)\b/i;

/**
 * @param {string} reply
 * @param {string} channel
 * @param {string|null} knownWhatsapp
 */
function repairWhatsappNumberAskOnChannel(reply, channel, knownWhatsapp) {
  const ch = String(channel || "").toLowerCase();
  if (ch !== "whatsapp") return String(reply || "").trim();
  const out = String(reply || "").trim();
  if (!out || !WHATSAPP_ASK_FOR_NUMBER_RE.test(out)) return out;

  const display = knownWhatsapp ? String(knownWhatsapp).trim() : "";
  console.warn("[aiInboundRouter] repaired whatsapp_number_ask on whatsapp channel");
  if (display) {
    return `İletişim için bu WhatsApp numarasını (${display}) kullanmaya devam edelim mi? Farklı bir numara isterseniz yazabilirsiniz.`;
  }
  return "İletişim için bu WhatsApp numaranızı kullanmaya devam edelim mi? Farklı bir numara isterseniz yazabilirsiniz.";
}

module.exports = {
  messageHasSchedulingIntent,
  isSchedulingContinuationFragment,
  shouldMergeWithLastPatientMessage,
  aiRepliedRecentlyInBurst,
  buildStaleSchedulingResetPatch,
  logAiRouter,
  logDuplicateReplyDetected,
  repairWhatsappNumberAskOnChannel,
  CONTINUATION_FRAGMENT_RE,
};
