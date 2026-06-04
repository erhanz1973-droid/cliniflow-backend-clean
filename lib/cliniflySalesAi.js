/**
 * Clinifly Sales AI — Messenger pages in clinifly_sales mode (no clinic KB).
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const {
  chatCompletion,
  isOpenAIConfigured,
  sanitizePatientFacingReply,
  coercePatientFacingReply,
  isInvalidPatientFacingReply,
} = require("./openai");
const { fetchRecentCoordinatorTurns } = require("./coordinatorRecentHistory");
const { insertChannelMessagesWithChannel } = require("./coordinatorChannelPersistence");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { normalizeConversationSummary, trimHistoryToRecent, buildMemoryPreamble, MAX_RECENT_TURNS } = require("./conversationMemory");
const { enforcePatientReplyLanguage } = require("./conversationLanguage");
const { CONVERSATION_TYPE } = require("./pageAiMode");
const { COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const {
  retrieveCliniflySalesKnowledge,
  formatKbIdsForLog,
} = require("./cliniflySalesKnowledge");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((opts: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertClinicMessageFn = null;

const CLINIFLY_SALES_SYSTEM_PROMPT = `You are Clinifly Sales AI — the official pre-sales assistant for dental clinics evaluating Clinifly.

ROLE:
• Explain Clinifly the platform to clinic owners, partners, and marketers — never a specific dental clinic.
• Use ONLY the AUTHORITATIVE SALES KB block below for product, pricing, markets, and features.
• If the KB does not cover something, say the Clinifly team will follow up — do not invent facts.

HARD BANS:
• Never mention a clinic code (e.g. CEM), patient app enrollment steps, treatment prices, or clinical advice.
• Never sound like a clinic treatment coordinator ("our clinic", "our doctors", appointment slots for procedures).
• Never tell visitors to download the patient app and enter a clinic code unless KB explicitly covers a sales motion (default: avoid).

COMMERCIAL BEHAVIOR:
• Professional, warm, sales-oriented — not pushy.
• Offer demo, 2-month trial (no credit card), or human call when interest is shown.
• Collect lead details when appropriate: name, clinic name, email, phone, country.
• Pricing in KB is canonical: 2-month trial, Pro $29/month, Premium tier, patient apps free.

STYLE:
• Messenger: 2–4 short sentences; match the visitor's language.

Output — valid JSON only (no markdown fences):
{
  "reply": "visitor-facing message only",
  "conversationSummary": "updated rolling summary for sales context",
  "salesLead": {
    "contactName": string or null,
    "clinicName": string or null,
    "email": string or null,
    "phone": string or null,
    "country": string or null,
    "demoInterest": "low" | "medium" | "high" | null,
    "meetingInterest": true | false | null,
    "notes": string or null
  }
}`;

const HUMAN_ESCALATION_RE =
  /\b(human|real person|live agent|speak to someone|talk to someone|call me back|phone me|representative|customer service|can i speak|operator|muhatap|yetkili|insan|gercek kisi|canli destek|birisiyle gorus|aramak istiyorum|beni arayin)\b/i;

/**
 * @param {import('./pageAiMode').setupCliniflySalesInbound} deps
 */
function setupCliniflySalesInbound(deps) {
  insertClinicMessageFn = deps.insertClinicMessage || null;
}

/**
 * @param {string} text
 */
function detectSalesHumanEscalation(text) {
  return HUMAN_ESCALATION_RE.test(String(text || "").trim());
}

/**
 * @param {string} [lang]
 */
function buildSalesHumanHandoffReply(lang = "en") {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  if (key === "tr") {
    return "Tabii — talebinizi Clinifly ekibine iletiyorum. Kısa süre içinde sizinle doğrudan iletişime geçecekler. İsterseniz adınız, klinik adınız ve telefon veya e-postanızı da yazabilirsiniz.";
  }
  if (key === "ru") {
    return "Конечно — я передам ваш запрос команде Clinifly. С вами свяжутся напрямую. Можете оставить имя, клинику и телефон или email.";
  }
  return "Of course — I’m passing your request to the Clinifly team. Someone will contact you directly soon. You can also share your name, clinic name, and phone or email if you like.";
}

/**
 * @param {string} content
 */
