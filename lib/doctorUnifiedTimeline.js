/**
 * Unified supervision feed — patient, AI, human, doctor, drafts, and system events
 * in one chronological stream for doctor workspace.
 */

const { supabase } = require("./supabase");
const { timelineLabel } = require("./timelineLabels");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @typedef {'patient'|'ai'|'human'|'doctor'|'doctor_intent'|'ai_draft'|'system'} SupervisionRole */
/** @typedef {'message'|'system'|'doctor_intent'|'ai_draft'} SupervisionKind */

/**
 * @param {string} at
 * @param {SupervisionRole} role
 * @param {string} text
 */
function dedupeKey(at, role, text) {
  const t = String(text || "").trim().slice(0, 120);
  return `${at || ""}|${role}|${t}`;
}

/**
 * @param {Record<string, unknown>} item
 * @param {Set<string>} seen
 */
function pushItem(items, seen, item) {
  const text = String(item.text || "").trim();
  if (!text && item.kind !== "system") return;
  const key = dedupeKey(item.at, item.role, text || item.label || "");
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

/**
 * @param {string} messageRole
 * @returns {SupervisionRole}
 */
function roleFromChannelMessage(messageRole) {
  const r = String(messageRole || "").toLowerCase();
  if (r === "patient") return "patient";
  if (r === "assistant") return "ai";
  if (r === "coordinator") return "human";
  return "system";
}

/**
 * @param {{ eventType?: string, eventMetadata?: Record<string, unknown> }} ev
 * @returns {SupervisionRole}
 */
function roleFromTimelineEvent(ev) {
  const meta = ev.eventMetadata && typeof ev.eventMetadata === "object" ? ev.eventMetadata : {};
  const subtype = String(meta.subtype || "").toLowerCase();
  if (subtype === "guidance_created") return "doctor_intent";
  if (subtype === "ai_expanded" || subtype === "rewrite_applied") return "ai_draft";
  if (subtype === "approved_by_doctor") return "system";
  if (ev.eventType === "human_reply") return "doctor";
  if (ev.eventType === "human_takeover" || ev.eventType === "doctor_joined") return "human";
  if (ev.eventType === "ai_reply" || ev.eventType === "continuity_fallback") return "ai";
  return "system";
}

/**
 * @param {string} profileId
 * @param {number} [limit]
 */
async function fetchChannelItems(profileId, limit = 150) {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabase
    .from("ai_coordinator_channel_messages")
    .select("id, message_role, body, channel, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[doctorUnifiedTimeline] channel:", error.message);
    return [];
  }
  return (data || []).map((row) => ({
    id: `ch-${row.id}`,
    kind: "message",
    role: roleFromChannelMessage(row.message_role),
    text: String(row.body || "").trim(),
    at: row.created_at,
    channel: row.channel || "in_app",
    source: "channel_messages",
  }));
}

/**
 * @param {Array<{ id: string, eventType?: string, patientMessage?: string, aiReply?: string, createdAt?: string, channel?: string, eventMetadata?: Record<string, unknown>, label?: string }>} timeline
 */
function itemsFromLeadEvents(timeline, lang = "en") {
  /** @type {Array<Record<string, unknown>>} */
  const items = [];
  for (const ev of timeline || []) {
    const meta =
      ev.eventMetadata && typeof ev.eventMetadata === "object" ? ev.eventMetadata : {};
    const subtype = String(meta.subtype || "").toLowerCase();

    if (ev.patientMessage) {
      items.push({
        id: `ev-${ev.id}-p`,
        kind: "message",
        role: "patient",
        text: String(ev.patientMessage).trim(),
        at: ev.createdAt,
        channel: ev.channel || "in_app",
        source: "lead_events",
        eventType: ev.eventType,
      });
    }

    if (ev.aiReply) {
      const role = roleFromTimelineEvent(ev);
      if (role === "doctor_intent" || role === "ai_draft") {
        items.push({
          id: `ev-${ev.id}-${role}`,
          kind: role === "doctor_intent" ? "doctor_intent" : "ai_draft",
          role,
          text: String(ev.aiReply).trim(),
          at: ev.createdAt,
          channel: ev.channel || "in_app",
          source: "lead_events",
          eventType: ev.eventType,
          label: subtypeLabel(subtype, meta),
          metadata: meta,
        });
      } else {
        items.push({
          id: `ev-${ev.id}-r`,
          kind: "message",
          role,
          text: String(ev.aiReply).trim(),
          at: ev.createdAt,
          channel: ev.channel || "in_app",
          source: "lead_events",
          eventType: ev.eventType,
          label: ev.label,
        });
      }
      continue;
    }

    const label = ev.label || timelineLabel(ev.eventType || "system", meta, lang);
    items.push({
      id: `ev-${ev.id}-sys`,
      kind: "system",
      role: "system",
      text: label,
      at: ev.createdAt,
      channel: ev.channel || "in_app",
      source: "lead_events",
      eventType: ev.eventType,
      label,
      metadata: meta,
    });
  }
  return items;
}

