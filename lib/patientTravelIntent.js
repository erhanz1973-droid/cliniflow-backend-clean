/**
 * International patient travel intents — hotel, flights, airport transfer.
 * Used for direct replies and to block stale clinical intake workflows.
 */

/** @typedef {'accommodation_hotel'|'flight_travel'|'airport_transfer'|'travel_general'} PatientTravelIntentKind */

const HOTEL_PATTERNS = [
  /\b(hotel|hotels|accommodation|where\s+to\s+stay|place\s+to\s+stay|stay\s+near)\b/i,
  /\b(otel|konaklama|kalacak\s+yer|nerede\s+kal)\b/i,
  /\b(yardım|yardımcı|help|assist).{0,48}(otel|hotel|konaklama|accommodation)\b/i,
  /\b(otel|hotel|konaklama|accommodation).{0,48}(yardım|yardımcı|help|assist)\b/i,
  /\b(otel\s+ayarlıyor|otel\s+ayarliyor|do\s+you\s+arrange\s+hotels?)\b/i,
  /\b(refakatçi|refakatci|companion|partner\s+travel|yanımda\s+biri|yanimda\s+biri)\b/i,
  /\b(hangi\s+bölge|which\s+area|where\s+in\s+antalya|antalya\s+da\s+nerede)\b/i,
  /\b(ilk\s+gün|first\s+day|same\s+day|varış|varis|landing\s+day).{0,40}(tedavi|treatment)\b/i,
];

const FLIGHT_PATTERNS = [
  /\b(flight|flights|airline|air\s+ticket|plane\s+ticket)\b/i,
  /\b(uçak|uçak\s*bilet|ucak|bilet(lerimi|imi)?\s*(ben\s+)?alsam|uçuş)\b/i,
  /\b(book|buy|purchase|organize).{0,32}(flight|ticket|uçak)\b/i,
  /\b(kendim\s+alsam|myself|on\s+my\s+own).{0,40}(uçak|flight|bilet|ticket)\b/i,
];

const TRANSFER_PATTERNS = [
  /\b(airport\s+transfer|airport\s+pickup|airport\s+pick[\s-]*up|pickup\s+from\s+airport)\b/i,
  /\b(havalimanı|airport).{0,32}(transfer|pickup|karşılama|ulaşım)\b/i,
  /\b(transfer|karşılama).{0,32}(havalimanı|airport)\b/i,
];

