'use strict';

/**
 * Usage metrics for SaaS limits — derived from Supabase where possible.
 * Counts are clinic-scoped; patient_id fallbacks use the same FK expansion as timeline
 * (bare UUID + p_<uuid>) so mobile/admin rows are not invisible when clinic_id is null.
 */

const BILLING_COUNT_TIMEOUT_MS = 5000;

const { patientFkInClauseKeysFromPatientRow, fetchReferralsRawForAdminClinic } = require('./supabase.js');

/** Matches legacy lowercase ENUMs + admin/mobile uppercase + common synonyms. */
const ACTIVE_TREATMENT_STATUSES_INCLUSIVE = Object.freeze([
  'planned',
  'scheduled',
  'active',
  'in_progress',
  'pending',
  'assigned',
  'proposed',
  'waiting',
  'confirmed',
  'open',
  'new',
  'started',
  'running',
  'draft',
  'booked',
  'PLANNED',
  'SCHEDULED',
  'ACTIVE',
  'IN_PROGRESS',
  'IN PROGRESS',
  'PENDING',
  'ASSIGNED',
  'PROPOSED',
  'WAITING',
  'CONFIRMED',
  'OPEN',
  'NEW',
  'STARTED',
  'RUNNING',
  'DRAFT',
  'BOOKED',
]);

const TERMINAL_ENCOUNTER_STATUSES = new Set([
  'completed',
  'cancelled',
  'canceled',
  'done',
  'closed',
  'COMPLETE',
  'CLOSED',
  'COMPLETED',
  'CANCELLED',
  'CANCELED',
  'DONE',
]);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** UTC calendar month [start, end) — always use for billing date windows (never local midnight). */
function currentUtcMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
  };
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      console.warn('TIMEOUT HIT:', label);
      reject(
        Object.assign(new Error(`Timeout: ${label}`), {
          isTimeout: true,
        })
      );
    }, ms);
  });

  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeout]);
}

async function safeCount(buildQuery, label) {
  try {
    const { count, error } = await buildQuery();
    if (error) {
      console.error('SUPABASE ERROR:', label, error);
      return { value: 0, error: true };
    }
    return { value: count != null ? count : 0, error: false };
  } catch (e) {
    console.error('CRASH:', label, e);
    return { value: 0, error: true };
  }
}

/**
 * All patient_id / id lookup keys for patients in this clinic (for orphan row joins).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} clinicUuid
 * @param {string} [clinicCodeUpper]
 */
async function fetchClinicPatientFkKeysForMetrics(supabase, clinicUuid, clinicCodeUpper) {
  const out = new Set();
  const pageSize = 800;
  const ingest = (rows) => {
    for (const r of rows || []) {
      for (const k of patientFkInClauseKeysFromPatientRow(r?.id, r?.patient_id)) out.add(k);
    }
  };
  try {
    for (let off = 0; off < 32000; off += pageSize) {
      const { data, error } = await supabase
        .from('patients')
        .select('id, patient_id')
        .eq('clinic_id', clinicUuid)
        .range(off, off + pageSize - 1);
      if (error) break;
      const rows = data || [];
      ingest(rows);
      if (rows.length < pageSize) break;
    }
  } catch (_) {}
  const codeUp = clinicCodeUpper != null ? String(clinicCodeUpper).trim().toUpperCase() : '';
  if (!codeUp) return out;
  try {
    for (let off2 = 0; off2 < 32000; off2 += pageSize) {
      const { data, error } = await supabase
        .from('patients')
        .select('id, patient_id')
        .eq('clinic_code', codeUp)
        .range(off2, off2 + pageSize - 1);
      if (error) break;
      const rows = data || [];
      ingest(rows);
      if (rows.length < pageSize) break;
    }
  } catch (_) {}
  return out;
}

/**
 * patient_files uploads in UTC month whose clinic_id is unset but patient belongs to clinic.
 */
