#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  formatLeadSummaryForHumans,
  attachHumanLeadSummary,
} = require("../lib/leadSummaryHuman");

const sample = formatLeadSummaryForHumans(
  {
    treatmentInterest: "implant",
    bookingIntent: "medium",
    budgetSignal: "medium",
    patientReportedTags: ["implant_interest"],
  },
  "en",
);

assert.ok(sample.sections.length >= 4, "expected categorized sections");
assert.strictEqual(sample.sections[0].id, "treatment");
assert.strictEqual(sample.sections[1].id, "booking");
assert.strictEqual(sample.sections[2].id, "commercial");
assert.strictEqual(sample.sections[3].id, "conversation");
assert.ok(
  sample.sections[1].bullets[0].includes("final commitment"),
  "booking readiness copy",
);
assert.ok(
  sample.sections[2].bullets[0].includes("evaluating options"),
  "commercial interest copy",
);

const ka = formatLeadSummaryForHumans(
  { treatmentInterest: "implant", bookingIntent: "medium" },
  "ka",
);
assert.ok(
  ka.sections[0].bullets[0].includes("იმპლანტ"),
  "Georgian treatment line",
);

const lead = attachHumanLeadSummary(
  {
    treatmentInterest: "implant",
    bookingIntent: "medium",
    budgetSignal: "medium",
    travelTimeline: "June 2026",
    urgency: "medium",
    operationalIntakeFlags: { patientReportedTags: ["implant_interest"] },
  },
  "en",
);

assert.strictEqual(lead.treatmentInterest, undefined);
assert.strictEqual(lead.bookingIntent, undefined);
assert.strictEqual(lead.budgetSignal, undefined);
assert.strictEqual(lead.urgency, undefined);
assert.strictEqual(lead.travelTimeline, undefined);
assert.ok(Array.isArray(lead.leadSummarySections) && lead.leadSummarySections.length >= 4);
assert.strictEqual(lead.operationalIntakeFlags.patientReportedTags, undefined);
assert.ok(lead.operationalIntakeFlags.patientReportedTagSummaries.length >= 1);

console.log("verify-lead-summary-human: ok");
