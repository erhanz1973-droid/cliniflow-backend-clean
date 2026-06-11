/**
 * Super Admin — platform-wide growth statistics (users, doctors, clinics).
 */

function isMissingTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist|schema cache|could not find the table/i.test(msg)
  );
}

async function countRows(supabase, table, buildQuery) {
  try {
    const { count, error } = await buildQuery(
      supabase.from(table).select("*", { count: "exact", head: true }),
    );
    if (error) {
      if (isMissingTableError(error)) return { ok: false, count: 0, missing: true };
      return { ok: false, count: 0, error: error.message };
    }
    return { ok: true, count: count || 0 };
  } catch (e) {
    return { ok: false, count: 0, error: e?.message || "count_failed" };
  }
}

/** Midnight today in Turkey (UTC+3, no DST). */
function startOfTodayTurkeyIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}T00:00:00+03:00`;
}

async function countUsers(supabase, { since } = {}) {
  return countRows(supabase, "patients", (q) => {
    let query = q.eq("role", "PATIENT");
    if (since) query = query.gte("created_at", since);
    return query;
  });
}

async function countDoctorsFromTable(supabase, table, { since } = {}) {
  return countRows(supabase, table, (q) => {
    if (!since) return q;
    return q.gte("created_at", since);
  });
}

async function countDoctors(supabase, { since } = {}) {
  const doctorsRes = await countDoctorsFromTable(supabase, "doctors", { since });
  if (doctorsRes.ok && doctorsRes.count > 0) {
    return { ...doctorsRes, source: "doctors" };
  }
  if (doctorsRes.missing || (doctorsRes.ok && doctorsRes.count === 0)) {
    const legacy = await countRows(supabase, "patients", (q) => {
      let query = q.eq("role", "DOCTOR");
      if (since) query = query.gte("created_at", since);
      return query;
    });
    if (legacy.ok) return { ...legacy, source: "patients" };
  }
  return doctorsRes.ok ? { ...doctorsRes, source: "doctors" } : doctorsRes;
}

async function countClinics(supabase) {
  return countRows(supabase, "clinics", (q) => q);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function buildSuperAdminPlatformStats(supabase) {
  const now = new Date();
  const startOfToday = startOfTodayTurkeyIso();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalUsersRes,
    totalDoctorsRes,
    totalClinicsRes,
    newUsersTodayRes,
    newDoctorsTodayRes,
    newUsersWeekRes,
    newDoctorsWeekRes,
  ] = await Promise.all([
    countUsers(supabase),
    countDoctors(supabase),
    countClinics(supabase),
    countUsers(supabase, { since: startOfToday }),
    countDoctors(supabase, { since: startOfToday }),
    countUsers(supabase, { since: weekAgo }),
    countDoctors(supabase, { since: weekAgo }),
  ]);

  return {
    ok: true,
    generatedAt: now.toISOString(),
    timezone: "Europe/Istanbul",
    stats: {
      totalUsers: totalUsersRes.count || 0,
      totalDoctors: totalDoctorsRes.count || 0,
      totalClinics: totalClinicsRes.count || 0,
      newUsersToday: newUsersTodayRes.count || 0,
      newDoctorsToday: newDoctorsTodayRes.count || 0,
      newUsersThisWeek: newUsersWeekRes.count || 0,
      newDoctorsThisWeek: newDoctorsWeekRes.count || 0,
    },
    sources: {
      users: "patients.role=PATIENT",
      doctors: totalDoctorsRes.source || "doctors",
      clinics: "clinics",
    },
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ superAdminGuard: Function, supabase: object }} deps
 */
function registerSuperAdminPlatformStatsRoutes(app, deps) {
  const { superAdminGuard, supabase } = deps;

  app.get("/api/super-admin/platform-stats", superAdminGuard, async (_req, res) => {
    try {
      const result = await buildSuperAdminPlatformStats(supabase);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "internal_error",
        message: e?.message || "Failed to load platform stats",
      });
    }
  });
}

module.exports = {
  registerSuperAdminPlatformStatsRoutes,
  buildSuperAdminPlatformStats,
  startOfTodayTurkeyIso,
};
