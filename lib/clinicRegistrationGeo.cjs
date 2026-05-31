/**
 * Infer country / city_code for newly registered clinics (phone, address, explicit fields).
 */

"use strict";

const { resolveCityCode } = require("./cityCodes.cjs");
const { countryBucket, countriesMatch } = require("./clinicCountryPriority.cjs");

/** Canonical browse city → ISO-style country bucket */
const CITY_DEFAULT_COUNTRY = Object.freeze({
  tbilisi: "GE",
  batumi: "GE",
  kutaisi: "GE",
  istanbul: "TR",
  ankara: "TR",
  antalya: "TR",
});

/** Default discovery city when only country is known */
const COUNTRY_DEFAULT_CITY = Object.freeze({
  GE: "tbilisi",
  TR: "istanbul",
});

/**
 * @param {unknown} phone
 * @returns {string|null} ISO-style bucket (GE, TR, …)
 */
function inferCountryFromPhone(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("+") ? digits.slice(1) : digits;
  if (normalized.startsWith("995")) return "GE";
  if (normalized.startsWith("90")) return "TR";
  if (normalized.startsWith("994")) return "AZ";
  return null;
}

/**
 * @param {unknown} text
 * @returns {string|null}
 */
function inferCountryFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (/\b(georgia|საქართველო|gürcistan|gurcistan)\b/i.test(t)) return "GE";
  if (/\b(turkey|türkiye|turkiye|türk|turk)\b/i.test(t)) return "TR";
  if (/\b(azerbaijan|azərbaycan)\b/i.test(t)) return "AZ";
  if (/\bge\b/i.test(lower) && /\b(country|ülke|ulke)\b/i.test(lower)) return "GE";
  return null;
}

/**
 * @param {unknown} address
 * @param {string|null} [countryHint]
 * @returns {string|null} canonical city_code
 */
function inferCityCodeFromAddress(address, countryHint = null) {
  const raw = String(address || "").trim();
  if (!raw) return null;
  const fromAlias = resolveCityCode(raw);
  if (fromAlias) return fromAlias;
  const lower = raw.toLowerCase();
  for (const code of Object.keys(CITY_DEFAULT_COUNTRY)) {
    if (lower.includes(code)) return code;
  }
  if (countryHint === "GE" || inferCountryFromText(raw) === "GE") {
    if (/batumi|ბათუმ/i.test(raw)) return "batumi";
    if (/kutaisi|ქუთაის/i.test(raw)) return "kutaisi";
    if (/tbilisi|tiflis|თბილის/i.test(raw)) return "tbilisi";
    return "tbilisi";
  }
  if (countryHint === "TR" || inferCountryFromText(raw) === "TR") {
    if (/ankara/i.test(raw)) return "ankara";
    if (/antalya/i.test(raw)) return "antalya";
    if (/istanbul|istabul/i.test(raw)) return "istanbul";
    return "istanbul";
  }
  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function enrichClinicRegistrationGeo(row) {
  const out = { ...(row || {}) };

  let country =
    out.country != null && String(out.country).trim()
      ? countryBucket(out.country)
      : null;
  if (!country) country = inferCountryFromPhone(out.phone);
  if (!country) country = inferCountryFromText(out.address);
  if (!country) country = inferCountryFromText(out.city);

  let cityCode =
    out.city_code != null && String(out.city_code).trim()
      ? resolveCityCode(out.city_code) || String(out.city_code).trim().toLowerCase()
      : null;
  if (!cityCode) cityCode = resolveCityCode(out.city);
  if (!cityCode) cityCode = inferCityCodeFromAddress(out.address, country);
  if (!cityCode && country && COUNTRY_DEFAULT_CITY[country]) {
    cityCode = COUNTRY_DEFAULT_CITY[country];
  }

  if (country) out.country = country;
  if (cityCode) {
    out.city_code = cityCode;
    if (!out.city || !String(out.city).trim() || !resolveCityCode(out.city)) {
      out.city = cityCode;
    }
  }

  const statusRaw = out.status != null ? String(out.status).trim() : "";
  if (!statusRaw) out.status = "active";

  return out;
}

/**
 * Whether a clinic with missing city_code should appear under a browse city filter.
 * @param {Record<string, unknown>} clinic
 * @param {string} wantCityCode
 */
function clinicMatchesCityBrowse(clinic, wantCityCode) {
  const want = String(wantCityCode || "").trim().toLowerCase();
  if (!want) return true;

  const explicit = clinic.city_code != null ? String(clinic.city_code).trim().toLowerCase() : "";
  if (explicit) return explicit === want;

  const legacy = resolveCityCode(clinic.city);
  if (legacy) return legacy === want;

  const defaultCountry = CITY_DEFAULT_COUNTRY[want];
  if (!defaultCountry) return false;

  const countryFromRow = clinic.country ? countryBucket(clinic.country) : "";
  if (countryFromRow && countriesMatch(countryFromRow, defaultCountry)) return true;

  const fromPhone = inferCountryFromPhone(clinic.phone);
  if (fromPhone && fromPhone === defaultCountry) return true;

  const fromAddress = inferCountryFromText(clinic.address) || inferCityCodeFromAddress(clinic.address, defaultCountry);
  if (fromAddress === want || (fromAddress && CITY_DEFAULT_COUNTRY[fromAddress] === defaultCountry)) {
    return true;
  }

  return false;
}

module.exports = {
  CITY_DEFAULT_COUNTRY,
  COUNTRY_DEFAULT_CITY,
  inferCountryFromPhone,
  inferCountryFromText,
  inferCityCodeFromAddress,
  enrichClinicRegistrationGeo,
  clinicMatchesCityBrowse,
};
