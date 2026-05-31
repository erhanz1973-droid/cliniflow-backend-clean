/**
 * Clinic pricing + sales authority prompt block for AI coordinator replies.
 */

const { getClinicAiProfile } = require("./clinicAiSettings");
const { getPricingKnowledgeForAi, PRICING_LANGUAGE_GUIDANCE } = require("./clinicPricingForAi");
const { detectPatientCommercialIntent, treatmentMatchesTopic } = require("./clinicPricingIntent");
const { classifyTreatmentIntake } = require("./treatmentIntakeComplexity");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} raw
 */
function normalizeSalesAuthority(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    allowBrandNames: d.allowBrandNames !== false && d.allow_brand_names !== false,
    allowBrandCountry: d.allowBrandCountry !== false && d.allow_brand_country !== false,
    allowPriceRanges: d.allowPriceRanges !== false && d.allow_price_ranges !== false,
    allowMaterialComparison:
      d.allowMaterialComparison !== false && d.allow_material_comparison !== false,
    allowEstimatedQuotes: d.allowEstimatedQuotes !== false && d.allow_estimated_quotes !== false,
    requireHumanForFinalQuote:
      d.requireHumanForFinalQuote !== false && d.require_human_for_final_quote !== false,
  };
}

/**
 * @param {ReturnType<typeof normalizeSalesAuthority>} auth
 */
function buildAuthorityLines(auth) {
  const lines = ["AI PRICING & SALES AUTHORITY (operational coordinator):"];
  if (auth.allowEstimatedQuotes && auth.allowPriceRanges) {
    lines.push(
      "* You ARE allowed to answer pricing questions using clinic-configured ranges below — use non-binding language (typically from, approximately, depending on complexity).",
    );
  }
  if (auth.allowBrandNames) {
    lines.push(
      "* You ARE allowed to name implant/material brands and systems configured for this clinic.",
    );
  }
  if (auth.allowBrandCountry) {
    lines.push("* You ARE allowed to mention country of origin for brands when listed below.");
  }
  if (auth.allowMaterialComparison && auth.allowBrandNames) {
    lines.push(
      "* You MAY compare configured options (e.g. premium vs standard) at a commercial level — not medical recommendations.",
    );
  }
  if (auth.requireHumanForFinalQuote) {
    lines.push(
      "* Final binding quotes require clinical assessment — but do NOT refuse to give approximate ranges when data is below.",
    );
  }
  lines.push(
    "* Do NOT deflect simple commercial questions (price, brands, duration) to \"upload panoramic X-ray\" or \"coordinator will review\" BEFORE answering from clinic data.",
    "* Behave like an experienced international dental coordinator — confident, concise, helpful.",
  );
  return lines.join("\n");
}

/**
 * @param {number|null|undefined} min
 * @param {number|null|undefined} max
 * @param {string} [currency]
 */
function formatPriceRange(min, max, currency = "EUR") {
  const cur = String(currency || "EUR").trim() || "EUR";
  if (min != null && max != null && min !== max) {
    return `approximately ${min}–${max} ${cur}`;
  }
  if (min != null) return `typically from approximately ${min} ${cur}`;
  if (max != null) return `up to approximately ${max} ${cur}`;
  return null;
}

/**
 * @param {Array<Record<string, unknown>>} treatments
 * @param {ReturnType<typeof detectPatientCommercialIntent>} intent
 */
function selectRelevantTreatments(treatments, intent) {
  const rows = treatments || [];
  if (!rows.length) return [];

  const topics = intent.topics.length ? intent.topics : ["implant"];
  const matched = rows.filter((t) => {
    const code = String(t.treatmentCode || t.name || "");
    const name = String(t.name || "");
    return topics.some((topic) => treatmentMatchesTopic(code, name, topic));
  });

  if (matched.length) return matched.slice(0, 10);

  if (intent.asksBrand || intent.primaryTopic === "implant") {
    const implantRows = rows.filter((t) =>
      /implant/i.test(`${t.treatmentCode || ""} ${t.name || ""}`),
    );
    if (implantRows.length) return implantRows.slice(0, 10);
  }

  if (intent.asksPrice) return rows.slice(0, 8);
  return matched.slice(0, 6);
}

