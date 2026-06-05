/**
 * Clinic AI coordinator messages must never present as the assigned doctor to patients.
 */

const CARE_TEAM_NAMES = new Set([
  "care team",
  "bakım ekibi",
  "bakim ekibi",
  "careteam",
  "ai",
  "klinik",
  "clinic",
]);

/**
 * @param {{ actorKind?: string|null, messageSource?: string|null, senderRole?: string|null, senderName?: string|null }} row
 */
function isClinicAiMessage(row = {}) {
  const actorKind = String(row.actorKind || row.actor_kind || "").toLowerCase();
  const messageSource = String(row.messageSource || row.message_source || "").toLowerCase();
  const senderRole = String(row.senderRole || row.sender_role || "").toLowerCase();
  const senderName = String(row.senderName || row.sender_name || "")
    .trim()
    .toLowerCase();

  if (actorKind === "clinic_ai" || messageSource === "clinic_ai") return true;
  if (actorKind.includes("ai_auto") || messageSource.includes("ai_auto")) return true;
  if (actorKind.includes("ai_offer") || messageSource.includes("ai_offer")) return true;
  if (senderRole === "assistant" || senderRole === "ai") return true;
  if (CARE_TEAM_NAMES.has(senderName)) return true;
  return false;
}

function careTeamSenderName() {
  return "Care Team";
}

module.exports = {
  isClinicAiMessage,
  careTeamSenderName,
  CARE_TEAM_NAMES,
};
