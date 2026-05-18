/**
 * node --test scripts/test-clinic-sales-prompt.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPatientCommercialIntent } from "../lib/clinicPricingIntent.js";
import { selectRelevantTreatments, normalizeSalesAuthority } from "../lib/clinicSalesPromptForAi.js";

describe("detectPatientCommercialIntent", () => {
  it("detects implant brand question", () => {
    const i = detectPatientCommercialIntent("Which implant brands do you use?");
    assert.equal(i.asksBrand, true);
    assert.ok(i.topics.includes("implant"));
  });

  it("detects filling price question", () => {
    const i = detectPatientCommercialIntent("How much is a filling?");
    assert.equal(i.asksPrice, true);
    assert.ok(i.topics.includes("filling"));
  });
});

describe("selectRelevantTreatments", () => {
  const catalog = [
    { treatmentCode: "IMPLANT", name: "Dental implant", variants: [{ brandName: "Straumann", originCountry: "Switzerland", priceMin: 900, priceMax: 1200, currency: "EUR" }] },
    { treatmentCode: "CLEANING", name: "Teeth cleaning", basePrice: 80, currency: "EUR" },
    { treatmentCode: "FILLING", name: "Composite filling", basePrice: 120, currency: "EUR" },
  ];

  it("selects implant rows for brand question", () => {
    const intent = detectPatientCommercialIntent("Which implant brands do you use?");
    const picked = selectRelevantTreatments(catalog, intent);
    assert.ok(picked.some((t) => /implant/i.test(t.name)));
  });
});

describe("normalizeSalesAuthority", () => {
  it("defaults allow pricing", () => {
    const a = normalizeSalesAuthority({});
    assert.equal(a.allowPriceRanges, true);
    assert.equal(a.allowBrandNames, true);
  });
});