/**
 * @param {Array<Record<string, unknown>>} treatments
 */
function formatTreatmentsForPrompt(treatments) {
  const lines = [];
  for (const t of treatments) {
    const label = String(t.name || t.treatmentCode || "Treatment").trim();
    const cur = t.currency || "EUR";
    const base = t.basePrice != null ? Number(t.basePrice) : null;
    const range = t.priceRange;
    let priceLine = null;
    if (range?.min != null || range?.max != null) {
      priceLine = formatPriceRange(range.min, range.max, range.currency || cur);
    } else if (base != null) {
      priceLine = formatPriceRange(base, base, cur);
    }
    if (t.durationMinutes != null) {
      priceLine = (priceLine ? `${priceLine}; ` : "") + `typical visit ~${t.durationMinutes} min`;
    }

    const variants = Array.isArray(t.variants) ? t.variants : [];
    if (variants.length) {
      lines.push(`• ${label}:`);
      for (const v of variants.slice(0, 8)) {
        const brand = v.brandName ? String(v.brandName) : v.label;
        const country = v.originCountry ? ` (${v.originCountry})` : "";
        const pr = formatPriceRange(v.priceMin, v.priceMax, v.currency || cur);
        lines.push(`  - ${brand}${country}${pr ? `: ${pr}` : ""}`);
        if (v.aiNotes) lines.push(`    Note: ${String(v.aiNotes).slice(0, 200)}`);
      }
    } else {
      lines.push(`• ${label}${priceLine ? `: ${priceLine}` : ""}`);
    }
  }
  return lines;
}

/**
 * @param {string[]} brandList
 */
function formatMaterialsBrands(brandList) {
  const brands = (brandList || []).map((b) => String(b || "").trim()).filter(Boolean);
  if (!brands.length) return [];
  return [`• Configured implant brands (materials profile): ${brands.join(", ")}`];
}

