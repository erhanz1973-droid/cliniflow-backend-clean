'use strict';

const saasPlans = require('../shared/saasPlans');
const saasUsage = require('./saasUsage.cjs');
const billingUsageCache = require('./billingUsageCache.cjs');
const { supabase } = require('./supabase');

function limitsEnabled() {
  return String(process.env.SAAS_LIMITS_ENABLED || '1').trim() !== '0';
}

function planFromClinicRow(row) {
  return saasPlans.normalizePlanKey(row?.plan || row?.subscriptionPlan || 'FREE');
}

/**
 * @param {object} clinicRow
 * @param {{ activeTreatments: number, monthlyUploads: number, referralInvites: number }} usage
 * @param {{ start: string, end: string, label: string }} period
 */
function buildSnapshotFromUsage(clinicRow, usage, period) {
  const plan = planFromClinicRow(clinicRow);
  const limits = saasPlans.getLimitsForPlan(plan);
  const { activeTreatments, monthlyUploads, referralInvites } = usage;
  const dimensions = {
    active_treatments: {
      used: activeTreatments,
      limit: limits.activeTreatments,
      unlimited: limits.activeTreatments == null,
      ratio: saasPlans.usageRatio(activeTreatments, limits.activeTreatments),
      within: saasPlans.isWithinLimit(activeTreatments, limits.activeTreatments),
    },
    monthly_uploads: {
      used: monthlyUploads,
      limit: limits.monthlyUploads,
      unlimited: limits.monthlyUploads == null,
      ratio: saasPlans.usageRatio(monthlyUploads, limits.monthlyUploads),
      within: saasPlans.isWithinLimit(monthlyUploads, limits.monthlyUploads),
    },
    referral_invites: {
      used: referralInvites,
      limit: limits.referralInvites,
      unlimited: limits.referralInvites == null,
      ratio: saasPlans.usageRatio(referralInvites, limits.referralInvites),
      within: saasPlans.isWithinLimit(referralInvites, limits.referralInvites),
    },
    branding: {
      customAllowed: limits.branding === true,
    },
  };
  return {
    plan,
    period,
    limits: {
      activeTreatments: limits.activeTreatments,
      monthlyUploads: limits.monthlyUploads,
      referralInvites: limits.referralInvites,
      branding: limits.branding,
    },
    usage,
    dimensions,
  };
}

/** Same shape as getBillingSnapshot; usage all zeros (timeout / error fallback for HTTP). */
function getBillingSnapshotWithZeroUsage(clinicRow) {
  const period = saasUsage.currentUtcMonthRange();
  return buildSnapshotFromUsage(
    clinicRow || {},
    { activeTreatments: 0, monthlyUploads: 0, referralInvites: 0 },
    period
  );
}

/** @param {PromiseSettledResult<{ value: number, error: boolean, timeout?: boolean }>} r */
function extractSettledCount(r) {
  if (r.status === 'fulfilled') {
    const v = r.value;
    if (v && typeof v.value === 'number' && typeof v.error === 'boolean') {
      return { value: v.value, error: v.error, timeout: v.timeout === true };
    }
    return { value: 0, error: true, timeout: false };
  }
  return { value: 0, error: true, timeout: r.reason?.isTimeout === true };
}

/**
 * @param {object} clinicRow - clinics row
 * @param {string|null} clinicCode
 * @param {{ force?: boolean }} [options]
 */
async function getBillingSnapshot(supabase, clinicRow, clinicCode, explicitClinicId, options) {
  try {
    const period = saasUsage.currentUtcMonthRange();
    const fromExplicit = explicitClinicId != null && String(explicitClinicId).trim() !== '' ? String(explicitClinicId).trim() : null;
    const fromRow = clinicRow?.id != null ? String(clinicRow.id).trim() : null;
    const fromFile = clinicRow?._fileId != null ? String(clinicRow._fileId).trim() : null;
    const resolvedClinicId = fromExplicit || fromRow || fromFile || null;
    if (!resolvedClinicId || String(resolvedClinicId).trim() === '') {
      return getBillingSnapshotWithZeroUsage(clinicRow);
    }
    const cid = String(resolvedClinicId).trim();
    if (options && options.force) {
      billingUsageCache.invalidateBillingUsageCache(cid);
    }
    const cached = billingUsageCache.getCachedBillingSnapshot(cid);
    if (cached) {
      console.log('USAGE CACHE HIT:', cid);
      return cached;
    }
    console.log('USAGE CACHE MISS:', cid);
    const code = clinicCode || clinicRow?.clinic_code || null;
    const t = saasUsage.BILLING_COUNT_TIMEOUT_MS;
    const t0 = Date.now();
    const c = (p) => p.catch(() => ({ value: 0, error: true, timeout: false }));

    const results = await Promise.allSettled([
      saasUsage.withTimeout(c(saasUsage.countActiveTreatmentsForClinic(supabase, cid)), t, 'treatments'),
      saasUsage.withTimeout(c(saasUsage.countMonthlyUploadsForClinic(supabase, cid, period.start, period.end)), t, 'uploads'),
      saasUsage.withTimeout(
        c(saasUsage.countMonthlyReferralInvitesForClinic(supabase, cid, code, period.start, period.end)),
        t,
        'referrals'
      ),
    ]);

    const tr = extractSettledCount(results[0]);
    const up = extractSettledCount(results[1]);
    const re = extractSettledCount(results[2]);

    console.log('USAGE RESULT:', {
      clinicId: cid,
      values: {
        treatments: tr.value,
        uploads: up.value,
        referrals: re.value,
      },
      errors: { treatments: tr.error, uploads: up.error, referrals: re.error },
      timeouts: {
        treatments: tr.timeout || false,
        uploads: up.timeout || false,
        referrals: re.timeout || false,
      },
      durationMs: Date.now() - t0,
    });

    const snapshot = buildSnapshotFromUsage(
      clinicRow,
      { activeTreatments: tr.value, monthlyUploads: up.value, referralInvites: re.value },
      period
    );
    billingUsageCache.setCachedBillingSnapshot(cid, snapshot);
    return snapshot;
  } catch (e) {
    console.error('getBillingSnapshot:', e);
    return getBillingSnapshotWithZeroUsage(clinicRow);
  }
}

