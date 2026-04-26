// Single source of truth for tooth-level procedures (backend + admin UI via /api/procedures)
// Status: PLANNED | ACTIVE | COMPLETED | CANCELLED
// Category: EVENTS | PROSTHETIC | RESTORATIVE | ENDODONTIC | SURGICAL | IMPLANT

/** @typedef {"EVENTS"|"PROSTHETIC"|"RESTORATIVE"|"ENDODONTIC"|"SURGICAL"|"IMPLANT"} ProcedureCategory */
/** @typedef {"PLANNED"|"ACTIVE"|"COMPLETED"|"CANCELLED"} ProcedureStatus */

/**
 * @typedef {Object} ProcedureTypeDef
 * @property {string} type
 * @property {ProcedureCategory} category
 */

/** @type {ProcedureTypeDef[]} */
const PROCEDURE_TYPES = [
  // EVENTS (non-tooth procedures / visits)
  { type: "CONSULT", category: "EVENTS" },
  { type: "XRAY", category: "EVENTS" },
  { type: "PANORAMIC_XRAY", category: "EVENTS" },

  // PROSTHETIC (CORE)
  { type: "CROWN", category: "PROSTHETIC" },
  { type: "TEMP_CROWN", category: "PROSTHETIC" },
  { type: "BRIDGE_UNIT", category: "PROSTHETIC" },
  { type: "TEMP_BRIDGE_UNIT", category: "PROSTHETIC" },
  { type: "CROWN_REPLACEMENT", category: "PROSTHETIC" },
  { type: "BRIDGE_REPLACEMENT_OR_REMOVAL", category: "PROSTHETIC" },
  { type: "INLAY", category: "PROSTHETIC" },
  { type: "ONLAY", category: "PROSTHETIC" },
  { type: "VENEER", category: "PROSTHETIC" },
  { type: "OVERLAY", category: "PROSTHETIC" },
  { type: "POST_AND_CORE", category: "PROSTHETIC" },

  // RESTORATIVE
  { type: "FILLING", category: "RESTORATIVE" },
  { type: "TEMP_FILLING", category: "RESTORATIVE" },
  { type: "FILLING_REPLACEMENT_OR_REMOVAL", category: "RESTORATIVE" },

  // ENDODONTIC
  { type: "ROOT_CANAL_TREATMENT", category: "ENDODONTIC" },
  { type: "ROOT_CANAL_RETREATMENT", category: "ENDODONTIC" },
  { type: "CANAL_OPENING", category: "ENDODONTIC" },
  { type: "CANAL_FILLING", category: "ENDODONTIC" },

  // SURGICAL
  { type: "EXTRACTION", category: "SURGICAL" },
  { type: "SURGICAL_EXTRACTION", category: "SURGICAL" },
  { type: "APICAL_RESECTION", category: "SURGICAL" },

  // IMPLANT (optional v1+)
  { type: "IMPLANT", category: "IMPLANT" },
  { type: "HEALING_ABUTMENT", category: "IMPLANT" },
  { type: "IMPLANT_CROWN", category: "IMPLANT" },
  { type: "WHITENING", category: "EVENTS" },
  { type: "ALL_ON_4", category: "IMPLANT" },
  { type: "ALL_ON_6", category: "IMPLANT" },
  { type: "OTHER", category: "EVENTS" },
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

/** @param {string} [lang] tr | en | ru | ka */
function normalizeProcedureLang(lang) {
  const c = String(lang || "en")
    .toLowerCase()
    .split("-")[0];
  if (c === "ru" || c === "tr" || c === "ka" || c === "en") return c;
  return "en";
}

/**
 * @param {Record<string, string>|string|null|undefined} obj
 * @param {string} [lang]
 * @returns {string}
 */
function safeLang(obj, lang) {
  if (obj == null || obj === "") return "";
  if (typeof obj === "string") return obj;
  const c = normalizeProcedureLang(lang);
  return obj[c] || obj.en || Object.values(obj || {})[0] || "";
}

/**
 * Admin UI + pickers: localized labels (human text only; `type` codes stay EN).
 * Fallback order: requested lang → English → type code
 */
const PROCEDURE_I18N = {
  en: {
    category: {
      EVENTS: "Events",
      PROSTHETIC: "Prosthetic",
      RESTORATIVE: "Restorative",
      ENDODONTIC: "Endodontic",
      SURGICAL: "Surgical",
      IMPLANT: "Implant",
    },
    type: {
      CONSULT: "Consultation",
      XRAY: "X-ray",
      PANORAMIC_XRAY: "Panoramic X-ray",
      CROWN: "Crown",
      TEMP_CROWN: "Temporary crown",
      BRIDGE_UNIT: "Bridge – tooth unit",
      TEMP_BRIDGE_UNIT: "Temporary bridge – tooth unit",
      CROWN_REPLACEMENT: "Crown replacement / renewal",
      BRIDGE_REPLACEMENT_OR_REMOVAL: "Bridge replacement / removal",
      INLAY: "Inlay",
      ONLAY: "Onlay",
      VENEER: "Veneer",
      OVERLAY: "Overlay",
      POST_AND_CORE: "Post & core",
      FILLING: "Filling",
      TEMP_FILLING: "Temporary filling",
      FILLING_REPLACEMENT_OR_REMOVAL: "Filling replacement / removal",
      ROOT_CANAL_TREATMENT: "Root canal treatment",
      ROOT_CANAL_RETREATMENT: "Root canal retreatment",
      CANAL_OPENING: "Canal opening",
      CANAL_FILLING: "Obturation",
      EXTRACTION: "Extraction",
      SURGICAL_EXTRACTION: "Surgical extraction",
      APICAL_RESECTION: "Apical resection",
      IMPLANT: "Implant",
      HEALING_ABUTMENT: "Healing abutment",
      IMPLANT_CROWN: "Implant crown",
      WHITENING: "Whitening",
      ALL_ON_4: "All-on-4",
      ALL_ON_6: "All-on-6",
      OTHER: "Other",
    },
  },
  tr: {
    category: {
      EVENTS: "Muayene / Görüntüleme",
      PROSTHETIC: "Protetik",
      RESTORATIVE: "Restoratif",
      ENDODONTIC: "Endodontik",
      SURGICAL: "Cerrahi",
      IMPLANT: "İmplant",
    },
    type: {
      CONSULT: "Muayene",
      XRAY: "Röntgen",
      PANORAMIC_XRAY: "Panoramik röntgen",
      CROWN: "Kuron",
      TEMP_CROWN: "Geçici kuron",
      BRIDGE_UNIT: "Köprü – diş ünitesi",
      TEMP_BRIDGE_UNIT: "Geçici köprü – diş ünitesi",
      CROWN_REPLACEMENT: "Kuron yenileme / değişim",
      BRIDGE_REPLACEMENT_OR_REMOVAL: "Köprü yenileme / söküm",
      INLAY: "İnley",
      ONLAY: "Onley",
      VENEER: "Vinir",
      OVERLAY: "Overlay",
      POST_AND_CORE: "Post & core",
      FILLING: "Dolgu",
      TEMP_FILLING: "Geçici dolgu",
      FILLING_REPLACEMENT_OR_REMOVAL: "Dolgu değişimi / söküm",
      ROOT_CANAL_TREATMENT: "Kanal tedavisi",
      ROOT_CANAL_RETREATMENT: "Kanal yeniden tedavi",
      CANAL_OPENING: "Kanal açma",
      CANAL_FILLING: "Kanal doldurma",
      EXTRACTION: "Çekim",
      SURGICAL_EXTRACTION: "Cerrahi çekim",
      APICAL_RESECTION: "Apikal rezeksiyon",
      IMPLANT: "İmplant",
      HEALING_ABUTMENT: "İyileşim abutmanı",
      IMPLANT_CROWN: "İmplant üstü kuron",
      WHITENING: "Beyazlatma",
      ALL_ON_4: "All-on-4",
      ALL_ON_6: "All-on-6",
      OTHER: "Diğer",
    },
  },
  ru: {
    category: {
      EVENTS: "События",
      PROSTHETIC: "Ортопедия",
      RESTORATIVE: "Терапия",
      ENDODONTIC: "Эндодонтия",
      SURGICAL: "Хирургия",
      IMPLANT: "Имплантация",
    },
    type: {
      CONSULT: "Консультация",
      XRAY: "Прицельный снимок",
      PANORAMIC_XRAY: "Панорамный снимок",
      CROWN: "Коронка",
      TEMP_CROWN: "Временная коронка",
      BRIDGE_UNIT: "Мост – единица зуба",
      TEMP_BRIDGE_UNIT: "Временный мост – единица зуба",
      CROWN_REPLACEMENT: "Замена коронки / обновление",
      BRIDGE_REPLACEMENT_OR_REMOVAL: "Замена / снятие моста",
      INLAY: "Вкладка",
      ONLAY: "Накладка",
      VENEER: "Винир",
      OVERLAY: "Оверлей",
      POST_AND_CORE: "Штифт + культя",
      FILLING: "Пломба",
      TEMP_FILLING: "Временная пломба",
      FILLING_REPLACEMENT_OR_REMOVAL: "Замена / снятие пломбы",
      ROOT_CANAL_TREATMENT: "Лечение корневых каналов",
      ROOT_CANAL_RETREATMENT: "Повторное лечение каналов",
      CANAL_OPENING: "Распломбировка / доступ",
      CANAL_FILLING: "Пломбирование каналов",
      EXTRACTION: "Удаление зуба",
      SURGICAL_EXTRACTION: "Хирургическое удаление",
      APICAL_RESECTION: "Апикальная резекция",
      IMPLANT: "Имплантат",
      HEALING_ABUTMENT: "Формирователь десны",
      IMPLANT_CROWN: "Коронка на импланте",
      WHITENING: "Отбеливание",
      ALL_ON_4: "All-on-4",
      ALL_ON_6: "All-on-6",
      OTHER: "Прочее",
    },
  },
  ka: {
    category: {
      EVENTS: "შეხვედრები / დიაგნოსტიკა",
      PROSTHETIC: "პროთეტიკა",
      RESTORATIVE: "რესტავრაცია",
      ENDODONTIC: "ენდოდონტია",
      SURGICAL: "ქირურგია",
      IMPLANT: "იმპლანტაცია",
    },
    type: {
      CONSULT: "კონსულტაცია",
      XRAY: "რენტგენი",
      PANORAMIC_XRAY: "პანორამული რენტგენი",
      CROWN: "კაპი",
      TEMP_CROWN: "დროებითი კაპი",
      BRIDGE_UNIT: "ხიდი – კბილის ერთეული",
      TEMP_BRIDGE_UNIT: "დროებითი ხიდი – კბილის ერთეული",
      CROWN_REPLACEMENT: "კაპის განახლება / ჩანაცვლება",
      BRIDGE_REPLACEMENT_OR_REMOVAL: "ხიდის ჩანაცვლება / აღება",
      INLAY: "ინლეი",
      ONLAY: "ონლეი",
      VENEER: "ვინირი",
      OVERLAY: "ოვერლეი",
      POST_AND_CORE: "პოსტი და ბირთვი",
      FILLING: "შევსება",
      TEMP_FILLING: "დროებითი შევსება",
      FILLING_REPLACEMENT_OR_REMOVAL: "შევსების ჩანაცვლება / აღება",
      ROOT_CANAL_TREATMENT: "ანქების მკურნალობა",
      ROOT_CANAL_RETREATMENT: "განმეორებითი ანქების მკურნალობა",
      CANAL_OPENING: "კავიტეტის გახსნა",
      CANAL_FILLING: "კავიტეტის შევსება",
      EXTRACTION: "განკვეთა",
      SURGICAL_EXTRACTION: "ქირურგიული განკვეთა",
      APICAL_RESECTION: "აპიკული რეზექცია",
      IMPLANT: "იმპლანტი",
      HEALING_ABUTMENT: "განკურნების აბუტმენტი",
      IMPLANT_CROWN: "იმპლანტზე კაპი",
      WHITENING: "გათეთრება",
      ALL_ON_4: "All-on-4",
      ALL_ON_6: "All-on-6",
      OTHER: "სხვა",
    },
  },
};

/**
 * @param {string} [lang]
 * @returns {{ type: string, name: string, category: ProcedureCategory }[]}
 */
function getLocalizedProcedureTypes(lang) {
  const L = normalizeProcedureLang(lang);
  const en = PROCEDURE_I18N.en;
  const pack = PROCEDURE_I18N[L] || en;
  const tEn = en.type || {};
  const tLoc = pack.type || {};
  return PROCEDURE_TYPES.map((p) => {
    const type = p.type;
    return {
      type,
      name: tLoc[type] || tEn[type] || type,
      category: p.category,
    };
  });
}

/**
 * @param {string} [lang]
 * @returns {Record<string, string>}
 */
function getLocalizedCategoryLabels(lang) {
  const L = normalizeProcedureLang(lang);
  const pack = PROCEDURE_I18N[L] || PROCEDURE_I18N.en;
  return { ...(pack.category || PROCEDURE_I18N.en.category) };
}

/**
 * @param {string} type — procedure type code
 * @returns {{ en: string, tr: string, ru: string, ka: string }}
 */
function getMultilingualTypeName(type) {
  const t = String(type || "").toUpperCase();
  const en = PROCEDURE_I18N.en.type[t] || t;
  return {
    en: PROCEDURE_I18N.en.type[t] || en,
    tr: PROCEDURE_I18N.tr.type[t] || en,
    ru: PROCEDURE_I18N.ru.type[t] || en,
    ka: PROCEDURE_I18N.ka.type[t] || en,
  };
}

/** Backend + `/api/debug/procedures` — one row per type; `name` is the multilingual object (not a mixed string). */
const PROCEDURES = PROCEDURE_TYPES.map((p) => ({
  id: p.type,
  type: p.type,
  category: p.category,
  name: getMultilingualTypeName(p.type),
}));

/**
 * @returns {Record<string, { en: string, tr: string, ru: string, ka: string }>}
 */
function getCategoryLabelsI18n() {
  const keys = ["EVENTS", "PROSTHETIC", "RESTORATIVE", "ENDODONTIC", "SURGICAL", "IMPLANT"];
  const out = {};
  for (const k of keys) {
    const en = PROCEDURE_I18N.en.category[k] || k;
    out[k] = {
      en: PROCEDURE_I18N.en.category[k] || en,
      tr: PROCEDURE_I18N.tr.category[k] || en,
      ru: PROCEDURE_I18N.ru.category[k] || en,
      ka: PROCEDURE_I18N.ka.category[k] || en,
    };
  }
  return out;
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
  normalizeProcedureLang,
  safeLang,
  getLocalizedProcedureTypes,
  getLocalizedCategoryLabels,
  getMultilingualTypeName,
  getCategoryLabelsI18n,
  PROCEDURE_I18N,
  PROCEDURES,
};


