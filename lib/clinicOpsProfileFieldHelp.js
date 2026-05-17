/**
 * Contextual help for Clinic Operations Profile fields — UI + orchestration clarity.
 *
 * visibility:
 *   patient_visible — may be quoted or paraphrased in patient-facing AI messages
 *   ai_reply        — used to shape AI replies (operational facts, not internal policy memos)
 *   internal        — staff/coordinator context; AI uses for tone/routing, not quoted to patients
 */

const VISIBILITY_TYPES = {
  patient_visible: {
    key: "patient_visible",
    label: "May appear in patient messages",
    short: "Patient-visible",
    className: "vis-patient",
  },
  ai_reply: {
    key: "ai_reply",
    label: "Used by AI replies",
    short: "AI replies",
    className: "vis-ai",
  },
  internal: {
    key: "internal",
    label: "Internal / operational only",
    short: "Internal",
    className: "vis-internal",
  },
};

/** @typedef {{ id: string, label: string, visibility: keyof typeof VISIBILITY_TYPES, helper: string, aiUsage: string, placeholder?: string, example?: string, gridSpan?: number, inputType?: string }} FieldHelpDef */

/** @type {Record<string, { title: string, intro: string, aiUsageSummary: string }>} */
const SECTION_HELP = {
  "ai-profile": {
    title: "Clinic AI Profile",
    intro:
      "Multilingual AI orchestration — enable languages and optional localized patient-facing text. Operational knowledge (brands, pricing, workflow) stays single-source; the AI localizes at reply time.",
    aiUsageSummary:
      "Language routing, localized greetings/signatures, and runtime localization guidance for coordinator prompts.",
  },
  materials: {
    title: "Implant Brands & Materials",
    intro: "Which brands and materials your clinic works with. Helps AI explain options without inventing brands.",
    aiUsageSummary: "Educational replies about implants, zirconium, labs, warranty.",
  },
  travel: {
    title: "Travel & Accommodation",
    intro: "Partner hotels and transfer options for international patients.",
    aiUsageSummary: "Medical travel coordination, hotel suggestions, transfer questions.",
  },
  logistics: {
    title: "Clinic Logistics",
    intro: "Hours, response times, and practical clinic operations.",
    aiUsageSummary: "Scheduling, availability, emergency routing, SLA fallback.",
  },
  payment: {
    title: "Payment & Financial Policies",
    intro: "Deposits, financing, refunds. AI explains policies — does not negotiate or promise exceptions.",
    aiUsageSummary: "Payment and policy questions; escalates refunds to humans.",
  },
  workflow: {
    title: "Treatment Workflow Knowledge",
    intro: "Visit timelines, healing periods, and post-treatment coordination. Operational guidance only — not diagnosis.",
    aiUsageSummary: "Treatment process, recovery, follow-up, and post-op patient questions.",
  },
  "ai-safety": {
    title: "AI Safety & Autonomy",
    intro: "How much the AI can act alone vs suggest drafts. Medical topics always stay human-reviewed.",
    aiUsageSummary: "Orchestration: auto-reply, suggest-only, or off per topic.",
  },
  handoff: {
    title: "Human Handoff Rules",
    intro: "When the AI must stop and alert your coordinator or doctor.",
    aiUsageSummary: "Automatic escalation triggers in conversation.",
  },
  "internal-notes": {
    title: "Internal AI Knowledge Notes",
    intro: "Clinic positioning and strategy. Helps AI align with your brand — not shown verbatim to patients.",
    aiUsageSummary: "Prompt context for tone, priorities, and what to emphasize.",
  },
};

