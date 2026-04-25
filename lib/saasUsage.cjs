'use strict';

/**
 * Usage metrics for SaaS limits — derived from Supabase where possible.
 * All counts MUST be scoped by clinic_id to avoid cross-tenant leakage.
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

function isNoSuchRelation(err) {
  const c = String(err?.code || '');
  const msg = String(err?.message || '');
  return c === '42P01' || c === 'PGRST204' || c === 'PGRST205' || msg.includes('does not exist') || msg.includes('Could not find the table');
}

function isMissingColumn(err) {
  const c = String(err?.code || '');
  return c === '42703' || c === 'PGRST204' || c === 'PGRST205';
}

/**
 * Open / active treatment rows for this clinic only.
 * Prefers `treatments` (clinic_id); falls back to encounter_treatments via clinic patients/encounters.
 */
async function countActiveTreatmentsForClinic(supabase, clinicId) {
  if (!supabase || !clinicId) return 0;
  const cid = String(clinicId).trim();
  if (!cid) return 0;
  try {
    const tq = supabase
      .from('treatments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid)
      .or('status.eq.planned,status.eq.scheduled,status.eq.active,status.eq.in_progress,status.eq.SCHEDULED,status.eq.ACTIVE,status.eq.PLANNED');
    const { count: tCount, error: tErr } = await tq;
    if (!tErr && tCount != null && tCount > 0) return tCount;

    const { data: patients, error: pErr } = await supabase
      .from('patients')
      .select('id')
      .eq('clinic_id', cid);
    if (pErr || !patients?.length) return 0;

    const patientIds = [...new Set(patients.map((p) => p.id).filter(Boolean))];
    if (!patientIds.length) return 0;

    let encounterIds = [];
    for (const part of chunk(patientIds, 80)) {
      if (!part.length) continue;
      const withC = await supabase
        .from('patient_encounters')
        .select('id')
        .in('patient_id', part)
        .eq('clinic_id', cid);
      if (!withC.error && withC.data?.length) {
        encounterIds.push(...withC.data.map((e) => e.id).filter(Boolean));
        continue;
      }
      if (withC.error && isMissingColumn(withC.error)) {
        const { data: encs, error: eErr } = await supabase
          .from('patient_encounters')
          .select('id')
          .in('patient_id', part);
        if (!eErr && encs?.length) {
          encounterIds.push(...encs.map((e) => e.id).filter(Boolean));
        }
        continue;
      }
      if (!withC.error && withC.data) {
        encounterIds.push(...withC.data.map((e) => e.id).filter(Boolean));
      }
    }
    encounterIds = [...new Set(encounterIds)];
    if (!encounterIds.length) return 0;

    let total = 0;
    for (const part of chunk(encounterIds, 50)) {
      if (!part.length) continue;
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

async function countFromPatientFiles(supabase, clinicId, monthStartIso, monthEndIso) {
  const { count, error } = await supabase
    .from('patient_files')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .gte('created_at', monthStartIso)
    .lt('created_at', monthEndIso);
  if (!error && count != null) return count;

  const { data: patients } = await supabase.from('patients').select('id').eq('clinic_id', clinicId);
  const ids = (patients || []).map((p) => p.id).filter(Boolean);
  if (!ids.length) return 0;
  let sum = 0;
  for (const part of chunk(ids, 80)) {
    if (!part.length) continue;
    const { count: c, error: e2 } = await supabase
      .from('patient_files')
      .select('id', { count: 'exact', head: true })
      .in('patient_id', part)
      .gte('created_at', monthStartIso)
      .lt('created_at', monthEndIso);
    if (!e2 && c != null) sum += c;
  }
  return sum;
}

/**
 * Monthly file uploads in the current calendar month (UTC), scoped to clinic.
 * Tries `uploads` then `patient_files`.
 */
async function countMonthlyUploadsForClinic(supabase, clinicId, monthStartIso, monthEndIso) {
  if (!supabase || !clinicId || !monthStartIso || !monthEndIso) return 0;
  const cid = String(clinicId).trim();
  if (!cid) return 0;
  try {
    const uq = supabase
      .from('uploads')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid)
      .gte('created_at', monthStartIso)
      .lt('created_at', monthEndIso);
    const { count, error } = await uq;
    if (!error && count != null) return count;
    if (error && !isNoSuchRelation(error)) {
      // uploads exists but another error: fall back to patient_files
    }

    return await countFromPatientFiles(supabase, cid, monthStartIso, monthEndIso);
  } catch {
    return 0;
  }
}

/** @deprecated use countMonthlyUploadsForClinic */
const countMonthlyPatientFileUploadsForClinic = countMonthlyUploadsForClinic;

/**
 * Referral invites in the current calendar month, scoped to clinic_id only.
 */
async function countMonthlyReferralInvitesForClinic(supabase, clinicId, _clinicCode, monthStartIso, monthEndIso) {
  if (!supabase || !clinicId || !monthStartIso || !monthEndIso) return 0;
  const cid = String(clinicId).trim();
  if (!cid) return 0;
  try {
    const { count, error } = await supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid)
      .gte('created_at', monthStartIso)
      .lt('created_at', monthEndIso);
    if (error) return 0;
    return count != null ? count : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  currentUtcMonthRange,
  countActiveTreatmentsForClinic,
  countMonthlyUploadsForClinic,
  countMonthlyPatientFileUploadsForClinic,
  countMonthlyReferralInvitesForClinic,
};
