/**
 * Clinic pricing + sales authority prompt block for AI coordinator replies.
 */

const { getClinicAiProfile } = require("./clinicAiSettings");
const { getPricingKnowledgeForAi, PRICING_LANGUAGE_GUIDANCE } = require("./clinicPricingForAi");
const {
  detectPatientCommercialIntent,
  treatmentMatchesTopic,
  patientAskedDurationOnly,
} = require("./clinicPricingIntent");
const { normalizeUiLang } = require("./i18n/coordinationLocales");
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
/**
 * @param {Array<Record<string, unknown>>} treatments
 * @param {string} message
 * @param {ReturnType<typeof detectPatientCommercialIntent>} intent
 */
function findTreatmentsForDurationQuestion(treatments, message, intent) {
  const rows = treatments || [];
  if (!rows.length) return [];
  const msg = String(message || "").toLowerCase();

  if (intent.topics.length) {
    const matched = rows.filter((t) =>
      intent.topics.some((topic) =>
        treatmentMatchesTopic(String(t.treatmentCode || ""), String(t.name || ""), topic),
      ),
    );
    if (matched.length) return matched;
  }

  if (/temizleme|temizlik|diş\s*temiz|dis\s*temiz|cleaning|hygiene/i.test(msg)) {
    return rows.filter((t) =>
      treatmentMatchesTopic(String(t.treatmentCode || ""), String(t.name || ""), "cleaning"),
    );
  }
  if (/dolgu|filling/i.test(msg)) {
    return rows.filter((t) =>
      treatmentMatchesTopic(String(t.treatmentCode || ""), String(t.name || ""), "filling"),
    );
  }
  if (/implant/i.test(msg)) {
    return rows.filter((t) =>
      treatmentMatchesTopic(String(t.treatmentCode || ""), String(t.name || ""), "implant"),
    );
  }

  return [];
}

function selectRelevantTreatments(treatments, intent) {
  const rows = treatments || [];
  if (!rows.length) return [];

  const topics = intent.topics.length
    ? intent.topics
    : intent.asksDirectPrice
      ? ["implant"]
      : [];
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

  if (intent.asksDirectPrice) return rows.slice(0, 8);
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

/**
 * @param {Record<string, unknown>} row
 * @param {string} message
 * @param {string} lang
 */
function pickTreatmentDisplayLabel(row, message, lang) {
  const L = normalizeUiLang(lang);
  const i18n = row.labelI18n && typeof row.labelI18n === "object" ? row.labelI18n : null;
  if (i18n && i18n[L]) return String(i18n[L]).trim();
  if (i18n && i18n.tr) return String(i18n.tr).trim();
  const msg = String(message || "").toLowerCase();
  if (/temizleme|temizlik|diş\s*temiz|dis\s*temiz/i.test(msg)) return "Diş temizliği";
  return String(row.name || row.treatmentCode || "Treatment").trim();
}

/**
 * @param {number} minutes
 * @param {string} treatmentLabel
 * @param {string} lang
 */
function formatDurationEstimateReply(minutes, treatmentLabel, lang) {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m <= 0) return null;
  const L = normalizeUiLang(lang);
  const label = String(treatmentLabel || "").trim() || (L === "tr" ? "Bu işlem" : "This visit");

  if (L === "tr") {
    return `${label} için kliniğimizde yaklaşık ${m} dakika planlıyoruz; ağız durumunuza göre biraz değişebilir.`;
  }
  if (L === "ka") {
    return `${label} ჩვენს კლინიკაში ჩვეულებრივ დაახლოებით ${m} წუთია; ეს შეიძლება ოდნავ შეიცვალოს პირის ჯანმრთელობის მიხედვით.`;
  }
  return `For ${label}, we typically allow about ${m} minutes at our clinic; it may vary slightly depending on your oral health.`;
}

/**
 * Direct reply when patient asks «kaç dakika» — uses admin duration_minutes only (no price).
 * @param {string} clinicId
 * @param {{ message: string, leadData?: Record<string, unknown>|null, lang?: string }} params
 */
