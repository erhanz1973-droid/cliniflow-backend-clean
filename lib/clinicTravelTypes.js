/**
 * Medical travel coordination — shared types & future partner categories.
 * Only hotels are implemented; other categories are interface placeholders.
 */

/** @typedef {'hotel'|'apartment'|'airport_transfer'|'driver'|'translator'|'travel_coordinator'} TravelPartnerCategory */

/**
 * Future partner record shape (not persisted yet except hotels).
 * @typedef {object} ClinicTravelPartnerBase
 * @property {string} id
 * @property {string} clinicId
 * @property {TravelPartnerCategory} category
 * @property {string} name
 * @property {boolean} isActive
 * @property {boolean} [isPreferred]
 * @property {string} [notes]
 */

/**
 * @typedef {object} ClinicPartnerHotelDto
 * @property {string} id
 * @property {string} clinicId
 * @property {string} name
 * @property {string|null} mapsUrl
 * @property {string|null} address
 * @property {string|null} priceRange
 * @property {number|null} distanceMinutes
 * @property {boolean} transferIncluded
 * @property {boolean} breakfastIncluded
 * @property {string|null} clinicDiscountNotes
 * @property {string|null} bookingUrl
 * @property {string|null} supportedLanguages
 * @property {string|null} notes
 * @property {boolean} isPreferred
 * @property {boolean} isActive
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** Categories planned — do not implement tables until needed. */
const FUTURE_TRAVEL_PARTNER_CATEGORIES = [
  "airport_transfer",
  "driver",
  "translator",
  "travel_coordinator",
  "apartment",
];

module.exports = {
  FUTURE_TRAVEL_PARTNER_CATEGORIES,
};