/**
 * @param {string} subtype
 * @param {Record<string, unknown>} meta
 */
function subtypeLabel(subtype, meta) {
  switch (subtype) {
    case "guidance_created":
      return "Doctor clinical guidance recorded";
    case "ai_expanded":
      return "AI expanded draft for review";
    case "rewrite_applied":
      return meta.rewrite_action
        ? `Rewrite applied: ${meta.rewrite_action}`
        : "Rewrite applied";
    case "approved_by_doctor":
      return "Doctor approved message";
    default:
      return subtype ? subtype.replace(/_/g, " ") : null;
  }
}

/**
 * @param {string} profileId
 */
async function fetchClinicalArtifacts(profileId) {
  if (!UUID_RE.test(profileId)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const items = [];

  const { data: guidanceRows, error: gErr } = await supabase
    .from("clinical_guidance")
    .select("id, intent_text, intent_tags, created_at, author_role")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(40);
  if (gErr) {
    console.warn("[doctorUnifiedTimeline] clinical_guidance:", gErr.message);
  } else {
    for (const g of guidanceRows || []) {
      const text = String(g.intent_text || "").trim();
      if (!text) continue;
      items.push({
        id: `cg-${g.id}`,
        kind: "doctor_intent",
        role: "doctor_intent",
        text,
        at: g.created_at,
        source: "clinical_guidance",
        label: "Doctor intent (internal — not sent to patient)",
        metadata: { intentTags: g.intent_tags, authorRole: g.author_role },
      });
    }
  }

  const { data: draftRows, error: dErr } = await supabase
    .from("clinical_communication_drafts")
    .select("id, draft_text, status, created_at, updated_at, sent_at, message_provenance, rewrite_actions")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .limit(60);
  if (dErr) {
    console.warn("[doctorUnifiedTimeline] clinical_communication_drafts:", dErr.message);
  } else {
    for (const d of draftRows || []) {
      const text = String(d.draft_text || "").trim();
      if (!text) continue;
      const status = String(d.status || "pending");
      items.push({
        id: `cd-${d.id}`,
        kind: "ai_draft",
        role: status === "sent" ? "ai" : "ai_draft",
        text,
        at: d.sent_at || d.created_at || d.updated_at,
        source: "clinical_communication_drafts",
        label:
          status === "sent"
            ? "Approved & sent to patient"
            : "AI draft (pending doctor approval)",
        metadata: {
          status,
          provenance: d.message_provenance,
          rewriteActions: d.rewrite_actions,
        },
      });
    }
  }

  return items;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function fetchPatientClinicMessages(patientId, clinicId) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return [];
  const { data, error } = await supabase
    .from("patient_messages")
    .select("id, message, sender_type, sender_name, created_at, type")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true })
    .limit(120);
  if (error) {
    console.warn("[doctorUnifiedTimeline] patient_messages:", error.message);
    return [];
  }
  return (data || []).map((row) => {
    const sender = String(row.sender_type || "").toLowerCase();
    let role = "human";
    if (sender === "patient") role = "patient";
    else if (sender === "assistant" || sender === "ai") role = "ai";
    else if (sender === "doctor") role = "doctor";
    else if (sender === "clinic" || sender === "coordinator") role = "human";
    return {
      id: `pm-${row.id}`,
      kind: "message",
      role,
      text: String(row.message || "").trim(),
      at: row.created_at,
      channel: "patient_chat",
      source: "patient_messages",
      label: row.sender_name ? String(row.sender_name) : null,
    };
  });
}

/**
 * Build one chronological supervision feed.
 * @param {{
 *   profileId: string,
 *   clinicId: string,
 *   patientId: string,
 *   timeline: Array<Record<string, unknown>>,
 * }} params
 */
async function buildUnifiedSupervisionFeed(params) {
  const { profileId, clinicId, patientId, timeline } = params;
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const merged = [];

  const [channelItems, clinicalItems, patientMsgs] = await Promise.all([
    fetchChannelItems(profileId),
    fetchClinicalArtifacts(profileId),
    fetchPatientClinicMessages(patientId, clinicId),
  ]);

  const eventItems = itemsFromLeadEvents(timeline, params.uiLang || "en");

  for (const batch of [patientMsgs, channelItems, eventItems, clinicalItems]) {
    for (const item of batch) {
      pushItem(merged, seen, item);
    }
  }

  merged.sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  return merged;
}

module.exports = {
  buildUnifiedSupervisionFeed,
  fetchChannelItems,
  itemsFromLeadEvents,
};