function toHttpError(dimension, snapshot) {
  const dim = snapshot?.dimensions?.[dimension];
  const limit = dim?.limit;
  const used = dim?.used;
  return {
    ok: false,
    error: 'saas_limit_exceeded',
    dimension,
    plan: snapshot?.plan,
    used,
    limit,
    message:
      dimension === 'active_treatments'
        ? 'Active treatment limit reached for your plan. Upgrade to add more.'
        : dimension === 'monthly_uploads'
          ? 'Monthly upload limit reached. Upgrade or wait until next billing month.'
          : dimension === 'referral_invites'
            ? 'Monthly referral invite limit reached.'
            : 'Plan limit reached.',
  };
}

async function assertCanAddActiveTreatment(supabase, clinicRow) {
  if (!limitsEnabled()) return { ok: true, snapshot: null };
  const snap = await getBillingSnapshot(supabase, clinicRow, clinicRow?.clinic_code, clinicRow?.id || clinicRow?._fileId);
  const lim = snap.limits.activeTreatments;
  if (saasPlans.canConsume(snap.usage.activeTreatments, lim, 1)) {
    return { ok: true, snapshot: snap };
  }
  return { ok: false, snapshot: snap, response: toHttpError('active_treatments', snap) };
}

async function assertCanUploadFiles(supabase, clinicRow, fileCount = 1) {
  if (!limitsEnabled()) return { ok: true, snapshot: null };
  const snap = await getBillingSnapshot(supabase, clinicRow, clinicRow?.clinic_code, clinicRow?.id || clinicRow?._fileId);
  const lim = snap.limits.monthlyUploads;
  const n = Number(fileCount) > 0 ? Number(fileCount) : 1;
  if (saasPlans.canConsume(snap.usage.monthlyUploads, lim, n)) {
    return { ok: true, snapshot: snap };
  }
  return { ok: false, snapshot: snap, response: toHttpError('monthly_uploads', snap) };
}

async function assertCanCreateReferralInvite(supabase, clinicRow) {
  if (!limitsEnabled()) return { ok: true, snapshot: null };
  const snap = await getBillingSnapshot(supabase, clinicRow, clinicRow?.clinic_code, clinicRow?.id || clinicRow?._fileId);
  const lim = snap.limits.referralInvites;
  if (saasPlans.canConsume(snap.usage.referralInvites, lim, 1)) {
    return { ok: true, snapshot: snap };
  }
  return { ok: false, snapshot: snap, response: toHttpError('referral_invites', snap) };
}

/**
 * Non-PRO: strip premium branding (logo, custom colors, hide powered-by).
 * @param {string} planKey
 * @param {object} mergedBranding - already merged with existing
 */
function clampBrandingForPlan(planKey, mergedBranding) {
  const limits = saasPlans.getLimitsForPlan(planKey);
  if (limits.branding) return { ...mergedBranding };
  return {
    ...mergedBranding,
    clinicLogoUrl: '',
    primaryColor: '#2563EB',
    secondaryColor: '#10B981',
    showPoweredBy: true,
  };
}

/**
 * Express middleware factory — use after requireAdminAuth.
 * @param {'active_treatments'|'monthly_uploads'|'referral_invites'} dimension
 * @param {{ fileCount?: number }} options
 */
function requireSaasQuota(dimension, options = {}) {
  return async (req, res, next) => {
    try {
      if (!limitsEnabled()) return next();
      const clinic = req.clinic;
      if (!clinic) return next();

      let check;
      if (dimension === 'active_treatments') {
        check = await assertCanAddActiveTreatment(supabase, clinic);
      } else if (dimension === 'monthly_uploads') {
        check = await assertCanUploadFiles(supabase, clinic, options.fileCount || 1);
      } else if (dimension === 'referral_invites') {
        check = await assertCanCreateReferralInvite(supabase, clinic);
      } else {
        return next();
      }

      if (!check.ok && check.response) {
        return res.status(403).json(check.response);
      }
      req.saasSnapshot = check.snapshot;
      next();
    } catch (e) {
      console.warn('[SAAS] requireSaasQuota:', e?.message || e);
      next();
    }
  };
}

module.exports = {
  limitsEnabled,
  planFromClinicRow,
  getBillingSnapshot,
  getBillingSnapshotWithZeroUsage,
  invalidateBillingUsageCache: billingUsageCache.invalidateBillingUsageCache,
  assertCanAddActiveTreatment,
  assertCanUploadFiles,
  assertCanCreateReferralInvite,
  clampBrandingForPlan,
  requireSaasQuota,
  toHttpError,
};