async function countMonthlyPatientFilesOrphanForClinic(
  supabase,
  clinicUuid,
  monthStartIso,
  monthEndIso,
  clinicCodeUpper
) {
  const keys = [...(await fetchClinicPatientFkKeysForMetrics(supabase, clinicUuid, clinicCodeUpper))].filter(Boolean);
  if (!keys.length) return { value: 0, error: false };
  let sum = 0;
  let anyErr = false;
  for (const part of chunk(keys, 100)) {
    const { count, error } = await supabase
      .from('patient_files')
      .select('id', { count: 'exact', head: true })
      .is('clinic_id', null)
      .in('patient_id', part)
      .gte('created_at', monthStartIso)
      .lt('created_at', monthEndIso);
    if (error) {
      if (!['42P01', 'PGRST205', 'PGRST204'].includes(String(error.code || ''))) anyErr = true;
      continue;
    }
    sum += count != null ? count : 0;
  }
  return { value: sum, error: anyErr };
}

async function countActiveTreatmentsTable(supabase, cid) {
  const { count, error } = await supabase
    .from('treatments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', cid)
    .in('status', [...ACTIVE_TREATMENT_STATUSES_INCLUSIVE]);

  if (!error && count != null) {
    let total = count;
    if (total === 0) {
      const { count: cNull, error: eNull } = await supabase
        .from('treatments')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', cid)
        .is('status', null);
      if (!eNull && cNull) total += cNull;
    }
    return { value: total, error: false };
  }

  try {
    const { data: rows, error: e2 } = await supabase
      .from('treatments')
      .select('id')
      .eq('clinic_id', cid)
      .in('status', [...ACTIVE_TREATMENT_STATUSES_INCLUSIVE]);
    if (e2 && !['42P01', 'PGRST205', 'PGRST204'].includes(String(e2.code || ''))) {
      return { value: 0, error: true };
    }
    let v2 = rows?.length || 0;
    if (v2 === 0 && !e2) {
      const { data: rowsNull, error: eN } = await supabase
        .from('treatments')
        .select('id')
        .eq('clinic_id', cid)
        .is('status', null);
      if (!eN && rowsNull?.length) v2 = rowsNull.length;
    }
    return { value: v2, error: !!e2 };
  } catch (_) {
    return { value: 0, error: !!error };
  }
}

async function countActiveEncounterTreatmentsForClinic(supabase, cid) {
  let encIds = [];
  try {
    const { data, error } = await supabase
      .from('patient_encounters')
      .select('id')
      .eq('clinic_id', cid)
      .limit(8000);
    if (!error && data?.length) {
      encIds = data.map((r) => String(r?.id || '').trim()).filter(Boolean);
    }
  } catch (_) {
    return { value: 0, error: true };
  }
  if (!encIds.length) return { value: 0, error: false };

  let total = 0;
  let anyErr = false;
  for (const part of chunk(encIds, 120)) {
    try {
      const { data: rows, error } = await supabase
        .from('encounter_treatments')
        .select('status')
        .in('encounter_id', part);
      if (error) {
        if (!['42P01', 'PGRST205', 'PGRST204'].includes(String(error.code || ''))) anyErr = true;
        continue;
      }
      for (const r of rows || []) {
        const st = String(r?.status || '').trim();
        const low = st.toLowerCase().replace(/-/g, '_');
        if (
          TERMINAL_ENCOUNTER_STATUSES.has(low) ||
          TERMINAL_ENCOUNTER_STATUSES.has(st) ||
          low === 'complete'
        )
          continue;
        total += 1;
      }
    } catch (_) {
      anyErr = true;
    }
  }
  return { value: total, error: anyErr };
}

