"use strict";

const { canonicalPatientIdForTimeline } = require("./supabase.js");
const procedures = require("../shared/procedures.js");

const UUID_CORE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const P_PREFIX_UUID =
  /^p_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function trimStr(v) {
  if (v == null || v === "") return "";
  return String(v).trim();
}

/** Bare lowercase UUID; empty string if input is not UUID-shaped (`p_<uuid>` accepted). */
function canonicalBareUuid(s) {
  const raw = trimStr(s);
  if (!raw) return "";
  const m = P_PREFIX_UUID.exec(raw);
  if (m) return m[1].toLowerCase();
  if (UUID_CORE.test(raw)) return raw.toLowerCase();
  return "";
}

/**
 * Canonical procedure/event identifier: pure UUID / p_<uuid> → lowercase bare UUID.
 * Composite slugs retain prefix; trailing UUID segment lowercased when present.
 */
function normalizeTimelineProcedureId(raw) {
  const t = trimStr(raw);
  if (!t) return t;
  const pure = canonicalBareUuid(t);
  if (pure) return pure;
  const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const m = re.exec(t);
  if (!m) return t;
  const idx = m.index;
  const prefix = t.slice(0, idx);
  const suf = t.slice(idx);
  if (UUID_CORE.test(suf)) return prefix + suf.toLowerCase();
  return t;
}

const META_ID_KEYS = [
  "encounter_id",
  "encounterId",
  "treatment_plan_id",
  "treatmentPlanId",
  "plan_id",
  "planId",
];

function normalizeMetaUuidFields(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
  const next = { ...meta };
  for (const key of META_ID_KEYS) {
    if (next[key] == null || next[key] === "") continue;
    const c = canonicalBareUuid(next[key]);
    if (c) next[key] = c;
  }
  return next;
}

/**
 * Single ingress point: normalize ids, clinic, status, meta BEFORE range / membership / dedupe.
 * @param {Record<string, any>} evt
 * @param {{ defaultClinicId?: string }} [opts]
 */
function normalizeAdminTimelineEventForIngest(evt, opts = {}) {
  if (!evt || typeof evt !== "object") return evt;
  const out = { ...evt };
  const defClinic = trimStr(opts.defaultClinicId);

  const pid = canonicalPatientIdForTimeline(out.patientId);
  if (pid) out.patientId = pid;

  const clinic = trimStr(out.clinicId || out.clinic_id) || defClinic;
  if (clinic) {
    out.clinicId = clinic;
    out.clinic_id = clinic;
  }

  if (out.id != null && trimStr(out.id) !== "") {
    out.id = normalizeTimelineProcedureId(trimStr(out.id));
  }
  if (out.procedureId != null && trimStr(out.procedureId) !== "") {
    out.procedureId = normalizeTimelineProcedureId(trimStr(out.procedureId));
  }

  const enc = trimStr(out.encounterId || out.encounter_id);
  if (enc) {
    const c = canonicalBareUuid(enc);
    const v = c || enc;
    out.encounterId = v;
    out.encounter_id = v;
  }

  const planRaw = trimStr(out.treatmentPlanId || out.treatment_plan_id);
  if (planRaw) {
    const c = canonicalBareUuid(planRaw);
    const v = c || planRaw;
    out.treatmentPlanId = v;
    out.treatment_plan_id = v;
  }

  const tl = trimStr(out.timelineAt || out.timeline_at);
  if (tl) {
    out.timelineAt = tl;
    out.timeline_at = tl;
  }

  if (out.meta && typeof out.meta === "object" && !Array.isArray(out.meta)) {
    out.meta = normalizeMetaUuidFields(out.meta);
  }

  out.status = procedures.normalizeStatus(out.status);
  return out;
}

/**
 * After resolving ISO instant: align calendar date fields for range/dashboard bucket logic.
 */
function finalizeAdminTimelineAfterIso(evt, iso, tsParsed) {
  if (!evt || typeof evt !== "object") return evt;
  const out = { ...evt };
  const ts = Number(tsParsed);

  out.timelineAt = iso;
  if (out.timeline_at != null || evt.timeline_at) out.timeline_at = iso;

  out.timestamp =
    Number.isFinite(ts) && ts > 0 ? ts : (Number(out.timestamp) || 0);

  const isoDay =
    Number.isFinite(ts) && ts > 0
      ? new Date(ts).toISOString().slice(0, 10)
      : "";

  const d = trimStr(out.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) && isoDay) {
    out.date = isoDay;
  }

  const sd = trimStr(out.scheduledDate || out.scheduled_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) && isoDay) {
    out.scheduledDate = isoDay;
    out.scheduled_date = isoDay;
  }

  out.status = procedures.normalizeStatus(out.status);
  return out;
}

function timelineDebugProcedureIdentity(evt) {
  if (!evt || typeof evt !== "object") return "";
  const a = normalizeTimelineProcedureId(
    trimStr(evt.id ?? evt.procedureId ?? "")
  );
  return a || trimStr(evt.id ?? evt.procedureId ?? "");
}

module.exports = {
  canonicalBareUuid,
  normalizeTimelineProcedureId,
  normalizeAdminTimelineEventForIngest,
  finalizeAdminTimelineAfterIso,
  timelineDebugProcedureIdentity,
};
