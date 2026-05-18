/**
 * Human-readable labels for ai_coordinator_lead_events.
 */

/**
 * @param {string} eventType
 * @param {Record<string, unknown>} [meta]
 */
function timelineLabel(eventType, meta = {}) {
  const m = meta && typeof meta === "object" ? meta : {};
  const actor = m.actorLabel || m.doctorName || m.coordinatorName || null;

  switch (eventType) {
    case "ai_reply":
      return "AI Coordinator replied";
    case "patient_turn":
      return "Patient message";
    case "human_takeover":
      return actor ? `${actor} took over the conversation` : "Human takeover activated";
    case "human_reply":
      return actor ? `${actor} replied` : "Coordinator replied";
    case "doctor_joined":
      return actor ? `${actor} joined the conversation` : "Doctor joined the conversation";
    case "ai_paused":
      return actor ? `${actor} paused AI` : "AI Coordinator paused";
    case "ai_resumed":
      return actor ? `${actor} resumed AI` : "AI Coordinator resumed";
    case "coordination_change":
      return m.responderModeLabel
        ? `Responder mode: ${m.responderModeLabel}`
        : "Coordination mode changed";
    case "escalation_detected":
      return "Escalation signal detected";
    case "follow_up_scheduled":
      return "Follow-up scheduled";
    case "appointment_intent":
      return "Appointment intent detected";
    case "appointment_booked":
      return m.summary || m.title || "Consultation booked";
    case "appointment_rescheduled":
      return m.summary || "Appointment rescheduled";
    case "appointment_cancelled":
      return m.summary || "Appointment cancelled";
    case "consultation_completed":
      return m.summary || "Consultation completed";
    case "task_created":
      return m.title ? `Task: ${m.title}` : "Operational task suggested";
    case "visit_plan_drafted":
      return "AI visit plan draft created";
    case "xray_uploaded":
      return "Panoramic X-ray uploaded";
    case "ct_scan_uploaded":
      return "CT scan uploaded";
    case "document_uploaded":
      return m.documentType ? `Document uploaded: ${m.documentType}` : "Document uploaded";
    case "doctor_review_requested":
      return "Doctor review requested";
    case "missing_documents_detected":
      return "Missing intake documents detected";
    case "intake_journey_updated":
      return m.label ? `Intake stage: ${m.label}` : "Intake journey stage updated";
    case "continuity_fallback":
      return "SLA reassurance message sent";
    case "conversion_signal":
      return m.primaryGoal
        ? `Conversion strategy: ${String(m.primaryGoal).replace(/_/g, " ")}`
        : "Conversion strategy updated";
    case "hesitation_detected":
      return "Hesitation or anxiety signal";
    case "trust_increase":
      return "Trust-building momentum";
    case "price_objection":
      return "Pricing concern detected";
    case "cold_lead_risk":
      return "Lead cooling — follow-up risk";
    default:
      return String(eventType || "event").replace(/_/g, " ");
  }
}

module.exports = { timelineLabel };