/** @type {FieldHelpDef[]} */
const FIELD_HELP = [
  // ── AI Profile ──
  {
    id: "displayName",
    label: "Assistant display name",
    visibility: "patient_visible",
    helper: "The name patients see when the AI writes messages (e.g. “DentX Care Team”).",
    aiUsage: "Used in greetings and message signatures.",
    placeholder: "DentX Care Team",
    example: "Smile Istanbul Coordinator",
  },
  {
    id: "toneStyle",
    label: "Tone / style",
    visibility: "patient_visible",
    helper: "Overall communication style for patient chats.",
    aiUsage: "Sets warmth, formality, and luxury level in replies.",
    example: "Warm + professional for international dental tourists.",
  },
  {
    id: "supportedLanguages",
    label: "Multilingual AI support",
    visibility: "patient_visible",
    helper:
      "Enable languages for AI orchestration. Operational data stays in one place — the AI localizes brands, pricing, and logistics at reply time.",
    aiUsage: "Patient language detection, reply language, and human-staff routing hints.",
    example: "English (primary), Turkish, Russian, Georgian for dental tourism.",
  },
  {
    id: "displayNameLocalized",
    label: "Assistant name (localized)",
    visibility: "patient_visible",
    helper: "Optional per-language assistant display names. Leave blank to let AI translate from English.",
    aiUsage: "Greetings and signatures in the patient's language.",
    example: "en: DentX Care Team · tr: DentX Hasta Destek Ekibi",
  },
  {
    id: "welcomeMessageLocalized",
    label: "Welcome message (localized)",
    visibility: "patient_visible",
    helper: "Optional opening message templates per language — not required for MVP.",
    aiUsage: "First-contact tone and clinic introduction.",
    placeholder: "Short welcome in each enabled language",
  },
  {
    id: "signatureStyle",
    label: "Signature style",
    visibility: "patient_visible",
    helper: "How messages are signed at the end.",
    aiUsage: "Appended to AI-generated patient messages.",
  },
  {
    id: "profileTags",
    label: "Profile tags",
    visibility: "internal",
    helper: "Short tags describing your clinic vibe (luxury, fast response, etc.).",
    aiUsage: "Internal tone hints — not shown directly to patients.",
    placeholder: "luxury, friendly, premium, fast_response",
    example: "premium, friendly, fast_response",
  },
  // ── Catalog ──
  {
    id: "catalog.name",
    label: "Treatment name",
    visibility: "patient_visible",
    helper: "Clear name patients understand (e.g. “Zirconium crown”, “Dental implant”).",
    aiUsage: "Pricing and treatment explanations.",
    placeholder: "Zirconium crown",
  },
  {
    id: "catalog.priceRange",
    label: "Price range (min–max)",
    visibility: "patient_visible",
    helper: "Approximate range only. AI must say estimates depend on clinical assessment.",
    aiUsage: "Cost questions and offer drafts — never as a final quote.",
    example: "180–350 EUR per crown",
  },
  {
    id: "catalog.durationLabel",
    label: "Duration / visits",
    visibility: "patient_visible",
    helper: "How long treatment takes or how many visits are typical.",
    aiUsage: "Timeline and planning answers.",
    placeholder: "2 visits / 3–6 months between",
    example: "First visit 5–7 days; second visit after 3 months",
  },
  {
    id: "catalog.includedServices",
    label: "Included services",
    visibility: "patient_visible",
    helper: "What is typically included in this package.",
    aiUsage: "Sets expectations in pricing replies.",
    placeholder: "Temporary crown, consultation, OPG x-ray",
  },
  {
    id: "catalog.excludedServices",
    label: "Excluded services",
    visibility: "patient_visible",
    helper: "What is NOT included (avoids misunderstandings).",
    aiUsage: "Clarifies scope when patients ask “is everything included?”",
    placeholder: "Flight, hotel, sinus lift",
  },
  {
    id: "catalog.aiNotes",
    label: "AI notes for this treatment",
    visibility: "ai_reply",
    helper: "Extra context for this treatment only — caveats, upsells, or common patient questions.",
    aiUsage: "Treatment-specific reply hints; not shown verbatim.",
    placeholder: "Mention bone graft may be needed after CBCT",
    example: "Usually requires 3–6 months healing before final crown.",
  },
  {
    id: "catalog.variants",
    label: "Brand / material variants",
    visibility: "patient_visible",
    helper:
      "Optional per-brand or per-material pricing (e.g. Straumann premium vs Megagen standard). AI compares options and answers “which brand do you use?” — always as estimates.",
    aiUsage:
      "Pricing differences, brand questions, premium vs standard explanations. Must use non-binding language (typically from, approximately).",
    example: "Straumann — Switzerland — Premium — typically from 900 EUR",
    gridSpan: true,
  },
  {
    id: "variant.brandName",
    label: "Brand name",
    visibility: "patient_visible",
    helper: "Implant or material brand patients may ask about.",
    aiUsage: "“Which brand do you use?” and comparison replies.",
    placeholder: "Straumann",
    example: "Megagen",
  },
  {
    id: "variant.originCountry",
    label: "Country of origin",
    visibility: "patient_visible",
    helper: "Where the brand/system is from — builds trust in international consultations.",
    aiUsage: "Educational brand context, not medical claims.",
    placeholder: "Switzerland",
    example: "South Korea",
  },
  {
    id: "variant.materialType",
    label: "Material / system type",
    visibility: "patient_visible",
    helper: "e.g. implant system, zirconia, E.max.",
    aiUsage: "Material-specific explanations.",
    placeholder: "Implant system",
    example: "Zirconia",
  },
  {
    id: "variant.tier",
    label: "Segment / tier",
    visibility: "patient_visible",
    helper: "Premium, standard, or mid-range — helps AI explain positioning.",
    aiUsage: "Premium vs standard option comparisons.",
    example: "Premium",
  },
  {
    id: "variant.priceRange",
    label: "Price from (min)",
    visibility: "patient_visible",
    helper: "Starting price for this brand option. AI must say “typically starts from” — not a guarantee.",
    aiUsage: "Non-binding price estimates per brand.",
    placeholder: "450",
    example: "900",
  },
  {
    id: "variant.aiNotes",
    label: "AI notes for this variant",
    visibility: "ai_reply",
    helper: "When to recommend this brand, caveats, or competitor comparisons.",
    aiUsage: "Variant-specific reply context.",
    placeholder: "Recommend for patients prioritizing long-term warranty",
    example: "Often chosen for full-arch cases; premium warranty package",
  },
  // ── Materials ──
  {
    id: "implantBrands",
    label: "Implant brands",
    visibility: "patient_visible",
    helper: "Brands you routinely use. AI can compare at a high level — not medical recommendations.",
    aiUsage: "Brand and option explanations.",
    placeholder: "Straumann, Nobel, Osstem",
  },
  {
    id: "premiumBrands",
    label: "Premium brands",
    visibility: "patient_visible",
    helper: "Higher-tier brands if you offer them.",
    aiUsage: "Upsell or comparison replies when patients ask about premium options.",
  },
  {
    id: "zirconiumTypes",
    label: "Zirconium types",
    visibility: "patient_visible",
    helper: "Materials for crowns/veneers you use.",
    aiUsage: "Cosmetic and crown material questions.",
    placeholder: "E.max, multilayer zirconia",
  },
  {
    id: "labPartners",
    label: "Lab partners",
    visibility: "ai_reply",
    helper: "In-house or partner labs — builds trust in process answers.",
    aiUsage: "Operational process explanations.",
  },
  {
    id: "warrantyInformation",
    label: "Warranty policy",
    visibility: "patient_visible",
    helper: "Summary of warranty terms. Keep factual; AI will not invent legal guarantees.",
    aiUsage: "Warranty and guarantee questions.",
    placeholder: "10-year implant warranty with annual check-up",
    example: "Implant warranty 10 years when maintenance visits are completed.",
  },
  {
    id: "sedationAvailability",
    label: "Sedation available",
    visibility: "patient_visible",
    helper: "Whether sedation is offered for anxious patients.",
    aiUsage: "Comfort and anxiety-related questions.",
  },
  // ── Logistics ──
  {
    id: "weekdayHours",
    label: "Weekday hours",
    visibility: "patient_visible",
    helper: "When the clinic is normally open for appointments and replies.",
    aiUsage: "Scheduling and “when are you open?” questions.",
    placeholder: "09:00 – 18:00",
  },
  {
    id: "timezone",
    label: "Clinic timezone",
    visibility: "internal",
    helper: "IANA timezone for scheduling and SLA calculations.",
    aiUsage: "Converts appointment times and response windows for international patients.",
    placeholder: "Europe/Istanbul",
    example: "Europe/Istanbul",
  },
  {
    id: "averageResponseSlaMinutes",
    label: "Response SLA (minutes)",
    visibility: "internal",
    helper: "Target time for human staff to respond. Used for AI fallback timing — not shown to patients.",
    aiUsage: "SLA automation and coordinator escalation.",
    placeholder: "120",
  },
  {
    id: "emergencyContact",
    label: "Emergency contact",
    visibility: "patient_visible",
    helper: "Phone or instruction for urgent cases. AI directs emergencies here — does not give medical advice.",
    aiUsage: "Urgent / severe pain routing (with human handoff).",
    placeholder: "+90 … / WhatsApp urgent line",
  },
  {
    id: "transportationNotes",
    label: "Transport notes",
    visibility: "patient_visible",
    helper: "Airport pickup, VIP transfer, shuttle details.",
    aiUsage: "Travel and arrival coordination.",
    placeholder: "Free airport pickup Mon–Sat for treatment patients",
    example: "VIP transfer available on request; standard pickup included with hotel package.",
  },
  // ── Payment ──
  {
    id: "refundPolicy",
    label: "Refund policy",
    visibility: "patient_visible",
    helper: "Your standard refund rules. AI summarizes — escalates disputes to humans.",
    aiUsage: "Refund questions (with handoff for conflicts).",
    placeholder: "Deposit refundable if cancelled 14+ days before treatment",
  },
  {
    id: "cancellationPolicy",
    label: "Cancellation policy",
    visibility: "patient_visible",
    helper: "Cancellation terms for appointments or packages.",
    aiUsage: "Scheduling and cancellation questions.",
  },
  // ── Internal notes ──
  {
    id: "positioningNotes",
    label: "Positioning bullets",
    visibility: "internal",
    helper: "How you want the clinic positioned (aesthetics, conservative planning, typical stay). One point per line.",
    aiUsage: "Shapes AI emphasis and recommendations style — not quoted directly.",
    placeholder: "We focus on natural aesthetics\nMost international patients stay 5–7 days",
    example: "We prefer conservative treatment planning\nPremium experience, not budget clinic",
  },
  {
    id: "freeformNotes",
    label: "Additional internal notes",
    visibility: "internal",
    helper: "Anything else staff should know when AI coordinates leads.",
    aiUsage: "Extra orchestration context.",
    placeholder: "Always mention free consultation CBCT when discussing implants",
  },
  // ── Treatment journey protocols (journeys editor) ──
  {
    id: "protocol.healingNotes",
    label: "Healing notes (operational)",
    visibility: "ai_reply",
    helper: "Healing timeline and osseointegration facts — operational only, not medical diagnosis.",
    aiUsage: "Answers about healing duration and when next visit is possible.",
    placeholder: "Osseointegration typically 3–6 months before final prosthetics",
    example: "Implant integration phase usually 3–6 months; soft diet first week.",
  },
  {
    id: "protocol.postOpNotes",
    label: "Post-op coordination notes",
    visibility: "ai_reply",
    helper:
      "Describe how your clinic usually guides patients after treatment. AI may use this to answer recovery, follow-up, swelling, eating, medication and check-up questions.",
    aiUsage:
      "Post-operative coordination replies — practical guidance your clinic normally gives. Not a substitute for doctor advice.",
    placeholder:
      "Patients are usually advised to avoid hard foods for 48 hours after implant surgery. Mild swelling is expected during the first 2–3 days. Follow-up checks are typically scheduled before departure.",
    example:
      "Soft diet 48h, ice packs first day, follow-up before flight home, WhatsApp check-in day 3.",
  },
  {
    id: "protocol.aiNotes",
    label: "AI coordinator notes",
    visibility: "internal",
    helper: "Private hints for the AI about this treatment type — priorities, phrases to use or avoid.",
    aiUsage: "Internal prompt context per treatment — not shown verbatim to patients.",
    placeholder: "Emphasize temp teeth option; mention CBCT required",
    example: "Always mention all-on-4 requires sufficient bone; offer video consult first.",
  },
  {
    id: "protocol.estimatedStay",
    label: "Estimated stay (1st visit)",
    visibility: "patient_visible",
    helper: "Typical days in country for the first visit.",
    aiUsage: "Travel planning and “how long should I stay?” questions.",
    placeholder: "5–7 days",
  },
  {
    id: "protocol.secondVisitAfter",
    label: "Second visit after",
    visibility: "patient_visible",
    helper: "When patients usually return for the next phase.",
    aiUsage: "Multi-visit treatment planning.",
    placeholder: "3–6 months",
  },
];

