// Single source of truth for tooth-level procedures (backend + admin UI via /api/procedures)
// Status: PLANNED | ACTIVE | COMPLETED | CANCELLED
// Category: EVENTS | PROSTHETIC | RESTORATIVE | ENDODONTIC | SURGICAL | IMPLANT

/** @typedef {"EVENTS"|"PROSTHETIC"|"RESTORATIVE"|"ENDODONTIC"|"SURGICAL"|"IMPLANT"} ProcedureCategory */
/** @typedef {"PLANNED"|"ACTIVE"|"COMPLETED"|"CANCELLED"} ProcedureStatus */

/**
 * @typedef {Object} ProcedureTypeDef
 * @property {string} type
 * @property {string} label
 * @property {ProcedureCategory} category
 */

/** @type {ProcedureTypeDef[]} */
const PROCEDURE_TYPES = [
  // EVENTS (non-tooth procedures / visits)
  { type: "CONSULT", label: "Consultation (Muayene)", category: "EVENTS" },
  { type: "XRAY", label: "X-ray (Röntgen)", category: "EVENTS" },
  { type: "PANORAMIC_XRAY", label: "Panoramic X-ray (Panoramik)", category: "EVENTS" },

  // PROSTHETIC (CORE)
  { type: "CROWN", label: "Crown (Kuron)", category: "PROSTHETIC" },
  { type: "TEMP_CROWN", label: "Temporary Crown (Geçici kuron)", category: "PROSTHETIC" },
  { type: "BRIDGE_UNIT", label: "Bridge (Köprü) – tooth unit", category: "PROSTHETIC" },
  { type: "TEMP_BRIDGE_UNIT", label: "Temporary Bridge (Geçici köprü) – tooth unit", category: "PROSTHETIC" },
  { type: "CROWN_REPLACEMENT", label: "Crown Replacement / Renewal", category: "PROSTHETIC" },
  { type: "BRIDGE_REPLACEMENT_OR_REMOVAL", label: "Bridge Replacement / Removal", category: "PROSTHETIC" },
  { type: "INLAY", label: "Inlay", category: "PROSTHETIC" },
  { type: "ONLAY", label: "Onlay", category: "PROSTHETIC" },
  { type: "VENEER", label: "Veneer (Vinir)", category: "PROSTHETIC" },
  { type: "OVERLAY", label: "Overlay", category: "PROSTHETIC" },
  { type: "POST_AND_CORE", label: "Post & Core", category: "PROSTHETIC" },

  // RESTORATIVE
  { type: "FILLING", label: "Filling (Dolgu)", category: "RESTORATIVE" },
  { type: "TEMP_FILLING", label: "Temporary Filling (Geçici dolgu)", category: "RESTORATIVE" },
  { type: "FILLING_REPLACEMENT_OR_REMOVAL", label: "Filling Replacement / Removal", category: "RESTORATIVE" },

  // ENDODONTIC
  { type: "ROOT_CANAL_TREATMENT", label: "Root Canal Treatment (Kanal)", category: "ENDODONTIC" },
  { type: "ROOT_CANAL_RETREATMENT", label: "Root Canal Retreatment", category: "ENDODONTIC" },
  { type: "CANAL_OPENING", label: "Canal Opening", category: "ENDODONTIC" },
  { type: "CANAL_FILLING", label: "Canal Filling", category: "ENDODONTIC" },

  // SURGICAL
  { type: "EXTRACTION", label: "Extraction (Çekim)", category: "SURGICAL" },
  { type: "SURGICAL_EXTRACTION", label: "Surgical Extraction (Cerrahi çekim)", category: "SURGICAL" },
  { type: "APICAL_RESECTION", label: "Apical Resection", category: "SURGICAL" },

  // IMPLANT (optional v1+)
  { type: "IMPLANT", label: "Implant", category: "IMPLANT" },
  { type: "HEALING_ABUTMENT", label: "Healing Abutment", category: "IMPLANT" },
  { type: "IMPLANT_CROWN", label: "Implant Crown", category: "IMPLANT" },
  { type: "WHITENING", label: "Whitening (Beyazlatma)", category: "EVENTS" },
  { type: "ALL_ON_4", label: "All-on-4", category: "IMPLANT" },
  { type: "ALL_ON_6", label: "All-on-6", category: "IMPLANT" },
  { type: "OTHER", label: "Other", category: "EVENTS" },
];

