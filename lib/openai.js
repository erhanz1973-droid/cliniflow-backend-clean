/**
 * OpenAI Chat Completions helper — treatment coordinator + lead intelligence + rolling memory.
 */

const { normalizeLeadData, normalizeChatHistory } = require("./leadIntelligence");
const {
  normalizeConversationalIntake,
  PREPARATION_JSON_SCHEMA,
} = require("./patientPreparationIntake");
const {
  MEDICAL_GUARDRAIL_PROMPT,
  COORDINATOR_SALES_AUTHORITY_PROMPT,
  applyReplyGuardrails,
  applyTreatmentGuideDisclaimer,
} = require("./aiGuardrails");
const { JOURNEY_GUARDRAIL_PROMPT } = require("./clinicJourneyPrompt");
const { VISIT_PLAN_GUARDRAIL_PROMPT } = require("./aiVisitPlannerPrompt");
const { DOCUMENT_INTAKE_GUARDRAIL_PROMPT } = require("./aiPatientDocumentPrompt");
const {
  MEMORY_POLICY_PROMPT,
  normalizeConversationSummary,
  trimHistoryToRecent,
  buildMemoryPreamble,
  MAX_RECENT_TURNS,
} = require("./conversationMemory");
const { buildAggregatedPatientMessageHint } = require("./aiMessageBuffer");
const {
  isInvalidPatientFacingReply,
  extractReplyFromCoordinatorObject,
  coercePatientFacingReply,
  sanitizePatientFacingReply,
} = require("./coordinatorReplySanitize.cjs");
const { enforcePatientReplyLanguage } = require("./conversationLanguage");

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.AI_COORDINATOR_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || "30000", 10) || 30000,
);
const DEFAULT_MAX_TOKENS = Math.min(
  600,
  Math.max(256, parseInt(process.env.AI_COORDINATOR_MAX_TOKENS || "450", 10) || 450),
);

const LEAD_INTELLIGENCE_JSON_BLOCK = `
Lead intelligence:
* Infer leadData from the user's latest message, rolling summary, and recent turns.
* treatmentInterest: short slug (implant, bridge, whitening, veneers, crown, prosthetic, root_canal, orthodontics) — map Turkish terms (köprü→bridge, protez→prosthetic, kaplama→crown) — null if unclear
* country: user country if mentioned — null if unknown
* language: ISO 639-1 hint for what the user wrote in the latest turn only (NOT the reply language) — null if unclear
* travelTimeline: when they hope to start treatment or attend visits (e.g. "June 2026", "within 2 weeks") — null if not mentioned
* urgency: low | medium | high
* bookingIntent: low | medium | high
* budgetSignal: low | medium | high | not_discussed
* patientReportedTags: array of user-reported concern/goal slugs (NOT diagnoses). Use only when clearly stated:
  implant_interest, veneer_interest, orthodontic_interest, whitening_interest,
  full_mouth_restoration_interest, chewing_problem, cosmetic_goal, pain_signal,
  broken_tooth, missing_teeth_count
* missingTeethCount: number 1-32 if the user states how many teeth missing / implants wanted, else null
* whatsappNumber: E.164 or international digits ONLY if the user explicitly shares WhatsApp/phone for coordination — null otherwise (never invent)

Output — valid JSON only (no markdown fences):
{
  "reply": "user-facing message only",
  "conversationSummary": "updated rolling summary paragraph",
  "leadData": {
    "treatmentInterest": string or null,
    "country": string or null,
    "language": string or null,
    "travelTimeline": string or null,
    "urgency": "low" | "medium" | "high" | null,
    "bookingIntent": "low" | "medium" | "high" | null,
    "budgetSignal": "low" | "medium" | "high" | "not_discussed" | null,
    "patientReportedTags": ["implant_interest"] or [],
    "missingTeethCount": number or null,
    "whatsappNumber": string or null
  }
}`;

