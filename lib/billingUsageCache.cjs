'use strict';

/**
 * In-memory TTL cache for getBillingSnapshot results (per clinic_id).
 * Reduces repeated Supabase count queries under dashboard polling.
 */

const saasUsage = require('./saasUsage.cjs');

const CACHE_DISABLED = String(process.env.BILLING_USAGE_CACHE || '').trim() === '0';

const TTL_MS = (() => {
  const n = parseInt(process.env.BILLING_USAGE_CACHE_TTL_MS || '60000', 10);
  return Number.isFinite(n) && n > 0 ? n : 60000;
})();

const MAX_ENTRIES = (() => {
  const n = parseInt(process.env.BILLING_USAGE_CACHE_MAX || '500', 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

/** @type {Map<string, { snapshot: object, ts: number, periodLabel: string|null }>} */
const store = new Map();

function trimIfNeeded() {
  while (store.size >= MAX_ENTRIES && store.size > 0) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

/**
 * @param {string} clinicId
 */
function invalidateBillingUsageCache(clinicId) {
  const cid = clinicId != null ? String(clinicId).trim() : '';
  if (!cid) return;
  store.delete(cid);
}

/**
 * @param {string} clinicId
 * @returns {object|null}
 */
function getCachedBillingSnapshot(clinicId) {
  if (CACHE_DISABLED) return null;
  const cid = clinicId != null ? String(clinicId).trim() : '';
  if (!cid) return null;
  const entry = store.get(cid);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.ts > TTL_MS) {
    store.delete(cid);
    return null;
  }
  const currentLabel = saasUsage.currentUtcMonthRange().label;
  if (entry.periodLabel != null && entry.periodLabel !== currentLabel) {
    store.delete(cid);
    return null;
  }
  return entry.snapshot;
}

/**
 * @param {string} clinicId
 * @param {object} snapshot
 */
function setCachedBillingSnapshot(clinicId, snapshot) {
  if (CACHE_DISABLED || snapshot == null || typeof snapshot !== 'object') return;
  const cid = clinicId != null ? String(clinicId).trim() : '';
  if (!cid) return;
  trimIfNeeded();
  const periodLabel = snapshot.period && snapshot.period.label != null ? String(snapshot.period.label) : null;
  store.set(cid, { snapshot, ts: Date.now(), periodLabel });
}

module.exports = {
  invalidateBillingUsageCache,
  getCachedBillingSnapshot,
  setCachedBillingSnapshot,
};
