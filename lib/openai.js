/**
 * OpenAI Chat Completions helper — treatment coordinator + lead intelligence + rolling memory.
 */

const { normalizeLeadData, normalizeChatHistory } = require("./leadIntelligence");
const {
  MEDICAL_GUARDRAIL_PROMPT,
  COORDINATOR_SALES_AUTHORITY_PROMPT,
  applyReplyGuardrails,
  applyTreatmentGuideDisclaimer,
} = require("./aiGuardrails");
const { TRAVEL_BOOKING_GUARDRAIL_PROMPT } = require("./clinicTravelPrompt");
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

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.AI_COORDINATOR_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || "30000", 10) || 30000,
);
const DEFAULT_MAX_TOKENS = Math.min(
  1400,
  Math.max(256, parseInt(process.env.AI_COORDINATOR_MAX_TOKENS || "800", 10) || 800),
);

const LEAD_INTELLIGENCE_JSON_BLOCK = `
Lead intelligence:
* Infer leadData from the patient's latest message, rolling summary, and recent turns.
* treatmentInterest: short slug (implant, whitening, veneers, root_canal, orthodontics) — null if unclear
* country: patient country if mentioned — null if unknown
* language: ISO 639-1 hint for what the patient wrote in the latest turn only (NOT the reply language) — null if unclear
* travelTimeline: when they hope to start treatment or attend visits (e.g. "June 2026", "within 2 weeks") — null if not mentioned
* urgency: low | medium | high
* bookingIntent: low | medium | high
* budgetSignal: low | medium | high | not_discussed
* patientReportedTags: array of patient-reported concern/goal slugs (NOT diagnoses). Use only when clearly stated:
  implant_interest, veneer_interest, orthodontic_interest, whitening_interest,
  full_mouth_restoration_interest, chewing_problem, cosmetic_goal, pain_signal,
  broken_tooth, missing_teeth_count
* missingTeethCount: number 1-32 if patient states how many teeth missing / implants wanted, else null
* whatsappNumber: E.164 or international digits ONLY if the patient explicitly shares WhatsApp/phone for coordination — null otherwise (never invent)

Output — valid JSON only (no markdown fences):
{
  "reply": "patient-facing message only",
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

const COORDINATOR_SYSTEM_PROMPT = `You are the Clinifly AI Patient Coordinator (AI Treatment Coordinator — not a dentist, not a pushy salesperson).
Your goals:
* help the patient, build trust, maintain conversation flow, reduce anxiety
* guide toward the next sensible step without losing the lead — naturally, never aggressively
* answer direct pricing, brand, and duration questions when clinic data is in context (educate + context + optional next step)
* collect patient information when needed for complex treatment planning
* encourage consultation booking when appropriate — soft conversion only unless Conversion Engine says otherwise
* keep answers concise, warm, and human

${COORDINATOR_SALES_AUTHORITY_PROMPT}

${MEDICAL_GUARDRAIL_PROMPT}

${TRAVEL_BOOKING_GUARDRAIL_PROMPT}

${JOURNEY_GUARDRAIL_PROMPT}

${VISIT_PLAN_GUARDRAIL_PROMPT}

${DOCUMENT_INTAKE_GUARDRAIL_PROMPT}

${MEMORY_POLICY_PROMPT}

${LEAD_INTELLIGENCE_JSON_BLOCK}`;

const TREATMENT_GUIDE_SYSTEM_PROMPT = `You are the AI Treatment Guide for Clinifly — an educational, patient-friendly assistant for dental treatment planning intake.
Your goals:
* help patients understand possible treatment journeys in plain language (operational orientation only)
* explain what clinics commonly request next (photos, X-rays, consultation) without diagnosing
* guide uploads and next steps calmly — never sound like a travel agency or sales funnel
* ask clarifying questions when goals or timeline are unclear
* keep answers concise, warm, and medically responsible

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
* Treat patient statements as patient-reported, not confirmed clinical facts
* When discussing visits or stay length, say estimates depend on clinical evaluation and individual healing
* Reinforce when appropriate: "Final clinical evaluation is performed by licensed dental professionals."

Clinic network (when directory data is provided in context):
* Use the Clinifly partner clinic directory to answer questions about which cities or regions have registered clinics.
* Speak operationally: "We currently have partner clinics in …" / "I don't see a registered clinic in that city yet."
* Never say you lack access to Clinifly's own clinic list when directory data is present.
* Do not rank clinics as "best" or push tourism packages.