async function countPatientTreatmentsActiveRowsForClinic(supabase, cid, clinicCodeUpper) {
  const { count, error } = await supabase
    .from('patient_treatments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', cid);
  if (!error && count != null && count > 0) {
    return { value: count, error: false };
  }

  const keys = [...(await fetchClinicPatientFkKeysForMetrics(supabase, cid, clinicCodeUpper))];
  const fkVariants = [...new Set(keys.flatMap((k) => [...patientFkInClauseKeysFromPatientRow(k, '')]))];
  if (!fkVariants.length) return { value: 0, error: !!error };

  let sum = 0;
  let anyErr = !!error;
  for (const part of chunk(fkVariants, 80)) {
    const { count: c2, error: e2 } = await supabase
      .from('patient_treatments')
      .select('id', { count: 'exact', head: true })
      .is('clinic_id', null)
      .in('patient_id', part);
    if (e2) {
      if (!['42P01', 'PGRST205', 'PGRST204'].includes(String(e2.code || ''))) anyErr = true;
      continue;
    }
    sum += c2 != null ? c2 : 0;
  }
  return { value: sum, error: anyErr };
}

async function countActiveTreatmentsForClinic(supabase, clinicId, opts = {}) {
  const t0 = Date.now();
  if (!supabase || !clinicId) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
  const codeUp =
    opts && opts.clinicCode != null ? String(opts.clinicCode).trim().toUpperCase() : '';
  if (!cid) {
    console.error('🚨 billing usage called without clinicId');
    return { value: 0, error: true };
  }

  const a = await countActiveTreatmentsTable(supabase, cid);
  const b = await countActiveEncounterTreatmentsForClinic(supabase, cid);
  const useC = Number(a.value || 0) + Number(b.value || 0) === 0;
  const c = useC ? await countPatientTreatmentsActiveRowsForClinic(supabase, cid, codeUp || undefined) : { value: 0, error: false };

  const value = Number(a.value || 0) + Number(b.value || 0) + Number(useC ? (c.value || 0) : 0);

  const diagPayload = {
    clinicId: cid,
    treatmentsTable: a.value,
    encounterTreatments: b.value,
    patientTreatmentsFallback: useC ? c.value : null,
    statusesEnum: [...ACTIVE_TREATMENT_STATUSES_INCLUSIVE],
  };

  console.log('COUNT TIMING:', 'usage_active_treatments_combined', Date.now() - t0, diagPayload);

  if (opts && opts.logRowsSample === true) {
    try {
      const { data: rowsSample } = await supabase
        .from('treatments')
        .select('id,status,created_at')
        .eq('clinic_id', cid)
        .order('created_at', { ascending: false })
        .limit(8);
      console.log('[saasUsage] active_treatments rowsSample', { clinicId: cid, rowsSample });
    } catch (_) {}
  }

  const err =
    value === 0 && !!(a.error && b.error && (useC ? c.error : true));
  return { value, error: err };
}

async function countFromPatientFiles(supabase, clinicId, monthStartIso, monthEndIso) {
  const t0 = Date.now();
  if (!supabase || !clinicId || !monthStartIso || !monthEndIso) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
  if (!cid) {
    console.error('🚨 billing usage called without clinicId');
    return { value: 0, error: true };
  }
  const out = await safeCount(
    () =>
      supabase
        .from('patient_files')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', cid)
        .gte('created_at', monthStartIso)
        .lt('created_at', monthEndIso),
    'patient_files_monthly'
  );
  console.log('COUNT TIMING:', 'patient_files_monthly', Date.now() - t0);
  return out;
}