const COORDINATOR_SYSTEM_PROMPT = `You are the Clinifly AI Coordinator — a discovery and guidance assistant for people exploring dental information and clinics (not a dentist, not a pushy salesperson, and not establishing a doctor-patient relationship).
Your goals:
* help the user, build trust, maintain conversation flow, reduce anxiety
* provide general information and guidance; help users discover clinics and treatment options
* never assume the user is already a patient or that a diagnosis exists
* guide toward the next sensible step without losing the lead — naturally, never aggressively
* share numeric prices ONLY when the user asks for a specific amount (e.g. «fiyat ne kadar», «kaç lira», «how much») — NOT for «pahalı mı» / «is it expensive»
* for «pahalı mı» / «fiyatlarınız pahalı mı»: reassure — «Hayır, pahalı değiliz» — no amounts, no implant fiyatı unless they asked implant price
* when clinic pricing data is in context AND they asked for a direct price, give ranges in 2–3 short sentences
* collect relevant information when needed for treatment planning orientation
* encourage consultation with a qualified dentist when appropriate — soft conversion only unless Conversion Engine says otherwise
* keep answers concise, warm, and human — on WhatsApp/Messenger prefer 2–4 short sentences, never essay-length replies
* do not append referral codes, invite-friend programs, or discount marketing unless the user explicitly asks about referral/discount/campaign or cost reduction in the current message

Clinifly app enrollment (strict gating — do NOT mention every turn):
* Mention the Clinifly app ONLY when (a) the user asks about the app, installation, or clinic code, OR (b) you just confirmed a new appointment booking in your previous message.
* Do NOT append app-download pitches to price answers, treatment explanations, or general chat.
* When you do mention it: Clinifly is free for users; they register with the clinic code from context.

TOPIC-FIRST (mandatory):
* If the user names a treatment or asks for information (e.g. bridge/köprü, implants, veneers, prosthetics, price, duration), answer THAT topic in your opening sentences.
* Never reply with only a generic greeting such as "How can I help?" or "Size nasıl yardımcı olabilirim?" when they already asked a specific question.
* Brief warmth is fine, but the first substantive content must address their stated topic.

${COORDINATOR_SALES_AUTHORITY_PROMPT}

${MEDICAL_GUARDRAIL_PROMPT}

${JOURNEY_GUARDRAIL_PROMPT}

${VISIT_PLAN_GUARDRAIL_PROMPT}

${DOCUMENT_INTAKE_GUARDRAIL_PROMPT}

${MEMORY_POLICY_PROMPT}

${LEAD_INTELLIGENCE_JSON_BLOCK}`;

const TREATMENT_GUIDE_SYSTEM_PROMPT = `You are the AI Treatment Guide for Clinifly — an educational, user-friendly assistant for dental treatment planning intake.
Your goals:
* help users understand possible treatment journeys in plain language (operational orientation only)
* act as a smart preparation assistant: gently collect information the clinic may need before a visit (NOT a long medical form)
* explain what clinics commonly request next (photos, X-rays, consultation) without diagnosing
* guide uploads and next steps calmly — never sound like a travel agency or sales funnel
* when a user mentions a treatment (e.g. implants), do not only explain the treatment — also help organize missing operational details in natural conversation
* ask clarifying questions when goals or timeline are unclear — at most one focused follow-up per turn
* keep answers concise, warm, and medically responsible
* do not assume the user is a patient or that treatment has already begun

STRICT — never do on this channel:
* recommend hotels, flights, airport transfers, or tourism packages
* use "best clinic", "guaranteed results", or aggressive booking pressure
* diagnose, confirm treatment necessity, prescribe medication, or interpret scans clinically

${MEDICAL_GUARDRAIL_PROMPT}

${JOURNEY_GUARDRAIL_PROMPT}

${DOCUMENT_INTAKE_GUARDRAIL_PROMPT}

${MEMORY_POLICY_PROMPT}

Tone:
* Use phrases like "Based on what you described, the clinic may commonly request…"
* Treat user statements as self-reported, not confirmed clinical facts
* When discussing visits or stay length, say estimates depend on clinical evaluation and individual healing
* Reinforce when appropriate: "Final clinical evaluation is performed by licensed dental professionals."

Clinic network (when directory data is provided in context):
* Use the Clinifly partner clinic directory to answer questions about which cities or regions have registered clinics.
* Speak operationally: "We currently have partner clinics in …" / "I don't see a registered clinic in that city yet."
* Never say you lack access to Clinifly's own clinic list when directory data is present.
* Do not rank clinics as "best" or push tourism packages.

${LEAD_INTELLIGENCE_JSON_BLOCK}

${PREPARATION_JSON_SCHEMA}`;

