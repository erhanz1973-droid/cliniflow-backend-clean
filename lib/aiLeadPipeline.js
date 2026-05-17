/**
 * Persist AI coordinator lead intelligence to Supabase CRM tables.
 * Best-effort — never throws to caller.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("./supabase");
const { leadDataHasSignals, emptyLeadData } = require("./leadIntelligence");
const { normalizeConversationSummary } = require("./conversationMemory");
const { detectEscalationSignals, escalationFlagsToJson } = require("./aiCoordinatorEscalation");
const { inferTaskPlaceholders, upsertTaskPlaceholders } = require("./aiCoordinatorTasks");
const { COORDINATION_AI, COORDINATION_HUMAN } = require("./aiCoordinatorCoordination");
const { buildEscalationPatch } = require("./aiDelegation");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('./leadIntelligence').LeadData} lead
 */
function computeLeadScore(lead) {
  let score = 0;
  if (lead.treatmentInterest) score += 20;
  if (lead.country) score += 10;
  if (lead.language) score += 5;
  if (lead.travelTimeline) score += 15;
  if (lead.urgency === "medium") score += 15;
  if (lead.urgency === "high") score += 25;
  if (lead.bookingIntent === "medium") score += 20;
  if (lead.bookingIntent === "high") score += 30;
  if (lead.budgetSignal && lead.budgetSignal !== "not_discussed") score += 10;
  if (lead.patientReportedTags?.length) score += Math.min(15, lead.patientReportedTags.length * 5);
  return Math.min(100, score);
}

/**
 * @param {import('./leadIntelligence').LeadData} lead
 */
function computeIsHot(lead) {
  const bookingHot = lead.bookingIntent === "high";
  const urgencyHot = lead.urgency === "high";
  const hasTreatment = !!lead.treatmentInterest;
  return (bookingHot && hasTreatment) || (urgencyHot && bookingHot);
}

/**
 * @param {import('./leadIntelligence').LeadData} lead
 */
function leadDataToDbColumns(lead) {
  const l = lead && typeof lead === "object" ? lead : emptyLeadData();
  return {
    treatment_interest: l.treatmentInterest || null,
    country: l.country || null,
    preferred_language: l.language || null,
    travel_timeline: l.travelTimeline || null,
    urgency: l.urgency || null,
    booking_intent: l.bookingIntent || null,
    budget_signal: l.budgetSignal || null,
    lead_score: computeLeadScore(l),
    is_hot: computeIsHot(l),
  };
}

/**
 * @param {string|undefined|null} id
 */
function asUuid(id) {
  const s = String(id || "").trim();
  return UUID_RE.test(s) ? s : null;
}

/**
 * @param {import('./leadIntelligence').LeadData} leadData
 * @param {ReturnType<typeof detectEscalationSignals>} escalation
 * @param {string} coordinationMode
 */
function computeAiUnresolved(leadData, escalation, coordinationMode) {
  if (coordinationMode === COORDINATION_HUMAN) return false;
  if (escalation?.any) return true;
  if (leadData?.bookingIntent === "high" && leadData?.urgency === "high") return true;
  if (leadData?.bookingIntent === "high" && leadData?.urgency === "medium") return true;
  return false;
}

/**
 * @param {{
 *   sessionId?: string|null,
 *   patientId?: string|null,
 *   clinicId?: string|null,
 *   leadData: import('./leadIntelligence').LeadData,
 *   turnLeadData?: import('./leadIntelligence').LeadData|null,
 *   conversationSummary?: string|null,
 *   patientMessage?: string|null,
 *   aiReply?: string|null,
 *   channel?: string|null,
 * }} params
 * @returns {Promise<{ saved: boolean, profileId?: string, sessionId?: string, isHot?: boolean, leadScore?: number, reason?: string }>}
 */
