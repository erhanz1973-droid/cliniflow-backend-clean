/**
 * Operational timeline entries on ai_coordinator_lead_events.
 */

const { isSupabaseEnabled } = require("./supabase");
const { normalizeCoordinatorChannel } = require("./coordinatorChannels");
const {
  insertLeadEventWithChannel,
  withOperationalChannelMetadata,
} = require("./coordinatorChannelPersistence");

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

  const channel = normalizeCoordinatorChannel(params.channel, "in_app");
  const { error } = await insertLeadEventWithChannel({
    profile_id: params.profileId,
    event_type: params.eventType,
    event_metadata: withOperationalChannelMetadata(params.eventMetadata, channel),
    patient_message: params.patientMessage || null,
    ai_reply: params.aiReply || null,
    channel,
    message_role: params.eventType,
  });

  if (error) {
    console.warn("[aiCoordinatorTimeline]", params.eventType, error.message);
  }
}

module.exports = { insertTimelineEvent };
