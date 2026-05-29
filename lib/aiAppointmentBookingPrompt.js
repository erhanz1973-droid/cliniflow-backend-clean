/**
 * AI appointment booking — coordinator prompt blocks (guardrails + slot presentation).
 */

const BOOKING_CONTACT_PROMPT = {
  tr: "Randevuyu tamamlamadan önce mutlaka şunu sorun (tek soru, nazik): «Size ulaşabileceğimiz telefon veya WhatsApp numaranızı paylaşabilir misiniz?» Telefon/WhatsApp alınmadan kesin randevu veya onay vermeyin.",
  en: "Before confirming any appointment, you MUST ask once (politely): «Could you share a phone or WhatsApp number where we can reach you?» Do NOT confirm or finalize booking without a contact number.",
  ru: "Перед подтверждением записи обязательно спросите номер телефона или WhatsApp. Без контакта не подтверждайте запись.",
  ka: "ჩაწერამდე აუცილებლად მოითხოვეთ ტელეფონი ან WhatsApp. კონტაქტის გარეშე ჩაწერა არ დაადასტუროთ.",
};

const BOOKING_NAME_PROMPT = {
  tr: "Randevu kaydı için hastanın adını mutlaka alın (tek soru, nazik): «Randevu kaydı için adınızı yazar mısınız?» Ad ve soyadı tek satırda yazsa bile patients.name alanına kaydedilecek — ad soyadı ayrı ayrı istemeyin. İsim alınmadan kesin randevu onayı vermeyin.",
  en: "For the appointment record you MUST ask once (politely): «May I have your name for the booking?» If they give first and last name in one line, accept it as the full name — do NOT insist on splitting. Do NOT confirm the appointment until you have their name.",
  ru: "Перед подтверждением записи обязательно спросите имя пациента. Фамилию и имя в одной строке принимайте как полное имя.",
  ka: "ჩაწერამდე აუცილებლად მოითხოვეთ პაციენტის სახელი.",
};

/**
 * @param {string} [lang]
 */
function buildContactRequiredPrompt(lang = "en") {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  return BOOKING_CONTACT_PROMPT[key] || BOOKING_CONTACT_PROMPT.en;
}

/**
 * @param {string} [lang]
 */
function buildNameRequiredPrompt(lang = "en") {
  const key = String(lang || "en").slice(0, 2).toLowerCase();
  return BOOKING_NAME_PROMPT[key] || BOOKING_NAME_PROMPT.en;
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
    "* Present the options below clearly (numbered). When the patient replies with only a digit (e.g. «1»), treat it as option 1 from the list — NOT as 01:00 on the clock.",
    "* After they pick a slot, ask explicitly to confirm date/time before creating the appointment (e.g. «Bu tarih ve saatte randevunuzu onaylıyor musunuz?»). Book only after «Evet» / Yes.",
    "* Understand natural time phrases: «saat 7», «7'de», «8 buçuk», «8'i 20 geçe», «9'a 10 var» — treat as the same intent as 07:00, 08:30, 08:20, 08:50.",
    '* NEVER reply with meta language lines like "Evet, Türkçe olarak yardımcı olabilirim" / "I can help you in Turkish" — the patient is choosing an appointment time.',
    "* Do NOT pivot to implant or other treatments unless the patient asked — stay on scheduling this turn.",
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
  if (params.hasContact && !params.hasName) {
    lines.push(buildNameRequiredPrompt(params.lang));
  }

  lines.push("Available slots:");
  slots.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.label} (id: ${s.id})`);
  });

  return lines.join("\n");
}

/**
 * Patient-visible numbered slot list (do not rely on the LLM to copy slots from the prompt).
 * @param {Array<{ label?: string }>} slots
 * @param {string} [lang]
 * @param {{ intro?: string, needContact?: boolean }} [opts]
 */
function buildSlotOfferDirectReply(slots, lang = "tr", opts = {}) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const list = (Array.isArray(slots) ? slots : []).filter((s) => String(s?.label || "").trim());

  if (!list.length) {
    if (key === "tr") {
      return "Şu an takvimde önerebileceğimiz boş saat görünmüyor. Farklı bir gün veya saat yazarsanız kontrol edelim; isterseniz ekibimiz sizi arayıp uygun saat önerebilir.";
    }
    if (key === "ru") {
      return "Сейчас нет свободных слотов в календаре. Напишите другой день или время — проверим, или команда перезвонит с вариантами.";
    }
    return "We don't see open slots on the calendar right now. Share another day or time and we'll check, or our team can call you with options.";
  }

  const numbered = list.map((s, i) => `${i + 1}. ${String(s.label).trim()}`).join("\n");
  const intro =
    opts.intro ||
    (key === "tr"
      ? "Size uygun müsait saatler:"
      : key === "ru"
        ? "Доступное время для записи:"
        : "Available appointment times:");

  const pickHint =
    key === "tr"
      ? "Listeden seçmek için sadece seçenek numarasını yazın (ör. «1» = birinci satır, saat 01:00 değil). Saat belirtmek isterseniz «17:00» veya «saat 17» yazabilirsiniz. Randevu, onayınızdan sonra oluşturulur."
      : key === "ru"
        ? "Напишите номер варианта (1 = первая строка, не 01:00) или время, например «17:00». Запись создаётся после вашего подтверждения."
        : "Reply with the option number (1 = first line, not 1:00 AM) or a time like «5:00 PM». The appointment is created only after you confirm.";

  const contactHint = opts.needContact
    ? key === "tr"
      ? "\n\nRandevuyu tamamlamak için telefon veya WhatsApp numaranızı da paylaşır mısınız?"
      : key === "ru"
        ? "\n\nТакже пришлите номер телефона или WhatsApp для подтверждения записи."
        : "\n\nPlease also share a phone or WhatsApp number to complete the booking."
    : "";
  const nameHint = opts.needName
    ? key === "tr"
      ? "\n\nRandevu kaydı için adınızı da yazar mısınız?"
      : key === "ru"
        ? "\n\nТакже напишите ваше имя для записи."
        : "\n\nPlease also share your name for the appointment record."
    : "";

  return `${intro}\n\n${numbered}\n\n${pickHint}${contactHint}${nameHint}`;
}

module.exports = {
  buildContactRequiredPrompt,
  buildNameRequiredPrompt,
  buildSlotOfferPromptBlock,
  buildSlotOfferDirectReply,
};