function parseSalesPayload(content) {
  let raw = null;
  try {
    raw = JSON.parse(content);
  } catch {
    const trimmed = String(content || "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        raw = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        raw = null;
      }
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { reply: String(content || "").trim(), conversationSummary: "", salesLead: null };
  }
  const reply = String(raw.reply || raw.message || "").trim();
  const conversationSummary = normalizeConversationSummary(
    raw.conversationSummary ?? raw.conversation_summary ?? raw.summary,
  );
  const leadRaw = raw.salesLead ?? raw.sales_lead ?? raw.lead ?? null;
  const salesLead =
    leadRaw && typeof leadRaw === "object" && !Array.isArray(leadRaw) ? leadRaw : null;
  return { reply, conversationSummary, salesLead };
}

/**
 * @param {Record<string, unknown>|null} salesLead
 * @param {Record<string, unknown>} prevMeta
 */
function mergeSalesLeadMetadata(salesLead, prevMeta = {}) {
  const prev =
    prevMeta.clinifly_sales_lead && typeof prevMeta.clinifly_sales_lead === "object"
      ? { ...prevMeta.clinifly_sales_lead }
      : {};
  if (!salesLead) return { ...prevMeta, clinifly_sales_lead: prev };
  const patch = { ...prev };
  for (const key of [
    "contactName",
    "clinicName",
    "email",
    "phone",
    "country",
    "demoInterest",
    "meetingInterest",
    "notes",
  ]) {
    const v = salesLead[key];
    if (v != null && String(v).trim()) patch[key] = v;
  }
  patch.updated_at = new Date().toISOString();
  return { ...prevMeta, clinifly_sales_lead: patch };
}

/**
 * @param {string} message
 * @param {string|null} summary
 * @param {Array<{ role: string, text: string }>} recentTurns
 * @param {string|null} conversationLanguage
 * @param {string|null} salesKbContext
 */
async function cliniflySalesChatReply({
  message,
  conversationSummary,
  recentTurns,
  conversationLanguage,
  salesKbContext,
}) {
  if (!isOpenAIConfigured()) {
    throw new Error("openai_not_configured");
  }
  const userText = String(message || "").trim();
  const turns = trimHistoryToRecent(recentTurns || [], MAX_RECENT_TURNS);
  let latestBlock = `Visitor's latest message:\n${userText}`;
  let systemPrompt = CLINIFLY_SALES_SYSTEM_PROMPT;
  const kbCtx = salesKbContext ? String(salesKbContext).trim() : "";
  if (kbCtx) {
    systemPrompt = `${systemPrompt}\n\n${kbCtx}`;
  }
  const messages = [{ role: "system", content: systemPrompt }];
  const preamble = buildMemoryPreamble({ conversationSummary, recentTurns: turns });
  if (preamble) {
    messages.push({ role: "user", content: preamble });
    messages.push({
      role: "assistant",
      content: "Understood. I will use the summary and recent messages for Clinifly sales context only.",
    });
  }
  for (const turn of turns) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({ role: "user", content: latestBlock });

  const { content, model } = await chatCompletion({ messages, jsonMode: true, maxTokens: 480 });
  const parsed = parseSalesPayload(content);
  let safeReply = coercePatientFacingReply(parsed.reply, {
    lang: conversationLanguage,
    patientMessage: userText,
    logLabel: "cliniflySalesChatReply",
  });
  if (isInvalidPatientFacingReply(safeReply)) {
    safeReply = sanitizePatientFacingReply(safeReply, {
      lang: conversationLanguage,
      patientMessage: userText,
      logLabel: "cliniflySalesChatReply",
    });
  }
  safeReply = enforcePatientReplyLanguage(safeReply, {
    expectedLang: conversationLanguage,
    lockedConversationLanguage: conversationLanguage,
    patientMessage: userText,
    logLabel: "cliniflySalesChatReply",
  });
  return {
    reply: safeReply,
    conversationSummary: parsed.conversationSummary || conversationSummary || "",
    salesLead: parsed.salesLead,
    model,
  };
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {string} externalMessageId
 */
function aiAlreadyRepliedForExternalMessage(profileRow, externalMessageId) {
  const mid = String(externalMessageId || "").trim();
  if (!mid) return false;
  const flags =
    profileRow.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? profileRow.operational_intake_flags
      : {};
  return String(flags.lastAiRepliedForExternalMessageId || "") === mid;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} message
 */
async function ensureCliniflySalesProfile(patientId, clinicId, message) {
  const { touchLeadProfileFromInbound } = require("./aiSlaContinuity");
  let profileId = await touchLeadProfileFromInbound(patientId, clinicId, message);
  if (!profileId || !isSupabaseEnabled()) return null;

  const nowIso = new Date().toISOString();
  const { data: row } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, channel_metadata, conversation_type")
    .eq("id", profileId)
    .maybeSingle();

  const meta =
    row?.channel_metadata && typeof row.channel_metadata === "object"
      ? { ...row.channel_metadata }
      : {};
  meta.clinifly_sales = { ...(meta.clinifly_sales && typeof meta.clinifly_sales === "object" ? meta.clinifly_sales : {}), active: true };

  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      conversation_type: CONVERSATION_TYPE.CLINIFLY_SALES,
      primary_channel: "messenger",
      source: "clinifly_sales_messenger",
      coordination_mode: "ai_active",
      ai_mode: "AI_ACTIVE",
      ai_paused: false,
      channel_metadata: meta,
      updated_at: nowIso,
    })
    .eq("id", profileId);

  return profileId;
}

