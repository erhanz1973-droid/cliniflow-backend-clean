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
  const scheduling = params.scheduling || {};
  const lang = String(params.lang || "en").slice(0, 2).toLowerCase();

  if (!slots.length) {
    const open = scheduling.weekdayStart || "09:00";
    const close = scheduling.weekdayEnd || "18:00";
    if (lang === "tr") {
      return [
        "APPOINTMENT SCHEDULING:",
        `* Takvimde şu an önerebileceğimiz boş slot yok (klinik saatleri ${open}–${close}, mevcut randevular dolu olabilir).`,
        "* Hastanın istediği güne en yakın alternatifleri koordinatör onayıyla planlayın; 06:00–07:00 gibi klinik açılış öncesi saatleri önermeyin.",
        "* Nazikçe başka gün/saat isteyin veya ekibin arayıp dönmesini teklif edin.",
      ].join("\n");
    }
    return [
      "APPOINTMENT SCHEDULING:",
      `* No verified open slots right now (clinic hours ${open}–${close}; calendar may be full).`,
      "* Do NOT insist on early-morning times before opening. Offer to have the team call back with alternatives.",
    ].join("\n");
  }

  const lines = [
    "APPOINTMENT SCHEDULING (operational — synced with admin calendar; use ONLY slots below):",
    `* Treatment context: ${params.treatmentLabel || "Consultation"}.`,
    `* Clinic weekday hours: ${scheduling.weekdayStart || "09:00"}–${scheduling.weekdayEnd || "18:00"} (${scheduling.timezone || "local"}). Never offer times before opening.`,
    "* Present the options below clearly (numbered). Ask the patient to pick one option by number or time.",
    "* Understand natural time phrases: «saat 7», «7'de», «8 buçuk», «8'i 20 geçe», «9'a 10 var» — treat as the same intent as 07:00, 08:30, 08:20, 08:50.",
    "* If the patient asks for a time NOT on this list, say that exact time is not available and offer the nearest options from the list — be flexible, do not repeat times they rejected.",
    "* Do NOT insist on 06:00 or 07:00 if the clinic opens later.",
    "* Do NOT invent dates/times outside this list.",
    "* Double-booking is prevented using the same appointment data as the clinic schedule page.",
  ];

  if (params.preferredDateYmd) {
    lines.push(`* Patient mentioned date preference: ${params.preferredDateYmd} — prioritize matching slots below.`);
  }
  if (params.wantsAlternate) {
    lines.push(
      "* Patient wants a different time — acknowledge their preference, explain the requested slot is unavailable, and guide them to pick from the refreshed list.",
    );
  }

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