${LEAD_INTELLIGENCE_JSON_BLOCK}`;

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
  return String(process.env.OPENAI_API_KEY || "").trim();
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

  if (raw && typeof raw === "object") {
    const reply = String(raw.reply ?? raw.message ?? "").trim();
    const leadData = normalizeLeadData(raw.leadData ?? raw.lead_data ?? raw.lead);
    const conversationSummary = normalizeConversationSummary(
      raw.conversationSummary ?? raw.conversation_summary ?? raw.summary,
    );
    if (reply) {
      return { reply, leadData, conversationSummary };
    }
  }

  return {
    reply: content,
    leadData: normalizeLeadData(null),
    conversationSummary: "",
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
 *   clinicDirectoryContext?: string|null,
 *   history?: Array<{ role?: string, text?: string, content?: string }>,
 *   conversationSummary?: string|null,
 *   contextMode?: 'coordinator'|'treatment_guide',
 *   conversationLanguagePolicy?: string|null,
 *   whatsappCollectionContext?: string|null,
 *   conversionStrategyContext?: string|null,
 * }} params
 */
async function coordinatorChatReply({
  message,
  clinicContext = null,
  travelContext = null,
  journeyContext = null,
  documentIntakeContext = null,
  pricingSalesContext = null,
  clinicDirectoryContext = null,
  history = [],
  conversationSummary = null,
  contextMode = "coordinator",
  conversationLanguagePolicy = null,
  whatsappCollectionContext = null,
  conversionStrategyContext = null,
}) {
  const mode = contextMode === "treatment_guide" ? "treatment_guide" : "coordinator";
  const userText = String(message || "").trim();
  const ctx = clinicContext ? String(clinicContext).trim() : "";
  const travel = travelContext ? String(travelContext).trim() : "";
  const journey = journeyContext ? String(journeyContext).trim() : "";
  const documents = documentIntakeContext ? String(documentIntakeContext).trim() : "";
  const pricingSales = pricingSalesContext ? String(pricingSalesContext).trim() : "";
  let latestBlock = "";
  if (ctx) latestBlock += `Clinic context: ${ctx}\n\n`;
  if (pricingSales && mode === "coordinator") latestBlock += `${pricingSales}\n\n`;
  if (journey) latestBlock += `${journey}\n\n`;
  if (mode === "coordinator" && travel) latestBlock += `${travel}\n\n`;
  if (documents) latestBlock += `${documents}\n\n`;
  const directory = clinicDirectoryContext ? String(clinicDirectoryContext).trim() : "";
  if (directory) latestBlock += `${directory}\n\n`;
  latestBlock += `Patient's latest message:\n${userText}`;
  if (!ctx && !(mode === "coordinator" && travel) && !journey && !documents && !pricingSales && !directory) {
    latestBlock = `Patient's latest message:\n${userText}`;
  }

  const allTurns = normalizeChatHistory(history);
  const recentTurns = trimHistoryToRecent(allTurns, MAX_RECENT_TURNS);

  let systemPrompt = buildCoordinatorSystemPrompt(mode);
  const langPolicy = conversationLanguagePolicy ? String(conversationLanguagePolicy).trim() : "";
  if (langPolicy) {
    systemPrompt = `${systemPrompt}\n\n${langPolicy}`;
  }
  const waCtx = whatsappCollectionContext ? String(whatsappCollectionContext).trim() : "";
  if (waCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${waCtx}`;
  }
  const conversionCtx = conversionStrategyContext
    ? String(conversionStrategyContext).trim()
    : "";
  if (conversionCtx && mode === "coordinator") {
    systemPrompt = `${systemPrompt}\n\n${conversionCtx}`;
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

  const { content, model } = await chatCompletion({ messages, jsonMode: true });

  const parsed = parseCoordinatorPayload(content);
  let safeReply = applyReplyGuardrails(parsed.reply, { userMessage: userText });
  if (mode === "treatment_guide") {
    safeReply = applyTreatmentGuideDisclaimer(safeReply);
  }

  const nextSummary =
    parsed.conversationSummary ||
    normalizeConversationSummary(conversationSummary);

  return {
    reply: safeReply,
    leadData: parsed.leadData,
    conversationSummary: nextSummary,
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
};
