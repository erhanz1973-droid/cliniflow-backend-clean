/**
 * AI Visit Planner — heuristic trigger + OpenAI draft generation.
 */

const { isOpenAIConfigured, chatCompletion, OpenAIError } = require("./openai");
const { VISIT_PLAN_GENERATION_SYSTEM } = require("./aiVisitPlannerPrompt");
const { saveVisitPlanDraft } = require("./aiVisitPlanDrafts");
const { protocolMatchesContext } = require("./clinicTreatmentProtocols");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} message
 * @param {import('./leadIntelligence').LeadData|null|undefined} leadData
 */
function shouldTriggerVisitPlan(message, leadData) {
  const t = String(message || "").toLowerCase();
  const ld = leadData && typeof leadData === "object" ? leadData : {};

  if (ld.travelTimeline) return true;
  if (ld.bookingIntent === "high" || ld.bookingIntent === "medium") return true;

  const timingRe =
    /\b(how many visit|how long|how many day|stay for|stay in|timeline|schedule|when (can|should)|trip|travel plan|visit plan|days (do|should)|weeks? (do|should)|month)\b/i;
  const monthRe =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|next (week|month|year))\b/i;
  const treatmentRe =
    /\b(implant|veneer|crown|aligner|whitening|full mouth|all-on|dental tourism)\b/i;

  if (timingRe.test(t) && (treatmentRe.test(t) || ld.treatmentInterest)) return true;
  if (monthRe.test(t) && (treatmentRe.test(t) || ld.treatmentInterest)) return true;
  if (ld.treatmentInterest && timingRe.test(t)) return true;

  return false;
}

/**
 * @param {import('./clinicJourneyTypes').ClinicTreatmentProtocolDto[]} protocols
 * @param {import('./leadIntelligence').LeadData|null|undefined} leadData
 */
function pickPrimaryProtocol(protocols, leadData) {
  const list = protocols || [];
  if (!list.length) return null;
  const ti = leadData?.treatmentInterest;
  if (ti) {
    const match = list.find((p) => protocolMatchesContext(p, String(ti), ti));
    if (match) return match;
  }
  return list[0];
}

/**
 * @param {unknown} raw
 * @returns {Array<{ day: number, label: string, detail?: string, phase?: string }>}
 */
function normalizeTimeline(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const day = Number(item.day) || i + 1;
      const label = String(item.label || item.title || "").trim();
      if (!label) return null;
      return {
        day,
        label: label.slice(0, 200),
        detail: item.detail ? String(item.detail).trim().slice(0, 400) : undefined,
        phase: item.phase ? String(item.phase).trim().slice(0, 80) : undefined,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * @param {object} params
 */
async function generateVisitPlanDraft(params) {
  if (!isOpenAIConfigured()) {
    return { generated: false, reason: "ai_not_configured" };
  }

  if (!shouldTriggerVisitPlan(params.message, params.leadData)) {
    return { generated: false, reason: "not_applicable" };
  }

  const protocol = pickPrimaryProtocol(params.protocols, params.leadData);
  const contextLines = [];
  if (params.journeyContext) contextLines.push(params.journeyContext);
  if (params.travelContext) contextLines.push(params.travelContext);
  if (params.conversationSummary) {
    contextLines.push(`Conversation summary:\n${params.conversationSummary}`);
  }
  if (params.leadData) {
    contextLines.push(`Lead signals: ${JSON.stringify(params.leadData)}`);
  }
  if (protocol) {
    contextLines.push(
      `Primary clinic protocol (${protocol.treatmentType}): visits=${protocol.typicalVisitCount}, stay=${protocol.estimatedStayDuration}, second visit=${protocol.secondVisitAfter}`,
    );
  }
  contextLines.push(`Patient message:\n${params.message}`);

  try {
    const { content } = await chatCompletion({
      messages: [
        { role: "system", content: VISIT_PLAN_GENERATION_SYSTEM },
        { role: "user", content: contextLines.join("\n\n") },
      ],
      jsonMode: true,
      maxTokens: 700,
      timeoutMs: 25000,
    });

    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { generated: false, reason: "parse_failed" };
    }

    if (!parsed?.shouldGenerate) {
      return { generated: false, reason: "model_declined" };
    }

    const timeline = normalizeTimeline(parsed.draftTimeline);
    if (!timeline.length && !parsed.estimatedStayDuration) {
      return { generated: false, reason: "empty_timeline" };
    }

    const treatmentType =
      String(parsed.treatmentType || protocol?.treatmentType || params.leadData?.treatmentInterest || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_") || null;

    const draftPayload = {
      clinicId: params.clinicId,
      patientId: params.patientId || null,
      leadProfileId: params.leadProfileId || null,
      sessionId: params.sessionId || null,
      treatmentType,
      proposedVisitCount:
        parsed.proposedVisitCount != null
          ? Number(parsed.proposedVisitCount)
          : protocol?.typicalVisitCount ?? null,
      estimatedStayDuration:
        String(parsed.estimatedStayDuration || protocol?.estimatedStayDuration || "").trim() || null,
      draftTimeline: timeline,
      aiSummary: String(parsed.aiSummary || "").trim() || null,
    };

    if (!params.leadProfileId || !UUID_RE.test(params.clinicId)) {
      return {
        generated: true,
        saved: false,
        draft: draftPayload,
        reason: "no_profile_to_persist",
      };
    }

    const saved = await saveVisitPlanDraft(draftPayload);
    return {
      generated: true,
      saved: saved.ok,
      draft: saved.draft || draftPayload,
    };
  } catch (e) {
    if (e instanceof OpenAIError) throw e;
    console.warn("[aiVisitPlanner] generate:", e?.message || e);
    return { generated: false, reason: "exception" };
  }
}

module.exports = {
  shouldTriggerVisitPlan,
  generateVisitPlanDraft,
  pickPrimaryProtocol,
  normalizeTimeline,
};
