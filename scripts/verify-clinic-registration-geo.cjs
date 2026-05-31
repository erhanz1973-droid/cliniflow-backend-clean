#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  enrichClinicRegistrationGeo,
  clinicMatchesCityBrowse,
  inferCountryFromPhone,
} = require("../lib/clinicRegistrationGeo.cjs");

assert.strictEqual(inferCountryFromPhone("+995 555 123456"), "GE");

const enriched = enrichClinicRegistrationGeo({
  name: "მედსმაილი",
  clinic_code: "MEDSMILE",
  phone: "+995555000000",
  address: "Tbilisi, Georgia",
});
assert.strictEqual(enriched.country, "GE");
assert.strictEqual(enriched.city_code, "tbilisi");

assert.ok(
  clinicMatchesCityBrowse(
    { name: "მედსმაილი", phone: "+995555000000", country: null, city_code: null },
    "tbilisi",
  ),
);

assert.ok(
  clinicMatchesCityBrowse(
    { name: "Test", country: "GE", city_code: null, city: null },
    "tbilisi",
  ),
);

console.log("clinicRegistrationGeo: ok");
