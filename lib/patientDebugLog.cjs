/**
 * Safe logging for patient-ish rows (avoid crashing on circular refs).
 */
"use strict";

function safeJsonForPatientLog(obj, maxBytes) {
  const cap = typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : 120000;
  try {
    const s = JSON.stringify(
      obj,
      (_k, v) => {
        if (v != null && typeof v === "object" && !Array.isArray(v) && v.constructor && v.constructor !== Object) {
          return "[Object]";
        }
        if (typeof v === "string" && v.length > 4000) return v.slice(0, 4000) + "…[truncated]";
        return v;
      },
      2
    );
    if (s.length > cap) return s.slice(0, cap) + "\n…[truncated " + (s.length - cap) + " bytes]";
    return s;
  } catch (e) {
    return "[patient log stringify failed: " + String(e && e.message ? e.message : e) + "]";
  }
}

function logPatientDebug(label, patientLike) {
  try {
    console.log("PATIENT DEBUG [" + String(label || "") + "]:", safeJsonForPatientLog(patientLike));
  } catch (e) {
    console.warn("PATIENT DEBUG log failed:", e && e.message ? e.message : e);
  }
}

function warnInvalidPatientData(patientLike, reason) {
  const id =
    patientLike &&
    (patientLike.id != null ? patientLike.id : patientLike.patient_id != null ? patientLike.patient_id : null);
  console.warn("INVALID PATIENT DATA:", id != null ? id : "(unknown id)", reason || "");
}

module.exports = { logPatientDebug, warnInvalidPatientData, safeJsonForPatientLog };
