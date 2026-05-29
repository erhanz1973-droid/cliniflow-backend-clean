/**
 * Safe coordinator channel writes — works before/after channel taxonomy migration.
 * Preserves true operational channel in event_metadata when DB CHECK is still legacy.
 */

const { supabase, isMissingColumnError } = require("./supabase");
const { normalizeCoordinatorChannel, COORDINATOR_CHANNELS } = require("./coordinatorChannels");

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^ai_coordinator_channel_messages\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

const MIGRATION_HINT = "20260518270000_coordinator_channel_taxonomy.sql";

/** Channels allowed on DBs that have not run the taxonomy migration yet. */
const LEGACY_DB_CHANNELS = new Set(["in_app", "whatsapp", "instagram", "messenger"]);

/**
 * @param {unknown} error
 */
function isChannelCheckConstraintError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || "").toLowerCase();
  return (
    code === "23514" ||
    (msg.includes("check constraint") &&
      (msg.includes("channel") || msg.includes("primary_channel")))
  );
}

/**
 * @param {string|null|undefined} raw
 * @param {string} [fallback]
 */
function resolveOperationalChannel(raw, fallback = "in_app") {
  return normalizeCoordinatorChannel(raw, fallback);
}

/**
 * Column value for DB — uses operational channel when migration is applied.
 * @param {string} operationalChannel
 */
function channelColumnForInsert(operationalChannel) {
  const op = resolveOperationalChannel(operationalChannel);
  return op;
}

/**
 * Merge operational channel into json metadata for analytics when column is legacy.
 * @param {Record<string, unknown>|null|undefined} metadata
 * @param {string} operationalChannel
 */
function withOperationalChannelMetadata(metadata, operationalChannel) {
  const op = resolveOperationalChannel(operationalChannel);
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...metadata }
      : {};
  if (op && base.operational_channel !== op) {
    base.operational_channel = op;
  }
  return base;
}

/**
 * @param {string} operationalChannel
 * @param {string} [legacyFallback]
 */
function channelForLegacyDbFallback(operationalChannel, legacyFallback = "in_app") {
  const op = resolveOperationalChannel(operationalChannel, legacyFallback);
  if (LEGACY_DB_CHANNELS.has(op)) return op;
  if (COORDINATOR_CHANNELS.includes(op)) return op;
  return resolveOperationalChannel(legacyFallback, "in_app");
}

/**
 * Insert ai_coordinator_lead_events with channel constraint fallback.
 * @param {Record<string, unknown>} row
 */
async function insertLeadEventWithChannel(row) {
  const operational = resolveOperationalChannel(row.channel, "in_app");
  const eventMeta = withOperationalChannelMetadata(row.event_metadata, operational);
  const payload = {
    ...row,
    channel: channelColumnForInsert(operational),
    event_metadata: eventMeta,
  };

  let result = await supabase.from("ai_coordinator_lead_events").insert(payload);
  if (!result.error) return result;

  if (isChannelCheckConstraintError(result.error) && !LEGACY_DB_CHANNELS.has(operational)) {
    console.warn("[coordinatorChannel] lead_events CHECK failed — apply migration", {
      migration: MIGRATION_HINT,
      operational_channel: operational,
    });
    result = await supabase.from("ai_coordinator_lead_events").insert({
      ...payload,
      channel: channelForLegacyDbFallback(operational, "in_app"),
    });
  }
  return result;
}

/**
 * Insert ai_coordinator_channel_messages with channel constraint fallback.
 * @param {Record<string, unknown>|Array<Record<string, unknown>>} rows
 */
async function insertChannelMessagesWithChannel(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  let prepared = list.map((row) => {
    const operational = resolveOperationalChannel(row.channel, "in_app");
    return {
      ...row,
      channel: channelColumnForInsert(operational),
      metadata: withOperationalChannelMetadata(row.metadata, operational),
    };
  });

  let channelCheckRetried = false;
  let lastError = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const result = await supabase.from("ai_coordinator_channel_messages").insert(prepared);
    if (!result.error) return result;

    lastError = result.error;

    if (isChannelCheckConstraintError(result.error) && !channelCheckRetried) {
      channelCheckRetried = true;
      prepared = prepared.map((row) => {
        const op = resolveOperationalChannel(
          row.metadata?.operational_channel || row.channel,
          "in_app",
        );
        if (LEGACY_DB_CHANNELS.has(op)) return row;
        console.warn("[coordinatorChannel] channel_messages CHECK failed — apply migration", {
          migration: MIGRATION_HINT,
          operational_channel: op,
        });
        return {
          ...row,
          channel: channelForLegacyDbFallback(op, "in_app"),
        };
      });
      continue;
    }

    if (isMissingColumnError(result.error)) {
      const col = getMissingColumnName(result.error);
      if (!col || !prepared.some((row) => Object.prototype.hasOwnProperty.call(row, col))) {
        break;
      }
      prepared = prepared.map((row) => {
        if (!Object.prototype.hasOwnProperty.call(row, col)) return row;
        const next = { ...row };
        delete next[col];
        return next;
      });
      continue;
    }

    break;
  }

  return { data: null, error: lastError };
}

/**
 * Patch primary_channel on lead profile with constraint fallback.
 * @param {string} profileId
 * @param {string} operationalChannel
 * @param {Record<string, unknown>} [extraPatch]
 */
async function patchProfilePrimaryChannel(profileId, operationalChannel, extraPatch = {}) {
  const op = resolveOperationalChannel(operationalChannel, "in_app");
  const patch = {
    ...extraPatch,
    primary_channel: channelColumnForInsert(op),
    channel_metadata: withOperationalChannelMetadata(extraPatch.channel_metadata, op),
  };

  let result = await supabase
    .from("ai_coordinator_lead_profiles")
    .update(patch)
    .eq("id", profileId);

  if (!result.error) return result;

  if (isChannelCheckConstraintError(result.error) && !LEGACY_DB_CHANNELS.has(op)) {
    console.warn("[coordinatorChannel] primary_channel CHECK failed — apply migration", {
      migration: MIGRATION_HINT,
      operational_channel: op,
    });
    result = await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        ...patch,
        primary_channel: channelForLegacyDbFallback(op, "in_app"),
      })
      .eq("id", profileId);
  }
  return result;
}

/**
 * Build profile insert/update row with normalized primary_channel.
 * @param {Record<string, unknown>} row
 */
function normalizeProfileRowChannels(row) {
  const op = resolveOperationalChannel(row.primary_channel, "in_app");
  return {
    ...row,
    primary_channel: channelColumnForInsert(op),
    channel_metadata: withOperationalChannelMetadata(row.channel_metadata, op),
  };
}

module.exports = {
  MIGRATION_HINT,
  LEGACY_DB_CHANNELS,
  isChannelCheckConstraintError,
  resolveOperationalChannel,
  withOperationalChannelMetadata,
  channelForLegacyDbFallback,
  insertLeadEventWithChannel,
  insertChannelMessagesWithChannel,
  patchProfilePrimaryChannel,
  normalizeProfileRowChannels,
};