async function buildDurationEstimateDirectReply(clinicId, params) {
  const id = String(clinicId || "").trim();
  if (!UUID_RE.test(id)) return null;

  const message = String(params.message || "").trim();
  const leadData = params.leadData || {};
  if (!patientAskedDurationOnly(message, leadData)) return null;

  const intent = detectPatientCommercialIntent(message, leadData);
  const pricing = await getPricingKnowledgeForAi(id);
  const treatments = pricing.treatments || [];

  let relevant = selectRelevantTreatments(treatments, intent);
  if (!relevant.length) {
    relevant = findTreatmentsForDurationQuestion(treatments, message, intent);
  }

  const row =
    relevant.find((t) => t.durationMinutes != null) ||
    treatments.find((t) => t.durationMinutes != null);
  if (!row || row.durationMinutes == null) return null;

  const lang =
    params.lang ||
    (/\b(kaç|dakika|süre|temizleme|diş)\b/i.test(message) ? "tr" : "en");
  const label = pickTreatmentDisplayLabel(row, message, lang);
  return formatDurationEstimateReply(row.durationMinutes, label, lang);
}

function buildNoPricingGuardPrompt(params, materials, intent, relevant, allTreatments = []) {
  const lines = [
    "PRICING POLICY — STRICT (this turn):",
    intent.asksCostSensitivity && !intent.asksDirectPrice
      ? "* Patient asked whether treatment is expensive/cheap (e.g. «pahalı mı») — NOT a request for a specific amount."
      : "* The patient did NOT ask for a specific price amount in their latest message.",
    intent.asksCostSensitivity && !intent.asksDirectPrice
      ? "* Reply like a coordinator reassuring the patient: say clearly you are NOT expensive (e.g. «Hayır, fiyatlarımız pahalı değil»). 1–2 short sentences."
      : "* Do NOT volunteer prices, cost ranges, currency amounts, or phrases like \"fiyatımız\", \"starting from\", or \"approximately €X\".",
    intent.asksCostSensitivity && !intent.asksDirectPrice
      ? "* Do NOT mention implant, implant prices, brands, bone condition, visit counts, X-ray, or any treatment-specific pricing unless the patient named that treatment in THIS message."
      : "* Explain treatment/process, brands (if asked), duration (if asked), consultation, or booking — without quoting money.",
    intent.asksCostSensitivity && !intent.asksDirectPrice
      ? "* Do NOT give TL/EUR/$ amounts or ranges. Do NOT explain «implant fiyatı» unless they asked about implant price explicitly."
      : "",
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
  if (intent.asksDuration) {
    const durationRows = (
      relevant.length ? relevant : findTreatmentsForDurationQuestion(allTreatments, params.message, intent)
    ).filter((t) => t.durationMinutes != null);
    lines.push("\nVISIT DURATION (mandatory — patient asked how long / kaç dakika):");
    lines.push(
      "* Answer with approximate minutes from clinic settings below — use «yaklaşık» / «typically».",
      "* Give the number in your FIRST sentence. Do NOT deflect to «randevu alın» without stating minutes.",
      "* Do NOT quote prices, TL/EUR, or cost ranges in this reply.",
    );
    if (durationRows.length) {
      for (const t of durationRows.slice(0, 4)) {
        const label = String(t.name || t.treatmentCode || "Treatment").trim();
        lines.push(`• ${label}: yaklaşık / approximately ${t.durationMinutes} dakika / minutes`);
      }
    } else {
      lines.push(
        "* (No duration in admin price list for this procedure — say you will confirm exact timing at consultation; still do not quote prices.)",
      );
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

  if (!intent.asksDirectPrice) {
    return buildNoPricingGuardPrompt(params, materials, intent, relevant, treatments);
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
    "RESPONSE ORDER: (1) Answer the price question in 2–3 short sentences using data below. (2) Stop — do not add x-ray, app, or booking pitches in the same message.",
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
  buildDurationEstimateDirectReply,
  formatDurationEstimateReply,
  detectPatientCommercialIntent,
  selectRelevantTreatments,
  findTreatmentsForDurationQuestion,
};