async function persistAiCoordinatorLead(params) {
  if (!isSupabaseEnabled()) {
    return { saved: false, reason: "supabase_disabled" };
  }

  const leadData = params.leadData && typeof params.leadData === "object" ? params.leadData : emptyLeadData();
  const sessionId =
    String(params.sessionId || "").trim() || `aic_${crypto.randomUUID()}`;
  const patientId = asUuid(params.patientId);
  const clinicId = asUuid(params.clinicId);
  const summary = normalizeConversationSummary(params.conversationSummary);
  const patientMessage = String(params.patientMessage || "").trim().slice(0, 4000) || null;

  if (!leadDataHasSignals(leadData) && !patientMessage) {
    return { saved: false, reason: "no_signals", sessionId };
  }

  try {
    const { data: existing, error: loadErr } = await supabase
      .from("ai_coordinator_lead_profiles")
      .select(
        "id, message_count, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags",
      )
      .eq("session_id", sessionId)
      .maybeSingle();

    if (loadErr) {
      console.warn("[aiLeadPipeline] load profile:", loadErr.message);
    }

    const cols = leadDataToDbColumns(leadData);
    const nowIso = new Date().toISOString();
    const escalation = detectEscalationSignals(patientMessage);
    const coordinationMode = String(existing?.coordination_mode || COORDINATION_AI);
    const prevFlags =
      existing?.escalation_flags && typeof existing.escalation_flags === "object"
        ? existing.escalation_flags
        : {};
    const mergedFlags = escalation.any
      ? { ...prevFlags, ...escalationFlagsToJson(escalation) }
      : prevFlags;

    const row = {
      session_id: sessionId,
      patient_id: patientId || existing?.patient_id || null,
      clinic_id: clinicId || existing?.clinic_id || null,
      ...cols,
      conversation_summary: summary || null,
      last_patient_message: patientMessage,
      last_patient_message_at: nowIso,
      last_channel_message_at: nowIso,
      message_count: (Number(existing?.message_count) || 0) + 1,
      updated_at: nowIso,
      source: "ai_coordinator_chat",
      primary_channel: String(params.channel || "in_app").trim() || "in_app",
      escalation_flags: mergedFlags,
      ai_unresolved: computeAiUnresolved(leadData, escalation, coordinationMode),
    };

    const escalationPatch = buildEscalationPatch(mergedFlags, patientMessage);
    if (escalationPatch) {
      Object.assign(row, escalationPatch);
    }
    const aiReply = String(params.aiReply || "").trim().slice(0, 8000) || null;
    if (aiReply) {
      row.last_ai_reply_at = nowIso;
    }

    let profileId = existing?.id || null;

    if (profileId) {
      const { error: updErr } = await supabase
        .from("ai_coordinator_lead_profiles")
        .update(row)
        .eq("id", profileId);
      if (updErr) {
        console.warn("[aiLeadPipeline] update profile:", updErr.message);
        return { saved: false, reason: "update_failed", sessionId };
      }
    } else {
      row.created_at = nowIso;
      const { data: inserted, error: insErr } = await supabase
        .from("ai_coordinator_lead_profiles")
        .insert(row)
        .select("id")
        .single();
      if (insErr) {
        console.warn("[aiLeadPipeline] insert profile:", insErr.message);
        return { saved: false, reason: "insert_failed", sessionId };
      }
      profileId = inserted?.id || null;
    }

    if (profileId && patientId && clinicId) {
      await supabase
        .from("ai_coordinator_lead_profiles")
        .update({ patient_id: patientId, clinic_id: clinicId, updated_at: nowIso })
        .eq("id", profileId)
        .is("patient_id", null);
    }

    if (profileId) {
      const turn = params.turnLeadData || leadData;
      const channel = String(params.channel || "in_app").trim() || "in_app";
      const eventType = aiReply ? "ai_reply" : "patient_turn";
      const eventMeta = {};
      if (escalation.any) {
        eventMeta.escalation = escalationFlagsToJson(escalation);
      }
      if (leadData?.bookingIntent === "high") {
        eventMeta.appointmentIntent = true;
      }

      const { error: evErr } = await supabase.from("ai_coordinator_lead_events").insert({
        profile_id: profileId,
        turn_lead_data: turn,
        merged_lead_data: leadData,
        patient_message: patientMessage,
        ai_reply: aiReply,
        channel,
        message_role: "turn",
        event_type: eventType,
        event_metadata: eventMeta,
      });
      if (evErr) {
        console.warn("[aiLeadPipeline] insert event:", evErr.message);
      }

      const wasEscalated =
        prevFlags.angry || prevFlags.emergency || prevFlags.complaintRefund || prevFlags.repeatedQuestions;
      if (escalation.any && !wasEscalated) {
        await supabase.from("ai_coordinator_lead_events").insert({
          profile_id: profileId,
          event_type: "escalation_detected",
          event_metadata: escalationFlagsToJson(escalation),
          channel,
          message_role: "system",
        });
      }

      const placeholders = inferTaskPlaceholders(leadData, patientMessage);
      if (placeholders.length) {
        await upsertTaskPlaceholders({
          profileId,
          clinicId: clinicId || existing?.clinic_id || null,
          tasks: placeholders,
        });
      }

      if (patientMessage || aiReply) {
        const rows = [];
        if (patientMessage) {
          rows.push({
            profile_id: profileId,
            channel,
            direction: "inbound",
            message_role: "patient",
            body: patientMessage,
          });
        }
        if (aiReply) {
          rows.push({
            profile_id: profileId,
            channel,
            direction: "outbound",
            message_role: "assistant",
            body: aiReply,
          });
        }
        const { error: chErr } = await supabase.from("ai_coordinator_channel_messages").insert(rows);
        if (chErr) {
          console.warn("[aiLeadPipeline] channel messages:", chErr.message);
        }
      }
    }

    console.log("[aiLeadPipeline] saved", {
      profileId,
      sessionId: sessionId.slice(0, 12),
      isHot: cols.is_hot,
      leadScore: cols.lead_score,
      treatment: cols.treatment_interest,
    });

    return {
      saved: !!profileId,
      profileId: profileId || undefined,
      sessionId,
      isHot: cols.is_hot,
      leadScore: cols.lead_score,
    };
  } catch (e) {
    console.warn("[aiLeadPipeline] unexpected:", e?.message || e);
    return { saved: false, reason: "exception", sessionId };
  }
}

module.exports = {
  computeLeadScore,
  computeIsHot,
  leadDataToDbColumns,
  persistAiCoordinatorLead,
  asUuid,
};
