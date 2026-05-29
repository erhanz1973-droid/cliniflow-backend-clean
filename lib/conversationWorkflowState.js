/**
 * Structured conversation workflow — interpret short patient replies by expected slot,
 * not by isolated message text (operational dental intake + booking).
 */

const { parseConversationalTimeToMinutes, formatMinutesAsHm, isTimeOnlyPatientMessage } =
  require("./conversationalTimeParse");

/**
 * @param {Record<string, unknown>} flags
 */
function readAiBookingStateFromFlags(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const ab = f.aiBooking && typeof f.aiBooking === "object" ? f.aiBooking : {};
  return {
    stage: String(ab.stage || "idle"),
    appointmentOfferPending: ab.appointmentOfferPending === true,
    offeredSlots: Array.isArray(ab.offeredSlots) ? ab.offeredSlots : [],
  };
}

/**
 * @param {string} message
 * @param {number} offeredCount
 */
function isNumberedSlotListPick(message, offeredCount) {
  const m = String(message || "").trim();
  const pick = m.match(/^\s*#?\s*(\d{1,2})\s*[.!)?]*\s*$/i);
  if (!pick) return false;
  const idx = Number(pick[1]) - 1;
  const n = Number(offeredCount) || 0;
  return n > 0 && idx >= 0 && idx < n;
}

const WORKFLOW_VERSION = 1;

/** @typedef {'integer'|'time'|'date'|'yes_no'|'text'|'phone'|'budget'|'pain_scale'} ExpectedInputType */

/**
 * Detect what the coordinator last asked for (TR + EN).
 * @param {string} text
 */
function inferPendingFromAssistantText(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  const rules = [
    {
      pending_slot: "tooth_count",
      expected_input_type: "integer",
      current_step: "collecting_tooth_count",
      re: /\b(how many teeth|how many tooth|missing teeth|teeth (are )?affected|kaç diş|kaç tane diş|etkilenen diş|eksik diş|diş sayısı|diş etkilen|number of teeth)\b/i,
    },
    {
      pending_slot: "appointment_time",
      expected_input_type: "time",
      current_step: "collecting_appointment_time",
      re: /\b(what time|which time|suitable time|preferred time|hangi saat|uygun saat|saat tercih|randevu saati|appointment time|pick a time|choose a time|seçebilir misiniz)\b/i,
    },
    {
      pending_slot: "travel_window",
      expected_input_type: "date",
      current_step: "collecting_travel_date",
      re: /\b(when (do you|would you) (travel|come|visit)|travel date|arrival date|ne zaman geleceksiniz|seyahat tarihi|hangi tarih|which date)\b/i,
    },
    {
      pending_slot: "budget_range",
      expected_input_type: "budget",
      current_step: "collecting_budget",
      re: /\b(budget|price range|bütçe|fiyat aralığı|how much|maliyet)\b/i,
    },
    {
      pending_slot: "pain_level",
      expected_input_type: "pain_scale",
      current_step: "collecting_pain_level",
      re: /\b(pain level|how (bad|strong) is the pain|ağrı şiddeti|ağrınız ne kadar)\b/i,
    },
    {
      pending_slot: "whatsapp_contact",
      expected_input_type: "phone",
      current_step: "collecting_contact",
      re: /\b(whatsapp|phone number|telefon numarası|numaranızı paylaş)\b/i,
    },
    {
      pending_slot: "yes_no_confirm",
      expected_input_type: "yes_no",
      current_step: "awaiting_confirmation",
      re: /\b(would you like|ister misiniz|onaylıyor musunuz|shall we|uygun mu)\b/i,
    },
  ];

  for (const rule of rules) {
    if (rule.re.test(t)) {
      return {
        version: WORKFLOW_VERSION,
        pending_slot: rule.pending_slot,
        expected_input_type: rule.expected_input_type,
        current_step: rule.current_step,
        pending_question: t.slice(0, 280),
        asked_at: new Date().toISOString(),
      };
    }
  }
  return null;
}

/**
 * @param {Array<{ role?: string, text?: string }>} recentTurns
 */
function lastAssistantTurnText(recentTurns) {
  const turns = Array.isArray(recentTurns) ? recentTurns : [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const row = turns[i];
    if (String(row?.role || "").toLowerCase() === "assistant" && String(row?.text || "").trim()) {
      return String(row.text).trim();
    }
  }
  return "";
}

/**
 * @param {Record<string, unknown>|null|undefined} flags
 */
function readConversationWorkflow(flags) {
  const f = flags && typeof flags === "object" ? flags : {};
  const w =
    f.conversationWorkflow && typeof f.conversationWorkflow === "object"
      ? f.conversationWorkflow
      : f.conversation_workflow && typeof f.conversation_workflow === "object"
        ? f.conversation_workflow
        : {};
  return normalizeWorkflowState(w);
}

/**
 * @param {unknown} raw
 */
function normalizeWorkflowState(raw) {
  const base = {
    version: WORKFLOW_VERSION,
    language: null,
    treatment_interest: null,
    current_step: "idle",
    expected_input_type: null,
    pending_slot: null,
    pending_question: null,
    missing_fields: [],
    filled_slots: {},
    asked_at: null,
    last_parsed_at: null,
  };
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const filled =
    o.filled_slots && typeof o.filled_slots === "object"
      ? { ...o.filled_slots }
      : o.filledSlots && typeof o.filledSlots === "object"
        ? { ...o.filledSlots }
        : {};
  const missing = Array.isArray(o.missing_fields)
    ? o.missing_fields.map(String).filter(Boolean)
    : Array.isArray(o.missingFields)
      ? o.missingFields.map(String).filter(Boolean)
      : [];
  return {
    ...base,
    language: o.language ? String(o.language).slice(0, 5) : null,
    treatment_interest:
      o.treatment_interest != null
        ? String(o.treatment_interest)
        : o.treatmentInterest != null
          ? String(o.treatmentInterest)
          : null,
    current_step: String(o.current_step || o.currentStep || "idle"),
    expected_input_type: o.expected_input_type || o.expectedInputType || null,
    pending_slot: o.pending_slot || o.pendingSlot || null,
    pending_question: o.pending_question || o.pendingQuestion || null,
    missing_fields: missing,
    filled_slots: filled,
    asked_at: o.asked_at || o.askedAt || null,
    last_parsed_at: o.last_parsed_at || o.lastParsedAt || null,
  };
}

/**
 * @param {string} message
 */
function isShortAnswerCandidate(message) {
  const t = String(message || "").trim();
  if (!t || t.length > 48) return false;
  if (/\n/.test(t)) return false;
  return true;
}

/**
 * @param {string} text
 */
function parseIntegerSlotValue(text) {
  const t = String(text || "").trim();
  const only = t.match(/^\s*(\d{1,2})\s*$/);
  if (only) {
    const n = parseInt(only[1], 10);
    if (n >= 1 && n <= 32) return n;
  }
  const embedded = t.match(/\b(\d{1,2})\s*(diş|tooth|teeth|implant)/i);
  if (embedded) {
    const n = parseInt(embedded[1], 10);
    if (n >= 1 && n <= 32) return n;
  }
  return null;
}

/**
 * Bare hour "7" in appointment context → 07:00 or 19:00 (prefer PM for 1-9 in dental scheduling).
 * @param {string} text
 */
function parseTimeSlotValue(text) {
  const t = String(text || "").trim();
  const bareHour = t.match(/^\s*(\d{1,2})\s*$/);
  if (bareHour) {
    const h = parseInt(bareHour[1], 10);
    if (h >= 0 && h <= 23) {
      const hour = h >= 1 && h <= 9 ? h + 12 : h;
      return `${String(hour).padStart(2, "0")}:00`;
    }
  }
  const mins = parseConversationalTimeToMinutes(t);
  if (mins != null) {
    const hm = formatMinutesAsHm(mins);
    return hm || null;
  }
  return null;
}

/**
 * @param {string} text
 */
function parseYesNoSlotValue(text) {
  const t = String(text || "").trim().toLowerCase();
  if (/^(evet|yes|yeah|yep|tabii|olur|tamam|sure|ok|okay)$/i.test(t)) return true;
  if (/^(hayır|hayir|no|nope|olmaz|yok)$/i.test(t)) return false;
  return null;
}

/**
 * Resolve active pending question: booking > persisted > infer from last assistant.
 * @param {{
 *   flags?: Record<string, unknown>,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 *   patientMessage?: string,
 *   treatmentInterest?: string|null,
 *   language?: string,
 * }} ctx
 */
function resolveActivePendingWorkflow(ctx) {
  const flags = ctx.flags || {};
  const message = String(ctx.patientMessage || "").trim();
  const lang = String(ctx.language || "tr").slice(0, 2);

  const ab = readAiBookingStateFromFlags(flags);
  const bookingActive =
    ab.stage === "slots_offered" ||
    ab.stage === "awaiting_patient_confirm" ||
    ab.stage === "slot_taken" ||
    ab.appointmentOfferPending === true;
  if (bookingActive && isNumberedSlotListPick(message, ab.offeredSlots.length)) {
    return null;
  }

  if (
    bookingActive &&
    (isTimeOnlyPatientMessage(message) || /^\s*\d{1,2}\s*([:.]\d{2})?\s*$/i.test(message)) &&
    !isNumberedSlotListPick(message, ab.offeredSlots.length)
  ) {
    return normalizeWorkflowState({
      pending_slot: "appointment_time",
      expected_input_type: "time",
      current_step: "collecting_appointment_time",
      pending_question: "appointment_slot_selection",
      language: lang,
      treatment_interest: ctx.treatmentInterest || null,
    });
  }

  const persisted = readConversationWorkflow(flags);
  if (persisted.pending_slot && !persisted.filled_slots[persisted.pending_slot]) {
    return {
      ...persisted,
      language: persisted.language || lang,
      treatment_interest: persisted.treatment_interest || ctx.treatmentInterest || null,
    };
  }

  const lastAsst = lastAssistantTurnText(ctx.recentTurns || []);
  const inferred = inferPendingFromAssistantText(lastAsst);
  if (!inferred) return null;
  return {
    ...normalizeWorkflowState(inferred),
    language: lang,
    treatment_interest: ctx.treatmentInterest || persisted.treatment_interest || null,
    filled_slots: { ...persisted.filled_slots },
    missing_fields: persisted.missing_fields?.length ? persisted.missing_fields : [],
  };
}

/**
 * @param {string} slot
 * @param {string} message
 * @param {ExpectedInputType|null} expectedType
 */
function parseMessageForSlot(slot, message, expectedType) {
  const type = expectedType || "text";
  if (type === "integer" || slot === "tooth_count") {
    const n = parseIntegerSlotValue(message);
    if (n != null) return { ok: true, value: n, intent: "tooth_count_answer" };
  }
  if (type === "time" || slot === "appointment_time") {
    const hm = parseTimeSlotValue(message);
    if (hm) return { ok: true, value: hm, intent: "appointment_time_answer" };
  }
  if (type === "yes_no" || slot === "yes_no_confirm") {
    const yn = parseYesNoSlotValue(message);
    if (yn != null) return { ok: true, value: yn, intent: "yes_no_answer" };
  }
  if (type === "phone" || slot === "whatsapp_contact") {
    const digits = message.replace(/\D/g, "");
    if (digits.length >= 10) return { ok: true, value: message.trim(), intent: "phone_answer" };
  }
  return { ok: false, value: null, intent: null };
}

/**
 * @param {string} lang
 * @param {string} slot
 * @param {unknown} value
 */
function buildSlotAckReply(lang, slot, value) {
  const tr = String(lang || "tr").slice(0, 2) !== "en";
  if (slot === "tooth_count") {
    const n = Number(value);
    if (tr) {
      return `Teşekkürler — ${n} diş için bilgiyi not aldım. Klinik değerlendirmesi için bir sonraki adımda size yardımcı olmaya devam edeceğim.`;
    }
    return `Thank you — I've noted ${n} affected tooth/teeth for your consultation planning.`;
  }
  if (slot === "appointment_time") {
    const hm = String(value || "");
    if (tr) {
      return `Teşekkürler — ${hm} saatini not aldım. Uygunluğu kontrol edip randevu planlamasına devam edeceğiz.`;
    }
    return `Thank you — I've noted ${hm} as your preferred time. We'll check availability and continue scheduling.`;
  }
  if (slot === "yes_no_confirm") {
    return tr ? "Teşekkürler, not aldım." : "Thanks, noted.";
  }
  return tr ? "Teşekkürler, bilgiyi not aldım." : "Thank you, I've noted that.";
}

/**
 * @param {import('./leadIntelligence').LeadData} leadData
 * @param {string} slot
 * @param {unknown} value
 */
function applySlotToLeadData(leadData, slot, value) {
  const ld = { ...(leadData || {}) };
  if (slot === "tooth_count" && Number.isFinite(Number(value))) {
    ld.missingTeethCount = Number(value);
    if (!ld.treatmentInterest && /implant/i.test(String(ld.treatmentInterest || ""))) {
      /* keep */
    }
  }
  if (slot === "travel_window" && value) {
    ld.travelTimeline = String(value);
  }
  if (slot === "budget_range" && value) {
    ld.budgetSignal = String(value).length > 20 ? "medium" : String(value);
  }
  return ld;
}

/**
 * @param {Record<string, unknown>} workflow
 * @param {string} slot
 * @param {unknown} value
 */
function workflowAfterFilledSlot(workflow, slot, value) {
  const w = normalizeWorkflowState(workflow);
  const filled = { ...w.filled_slots, [slot]: value };
  const missing = (w.missing_fields || []).filter((f) => f !== slot);
  return normalizeWorkflowState({
    ...w,
    filled_slots: filled,
    pending_slot: null,
    expected_input_type: null,
    current_step: "idle",
    pending_question: null,
    missing_fields: missing,
    last_parsed_at: new Date().toISOString(),
  });
}

/**
 * Set pending workflow from coordinator's outgoing question (post-reply).
 * @param {string} aiReplyText
 * @param {Record<string, unknown>} [prevWorkflow]
 */
function workflowAfterAssistantReply(aiReplyText, prevWorkflow) {
  const inferred = inferPendingFromAssistantText(aiReplyText);
  const prev = normalizeWorkflowState(prevWorkflow);
  if (!inferred) {
    return {
      ...prev,
      pending_slot: null,
      expected_input_type: null,
      current_step: prev.pending_slot ? prev.current_step : "idle",
    };
  }
  const missing = [...new Set([...prev.missing_fields, inferred.pending_slot].filter(Boolean))];
  return normalizeWorkflowState({
    ...prev,
    ...inferred,
    missing_fields: missing,
    asked_at: new Date().toISOString(),
  });
}

/**
 * Main turn evaluator — call before LLM when patient sends a short answer.
 * @param {{
 *   patientMessage: string,
 *   recentTurns?: Array<{ role?: string, text?: string }>,
 *   flags?: Record<string, unknown>,
 *   leadData?: import('./leadIntelligence').LeadData|null,
 *   language?: string,
 * }} params
 */
function evaluateConversationWorkflowTurn(params) {
  const message = String(params.patientMessage || "").trim();
  const lang = String(params.language || "tr").slice(0, 5);
  const leadData = params.leadData || {};
  const treatmentInterest = leadData.treatmentInterest || null;

  const pending = resolveActivePendingWorkflow({
    flags: params.flags,
    recentTurns: params.recentTurns,
    patientMessage: message,
    treatmentInterest,
    language: lang,
  });

  if (!pending?.pending_slot) {
    return {
      engaged: false,
      promptBlock: "",
      directReply: null,
      leadDataPatch: null,
      workflowPatch: null,
    };
  }

  if (!isShortAnswerCandidate(message)) {
    return {
      engaged: true,
      promptBlock: buildWorkflowContextPromptBlock({
        workflow: pending,
        parsed: null,
        patientMessage: message,
        language: lang,
      }),
      directReply: null,
      leadDataPatch: null,
      workflowPatch: pending,
    };
  }

  const parsed = parseMessageForSlot(
    String(pending.pending_slot),
    message,
    /** @type {ExpectedInputType|null} */ (pending.expected_input_type),
  );

  if (!parsed.ok) {
    return {
      engaged: true,
      promptBlock: buildWorkflowContextPromptBlock({
        workflow: pending,
        parsed: null,
        patientMessage: message,
        language: lang,
      }),
      directReply: null,
      leadDataPatch: null,
      workflowPatch: pending,
    };
  }

  const slot = String(pending.pending_slot);
  const workflowNext = workflowAfterFilledSlot(pending, slot, parsed.value);
  const leadDataPatch = applySlotToLeadData(leadData, slot, parsed.value);

  const conversationalIntakePatch =
    slot === "tooth_count"
      ? { missingTeeth: Number(parsed.value) }
      : slot === "travel_window"
        ? { travelWindow: String(parsed.value) }
        : null;

  return {
    engaged: true,
    promptBlock: buildWorkflowContextPromptBlock({
      workflow: workflowNext,
      parsed,
      patientMessage: message,
      language: lang,
    }),
    directReply: buildSlotAckReply(lang, slot, parsed.value),
    leadDataPatch,
    workflowPatch: workflowNext,
    conversationalIntakePatch,
    parsedIntent: parsed.intent,
    slotValue: parsed.value,
  };
}

/**
 * @param {{
 *   workflow: Record<string, unknown>,
 *   parsed: { ok?: boolean, value?: unknown, intent?: string|null }|null,
 *   patientMessage: string,
 *   language?: string,
 * }} params
 */
function buildWorkflowContextPromptBlock(params) {
  const w = normalizeWorkflowState(params.workflow);
  const lang = String(params.language || w.language || "tr").slice(0, 2);
  const tr = lang !== "en";

  const lines = [
    "CONVERSATION WORKFLOW STATE (mandatory — short answers are slot fills, not new topics):",
    `* Active step: ${w.current_step || "idle"}`,
    w.pending_slot
      ? `* Awaiting patient answer for slot: ${w.pending_slot} (expected type: ${w.expected_input_type || "text"})`
      : "* No open slot question — continue intake naturally.",
  ];

  const filledKeys = Object.keys(w.filled_slots || {});
  if (filledKeys.length) {
    lines.push(
      `* Already captured slots: ${filledKeys.map((k) => `${k}=${JSON.stringify(w.filled_slots[k])}`).join(", ")}`,
    );
  }

  if (params.parsed?.ok) {
    lines.push(
      `* THIS TURN: Patient message "${params.patientMessage}" was parsed as ${params.parsed.intent} = ${JSON.stringify(params.parsed.value)}.`,
    );
    lines.push(
      "* Do NOT reinterpret this number/time as age, random data, or unrelated context.",
    );
    lines.push(
      "* Acknowledge briefly, then ask the next single missing operational question if needed (max one).",
    );
  } else if (w.pending_slot && isShortAnswerCandidate(params.patientMessage)) {
    lines.push(
      `* Patient sent a short reply while "${w.pending_slot}" was expected — interpret only in that context; if unclear, ask one clarifying question about ${w.pending_slot} only.`,
    );
  }

  lines.push(
    tr
      ? '* "Türkçe biliyorum" veya genel sohbet cevabı VERME — operasyonel intake/randevu akışında kal.'
      : '* Do NOT give meta language capability replies — stay in operational intake/booking workflow.',
  );

  return lines.join("\n");
}

module.exports = {
  WORKFLOW_VERSION,
  readConversationWorkflow,
  normalizeWorkflowState,
  inferPendingFromAssistantText,
  resolveActivePendingWorkflow,
  evaluateConversationWorkflowTurn,
  workflowAfterAssistantReply,
  buildWorkflowContextPromptBlock,
  parseIntegerSlotValue,
  parseTimeSlotValue,
};
