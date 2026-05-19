/**
 * Human-readable labels for ai_coordinator_lead_events (localized).
 */

const { t, normalizeUiLang } = require("./i18n/coordinationLocales");

/**
 * @param {string} eventType
 * @param {Record<string, unknown>} [meta]
 * @param {string} [lang]
 */
function timelineLabel(eventType, meta = {}, lang = "en") {
  const L = normalizeUiLang(lang);
  const m = meta && typeof meta === "object" ? meta : {};
  const actor = m.actorLabel || m.doctorName || m.coordinatorName || null;

  switch (eventType) {
    case "ai_reply":
      return t(L, "timeline.ai_reply");
    case "patient_turn":
      return t(L, "timeline.patient_turn");
    case "human_takeover":
      return actor
        ? t(L, "timeline.human_takeover", { actor })
        : t(L, "timeline.human_takeoverGeneric");
    case "human_reply":
      return actor ? t(L, "timeline.human_reply", { actor }) : t(L, "timeline.human_replyGeneric");
    case "doctor_joined":
      return actor
        ? t(L, "timeline.doctor_joined", { actor })
        : t(L, "timeline.doctor_joinedGeneric");
    case "ai_paused":
      return actor ? t(L, "timeline.ai_paused", { actor }) : t(L, "timeline.ai_pausedGeneric");
    case "ai_resumed":
      return actor ? t(L, "timeline.ai_resumed", { actor }) : t(L, "timeline.ai_resumedGeneric");
    case "coordination_change":
      return m.responderModeLabel
        ? t(L, "timeline.modeLabel", { mode: m.responderModeLabel })
        : t(L, "timeline.coordination_change");
    case "escalation_detected":
      return t(L, "timeline.escalation_detected");
    case "follow_up_scheduled":
      return t(L, "timeline.follow_up_scheduled");
    case "appointment_intent":
      return t(L, "timeline.appointment_intent");
    case "appointment_booked":
      return m.summary || m.title || t(L, "timeline.appointment_booked");
    case "appointment_rescheduled":
      return m.summary || t(L, "timeline.appointment_rescheduled");
    case "appointment_cancelled":
      return m.summary || t(L, "timeline.appointment_cancelled");
    case "consultation_completed":
      return m.summary || t(L, "timeline.consultation_completed");
    case "task_created":
      return m.title ? `${t(L, "timeline.task_created")}: ${m.title}` : t(L, "timeline.task_created");
    case "visit_plan_drafted":
      return t(L, "timeline.visit_plan_drafted");
    case "xray_uploaded":
      return t(L, "timeline.xray_uploaded");
    case "ct_scan_uploaded":
      return t(L, "timeline.ct_scan_uploaded");
    case "document_uploaded":
      return m.documentType
        ? `${t(L, "timeline.document_uploaded")}: ${m.documentType}`
        : t(L, "timeline.document_uploaded");
    case "doctor_review_requested":
      return t(L, "timeline.doctor_review_requested");
    case "missing_documents_detected":
      return t(L, "timeline.missing_documents_detected");
    case "intake_journey_updated":
      return m.label
        ? `${t(L, "timeline.intake_journey_updated")}: ${m.label}`
        : t(L, "timeline.intake_journey_updated");
    case "continuity_fallback":
      return t(L, "timeline.continuity_fallback");
    case "conversion_signal":
      return m.primaryGoal
        ? `${t(L, "timeline.conversion_signal")}: ${String(m.primaryGoal).replace(/_/g, " ")}`
        : t(L, "timeline.conversion_signal");
    case "hesitation_detected":
      return t(L, "timeline.hesitation_detected");
    case "trust_increase":
      return t(L, "timeline.trust_increase");
    case "price_objection":
      return t(L, "timeline.price_objection");
    case "cold_lead_risk":
      return t(L, "timeline.cold_lead_risk");
    case "system":
      if (m.subtype === "guidance_created") return t(L, "timeline.guidance_created");
      if (m.subtype === "ai_expanded") return t(L, "timeline.ai_expanded");
      if (m.subtype === "rewrite_applied") {
        return m.rewrite_action
          ? t(L, "timeline.rewrite_applied", { action: m.rewrite_action })
          : t(L, "timeline.rewrite_applied", { action: "" });
      }
      if (m.subtype === "approved_by_doctor") return t(L, "timeline.approved_by_doctor");
      return m.summary || t(L, "timeline.system");
    default:
      return String(eventType || "event").replace(/_/g, " ");
  }
}

module.exports = { timelineLabel };
