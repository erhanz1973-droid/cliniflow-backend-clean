/**
 * Clinic treatment journey protocols — CRUD + AI relevance filtering.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shown in admin UI when workflow storage is not ready yet. */
const PROTOCOLS_SETUP_CLINIC_MESSAGE =
  "AI treatment workflows are being prepared for your clinic. You can review this page now; saving will be available once setup is complete. If this message persists, contact Clinifly support.";

/** Logged server-side only — never returned to clinic UI. */
const PROTOCOLS_SETUP_DEV_HINT =
  "[clinicTreatmentProtocols] clinic_treatment_protocols unavailable — apply migration 20260518160000_clinic_treatment_protocols_ensure.sql and refresh PostgREST schema cache.";

/**
 * @param {{ message?: string, code?: string, details?: string }|null|undefined} error
 */
function isProtocolsTableMissingError(error) {
  if (!error) return false;
  const msg = String(error.message || error.details || "").toLowerCase();
  const code = String(error.code || "");
  return (
    code === "PGRST205" ||
    (msg.includes("clinic_treatment_protocols") &&
      (msg.includes("schema cache") || msg.includes("does not exist") || msg.includes("not found")))
  );
}

/**
 * @param {{ message?: string, code?: string, details?: string }|null|undefined} error
 */
function protocolErrorResult(error, fallbackCode = "db_error") {
  if (isProtocolsTableMissingError(error)) {
    console.warn(PROTOCOLS_SETUP_DEV_HINT, error?.message || error?.code || "");
    return {
      ok: false,
      error: "protocols_table_missing",
      message: PROTOCOLS_SETUP_CLINIC_MESSAGE,
      setupState: "preparing",
      tableMissing: true,
    };
  }
  console.warn("[clinicTreatmentProtocols]", fallbackCode, error?.message || error);
  return {
    ok: false,
    error: fallbackCode,
    message: "We could not save your workflow right now. Please try again in a moment.",
  };
}

/** @type {Record<string, string[]>} */
const TYPE_ALIASES = {
  implant: ["implant", "implants", "dental implant"],
  full_mouth_implant: ["full mouth", "all-on-4", "all on 4", "full arch", "all on six"],
  veneers: ["veneer", "veneers", "laminate", "porcelain"],
  crowns: ["crown", "crowns", "cap", "caps"],
  aligners: ["aligner", "aligners", "invisalign", "clear aligner", "orthodont"],
  whitening: ["whitening", "bleach", "bleaching", "white teeth"],
};

/**
 * @param {Record<string, unknown>} row
 * @returns {import('./clinicJourneyTypes').ClinicTreatmentProtocolDto}
 */
function mapProtocolRow(row) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    treatmentType: row.treatment_type,
    typicalVisitCount:
      row.typical_visit_count != null && row.typical_visit_count !== ""
        ? Number(row.typical_visit_count)
        : null,
    estimatedStayDuration: row.estimated_stay_duration || null,
    secondVisitAfter: row.second_visit_after || null,
    healingNotes: row.healing_notes || null,
    postOpNotes: row.post_op_notes || null,
    xrayRequired: row.xray_required === true,
    temporaryTeethPossible: row.temporary_teeth_possible === true,
    languages: row.languages || null,
    aiNotes: row.ai_notes || null,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {Partial<import('./clinicJourneyTypes').ClinicTreatmentProtocolDto>} body
 * @param {string} clinicId
 */