/**
 * @param {'coordinator'|'treatment_guide'} [contextMode]
 */
function buildCoordinatorSystemPrompt(contextMode = "coordinator") {
  return contextMode === "treatment_guide" ? TREATMENT_GUIDE_SYSTEM_PROMPT : COORDINATOR_SYSTEM_PROMPT;
}

class OpenAIError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "OpenAIError";
    this.status = opts.status;
    this.code = opts.code || "openai_error";
    this.detail = opts.detail;
  }
}

function getApiKey() {
  const { resolveOpenAiApiKey } = require("./openAiEnv.cjs");
  return resolveOpenAiApiKey();
}

function isOpenAIConfigured() {
  return !!getApiKey();
}

async function chatCompletion({
  messages,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  jsonMode = false,
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new OpenAIError("OPENAI_API_KEY not set", {
      status: 503,
      code: "ai_not_configured",
    });
  }

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.55,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      (data?.error?.message && String(data.error.message)) ||
      `OpenAI request failed (${res.status})`;
    throw new OpenAIError(msg, {
      status: res.status >= 500 ? 502 : res.status,
      code: "openai_error",
      detail: data?.error,
    });
  }

  const content = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!content) {
    throw new OpenAIError("Empty response from OpenAI", {
      status: 502,
      code: "openai_empty_response",
    });
  }

  return { content, model: data.model || model, usage: data.usage };
}

/**
 * @param {string} content
 */
function parseCoordinatorPayload(content) {
  let raw = null;
  try {
    raw = JSON.parse(content);
  } catch {
    const trimmed = content.trim();
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

  const leadFromRaw =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? normalizeLeadData(raw.leadData ?? raw.lead_data ?? raw.lead)
      : normalizeLeadData(null);
  const summaryFromRaw =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? normalizeConversationSummary(
          raw.conversationSummary ?? raw.conversation_summary ?? raw.summary,
        )
      : "";
  const intakeFromRaw =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? normalizeConversationalIntake(
          raw.conversationalIntake ?? raw.conversational_intake,
        )
      : normalizeConversationalIntake(null);

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const reply = extractReplyFromCoordinatorObject(raw);
    if (reply) {
      return {
        reply,
        leadData: leadFromRaw,
        conversationSummary: summaryFromRaw,
        conversationalIntake: intakeFromRaw,
      };
    }
    const nested =
      (raw.data && typeof raw.data === "object" && extractReplyFromCoordinatorObject(raw.data)) ||
      (raw.result && typeof raw.result === "object" && extractReplyFromCoordinatorObject(raw.result)) ||
      "";
    if (nested) {
      return {
        reply: nested,
        leadData: leadFromRaw,
        conversationSummary: summaryFromRaw,
        conversationalIntake: intakeFromRaw,
      };
    }
    return {
      reply: "",
      leadData: leadFromRaw,
      conversationSummary: summaryFromRaw,
      conversationalIntake: intakeFromRaw,
    };
  }

  const trimmed = String(content || "").trim();
  let embedded = "";
  try {
    const maybe = JSON.parse(trimmed);
    embedded = extractReplyFromCoordinatorObject(maybe);
  } catch {
    embedded = "";
  }
  if (embedded) {
    return {
      reply: embedded,
      leadData: leadFromRaw,
      conversationSummary: summaryFromRaw,
      conversationalIntake: intakeFromRaw,
    };
  }

  const coerced = coercePatientFacingReply(trimmed, { allowFallback: false });
  if (coerced) {
    return {
      reply: coerced,
      leadData: leadFromRaw,
      conversationSummary: summaryFromRaw,
      conversationalIntake: intakeFromRaw,
    };
  }

  return {
    reply: "",
    leadData: leadFromRaw,
    conversationSummary: summaryFromRaw,
    conversationalIntake: intakeFromRaw,
  };
}

