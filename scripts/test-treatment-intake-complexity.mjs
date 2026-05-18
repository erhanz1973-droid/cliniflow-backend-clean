/**
 * node --test scripts/test-treatment-intake-complexity.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTreatmentIntake,
  imagingRequiredForIntake,
  photosRequiredForIntake,
} from "../lib/treatmentIntakeComplexity.js";
import { computeIntakeFlags } from "../lib/aiIntakeFlags.js";

describe("classifyTreatmentIntake", () => {
  it("teeth cleaning → low tier", () => {
    const c = classifyTreatmentIntake("cleaning", "How much is teeth cleaning?", []);
    assert.equal(c.tier, "low");
    assert.equal(imagingRequiredForIntake(c, [], "teeth cleaning"), false);
    assert.equal(photosRequiredForIntake(c, [], "teeth cleaning"), false);
  });

  it("implant inquiry → high tier + imaging", () => {
    const c = classifyTreatmentIntake("implant", "I need 4 implants", ["implant_interest"]);
    assert.equal(c.tier, "high");
    assert.equal(imagingRequiredForIntake(c, ["implant_interest"], "implants"), true);
  });

  it("veneer → medium, photos may be required", () => {
    const c = classifyTreatmentIntake("veneer", "Hollywood smile", ["veneer_interest"]);
    assert.equal(c.tier, "medium");
    assert.equal(photosRequiredForIntake(c, ["veneer_interest"], "veneer"), true);
    assert.equal(imagingRequiredForIntake(c, ["veneer_interest"], "veneer"), false);
  });
});

describe("computeIntakeFlags", () => {
  it("cleaning does not set missingXray", () => {
    const flags = computeIntakeFlags(
      { treatmentInterest: "cleaning" },
      [],
      [],
      "What is the price for teeth cleaning?",
    );
    assert.equal(flags.treatmentComplexity, "low");
    assert.equal(flags.missingXray, false);
    assert.equal(flags.missingSmilePhotos, false);
  });
});