function protocolBodyToRow(body, clinicId) {
  const visits = body.typicalVisitCount;
  return {
    clinic_id: clinicId,
    treatment_type: String(body.treatmentType || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_"),
    typical_visit_count:
      visits != null && visits !== "" && Number.isFinite(Number(visits))
        ? Math.max(1, Number(visits))
        : null,
    estimated_stay_duration: String(body.estimatedStayDuration || "").trim() || null,
    second_visit_after: String(body.secondVisitAfter || "").trim() || null,
    healing_notes: String(body.healingNotes || "").trim() || null,
    post_op_notes: String(body.postOpNotes || "").trim() || null,
    xray_required: body.xrayRequired === true,
    temporary_teeth_possible: body.temporaryTeethPossible === true,
    languages: String(body.languages || "").trim() || null,
    ai_notes: String(body.aiNotes || "").trim() || null,
    is_active: body.isActive !== false,
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

/**
 * @param {import('./clinicJourneyTypes').ClinicTreatmentProtocolDto} protocol
 * @param {string} message
 * @param {string|null|undefined} treatmentInterest
 */
function protocolMatchesContext(protocol, message, treatmentInterest) {
  const type = String(protocol.treatmentType || "").toLowerCase();
  const msg = String(message || "").toLowerCase();
  const ti = String(treatmentInterest || "").toLowerCase().replace(/\s+/g, "_");
  const aliases = TYPE_ALIASES[type] || [type.replace(/_/g, " "), type];
  const haystack = `${msg} ${ti}`;
  return aliases.some((a) => haystack.includes(a) || haystack.includes(a.replace(/\s/g, "_")));
}

/**
 * @param {string} clinicId
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function listProtocolsByClinic(clinicId, opts = {}) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId)) return [];

  let qb = supabase
    .from("clinic_treatment_protocols")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("sort_order", { ascending: true })
    .order("treatment_type", { ascending: true });

  if (opts.activeOnly) qb = qb.eq("is_active", true);

  const { data, error } = await qb;
  if (error) {
    if (isProtocolsTableMissingError(error)) {
      console.warn(PROTOCOLS_SETUP_DEV_HINT, error.message || error.code);
      const err = new Error(PROTOCOLS_SETUP_CLINIC_MESSAGE);
      err.code = "PROTOCOLS_TABLE_MISSING";
      err.setupState = "preparing";
      throw err;
    }
    console.warn("[clinicTreatmentProtocols] list:", error.message);
    return [];
  }
  return (data || []).map(mapProtocolRow);
}

/**
 * Relevant active protocols for AI (keyword + lead treatment interest).
 * @param {string} clinicId
 * @param {{ message?: string, treatmentInterest?: string|null, max?: number }} [opts]
 */
async function getRelevantProtocolsForAi(clinicId, opts = {}) {
  const max = Math.min(8, Math.max(1, opts.max || 5));
  let all = [];
  try {
    all = await listProtocolsByClinic(clinicId, { activeOnly: true });
  } catch (e) {
    if (e?.code === "PROTOCOLS_TABLE_MISSING") return [];
    throw e;
  }
  if (!all.length) return [];

  const matched = all.filter((p) =>
    protocolMatchesContext(p, opts.message || "", opts.treatmentInterest),
  );
  if (matched.length) return matched.slice(0, max);

  return all.slice(0, max);
}

/**
 * @param {string} clinicId
 * @param {string} protocolId
 */
async function getProtocolById(clinicId, protocolId) {
  if (!isSupabaseEnabled() || !UUID_RE.test(clinicId) || !UUID_RE.test(protocolId)) {
    return null;
  }

  const { data, error } = await supabase
    .from("clinic_treatment_protocols")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("id", protocolId)
    .maybeSingle();

  if (error || !data) return null;
  return mapProtocolRow(data);
}

/**
 * @param {string} clinicId
 * @param {Partial<import('./clinicJourneyTypes').ClinicTreatmentProtocolDto>} body
 */
async function createProtocol(clinicId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };
  const type = String(body.treatmentType || "").trim();
  if (!type) return { ok: false, error: "treatment_type_required" };

  const row = protocolBodyToRow(body, clinicId);
  row.created_at = row.updated_at;

  const { data, error } = await supabase
    .from("clinic_treatment_protocols")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_treatment_type", message: error.message };
    }
    return protocolErrorResult(error, "insert_failed");
  }
  return { ok: true, protocol: mapProtocolRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} protocolId
 * @param {Partial<import('./clinicJourneyTypes').ClinicTreatmentProtocolDto>} body
 */
async function updateProtocol(clinicId, protocolId, body) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const existing = await getProtocolById(clinicId, protocolId);
  if (!existing) return { ok: false, error: "not_found" };

  const merged = { ...existing, ...body };
  if (body.treatmentType != null) {
    merged.treatmentType = String(body.treatmentType).trim();
  }
  if (!merged.treatmentType) return { ok: false, error: "treatment_type_required" };

  const row = protocolBodyToRow(merged, clinicId);
  const { data, error } = await supabase
    .from("clinic_treatment_protocols")
    .update(row)
    .eq("id", protocolId)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_treatment_type", message: error.message };
    }
    return protocolErrorResult(error, "update_failed");
  }
  return { ok: true, protocol: mapProtocolRow(data) };
}

/**
 * @param {string} clinicId
 * @param {string} protocolId
 */
async function deleteProtocol(clinicId, protocolId) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_required" };

  const { error } = await supabase
    .from("clinic_treatment_protocols")
    .delete()
    .eq("id", protocolId)
    .eq("clinic_id", clinicId);

  if (error) return protocolErrorResult(error, "delete_failed");
  return { ok: true };
}

/**
 * Bulk reorder: [{ id, sortOrder }]
 * @param {string} clinicId
 * @param {Array<{ id: string, sortOrder: number }>} items
 */
async function reorderProtocols(clinicId, items) {
  if (!isSupabaseEnabled() || !Array.isArray(items)) return { ok: false, error: "invalid_payload" };

  const nowIso = new Date().toISOString();
  for (const item of items) {
    if (!UUID_RE.test(String(item.id || ""))) continue;
    await supabase
      .from("clinic_treatment_protocols")
      .update({ sort_order: Number(item.sortOrder) || 0, updated_at: nowIso })
      .eq("id", item.id)
      .eq("clinic_id", clinicId);
  }
  return { ok: true };
}

module.exports = {
  PROTOCOLS_SETUP_CLINIC_MESSAGE,
  PROTOCOLS_SETUP_DEV_HINT,
  isProtocolsTableMissingError,
  mapProtocolRow,
  listProtocolsByClinic,
  getRelevantProtocolsForAi,
  getProtocolById,
  createProtocol,
  updateProtocol,
  deleteProtocol,
  reorderProtocols,
  protocolMatchesContext,
};
