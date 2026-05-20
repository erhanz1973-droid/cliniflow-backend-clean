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
  let text = String(item.text || "").trim();
  if (!text && item.kind === "message" && item.attachmentHint) {
    text = item.attachmentHint;
  }
  if (!text && item.kind !== "system") return;
  const key = dedupeKey(item.at, item.role, text || item.label || "");
  if (seen.has(key)) return;
  seen.add(key);
  items.push({ ...item, text });
}

/**
 * @param {string} messageRole
 * @returns {SupervisionRole}
 */
function roleFromChannelMessage(messageRole) {
  const r = String(messageRole || "").toLowerCase();
  if (r === "patient" || r === "user") return "patient";
  if (r === "assistant") return "ai";
  if (r === "coordinator") return "human";
  return "system";
}

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

/**
 * @param {Record<string, unknown>} row
 */
function mapOfferMessageRowToFeedItem(row) {
  const roleRaw = String(row.sender_role || "").toLowerCase();
  let role = "human";
  if (roleRaw === "patient") role = "patient";
  else if (roleRaw === "assistant" || roleRaw === "ai") role = "ai";
  else if (roleRaw === "doctor" || roleRaw === "dr") role = "doctor";
  else if (roleRaw === "clinic" || roleRaw === "system") role = "human";

  const text = String(row.text ?? row.message_text ?? row.body ?? "").trim();
  const hasAttachment = Boolean(String(row.attachment_url || "").trim());

  return {
    id: `om-${row.id}`,
    kind: "message",
    role,
    text: text || (hasAttachment ? "📎 Ek" : ""),
    at: row.created_at,
    channel: "offer_chat",
    source: "offer_messages",
    label: row.sender_name ? String(row.sender_name) : null,
    attachmentHint: hasAttachment && !text ? "📎 Ek" : undefined,
  };
}

/**
 * Load all rows for one offer (no cross-offer limit truncation).
 * @param {string} offerId
 */