const TRAVEL_CONTEXT_PATTERNS = [
  /\b(i'?m|i am|we are|ben)\s+(coming|traveling|travelling|flying|geleceğim|gelecegim)\b/i,
  /\b(coming|traveling|travelling|flying|geleceğim|gelecegim)\s+(from|to|den|dan|e|a)\b/i,
  /\b(from|den|dan)\s+(tiflis|tbilisi|georgia|gürcistan|gurcistan|germany|uk|france)\b/i,
  /\b(to|e|a)\s+(antalya|istanbul|turkey|türkiye|turkiye)\b/i,
  /\b(tiflis|tbilisi|antalya|dental\s+tourism|medical\s+tourism|international\s+patient)\b/i,
  /\b(seyahat|travel|trip|visit\s+coordination|arrival|departure|konaklama\s+süresi)\b/i,
];

/**
 * @param {string} message
 * @returns {PatientTravelIntentKind|null}
 */
function classifyPatientTravelIntent(message) {
  const t = String(message || "").trim();
  if (!t) return null;

  const hasTravelContext = TRAVEL_CONTEXT_PATTERNS.some((re) => re.test(t));
  const hotel = HOTEL_PATTERNS.some((re) => re.test(t));
  const flight = FLIGHT_PATTERNS.some((re) => re.test(t));
  const transfer = TRANSFER_PATTERNS.some((re) => re.test(t));

  if (!hotel && !flight && !transfer && !hasTravelContext) return null;

  if (hotel) return "accommodation_hotel";
  if (transfer) return "airport_transfer";
  if (flight) return "flight_travel";
  if (hasTravelContext) return "travel_general";
  return null;
}

/**
 * True when the current turn is clearly about travel/logistics (not clinical intake).
 * @param {string} message
 */
function patientMessageIsTravelCoordination(message) {
  return classifyPatientTravelIntent(message) != null;
}

/**
 * @param {PatientTravelIntentKind} kind
 * @param {string} [lang]
 * @param {{ hotels?: import('./clinicTravelTypes').ClinicPartnerHotelDto[], message?: string }} [opts]
 */
function buildTravelCoordinationDirectReply(kind, lang = "tr", opts = {}) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const hotels = Array.isArray(opts.hotels)
    ? opts.hotels.filter((h) => h && h.isActive !== false).slice(0, 3)
    : [];

  const hotelLines =
    hotels.length > 0
      ? hotels
          .map((h, i) => {
            const parts = [`${i + 1}. ${h.name}`];
            if (h.priceRange) parts.push(`~${h.priceRange}`);
            if (h.distanceMinutes != null) parts.push(`${h.distanceMinutes} dk kliniğe`);
            return parts.join(" — ");
          })
          .join("\n")
      : "";

  if (key === "tr") {
    if (kind === "accommodation_hotel" || kind === "travel_general") {
      let text =
        "Antalya'ya uçak biletlerinizi kendiniz rahatlıkla ayarlayabilirsiniz. Biletlerinizi aldıktan sonra seyahat tarihlerinizi bizimle paylaşmanız yeterli.\n\n";
      text +=
        "Otel ve konaklama konusunda klinik ekibimiz size yardımcı olur; tedavi planınıza ve kalış sürenize göre uygun seçenekler hakkında bilgi verebiliriz.\n\n";
      if (hotelLines) {
        text += "Anlaşmalı otel örnekleri (yaklaşık):\n" + hotelLines + "\n\n";
      }
      if (/\b(refakatçi|refakatci|companion|yanımda|yanimda)\b/i.test(String(opts.message || ""))) {
        text +=
          "Refakatçi getirebilirsiniz — konaklama planını buna göre birlikte netleştiririz.\n\n";
      }
      if (/\b(ilk\s+gün|first\s+day).{0,40}(tedavi|treatment)\b/i.test(String(opts.message || ""))) {
        text +=
          "İlk gün tedavi mümkün olabilir; varış saatinize göre koordinatörümüz randevuyu planlar (aynı gün garanti edilmez).\n\n";
      }
      text +=
        "Seyahat tarihlerinizi paylaşırsanız konaklama alternatiflerini ve tedavi sürenize göre kaç gün kalmanız gerektiğini netleştirebiliriz.";
      return text;
    }
    if (kind === "flight_travel") {
      return (
        "Uçak biletlerinizi kendiniz alabilirsiniz — bu konuda bir zorunluluk yok.\n\n" +
        "Biletlerinizi aldıktan sonra varış tarihinizi bizimle paylaşmanız yeterli; klinik ekibi konaklama ve randevu planlamasında size yardımcı olur."
      );
    }
    if (kind === "airport_transfer") {
      return (
        "Havalimanı transferi konusunda klinik ekibimiz yardımcı olabilir.\n\n" +
        "Uçuş bilgilerinizi ve varış saatinizi paylaşırsanız transfer seçeneklerini birlikte netleştiririz."
      );
    }
  }

  if (key === "ka") {
    if (kind === "accommodation_hotel" || kind === "travel_general") {
      let text =
        "ანტალიაში ბილეთების თვითონ შეძენა შეგიძლიათ. ბილეთის შემდეგ მოგზაურობის თარიღები გაგვიზიარეთ.\n\n";
      text += "სასტუმროსა და განთავსებაში კლინიკის გუნდი დაგეხმარებათ.\n\n";
      if (hotelLines) text += hotelLines + "\n\n";
      text += "თარიღების გაზიარების შემდეგ შევაჯამებთ რამდენი დღე დაგჭირდებათ.";
      return text;
    }
    if (kind === "flight_travel") {
      return "ავიაბილეთების თვითონ შეძენა შეგიძლიათ. ვარიის თარიღის გაზიარება საკმარისია.";
    }
    return "აეროპორტის ტრანსფერი — გაუზიარეთ რეისის დეტალები.";
  }

  if (key === "ru") {
    if (kind === "accommodation_hotel" || kind === "travel_general") {
      let text =
        "Авиабилеты в Антalyю вы можете оформить самостоятельно. После покупки поделитесь датами поездки.\n\n";
      text += "По отелю и проживанию поможет команда клиники — подберём варианты под план лечения.\n\n";
      if (hotelLines) text += hotelLines + "\n\n";
      text += "Когда будут даты — уточним срок пребывания.";
      return text;
    }
    if (kind === "flight_travel") {
      return "Билеты можно купить самостоятельно. Сообщите дату прилёта — поможем с проживанием и визитами.";
    }
    return "Трансфер из аэропорта — пришлите рейс и время прилёта.";
  }

  if (kind === "accommodation_hotel" || kind === "travel_general") {
    let text =
      "You can book your flights to Antalya yourself. After you have tickets, share your travel dates with us.\n\n";
    text +=
      "Our clinic team can help with hotel and accommodation options based on your treatment plan and length of stay.\n\n";
    if (hotelLines) text += "Partner hotel examples (approximate):\n" + hotelLines + "\n\n";
    text +=
      "Share your travel dates and we can outline stay length and accommodation options.";
    return text;
  }
  if (kind === "flight_travel") {
    return (
      "You may arrange your own flights — there is no requirement to book through us.\n\n" +
      "Once you have tickets, share your arrival dates and our team will help with accommodation and visit planning."
    );
  }
  return (
    "We can help coordinate airport transfer.\n\n" +
    "Share your flight details and arrival time and we will outline transfer options."
  );
}

module.exports = {
  classifyPatientTravelIntent,
  patientMessageIsTravelCoordination,
  buildTravelCoordinationDirectReply,
};
