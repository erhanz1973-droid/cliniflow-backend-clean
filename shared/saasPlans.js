'use strict';

/**
 * Clinifly SaaS plan definitions — single source of truth for tier limits.
 * null limit = unlimited for that dimension.
 */

const PLAN_KEYS = Object.freeze(['FREE', 'BASIC', 'PRO']);

/** @typedef {{ activeTreatments: number|null, monthlyUploads: number|null, referralInvites: number|null, branding: boolean }} PlanLimits */

/** @type {Record<string, PlanLimits>} */
const SAAS_PLAN_LIMITS = Object.freeze({
  FREE: {
    activeTreatments: 40,
    monthlyUploads: 50,
    referralInvites: 20,
    branding: false,
  },
  BASIC: {
    activeTreatments: 400,
    monthlyUploads: 500,
    referralInvites: 100,
    branding: false,
  },
  PRO: {
    activeTreatments: null,
    monthlyUploads: null,
    referralInvites: null,
    branding: true,
  },
});

const LIMIT_DIMENSIONS = Object.freeze([
  'active_treatments',
  'monthly_uploads',
  'referral_invites',
  'branding',
]);

function normalizePlanKey(raw) {
  const u = String(raw || 'FREE')
    .trim()
    .toUpperCase();
  if (u === 'PROFESSIONAL' || u === 'PREMIUM') return 'PRO';
  if (PLAN_KEYS.includes(u)) return u;
  return 'FREE';
}

/** @returns {PlanLimits & { plan: string }} */
function getLimitsForPlan(rawPlan) {
  const plan = normalizePlanKey(rawPlan);
  const row = SAAS_PLAN_LIMITS[plan];
  return {
    plan,
    activeTreatments: row.activeTreatments,
    monthlyUploads: row.monthlyUploads,
    referralInvites: row.referralInvites,
    branding: row.branding,
  };
}

/** limit null/undefined => unlimited */
function isWithinLimit(used, limit) {
  if (limit == null || limit === '') return true;
  const cap = Number(limit);
  if (!Number.isFinite(cap) || cap < 0) return true;
  return Number(used) < cap;
}

/** True if adding `delta` units stays at or under `limit` (inclusive cap). */
function canConsume(used, limit, delta) {
  if (limit == null || limit === '') return true;
  const cap = Number(limit);
  if (!Number.isFinite(cap) || cap < 0) return true;
  const d = Number(delta);
  const add = Number.isFinite(d) && d > 0 ? d : 1;
  return Number(used) + add <= cap;
}

function usageRatio(used, limit) {
  if (limit == null || !Number.isFinite(Number(limit)) || Number(limit) <= 0) return null;
  return Math.min(1, Number(used) / Number(limit));
}

/**
 * Public catalog for pricing pages / admin UI (no secrets).
 * @returns {{ plans: Record<string, PlanLimits & { label: string }> }}
 */
function getPublicPlanCatalog() {
  return {
    plans: {
      FREE: { label: 'Free', ...SAAS_PLAN_LIMITS.FREE },
      BASIC: { label: 'Basic', ...SAAS_PLAN_LIMITS.BASIC },
      PRO: { label: 'Pro', ...SAAS_PLAN_LIMITS.PRO },
    },
    dimensions: LIMIT_DIMENSIONS,
  };
}

module.exports = {
  PLAN_KEYS,
  LIMIT_DIMENSIONS,
  SAAS_PLAN_LIMITS,
  normalizePlanKey,
  getLimitsForPlan,
  isWithinLimit,
  canConsume,
  usageRatio,
  getPublicPlanCatalog,
};
