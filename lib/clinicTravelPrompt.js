/**
 * Travel & accommodation context for AI coordinator prompts.
 */

const TRAVEL_BOOKING_GUARDRAIL_PROMPT = `
TRAVEL & ACCOMMODATION (when partner hotel context is provided):
* Recommend only hotels listed in the clinic partner context — do not invent properties.
* Prices are approximate ranges only — never guarantee exact rates or availability.
* You are not a booking engine — do not complete reservations; suggest the patient confirm with the clinic coordinator.
* Mention transfer/breakfast only if listed for that hotel.
* If no hotels are listed, say the clinic team can suggest options after understanding travel dates.`;

/**
 * @param {import('./clinicTravelTypes').ClinicPartnerHotelDto[]} hotels
 * @returns {string|null}
 */
function buildTravelAccommodationPromptBlock(hotels) {
  const list = Array.isArray(hotels) ? hotels.filter((h) => h && h.isActive !== false) : [];
  if (!list.length) return null;

  const lines = list.map((h, i) => {
    const parts = [`${i + 1}. ${h.name}`];
    if (h.isPreferred) parts.push("(preferred partner)");
    if (h.distanceMinutes != null) parts.push(`~${h.distanceMinutes} min from clinic`);
    if (h.priceRange) parts.push(`typical price: ${h.priceRange} (approximate)`);
    if (h.transferIncluded) parts.push("airport/clinic transfer can be arranged");
    if (h.breakfastIncluded) parts.push("breakfast included");
    if (h.clinicDiscountNotes) parts.push(`notes: ${h.clinicDiscountNotes}`);
    if (h.supportedLanguages) parts.push(`languages: ${h.supportedLanguages}`);
    if (h.address) parts.push(`address: ${h.address}`);
    return parts.join("; ");
  });

  return (
    "Clinic partner hotels (use only these for stay recommendations; prices are approximate):\n" +
    lines.join("\n")
  );
}

/**
 * @param {import('./clinicTravelTypes').ClinicPartnerHotelDto[]} hotels
 * @returns {string|null}
 */
function buildTravelUserContextAppendix(hotels) {
  const block = buildTravelAccommodationPromptBlock(hotels);
  if (!block) return null;
  return `\n\n${block}`;
}

module.exports = {
  TRAVEL_BOOKING_GUARDRAIL_PROMPT,
  buildTravelAccommodationPromptBlock,
  buildTravelUserContextAppendix,
};