/** @type {Record<string, ProcedureTypeDef>} */
const TYPE_MAP = Object.fromEntries(PROCEDURE_TYPES.map((t) => [t.type, t]));

/** @type {Set<string>} */
const EXTRACTION_TYPES = new Set(["EXTRACTION", "SURGICAL_EXTRACTION"]);

/** @param {any} s */
function normalizeStatus(s) {
  const raw = String(s || "PLANNED").trim().toUpperCase();
  if (raw === "DONE") return "COMPLETED";
  if (raw === "IN_PROGRESS") return "ACTIVE";
  if (raw === "PLANNED" || raw === "ACTIVE" || raw === "COMPLETED" || raw === "CANCELLED") return raw;
  return "PLANNED";
}

/**
 * @param {any} v
 * @returns {number|string|null}
 */
function normalizeDate(v) {
  if (v === null || v === undefined || v === "") return null;
  // allow YYYY-MM-DD
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  // allow timestamp-ish
  const n = Number(v);
  if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  return null;
}

/** @param {any} type */
function normalizeType(type) {
  return String(type || "").trim().toUpperCase();
}

/** procedure_id UUID iken procedure_type gibi kullanılmamalı; mobil/legacy kısa kodlar → kanonik tip */
function normalizeEncounterProcedureTypeCode(procedure_type, procedure_id) {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let code = String(procedure_type ?? "").trim().toUpperCase();
  if (!code && procedure_id != null && procedure_id !== "") {
    const pid = String(procedure_id).trim();
    if (pid && !uuidRe.test(pid)) code = pid.toUpperCase();
  }
  const aliases = {
    BRIDGE: "BRIDGE_UNIT",
    ROOT_CANAL: "ROOT_CANAL_TREATMENT",
    RCT: "ROOT_CANAL_TREATMENT",
    TEMP_BRIDGE: "TEMP_BRIDGE_UNIT",
    ENDO: "ROOT_CANAL_TREATMENT",
    RCT_TX: "ROOT_CANAL_TREATMENT",
  };
  return aliases[code] || code;
}

/**
 * @param {string} type
 * @returns {ProcedureCategory|null}
 */
function categoryForType(type) {
  const t = TYPE_MAP[String(type || "").toUpperCase()];
  return t ? t.category : null;
}

/**
 * A tooth is locked if there is a COMPLETED extraction procedure in history.
 * @param {Array<any>} procedures
 */
function isToothLocked(procedures) {
  const list = Array.isArray(procedures) ? procedures : [];
  return list.some((p) => {
    const st = normalizeStatus(p?.status);
    const tp = normalizeType(p?.type);
    return st === "COMPLETED" && EXTRACTION_TYPES.has(tp);
  });
}

/**
 * Validate the core constraints for an upsert on one tooth.
 * @param {Array<any>} existingProcedures
 * @param {{procedureId:string,type:string,status:ProcedureStatus,category:ProcedureCategory|null,date:number|string|null,notes?:string,meta?:any,replacesProcedureId?:string,createdAt:number}} incoming
 */
function validateToothUpsert(existingProcedures, incoming) {
  const procedures = Array.isArray(existingProcedures) ? existingProcedures : [];
  const locked = isToothLocked(procedures);

  const existing = procedures.find((p) => String(p?.procedureId || p?.id || "") === String(incoming.procedureId));
  const isNew = !existing;
  if (locked && isNew) {
    return { ok: false, error: "tooth_locked", locked: true };
  }

  if (!incoming.category) {
    return { ok: false, error: "invalid_type", message: "Unknown procedure type" };
  }

  if (incoming.status === "ACTIVE") {
    const hasOtherActiveSameCat = procedures.some((p) => {
      const pid = String(p?.procedureId || p?.id || "");
      if (pid === String(incoming.procedureId)) return false;
      return normalizeStatus(p?.status) === "ACTIVE" && categoryForType(p?.type) === incoming.category;
    });
    if (hasOtherActiveSameCat) {
      return { ok: false, error: "active_conflict", category: incoming.category };
    }
  }

  return { ok: true, locked };
}

module.exports = {
  PROCEDURE_TYPES,
  TYPE_MAP,
  EXTRACTION_TYPES,
  normalizeStatus,
  normalizeType,
  normalizeDate,
  normalizeEncounterProcedureTypeCode,
  categoryForType,
  isToothLocked,
  validateToothUpsert,
};


