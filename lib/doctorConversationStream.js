/**
 * Doctor workspace — unified patient ↔ AI ↔ human conversation stream.
 */

const { supabase } = require("./supabase");
const { resolvePatientContextStrategy } = require("./patientContextStrategy");
const {
  normalizeDiscussionMemory,
  readDiscussionMemoryFromFlags,
} = require("./conversationRepetitionMemory");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} messageRole
 * @returns {'patient'|'ai'|'human'|'system'}
 */
function roleFromChannelMessage(messageRole) {
  const r = String(messageRole || "").toLowerCase();
  if (r === "patient") return "patient";
  if (r === "assistant") return "ai";
  if (r === "coordinator") return "human";
  return "system";
}

/**
 * @param {{ eventType?: string }} ev
 * @returns {'patient'|'ai'|'human'|'system'}
 */
function roleFromTimelineReply(ev) {
  if (ev.eventType === "human_reply") return "human";
  if (ev.eventType === "continuity_fallback") return "ai";
  return "ai";
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
function mapChannelRows(rows) {
  return (rows || []).map((row) => ({
    id: String(row.id),
    role: roleFromChannelMessage(row.message_role),
    text: String(row.body || "").trim(),
    at: row.created_at,
    channel: row.channel || "in_app",
    source: "channel",
  }));
}

/**
 * @param {Array<{ id: string, eventType?: string, patientMessage?: string, aiReply?: string, createdAt?: string, channel?: string }>} timeline
 */
function conversationFromTimeline(timeline) {
  /** @type {Array<{ id: string, role: string, text: string, at: string, channel: string, source: string }>} */
  const items = [];
  for (const ev of timeline || []) {
    if (ev.patientMessage) {
      items.push({
        id: `${ev.id}-patient`,
        role: "patient",
        text: String(ev.patientMessage).trim(),
        at: ev.createdAt,
        channel: ev.channel || "in_app",
        source: "timeline",
      });
    }
    if (ev.aiReply) {
      items.push({
        id: `${ev.id}-reply`,
        role: roleFromTimelineReply(ev),
        text: String(ev.aiReply).trim(),
        at: ev.createdAt,
        channel: ev.channel || "in_app",
        source: "timeline",
      });
    }
  }
  return items.filter((m) => m.text);
}

/**
 * @param {string} profileId
 * @param {number} [limit]
 */
async function fetchChannelMessagesForProfile(profileId, limit = 120) {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabase
    .from("ai_coordinator_channel_messages")
    .select("id, message_role, body, channel, direction, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[doctorConversationStream] channel_messages:", error.message);
    return [];
  }
  return mapChannelRows(data || []);
}

/**
 * Prefer channel_messages when present; otherwise expand lead_events turns.
 * @param {string} profileId
 * @param {Array<Record<string, unknown>>} timeline
 */
async function buildDoctorConversationStream(profileId, timeline) {
  const channelItems = await fetchChannelMessagesForProfile(profileId);
  if (channelItems.length >= 1) {
    return channelItems;
  }
  return conversationFromTimeline(timeline);
}

/**
 * Timeline rows that are operational (not chat turns).
 * @param {Array<Record<string, unknown>>} timeline
 */
function operationalTimelineOnly(timeline) {
  return (timeline || []).filter((ev) => !(ev.patientMessage || ev.aiReply));
}

/**
 * @param {Record<string, unknown>} lead
 * @param {Record<string, unknown>} [profileRow]
 */
function buildDoctorWorkspaceContext(lead, profileRow) {
  const flags =
    lead.operationalIntakeFlags && typeof lead.operationalIntakeFlags === "object"
      ? lead.operationalIntakeFlags
      : {};
  const delegation = lead.delegation && typeof lead.delegation === "object" ? lead.delegation : {};

  const strategy = resolvePatientContextStrategy({
    conversationSummary: lead.conversationSummary,
    leadData: {
      treatmentInterest: lead.treatmentInterest,
      country: lead.country,
      travelTimeline: profileRow?.travel_timeline,
    },
    profileRow: profileRow || { operational_intake_flags: flags, country: lead.country },
  });

  const score = lead.leadScore != null ? Number(lead.leadScore) : null;
  let heatLabel = "Soğuk";
  if (lead.isHot) heatLabel = "Sıcak";
  else if (score != null && score >= 60) heatLabel = "Ilık";
  else if (score != null && score >= 35) heatLabel = "Nötr";

  const discussionMemory = normalizeDiscussionMemory(
    readDiscussionMemoryFromFlags(flags),
  );

  const owner = delegation.conversationOwner === "doctor" ? "doctor" : "ai";

  return {
    aiState: {
      conversationOwner: owner,
      conversationOwnerLabel:
        owner === "doctor"
          ? "Doctor is handling conversation"
          : "AI is handling conversation",
      responderMode: lead.responderMode || lead.coordinationMode || null,
      responderModeLabel: lead.responderModeLabel || delegation.statusLabel || null,
      primaryResponderLabel: lead.primaryResponderLabel || null,
      handlingStateLabel: delegation.statusLabel || lead.handlingStateLabel || null,
      aiPaused: lead.aiPaused === true,
      autoReplyAllowed: delegation.autoReplyAllowed === true,
      draftGenerationAllowed: delegation.draftGenerationAllowed === true,
      canSendPatientMessageAsDoctor: delegation.canSendPatientMessageAsDoctor === true,
      aiEscalationRequired: lead.aiEscalationRequired === true || delegation.aiEscalationRequired === true,
      coordinationMode: lead.coordinationMode || null,
    },
    leadHeat: {
      score,
      isHot: lead.isHot === true,
      label: heatLabel,
      messageCount: lead.messageCount != null ? Number(lead.messageCount) : null,
    },
    currentStrategy: {
      patientContextClass: strategy.patient_context_class,
      travelContextDetected: strategy.travel_context_detected,
      avoidTravelCoordinationTopics: strategy.avoid_travel_coordination_topics,
      journeyStage: flags.journeyStage || lead.journeyStage || null,
      journeyStageLabel: flags.journeyStageLabel || lead.journeyStageLabel || null,
      readinessPercent: flags.readinessPercent ?? lead.readinessPercent ?? null,
      waitingParty: lead.waitingParty || null,
      waitingPartyLabel: lead.waitingPartyLabel || null,
      blockingReason: lead.blockingReason || flags.blockingReason || null,
      nextAction: lead.nextAction || flags.nextStep || null,
      recentTopics: discussionMemory.recentTopics,
      pricingAlreadyDiscussed: discussionMemory.pricingAlreadyDiscussed,
      lastCtaType: discussionMemory.lastCtaType,
    },
  };
}

module.exports = {
  buildDoctorConversationStream,
  operationalTimelineOnly,
  buildDoctorWorkspaceContext,
  conversationFromTimeline,
};