function buildNoPricingGuardPrompt(params, materials, intent, relevant) {
  const lines = [
    "PRICING POLICY — STRICT (this turn):",
    "* The patient did NOT ask about price, cost, fees, or budget in their latest message.",
    "* Do NOT volunteer prices, cost ranges, currency amounts, or phrases like \"fiyatımız\", \"starting from\", \"approximately €X\", or \"genellikle X TL/EUR\".",
    "* Explain treatment/process, brands (if asked), duration (if asked), consultation, or booking — without quoting money.",
    "* If helpful, you may invite them to ask for a quote — but do not give numbers unprompted.",
  ];
  const mem = params.discussionMemory;
  if (mem?.pricingAlreadyDiscussed) {
    lines.push(
      "* Pricing was discussed earlier — do not repeat figures unless they explicitly ask about cost/price again.",
    );
  }
  const authority = normalizeSalesAuthority(
    materials.salesAuthority || materials.pricingSalesAuthority,
  );
  if (intent.asksBrand && authority.allowBrandNames) {
    const brandLines = formatMaterialsBrands(materials.implantBrands);
    const premiumLines = formatMaterialsBrands(materials.premiumBrands);
    if (brandLines.length) {
      lines.push("\nBRANDS (names only — never pair with prices this turn):");
      lines.push(...brandLines);
      if (premiumLines.length) lines.push(...premiumLines);
    }
  }
  if (intent.asksDuration && relevant.length) {
    lines.push("\nTYPICAL VISIT DURATION (no prices):");
    for (const t of relevant.slice(0, 6)) {
      const label = String(t.name || t.treatmentCode || "Treatment").trim();
      if (t.durationMinutes != null) {
        lines.push(`• ${label}: typical visit ~${t.durationMinutes} min`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Build pricing + sales prompt for inbound coordinator AI.
 * @param {string} clinicId
 * @param {{ message: string, leadData?: Record<string, unknown>|null, clinicName?: string|null, discussionMemory?: { pricingAlreadyDiscussed?: boolean, recentTopics?: string[] }|null }} params
 */
async function buildClinicSalesPromptForAi(clinicId, params) {
  const id = String(clinicId || "").trim();
  if (!UUID_RE.test(id)) return null;

  const message = String(params.message || "").trim();
  const leadData = params.leadData || {};
  const intent = detectPatientCommercialIntent(message, leadData);
  const intakeClass = classifyTreatmentIntake(
    leadData.treatmentInterest,
    message,
    leadData.patientReportedTags || [],
  );

  const [profile, pricing] = await Promise.all([
    getClinicAiProfile(id),
    getPricingKnowledgeForAi(id),
  ]);

  const materials = profile.materials || {};
  const authority = normalizeSalesAuthority(materials.salesAuthority || materials.pricingSalesAuthority);
  const treatments = pricing.treatments || [];
  const relevant = selectRelevantTreatments(treatments, intent);

  if (!intent.asksPrice) {
    return buildNoPricingGuardPrompt(params, materials, intent, relevant);
  }

  const lines = [buildAuthorityLines(authority)];
  const mem = params.discussionMemory;
  if (mem?.pricingAlreadyDiscussed) {
    lines.push(
      "\nPRICING ALREADY DISCUSSED IN RECENT TURNS:",
      "* Do NOT repeat the same price ranges or brand price paragraphs from your last messages.",
      "* If the patient asks a follow-up about a brand already quoted, add clinical/suitability context — not the same numbers again.",
      mem.recentTopics?.length
        ? `* Recent topics: ${mem.recentTopics.slice(-8).join(", ")}`
        : "",
    );
  }

  if (params.clinicName) {
    lines.push(`Clinic: ${params.clinicName}`);
  }

  lines.push(
    `Patient intent: explicit price question; topics: ${intent.topics.join(", ") || "unspecified"}; complexity: ${intakeClass.tier}.`,
  );

  lines.push(
    "RESPONSE ORDER: (1) Answer the price question directly using data below. (2) Brief coordinator tone. (3) Optional booking. (4) Do NOT deflect to consultation-only or x-ray upload before answering price questions.",
  );

  const treatmentLines = formatTreatmentsForPrompt(relevant);
  const brandLines = formatMaterialsBrands(materials.implantBrands);
  const premiumLines = formatMaterialsBrands(materials.premiumBrands);

  if (treatmentLines.length) {
    lines.push("\nCLINIC TREATMENT PRICING (structured — use for estimates):");
    lines.push(...treatmentLines);
  } else if (treatments.length) {
    lines.push("\nCLINIC TREATMENT PRICING (general list — pick closest match):");
    lines.push(...formatTreatmentsForPrompt(treatments.slice(0, 6)));
  } else {
    lines.push(
      "\n(No structured treatment prices in admin — give helpful operational guidance and invite coordinator follow-up for exact figures.)",
    );
  }

  if (brandLines.length && authority.allowBrandNames) {
    lines.push("\nIMPLANT / MATERIAL BRANDS:");
    lines.push(...brandLines);
    if (premiumLines.length) lines.push(...premiumLines);
  }

  lines.push(
    `\nLanguage: ${PRICING_LANGUAGE_GUIDANCE.phrases.slice(0, 3).join("; ")}. Avoid: ${PRICING_LANGUAGE_GUIDANCE.avoid.join(", ")}.`,
  );

  return lines.join("\n");
}

module.exports = {
  normalizeSalesAuthority,
  buildClinicSalesPromptForAi,
  detectPatientCommercialIntent,
  selectRelevantTreatments,
};
