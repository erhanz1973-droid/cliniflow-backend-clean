/**
 * Operational timeline entries on ai_coordinator_lead_events.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { normalizeCoordinatorChannel } = require("./coordinatorChannels");

/**
 * @param {{
 *   profileId: string,
 *   eventType: string,
 *   eventMetadata?: Record<string, unknown>,
 *   patientMessage?: string|null,
 *   aiReply?: string|null,
 *   channel?: string,
 * }} params
 */
async function insertTimelineEvent(params) {
  if (!isSupabaseEnabled() || !params.profileId) return;

  const { error } = await supabase.from("ai_coordinator_lead_events").insert({
    profile_id: params.profileId,
    event_type: params.eventType,
    event_metadata: params.eventMetadata || {},
    patient_message: params.patientMessage || null,
    ai_reply: params.aiReply || null,
    channel: normalizeCoordinatorChannel(params.channel, "in_app"),
    message_role: params.eventType,
  });

  if (error) {
    console.warn("[aiCoordinatorTimeline]", params.eventType, error.message);
  }
}

module.exports = { insertTimelineEvent };
