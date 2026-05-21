/**
 * Clinic referral discount % for patient-facing UI (0–100).
 */

/**
 * @param {unknown} raw
 * @returns {number}
 */
function normalizeReferralDiscountPercent(raw) {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * @param {Record<string, unknown>|null|undefined} clinicRow
 * @returns {number}
 */
function readReferralDiscountPercentFromClinicRow(clinicRow) {
  if (!clinicRow || typeof clinicRow !== "object") return 0;

  let settings = clinicRow.settings;
  if (typeof settings === "string") {
    try {
      settings = JSON.parse(settings);
    } catch (_) {
      settings = {};
    }
  }
  if (!settings || typeof settings !== "object") settings = {};

  const levels =
    settings.referralLevels && typeof settings.referralLevels === "object"
      ? settings.referralLevels
      : clinicRow.referralLevels && typeof clinicRow.referralLevels === "object"
        ? clinicRow.referralLevels
        : {};

  const candidates = [
    settings.referral_discount_percent,
    settings.referralDiscountPercent,
    clinicRow.referral_discount_percent,
    clinicRow.referralDiscountPercent,
    levels.level1,
    settings.referralLevel1Percent,
    settings.referral_level1_percent,
    clinicRow.defaultInviterDiscountPercent,
    clinicRow.default_inviter_discount_percent,
    clinicRow.defaultInvitedDiscountPercent,
    clinicRow.default_invited_discount_percent,
  ];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c != null && String(c).trim() !== "") {
      return normalizeReferralDiscountPercent(c);
    }
  }
  return 0;
}

module.exports = {
  normalizeReferralDiscountPercent,
  readReferralDiscountPercentFromClinicRow,
};