async function fetchOfferMessagesForSingleOffer(offerId) {
  const oid = String(offerId || "").trim();
  if (!UUID_RE.test(oid)) return [];

  const selectAttempts = [
    "id, offer_id, sender_role, sender_name, text, message_text, attachment_url, created_at",
    "id, offer_id, sender_role, text, created_at",
    "*",
  ];

  for (const selectClause of selectAttempts) {
    const { data, error } = await supabase
      .from("offer_messages")
      .select(selectClause)
      .eq("offer_id", oid)
      .order("created_at", { ascending: true })
      .limit(500);
    if (!error) return (data || []).map(mapOfferMessageRowToFeedItem);
    if (!isMissingColumnError(error)) {
      console.warn("[doctorUnifiedTimeline] offer_messages:", error.message);
      return [];
    }
  }
  return [];
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
 * Role from patient_messages row (schema may use from_role or sender_type).
 * @param {Record<string, unknown>} row
 */
function roleFromPatientMessageRow(row) {
  const sender = String(row.sender_type || row.from_role || row.from || "").toLowerCase();
  if (sender === "patient" || sender === "from_patient" || row.from_patient === true) return "patient";
  if (sender === "assistant" || sender === "ai") return "ai";
  if (sender === "doctor" || sender === "dr") return "doctor";
  if (sender === "clinic" || sender === "coordinator" || sender === "admin" || sender === "clinic_staff") {
    return "human";
  }
  return "human";
}

function messageTextFromPatientMessageRow(row) {
  const text = String(row.message_text ?? row.message ?? row.text ?? "").trim();
  if (text) return text;
  if (row.attachment_url || row.file_url) return "📎 Ek";
  return "";
}

/**
 * Offer-thread messages (treatment request / lead chat) — primary source for patient replies.
 * @param {string} patientId
 * @param {string} clinicId
 */
async function fetchOfferThreadMessages(
  patientId,
  clinicId,
  coordinationOfferId,
  treatmentRequestId,
) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return [];

  const directOfferId = String(coordinationOfferId || "").trim();
  if (UUID_RE.test(directOfferId)) {
    const direct = await fetchOfferMessagesForSingleOffer(directOfferId);
    if (direct.length) return direct;
  }

  const requestId = String(treatmentRequestId || "").trim();
  if (UUID_RE.test(requestId)) {
    try {
      const { ensureCoordinationOfferForRequest } = require("./patientCoordinationChat");
      const ensured = await ensureCoordinationOfferForRequest(requestId);
      if (ensured.ok && ensured.offerId) {
        const fromReq = await fetchOfferMessagesForSingleOffer(String(ensured.offerId));
        if (fromReq.length) return fromReq;
      }
    } catch (e) {
      console.warn("[doctorUnifiedTimeline] coordination offer:", e?.message || e);
    }
  }

  const { data: trRows, error: trErr } = await supabase
    .from("treatment_requests")
    .select("id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(80);
  if (trErr) {
    console.warn("[doctorUnifiedTimeline] treatment_requests:", trErr.message);
    return [];
  }
  const requestIds = (trRows || [])
    .map((r) => String(r.id || "").trim())
    .filter((id) => UUID_RE.test(id));
  if (!requestIds.length) return [];

  const offerIds = [];
  for (let i = 0; i < requestIds.length; i += 40) {
    const chunk = requestIds.slice(i, i + 40);
    const { data: offers, error: oErr } = await supabase
      .from("treatment_offers")
      .select("id")
      .in("request_id", chunk);
    if (oErr) {
      console.warn("[doctorUnifiedTimeline] treatment_offers:", oErr.message);
      continue;
    }
    for (const o of offers || []) {
      const oid = String(o.id || "").trim();
      if (UUID_RE.test(oid)) offerIds.push(oid);
    }
  }
  const uniqueOfferIds = [...new Set(offerIds)];
  if (!uniqueOfferIds.length) return [];

  /** @type {Array<Record<string, unknown>>} */
  const items = [];
  for (const offerId of uniqueOfferIds) {
    const batch = await fetchOfferMessagesForSingleOffer(offerId);
    for (const item of batch) items.push(item);
  }
  return items;
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 */
async function fetchPatientClinicMessages(patientId, clinicId) {
  if (!UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) return [];

  const selectAttempts = [
    "id, message, message_text, sender_type, from_role, sender_name, created_at, type, attachment_url, file_url",
    "id, message_text, from_role, created_at, attachment_url",
    "id, message_text, from_role, created_at",
  ];

  let data = null;
  for (const selectClause of selectAttempts) {
    const result = await supabase
      .from("patient_messages")
      .select(selectClause)
      .eq("patient_id", patientId)
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!result.error) {
      data = result.data;
      break;
    }
    if (!isMissingColumnError(result.error)) {
      console.warn("[doctorUnifiedTimeline] patient_messages:", result.error.message);
      return [];
    }
  }

  if (!data) {
    const loose = await supabase
      .from("patient_messages")
      .select("id, message_text, from_role, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (loose.error) {
      console.warn("[doctorUnifiedTimeline] patient_messages (loose):", loose.error.message);
      return [];
    }
    data = (loose.data || []).filter(
      (row) => !row.clinic_id || String(row.clinic_id) === clinicId,
    );
  }

  return (data || []).map((row) => {
    const role = roleFromPatientMessageRow(row);
    const text = messageTextFromPatientMessageRow(row);
    return {
      id: `pm-${row.id}`,
      kind: "message",
      role,
      text,
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
 *   coordinationOfferId?: string|null,
 * }} params
 */
/**
 * @param {Array<Record<string, unknown>>} merged
 * @param {Set<string>} seen
 * @param {Record<string, unknown>} params
 */
function injectProfileMessageFallback(merged, seen, params) {
  const lastP = String(params.lastPatientMessage || "").trim();
  const lastAi = String(params.lastAiReply || "").trim();
  const hasPatient = merged.some((m) => m.role === "patient");
  const hasAi = merged.some((m) => m.role === "ai" || m.role === "human");

  if (lastP && !hasPatient) {
    pushItem(merged, seen, {
      id: "profile-last-patient",
      kind: "message",
      role: "patient",
      text: lastP,
      at: params.lastPatientMessageAt || params.profileUpdatedAt || new Date().toISOString(),
      channel: "in_app",
      source: "profile_snapshot",
    });
  }
  if (lastAi && !hasAi) {
    pushItem(merged, seen, {
      id: "profile-last-ai",
      kind: "message",
      role: "ai",
      text: lastAi,
      at: params.lastAiReplyAt || params.profileUpdatedAt || new Date().toISOString(),
      channel: "in_app",
      source: "profile_snapshot",
    });
  }
}

async function buildUnifiedSupervisionFeed(params) {
  const {
    profileId,
    clinicId,
    patientId,
    timeline,
    coordinationOfferId,
    treatmentRequestId,
  } = params;
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const merged = [];

  const [offerThreadMsgs, channelItems, clinicalItems, patientMsgs] = await Promise.all([
    fetchOfferThreadMessages(patientId, clinicId, coordinationOfferId, treatmentRequestId),
    fetchChannelItems(profileId),
    fetchClinicalArtifacts(profileId),
    fetchPatientClinicMessages(patientId, clinicId),
  ]);

  const eventItems = itemsFromLeadEvents(timeline, params.uiLang || "en");
  const chatEventItems = eventItems.filter(
    (item) =>
      item.kind === "message" ||
      item.kind === "doctor_intent" ||
      item.kind === "ai_draft" ||
      (item.role === "patient" || item.role === "ai" || item.role === "human" || item.role === "doctor"),
  );
  const systemEventItems = eventItems.filter((item) => item.kind === "system" || item.role === "system");

  for (const batch of [offerThreadMsgs, patientMsgs, channelItems, chatEventItems, clinicalItems]) {
    for (const item of batch) {
      pushItem(merged, seen, item);
    }
  }

  injectProfileMessageFallback(merged, seen, params);

  for (const item of systemEventItems) {
    pushItem(merged, seen, item);
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
  fetchOfferThreadMessages,
  itemsFromLeadEvents,
};