async function countMonthlyUploadsForClinic(supabase, clinicId, arg3, arg4) {
  const t0 = Date.now();
  if (!supabase || !clinicId) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
  const opts =
    arg3 &&
    typeof arg3 === 'object' &&
    !Array.isArray(arg3) &&
    (Object.prototype.hasOwnProperty.call(arg3, 'clinicCode') ||
      (Object.prototype.hasOwnProperty.call(arg3, 'monthStartIso') &&
        Object.prototype.hasOwnProperty.call(arg3, 'monthEndIso')))
      ? arg3
      : {};
  const codeUp =
    opts.clinicCode != null ? String(opts.clinicCode).trim().toUpperCase() : '';
  if (!cid) {
    console.error('🚨 billing usage called without clinicId');
    return { value: 0, error: true };
  }

  const { start, end } = currentUtcMonthRange();

  const u = await safeCount(
    () =>
      supabase
        .from('uploads')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', cid)
        .gte('created_at', start)
        .lt('created_at', end),
    'uploads_monthly'
  );

  const p = await countFromPatientFiles(supabase, cid, start, end);
  const o = await countMonthlyPatientFilesOrphanForClinic(supabase, cid, start, end, codeUp || undefined);

  const sum = Number(u.value || 0) + Number(p.value || 0) + Number(o.value || 0);

  console.log('COUNT TIMING:', 'uploads_monthly_total', Date.now() - t0, {
    uploads_table: u.value,
    patient_files_scoped: p.value,
    patient_files_orphan_patient_join: o.value,
  });

  const errAll = !!(u.error && p.error && o.error);
  return { value: sum, error: errAll && sum === 0 };
}

/** @deprecated use countMonthlyUploadsForClinic */
const countMonthlyPatientFileUploadsForClinic = countMonthlyUploadsForClinic;

/** Rows from GET /api/admin/referrals Supabase scope with created_at in [period.start, period.end). Excludes soft-deleted. */
function countReferralInviteRowsInUtcMonth(rows, period) {
  const start = period && period.start;
  const end = period && period.end;
  if (!start || !end) return 0;
  let n = 0;
  for (const r of rows || []) {
    if (!r || r.deleted_at) continue;
    const ca = r.created_at;
    if (ca == null || ca === '') continue;
    let iso;
    if (typeof ca === 'string') iso = ca;
    else {
      try {
        iso = new Date(ca).toISOString();
      } catch (_) {
        continue;
      }
    }
    if (iso >= start && iso < end) n += 1;
  }
  return n;
}

async function countMonthlyReferralInvitesForClinic(supabase, clinicId, clinicCode, _monthStartIso, _monthEndIso) {
  const t0 = Date.now();
  if (!clinicId) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
  const codeRaw = clinicCode != null ? String(clinicCode).trim() : '';
  if (!cid) {
    console.error('🚨 billing usage called without clinicId');
    return { value: 0, error: true };
  }
  const period = currentUtcMonthRange();
  let rows = [];
  let fetchErr = false;
  try {
    rows = await fetchReferralsRawForAdminClinic(cid, codeRaw || null);
  } catch (e) {
    fetchErr = true;
    console.error('[saasUsage] referrals_monthly canonical fetch', e);
    rows = [];
  }
  const value = countReferralInviteRowsInUtcMonth(rows, period);
  console.log('COUNT TIMING:', 'referrals_monthly_admin_canonical', Date.now() - t0, {
    clinicId: cid,
    clinicCode: codeRaw || null,
    referralsListed: rows.length,
    referralsThisUtcMonth: value,
    utcStart: period.start,
    utcEnd: period.end,
  });
  return { value, error: fetchErr };
}

/**
 * Extra breakdown for ?debugUsage=1 on /api/clinic/usage (authenticated clinic admin).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} clinicUuid
 * @param {string|null|undefined} clinicCode
 * @param {{ start: string, end: string, label?: string }} period
 */