/**
 * @param {Record<string, unknown>} params
 */
async function runCliniflySalesInboundReply(params) {
  if (!insertClinicMessageFn || !isSupabaseEnabled()) {
    return { sent: false, reason: "not_configured" };
  }

  const patientId = String(params.patientId || "").trim();
  const clinicId = String(params.clinicId || "").trim();
  const message = String(params.patientMessage || "").trim();
  const channel = "messenger";

  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId) || !message) {
    return { sent: false, reason: "invalid_params" };
  }

  const profileId = await ensureCliniflySalesProfile(patientId, clinicId, message);
  if (!profileId) return { sent: false, reason: "no_profile" };

  const { data: profileRow, error: loadErr } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, ai_mode, ai_paused, ai_escalation_required, escalation_flags, human_takeover_at, conversation_summary, conversation_primary_language, preferred_language, operational_intake_flags, channel_metadata, last_patient_message_at, last_ai_reply_at",
    )
    .eq("id", profileId)
    .maybeSingle();

  if (loadErr || !profileRow?.id) return { sent: false, reason: "no_profile" };

  if (params.externalMessageId && aiAlreadyRepliedForExternalMessage(profileRow, params.externalMessageId)) {
    return { sent: false, reason: "already_replied_external_id" };
  }

  const mode = String(profileRow.ai_mode || "").toUpperCase().replace(/-/g, "_");
  if (
    profileRow.ai_paused === true &&
    (mode === "HUMAN_ONLY" || profileRow.ai_escalation_required === true)
  ) {
    return { sent: false, reason: "human_takeover" };
  }

  const lang =
    profileRow.conversation_primary_language ||
    profileRow.preferred_language ||
    (/[а-яё]/i.test(message) ? "ru" : /[ğüşöçıİ]/i.test(message) ? "tr" : "en");

  let replyText = "";
  let nextSummary = normalizeConversationSummary(profileRow.conversation_summary);
  let salesLead = null;
  let escalated = false;
  /** @type {string[]} */
  let kbEntryIdsUsed = [];
  let kbTopScore = 0;

  if (detectSalesHumanEscalation(message)) {
    replyText = buildSalesHumanHandoffReply(lang);
    escalated = true;
  } else if (!isOpenAIConfigured()) {
    replyText =
      lang === "tr"
        ? "Merhaba — ben Clinifly asistanıyım. Clinifly, kliniklerin hasta iletişimi ve uluslararası hasta kazanımı için bir platformdur. Demo veya görüşme için adınızı ve iletişim bilginizi yazabilirsiniz."
        : "Hello — I'm the Clinifly assistant. Clinifly helps dental clinics with patient communication and international patient acquisition. Share your contact details if you'd like a demo.";
  } else {
    const kbRetrieval = await retrieveCliniflySalesKnowledge({
      message,
      locale: lang,
    });
    kbEntryIdsUsed = formatKbIdsForLog(kbRetrieval.entryIds);
    kbTopScore = kbRetrieval.topScore;

    const recentTurns = await fetchRecentCoordinatorTurns(profileRow.id, {
      maxTurns: 10,
      patientId,
      clinicId,
      includeClinicChat: true,
    });
    try {
      const ai = await cliniflySalesChatReply({
        message,
        conversationSummary: nextSummary,
        recentTurns,
        conversationLanguage: lang,
        salesKbContext: kbRetrieval.contextBlock,
      });
      replyText = ai.reply;
      nextSummary = ai.conversationSummary || nextSummary;
      salesLead = ai.salesLead;
    } catch (e) {
      console.warn("[cliniflySalesAi] chat:", e?.message || e);
      replyText = buildSalesHumanHandoffReply(lang);
      escalated = true;
    }
  }

  if (!String(replyText || "").trim()) {
    return { sent: false, reason: "empty_reply" };
  }

  const insertResult = await insertClinicMessageFn({
    patientId,
    message: replyText,
    type: "text",
    contextClinicId: clinicId,
    senderName: "Clinifly",
    messageProvenance: {
      message_source: "clinifly_sales_auto_reply",
      operational_channel: channel,
      conversation_type: CONVERSATION_TYPE.CLINIFLY_SALES,
      latency_trace_id: params.latencyTraceId || null,
      kb_entry_ids_used: kbEntryIdsUsed,
      kb_top_score: kbTopScore,
    },
  });

  if (insertResult?.error) {
    return { sent: false, reason: "insert_failed" };
  }

  const nowIso = new Date().toISOString();
  const prevMeta =
    profileRow.channel_metadata && typeof profileRow.channel_metadata === "object"
      ? profileRow.channel_metadata
      : {};
  const channelMetadata = {
    ...mergeSalesLeadMetadata(salesLead, prevMeta),
    clinifly_sales_kb: {
      entry_ids_used: kbEntryIdsUsed,
      top_score: kbTopScore,
      retrieved_at: nowIso,
    },
  };
  const flags =
    profileRow.operational_intake_flags && typeof profileRow.operational_intake_flags === "object"
      ? { ...profileRow.operational_intake_flags }
      : {};
  if (params.externalMessageId) {
    flags.lastAiRepliedForExternalMessageId = String(params.externalMessageId).trim();
    flags.lastAiRepliedForPatientMessageAt = params.inboundPatientMessageAt || nowIso;
  }

  const profilePatch = {
    conversation_type: CONVERSATION_TYPE.CLINIFLY_SALES,
    conversation_summary: nextSummary || profileRow.conversation_summary,
    last_ai_reply_at: nowIso,
    channel_metadata: channelMetadata,
    operational_intake_flags: flags,
    updated_at: nowIso,
  };

  if (escalated) {
    profilePatch.ai_escalation_required = true;
    profilePatch.ai_paused = true;
    profilePatch.ai_mode = "HUMAN_ONLY";
    profilePatch.coordination_mode = COORDINATION_HUMAN;
    profilePatch.human_takeover_at = profileRow.human_takeover_at || nowIso;
    const esc =
      profileRow.escalation_flags && typeof profileRow.escalation_flags === "object"
        ? { ...profileRow.escalation_flags }
        : {};
    esc.clinifly_sales_human_requested = true;
    esc.clinifly_sales_human_requested_at = nowIso;
    profilePatch.escalation_flags = esc;
  }

  await supabase.from("ai_coordinator_lead_profiles").update(profilePatch).eq("id", profileRow.id);

  await insertChannelMessagesWithChannel({
    profile_id: profileRow.id,
    channel,
    direction: "outbound",
    message_role: "assistant",
    body: replyText.slice(0, 8000),
  });

  await insertTimelineEvent({
    profileId: profileRow.id,
    eventType: escalated ? "sales_escalation" : "clinifly_sales_reply",
    eventMetadata: {
      source: "clinifly_sales_messenger",
      conversation_type: CONVERSATION_TYPE.CLINIFLY_SALES,
      escalated,
      kb_entry_ids_used: kbEntryIdsUsed,
      kb_top_score: kbTopScore,
    },
    patientMessage: message,
    aiReply: replyText,
    channel,
  });

  const outboundDelivered =
    insertResult?.outboundDelivery?.delivered === true ||
    insertResult?.outboundDelivery?.ok === true;

  console.log("[cliniflySalesAi] reply sent", {
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    escalated,
    outboundDelivered,
    kb_entry_ids_used: kbEntryIdsUsed,
    kb_top_score: kbTopScore,
  });

  return {
    sent: true,
    profileId: profileRow.id,
    outboundDelivered,
    escalated,
    kbEntryIdsUsed,
    kbTopScore,
  };
}

module.exports = {
  setupCliniflySalesInbound,
  runCliniflySalesInboundReply,
  detectSalesHumanEscalation,
  CLINIFLY_SALES_SYSTEM_PROMPT,
  retrieveCliniflySalesKnowledge,
};