/**
 * @param {{
 *   message: string,
 *   clinicContext?: string|null,
 *   travelContext?: string|null,
 *   journeyContext?: string|null,
 *   documentIntakeContext?: string|null,
 *   pricingSalesContext?: string|null,
 *   doctorProfilesContext?: string|null,
 *   clinicDirectoryContext?: string|null,
 *   history?: Array<{ role?: string, text?: string, content?: string }>,
 *   conversationSummary?: string|null,
 *   contextMode?: 'coordinator'|'treatment_guide',
 *   conversationLanguagePolicy?: string|null,
 *   whatsappCollectionContext?: string|null,
 *   nameCollectionContext?: string|null,
 *   conversionStrategyContext?: string|null,
 *   patientContextStrategyPrompt?: string|null,
 *   internationalCoordinatorContext?: string|null,
 *   repetitionSuppressionPrompt?: string|null,
 *   referralAwarenessContext?: string|null,
 *   preparationIntakeContext?: string|null,
 *   patientQuestionAnchoringPrompt?: string|null,
 *   conversationLanguage?: string|null,
 *   messagingBrevityPrompt?: string|null,
 *   maxTokens?: number|null,
 * }} params
 */
async function coordinatorChatReply({
  message,
  clinicContext = null,
  travelContext = null,
  journeyContext = null,
  documentIntakeContext = null,
  pricingSalesContext = null,
  doctorProfilesContext = null,
  clinicDirectoryContext = null,
  history = [],
  conversationSummary = null,
  contextMode = "coordinator",
  conversationLanguage = null,
  conversationPrimaryLanguage = null,
  conversationLanguagePolicy = null,
  whatsappCollectionContext = null,
  nameCollectionContext = null,
  conversionStrategyContext = null,
  patientContextStrategyPrompt = null,
  internationalCoordinatorContext = null,
  repetitionSuppressionPrompt = null,
  referralAwarenessContext = null,
  preparationIntakeContext = null,
  patientQuestionAnchoringPrompt = null,
  messagingBrevityPrompt = null,
  maxTokens = null,
}) {
  const mode = contextMode === "treatment_guide" ? "treatment_guide" : "coordinator";
  const userText = String(message || "").trim();
  const ctx = clinicContext ? String(clinicContext).trim() : "";
  const travel = travelContext ? String(travelContext).trim() : "";
  const journey = journeyContext ? String(journeyContext).trim() : "";
  const documents = documentIntakeContext ? String(documentIntakeContext).trim() : "";
  const pricingSales = pricingSalesContext ? String(pricingSalesContext).trim() : "";
  const doctorProfiles = doctorProfilesContext ? String(doctorProfilesContext).trim() : "";
  let latestBlock = "";
  if (ctx) latestBlock += `Clinic context: ${ctx}\n\n`;
  if (pricingSales && mode === "coordinator") latestBlock += `${pricingSales}\n\n`;
  if (doctorProfiles && mode === "coordinator") latestBlock += `${doctorProfiles}\n\n`;
  if (journey) latestBlock += `${journey}\n\n`;
  if (mode === "coordinator" && travel) latestBlock += `${travel}\n\n`;
  if (documents) latestBlock += `${documents}\n\n`;
  const directory = clinicDirectoryContext ? String(clinicDirectoryContext).trim() : "";
  if (directory) latestBlock += `${directory}\n\n`;
  const anchoring = patientQuestionAnchoringPrompt
    ? String(patientQuestionAnchoringPrompt).trim()
    : "";
  if (anchoring) latestBlock += `${anchoring}\n\n`;
  latestBlock += `User's latest message:\n${userText}`;
  const aggregatedHint = buildAggregatedPatientMessageHint(userText);
  if (aggregatedHint) latestBlock += `\n\n${aggregatedHint}`;
  if (!ctx && !(mode === "coordinator" && travel) && !journey && !documents && !pricingSales && !doctorProfiles && !directory) {
    latestBlock = `User's latest message:\n${userText}`;
    if (aggregatedHint) latestBlock += `\n\n${aggregatedHint}`;
  }

  const allTurns = normalizeChatHistory(history);
  const recentTurns = trimHistoryToRecent(allTurns, MAX_RECENT_TURNS);

  let systemPrompt = buildCoordinatorSystemPrompt(mode);
  const langPolicy = conversationLanguagePolicy ? String(conversationLanguagePolicy).trim() : "";
  if (langPolicy) {
    systemPrompt = `${systemPrompt}\n\n${langPolicy}`;
  }
  const nameCtx = nameCollectionContext ? String(nameCollectionContext).trim() : "";
  if (nameCtx && mode === "coordinator") {
    systemPrompt = nameCtx.includes("NAME RECEIVED") || nameCtx.includes("ALINDI") || nameCtx.includes("ПОЛУЧЕНО") || nameCtx.includes("მიღებულია")
      ? `${nameCtx}\n\n${systemPrompt}`
      : `${systemPrompt}\n\n${nameCtx}`;
  }
  const waCtx = whatsappCollectionContext ? String(whatsappCollectionContext).trim() : "";
  if (waCtx && mode === "coordinator") {
    /** Phone-number turn block must win over generic language-policy wording. */
    systemPrompt = waCtx.includes("PHONE / WHATSAPP NUMBER RECEIVED")
      ? `${waCtx}\n\n${systemPrompt}`
      : `${systemPrompt}\n\n${waCtx}`;
  }
  const patientCtx = patientContextStrategyPrompt
    ? String(patientContextStrategyPrompt).trim()
    : "";
  if (patientCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${patientCtx}`;
  }
  const intlCtx = internationalCoordinatorContext
    ? String(internationalCoordinatorContext).trim()
    : "";
  if (intlCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${intlCtx}`;
  }
  const conversionCtx = conversionStrategyContext
    ? String(conversionStrategyContext).trim()
    : "";
  if (conversionCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${conversionCtx}`;
  }
  const repetitionCtx = repetitionSuppressionPrompt
    ? String(repetitionSuppressionPrompt).trim()
    : "";
  if (repetitionCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${repetitionCtx}`;
  }
  if (anchoring && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${anchoring}`;
  }
  const referralCtx = referralAwarenessContext
    ? String(referralAwarenessContext).trim()
    : "";
  if (referralCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${referralCtx}`;
  }
  const brevityCtx = messagingBrevityPrompt ? String(messagingBrevityPrompt).trim() : "";
  if (brevityCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${brevityCtx}`;
  }
  const prepCtx = preparationIntakeContext ? String(preparationIntakeContext).trim() : "";
  if (prepCtx && mode === "treatment_guide") {
    systemPrompt = `${systemPrompt}\n\n${prepCtx}`;
  }

  /** @type {Array<{ role: string, content: string }>} */
  const messages = [{ role: "system", content: systemPrompt }];

  const preamble = buildMemoryPreamble({
    conversationSummary,
    recentTurns,
  });
  if (preamble) {
    messages.push({ role: "user", content: preamble });
    messages.push({
      role: "assistant",
      content: "Understood. I will use the rolling summary and recent messages only.",
    });
  }

  for (const turn of recentTurns) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({ role: "user", content: latestBlock });

  const finishCoordinatorTurn = (content, modelName) => {
    const parsed = parseCoordinatorPayload(content);
    let safeReply = applyReplyGuardrails(parsed.reply, { userMessage: userText });
    safeReply = coercePatientFacingReply(safeReply, {
      lang: conversationLanguage || parsed.leadData?.language || null,
      patientMessage: userText,
      logLabel: "coordinatorChatReply",
    });
    if (isInvalidPatientFacingReply(safeReply)) {
      console.warn("[coordinatorChatReply] empty_or_invalid_reply", {
        preview: String(content || "").slice(0, 200),
        hadSummary: Boolean(parsed.conversationSummary),
        leadLanguage: parsed.leadData?.language || null,
      });
      safeReply = sanitizePatientFacingReply(safeReply, {
        lang: conversationLanguage || parsed.leadData?.language || null,
        patientMessage: userText,
        logLabel: "coordinatorChatReply",
      });
    }
    safeReply = enforcePatientReplyLanguage(safeReply, {
      expectedLang: conversationLanguage || parsed.leadData?.language || null,
      lockedConversationLanguage:
        conversationPrimaryLanguage || conversationLanguage || parsed.leadData?.language || null,
      patientMessage: userText,
      logLabel: "coordinatorChatReply",
    });
    if (mode === "treatment_guide") {
      safeReply = applyTreatmentGuideDisclaimer(safeReply);
    }
    return { parsed, safeReply, model: modelName };
  };

  let { content, model } = await chatCompletion({
    messages,
    jsonMode: true,
    maxTokens: maxTokens != null ? maxTokens : DEFAULT_MAX_TOKENS,
  });
  let turn = finishCoordinatorTurn(content, model);

  if (isInvalidPatientFacingReply(turn.parsed.reply)) {
    const retryMessages = [
      ...messages,
      {
        role: "user",
        content:
          "Your previous JSON was missing or had an empty \"reply\" field. Return valid JSON only with a non-empty \"reply\" string that answers the user's latest message in the SAME language they used (do not switch to English unless they wrote in English).",
      },
    ];
    try {
      const retry = await chatCompletion({
        messages: retryMessages,
        jsonMode: true,
        maxTokens: maxTokens != null ? maxTokens : DEFAULT_MAX_TOKENS,
      });
      turn = finishCoordinatorTurn(retry.content, retry.model || model);
      content = retry.content;
      model = retry.model || model;
    } catch (retryErr) {
      console.warn("[coordinatorChatReply] empty_reply_retry_failed:", retryErr?.message || retryErr);
    }
  }

  const { parsed, safeReply } = turn;

  const nextSummary =
    parsed.conversationSummary ||
    normalizeConversationSummary(conversationSummary);

  return {
    reply: safeReply,
    leadData: parsed.leadData,
    conversationSummary: nextSummary,
    conversationalIntake: parsed.conversationalIntake,
    model,
    memoryMeta: {
      recentTurnsSent: recentTurns.length,
      maxRecentTurns: MAX_RECENT_TURNS,
      hadPriorSummary: !!normalizeConversationSummary(conversationSummary),
    },
  };
}

module.exports = {
  COORDINATOR_SYSTEM_PROMPT,
  TREATMENT_GUIDE_SYSTEM_PROMPT,
  buildCoordinatorSystemPrompt,
  DEFAULT_MODEL,
  MAX_RECENT_TURNS,
  OpenAIError,
  isOpenAIConfigured,
  chatCompletion,
  parseCoordinatorPayload,
  coordinatorChatReply,
  isInvalidPatientFacingReply,
  sanitizePatientFacingReply,
  coercePatientFacingReply,
};