async function collectUsageDiagnostics(supabase, clinicUuid, clinicCode, period) {
  const cid = String(clinicUuid || '').trim();
  const codeUp = clinicCode != null ? String(clinicCode).trim().toUpperCase() : '';
  const { start, end } =
    period && period.start && period.end ? period : currentUtcMonthRange();
  const label = period && period.label != null ? String(period.label) : currentUtcMonthRange().label;
  const out = {
    clinicId: cid,
    clinicCodeUpper: codeUp || null,
    utcMonth: { start, end, label },
    activeTreatments: {},
    monthlyUploads: {},
    referrals: {},
  };
  if (!supabase || !cid) {
    out.error = 'missing_supabase_or_clinic';
    return out;
  }

  try {
    const [{ data: stSample, error: stErr }, { count: trTotal, error: trTErr }] = await Promise.all([
      supabase.from('treatments').select('id,status,created_at').eq('clinic_id', cid).limit(15),
      supabase.from('treatments').select('id', { count: 'exact', head: true }).eq('clinic_id', cid),
    ]);
    out.activeTreatments.rowsSample = stSample || [];
    out.activeTreatments.sampleError = stErr ? stErr.message : null;
    out.activeTreatments.treatmentsRowTotal = trTotal != null ? trTotal : null;
    out.activeTreatments.tableError = trTErr ? trTErr.message : null;
  } catch (e) {
    out.activeTreatments.catch = String(e && e.message ? e.message : e);
  }

  try {
    const [uTable, pfScoped, pfOrphan] = await Promise.all([
      safeCount(
        () =>
          supabase
            .from('uploads')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', cid)
            .gte('created_at', start)
            .lt('created_at', end),
        'diag_uploads'
      ),
      safeCount(
        () =>
          supabase
            .from('patient_files')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', cid)
            .gte('created_at', start)
            .lt('created_at', end),
        'diag_pf_created'
      ),
      countMonthlyPatientFilesOrphanForClinic(supabase, cid, start, end, codeUp || undefined),
    ]);
    out.monthlyUploads.uploads_table = uTable.value;
    out.monthlyUploads.patient_files_clinic_created_at = pfScoped.value;
    out.monthlyUploads.patient_files_orphan_join = pfOrphan.value;

    const { count: pfUpAt, error: pfUpErr } = await supabase
      .from('patient_files')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid)
      .gte('uploaded_at', start)
      .lt('uploaded_at', end);
    if (!pfUpErr) out.monthlyUploads.patient_files_clinic_uploaded_at = pfUpAt != null ? pfUpAt : 0;
    else if (!['42703', 'PGRST204'].includes(String(pfUpErr.code || '')))
      out.monthlyUploads.patient_files_uploaded_at_error = pfUpErr.message;
  } catch (e) {
    out.monthlyUploads.catch = String(e && e.message ? e.message : e);
  }

  try {
    const canonRows = await fetchReferralsRawForAdminClinic(cid, codeUp || null);
    out.referrals.canonicalSource = 'fetchReferralsRawForAdminClinic';
    out.referrals.referralsFound = canonRows.length;
    out.referrals.referralsThisMonth = countReferralInviteRowsInUtcMonth(canonRows, { start, end });
    out.referrals.utcStart = start;
    out.referrals.utcEnd = end;
    out.referrals.clinicId = cid;
  } catch (e) {
    out.referrals.catch = String(e && e.message ? e.message : e);
  }

  return out;
}

async function getActiveTreatmentsCount(clinicId, opts) {
  const { supabase } = require("./supabase");
  const r = await countActiveTreatmentsForClinic(supabase, clinicId, opts || {});
  return Number(r.value) || 0;
}

module.exports = {
  BILLING_COUNT_TIMEOUT_MS,
  ACTIVE_TREATMENT_STATUSES_INCLUSIVE,
  chunk,
  fetchClinicPatientFkKeysForMetrics,
  currentUtcMonthRange,
  countReferralInviteRowsInUtcMonth,
  withTimeout,
  safeCount,
  countActiveTreatmentsForClinic,
  countActiveEncounterTreatmentsForClinic,
  countActiveTreatmentsTable,
  getActiveTreatmentsCount,
  countMonthlyUploadsForClinic,
  countMonthlyPatientFilesOrphanForClinic,
  countMonthlyPatientFileUploadsForClinic,
  countMonthlyReferralInvitesForClinic,
  collectUsageDiagnostics,
};
