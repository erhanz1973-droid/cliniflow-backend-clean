'use strict';

/**
 * Usage metrics for SaaS limits — derived from Supabase where possible.
 */

function currentUtcMonthRange(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Open treatment rows on encounter_treatments (DB uses lowercase statuses). */
async function countActiveTreatmentsForClinic(supabase, clinicId) {
  if (!supabase || !clinicId) return 0;
  try {
    const { data: patients, error: pErr } = await supabase
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId);
    if (pErr || !patients?.length) return 0;

    const patientIds = [...new Set(patients.map((p) => p.id).filter(Boolean))];
    let encounterIds = [];
    for (const part of chunk(patientIds, 80)) {
      const { data: encs, error: eErr } = await supabase
        .from('patient_encounters')
        .select('id')
        .in('patient_id', part);
      if (!eErr && encs?.length) {
        encounterIds.push(...encs.map((e) => e.id).filter(Boolean));
      }
    }
    encounterIds = [...new Set(encounterIds)];
    if (!encounterIds.length) return 0;

    let total = 0;
    for (const part of chunk(encounterIds, 50)) {
      const { count, error } = await supabase
        .from('encounter_treatments')
        .select('id', { count: 'exact', head: true })
        .in('encounter_id', part)
        .or('status.eq.planned,status.eq.scheduled,status.eq.active');
      if (!error && count != null) total += count;
    }
    return total;
  } catch {
    return 0;
  }
}

async function countMonthlyPatientFileUploadsForClinic(supabase, clinicId, monthStartIso) {
  if (!supabase || !clinicId || !monthStartIso) return 0;
  try {
    const { count, error } = await supabase
      .from('patient_files')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('created_at', monthStartIso);
    if (!error && count != null) return count;

    const { data: patients } = await supabase.from('patients').select('id').eq('clinic_id', clinicId);
    const ids = (patients || []).map((p) => p.id).filter(Boolean);
    if (!ids.length) return 0;
    let sum = 0;
    for (const part of chunk(ids, 80)) {
      const { count: c, error: e2 } = await supabase
        .from('patient_files')
        .select('id', { count: 'exact', head: true })
        .in('patient_id', part)
        .gte('created_at', monthStartIso);
      if (!e2 && c != null) sum += c;
    }
    return sum;
  } catch {
    return 0;
  }
}

async function countMonthlyReferralInvitesForClinic(supabase, clinicId, clinicCode, monthStartIso) {
  if (!supabase || !monthStartIso) return 0;
  try {
    if (clinicId) {
      const { count, error } = await supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('created_at', monthStartIso);
      if (!error && count != null) return count;
    }
    if (clinicCode) {
      const { count, error } = await supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_code', String(clinicCode).toUpperCase())
        .gte('created_at', monthStartIso);
      if (!error && count != null) return count;
    }
    return 0;
  } catch {
    return 0;
  }
}

module.exports = {
  currentUtcMonthRange,
  countActiveTreatmentsForClinic,
  countMonthlyPatientFileUploadsForClinic,
  countMonthlyReferralInvitesForClinic,
};
