#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  detectPatientCommercialIntent,
  patientAskedDurationOnly,
} = require("../lib/clinicPricingIntent");
const { buildDurationEstimateDirectReply } = require("../lib/clinicSalesPromptForAi");

const msg = "Diş temizleme kaç dakika yaklaşık";
const intent = detectPatientCommercialIntent(msg, {});
assert.strictEqual(intent.asksDuration, true, "TR kaç dakika → asksDuration");
assert.strictEqual(intent.topics.includes("cleaning"), true, "temizleme → cleaning topic");
assert.strictEqual(patientAskedDurationOnly(msg, {}), true);

console.log("verify-duration-reply: intent ok (direct reply needs DB)");
