/**
 * Audit log for omnichannel connection lifecycle events.
 */

const { supabase, isSupabaseEnabled } = require("../supabase");

/**
 * @param {{
 *   channel: string,
 *   eventType: string,
 *   connectionId?: string|null,
 *   clinicId?: string|null,
 *   externalId?: string|null,
 *   actor?: string|null,
 *   metadata?: Record<string, unknown>,
 * }} params
 */
async function logOmnichannelConnectionAudit(params) {
  const channel = String(params.channel || "").trim();
  const eventType = String(params.eventType || "").trim();
  const line = {
    channel,
    event: eventType,
    connectionId: params.connectionId || null,
    clinicId: params.clinicId || null,
    externalId: params.externalId || null,
    actor: params.actor || null,
    metadata: params.metadata || {},
  };

  console.log(`[${channel}_connection.${eventType}]`, line);

  if (!isSupabaseEnabled() || !channel || !eventType) return { ok: false };

  const { error } = await supabase.from("omnichannel_connection_audit").insert({
    channel,
    event_type: eventType,
    connection_id: params.connectionId || null,
    clinic_id: params.clinicId || null,
    external_id: params.externalId || null,
    actor: params.actor || null,
    metadata: params.metadata || {},
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.warn("[omnichannelAudit] insert:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * @param {{ connectionId?: string, clinicId?: string, channel?: string, limit?: number }} params
 */
async function listOmnichannelConnectionAudit(params = {}) {
  if (!isSupabaseEnabled()) return [];
  const channel = String(params.channel || "whatsapp").trim();
  const limit = Math.min(Math.max(Number(params.limit) || 40, 1), 100);

  let query = supabase
    .from("omnichannel_connection_audit")
    .select("id, channel, event_type, connection_id, clinic_id, external_id, actor, metadata, created_at")
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.connectionId) {
    query = query.eq("connection_id", String(params.connectionId));
  } else if (params.clinicId) {
    query = query.eq("clinic_id", String(params.clinicId));
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[omnichannelAudit] list:", error.message);
    return [];
  }
  return data || [];
}

module.exports = {
  logOmnichannelConnectionAudit,
  listOmnichannelConnectionAudit,
};
