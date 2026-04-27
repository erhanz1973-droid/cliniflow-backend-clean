'use strict';

/**
 * Usage metrics for SaaS limits — derived from Supabase where possible.
 * All counts MUST be scoped by clinic_id. No patient_id / encounter_id fallbacks without clinic_id.
 */

const BILLING_COUNT_TIMEOUT_MS = 5000;

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

/**
 * Races a promise with a timeout. Does not abort the underlying request.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
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

const ACTIVE_TREATMENT_STATUSES = Object.freeze(['planned', 'scheduled', 'active', 'in_progress']);

/**
 * @param {() => Promise<{ count?: number | null, error?: object }>} buildQuery
 * @param {string} label
 * @returns {Promise<{ value: number, error: boolean }>}
 */
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
 * @returns {Promise<{ value: number, error: boolean }>}
 */
async function countActiveTreatmentsForClinic(supabase, clinicId) {
  const t0 = Date.now();
  if (!supabase || !clinicId) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
  if (!cid) {
    console.error('🚨 billing usage called without clinicId');
    return { value: 0, error: true };
  }
  try {
    const { count, error } = await supabase
      .from('treatments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid)
      .in('status', ACTIVE_TREATMENT_STATUSES);

    if (!error && count != null) {
      console.log('COUNT TIMING:', 'treatments_active', Date.now() - t0);
      return { value: count, error: false };
    }
    if (error) {
      console.error('SUPABASE ERROR: treatments_active', error);
    }
  } catch (e) {
    console.error('CRASH: treatments_active', e);
  }

  try {
    const { data, error } = await supabase
      .from('treatments')
      .select('id')
      .eq('clinic_id', cid)
      .in('status', ACTIVE_TREATMENT_STATUSES);
    if (error) {
      console.error('SUPABASE ERROR (fallback): treatments_active', error);
      return { value: 0, error: true };
    }
    console.log('COUNT TIMING:', 'treatments_active', Date.now() - t0);
    return { value: data?.length || 0, error: false };
  } catch (e) {
    console.error('CRASH: treatments_active (fallback)', e);
    return { value: 0, error: true };
  }
}

/**
 * @returns {Promise<{ value: number, error: boolean }>}
 */
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

/**
 * @returns {Promise<{ value: number, error: boolean }>}
 */
async function countMonthlyUploadsForClinic(supabase, clinicId, _monthStartIso, _monthEndIso) {
  const t0 = Date.now();
  if (!supabase || !clinicId) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
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
  if (u.value > 0) {
    console.log('COUNT TIMING:', 'uploads_monthly_total', Date.now() - t0);
    return { value: u.value, error: !!u.error };
  }
  const p = await countFromPatientFiles(supabase, cid, start, end);
  if (p.value > 0) {
    console.log('COUNT TIMING:', 'uploads_monthly_total', Date.now() - t0);
    return { value: p.value, error: !!p.error };
  }
  const out = { value: 0, error: u.error || p.error };
  console.log('COUNT TIMING:', 'uploads_monthly_total', Date.now() - t0);
  return out;
}

/** @deprecated use countMonthlyUploadsForClinic */
const countMonthlyPatientFileUploadsForClinic = countMonthlyUploadsForClinic;

/**
 * @returns {Promise<{ value: number, error: boolean }>}
 */
async function countMonthlyReferralInvitesForClinic(supabase, clinicId, _clinicCode, _monthStartIso, _monthEndIso) {
  const t0 = Date.now();
  if (!supabase || !clinicId) {
    return { value: 0, error: true };
  }
  const cid = String(clinicId).trim();
  if (!cid) {
    console.error('🚨 billing usage called without clinicId');
    return { value: 0, error: true };
  }
  const { start, end } = currentUtcMonthRange();
  const out = await safeCount(
    () =>
      supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', cid)
        .gte('created_at', start)
        .lt('created_at', end),
    'referrals_monthly'
  );
  console.log('COUNT TIMING:', 'referrals_monthly', Date.now() - t0);
  return out;
}

module.exports = {
  BILLING_COUNT_TIMEOUT_MS,
  currentUtcMonthRange,
  withTimeout,
  safeCount,
  countActiveTreatmentsForClinic,
  countMonthlyUploadsForClinic,
  countMonthlyPatientFileUploadsForClinic,
  countMonthlyReferralInvitesForClinic,
};