/** @type {Record<string, FieldHelpDef>} */
const FIELD_HELP_BY_ID = Object.fromEntries(FIELD_HELP.map((f) => [f.id, f]));

function getFieldHelp(id) {
  return FIELD_HELP_BY_ID[id] || null;
}

function getSectionHelp(sectionId) {
  return SECTION_HELP[sectionId] || null;
}

function listFieldsForSection(sectionId) {
  if (sectionId === "workflow") {
    return FIELD_HELP.filter((f) => f.id.startsWith("protocol."));
  }
  const sectionFieldIds = {
    "ai-profile": [
      "supportedLanguages",
      "displayNameLocalized",
      "welcomeMessageLocalized",
      "toneStyle",
      "signatureStyle",
      "profileTags",
    ],
    materials: [
      "implantBrands",
      "premiumBrands",
      "zirconiumTypes",
      "labPartners",
      "warrantyInformation",
      "sedationAvailability",
    ],
    logistics: ["weekdayHours", "averageResponseSlaMinutes", "emergencyContact", "transportationNotes"],
    payment: ["refundPolicy", "cancellationPolicy"],
    "internal-notes": ["positioningNotes", "freeformNotes"],
  };
  const ids = sectionFieldIds[sectionId] || [];
  return ids.map((id) => FIELD_HELP_BY_ID[id]).filter(Boolean);
}

/** Admin UI meta — structure only; copy comes from admin-i18n.js (never English prose over the wire). */
function adminUiFieldHelpMeta() {
  const out = {};
  for (const [id, def] of Object.entries(FIELD_HELP_BY_ID)) {
    out[id] = {
      id,
      visibility: def.visibility,
      ...(def.gridSpan ? { gridSpan: def.gridSpan } : {}),
      ...(def.inputType ? { inputType: def.inputType } : {}),
    };
  }
  return out;
}

module.exports = {
  VISIBILITY_TYPES,
  SECTION_HELP,
  FIELD_HELP,
  FIELD_HELP_BY_ID,
  getFieldHelp,
  getSectionHelp,
  listFieldsForSection,
  adminUiFieldHelpMeta,
};
