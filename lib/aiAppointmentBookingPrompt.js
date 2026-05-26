/**
 * AI appointment booking — coordinator prompt blocks (guardrails + slot presentation).
 */

const BOOKING_CONTACT_PROMPT = {
  tr: "Randevuyu tamamlamadan önce mutlaka şunu sorun (tek soru, nazik): «Size ulaşabileceğimiz telefon veya WhatsApp numaranızı paylaşabilir misiniz?» Telefon/WhatsApp alınmadan kesin randevu veya onay vermeyin.",
  en: "Before confirming any appointment, you MUST ask once (politely): «Could you share a phone or WhatsApp number where we can reach you?» Do NOT confirm or finalize booking without a contact number.",
  ru: "Перед подтверждением записи обязательно спросите номер телефона или WhatsApp. Без контакта не подтверждайте запись.",
  ka: "ჩაწერამდე აუცილებლად მოითხოვეთ ტელეფონი ან WhatsApp. კონტაქტის გარეშე ჩაწერა არ დაადასტუროთ.",
};

/**
 * @param {string} [lang]
 */
function buildContactRequiredPrompt(lang = "en") {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  return BOOKING_CONTACT_PROMPT[key] || BOOKING_CONTACT_PROMPT.en;
}

/**
 * @param {{
 *   mode: string,
 *   slots: Array<{ id: string, label: string, startAt: string }>,
 *   treatmentLabel?: string,
 *   lang?: string,
 *   hasContact: boolean,
 * }} params
 */
function buildSlotOfferPromptBlock(params) {
  const mode = String(params.mode || "draft_booking");
  const slots = Array.isArray(params.slots) ? params.slots : [];
  if (!slots.length) return "";

  const lines = [
    "APPOINTMENT SCHEDULING (operational — use ONLY these verified calendar slots):",
    `* Treatment context: ${params.treatmentLabel || "Consultation"}.`,
    "* First collect treatment need and any missing clinical intake, then offer slots when appropriate.",
    "* Present the options below clearly (numbered). Ask the patient to pick one option by number or time.",
    "* Do NOT invent dates/times outside this list.",
    "* Respect clinic working hours, lunch break, buffers, and timezone — slots below are already filtered.",
    "* Double-booking is prevented server-side — only offer listed slots.",
  ];

  if (mode === "suggest_only") {
    lines.push("* Mode: SUGGEST ONLY — do NOT say the appointment is confirmed. Say the team will confirm shortly after they choose.");
  } else if (mode === "draft_booking") {
    lines.push(
      "* Mode: DRAFT BOOKING — when the patient picks a slot, say it is reserved pending clinic confirmation (not fully confirmed until staff approves).",
    );
  } else {
    lines.push("* Mode: AUTO BOOKING — when the patient picks a slot, confirm the appointment is booked for that time.");
  }

  if (!params.hasContact) {
    lines.push(buildContactRequiredPrompt(params.lang));
  }

  lines.push("Available slots:");
  slots.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.label} (id: ${s.id})`);
  });

  return lines.join("\n");
}

module.exports = {
  buildContactRequiredPrompt,
  buildSlotOfferPromptBlock,
};
