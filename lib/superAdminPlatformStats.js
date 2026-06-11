/**
 * Super Admin — platform growth + ad conversion funnel statistics.
 * Registered users exclude Messenger/WhatsApp lead stubs (is_lead, MSG_/WA_/LD_ prefixes).
 */

const LEAD_PATIENT_ID_PREFIXES = ["MSG_", "WA_", "LD_"];

function isMissingTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist|schema cache|could not find the table/i.test(msg)
  );
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

/**
 * App-registered patients only — NOT Messenger/WhatsApp/ad lead stubs.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ since?: string }} [opts]
 */
async function countRegisteredUsers(supabase, { since } = {}) {
  try {
    let q = supabase
      .from("patients")
      .select("*", { count: "exact", head: true })
      .eq("role", "PATIENT")
      .or("is_lead.eq.false,is_lead.is.null")
      .not("patient_id", "like", "MSG_%")
      .not("patient_id", "like", "WA_%")
      .not("patient_id", "like", "LD_%");
    if (since) q = q.gte("created_at", since);
    const { count, error } = await q;
    if (error) {
      if (isMissingTableError(error)) {
        return countRegisteredUsersLegacy(supabase, { since });
      }
      return { ok: false, count: 0, error: error.message };
    }
    return { ok: true, count: count || 0, source: "patients.role=PATIENT,!is_lead,!MSG/WA/LD" };
  } catch (e) {
    return { ok: false, count: 0, error: e?.message || "count_failed" };
  }
}

async function countRegisteredUsersLegacy(supabase, { since } = {}) {
  return countRows(supabase, "patients", (q) => {
    let query = q.eq("role", "PATIENT");
    if (since) query = query.gte("created_at", since);
    return query;
  });
}

/**
 * Ad / brand-page Messenger & Instagram conversations (Clinifly Sales AI — not clinic inbox leads).
 */
async function countMessengerAdLeads(supabase, { since } = {}) {
  const salesProfileRes = await countRows(supabase, "ai_coordinator_lead_profiles", (q) => {
    let query = q.or("conversation_type.eq.clinifly_sales,source.eq.clinifly_sales_messenger");
    if (since) query = query.gte("created_at", since);
    return query;
  });
  if (salesProfileRes.ok && !salesProfileRes.missing) {
    return { ...salesProfileRes, source: "ai_coordinator_lead_profiles.clinifly_sales" };
  }

  return countRows(supabase, "patients", (q) => {
    let query = q.eq("is_lead", true).like("patient_id", "MSG_%");
    if (since) query = query.gte("created_at", since);
    return query;
  }).then((r) => ({ ...r, source: "patients.is_lead+MSG_ (fallback)" }));
}

async function countDoctorsFromTable(supabase, table, { since } = {}) {
  return countRows(supabase, table, (q) => {
    if (!since) return q;
    return q.gte("created_at", since);
  });
}

async function countRegisteredDoctors(supabase, { since } = {}) {
  const doctorsRes = await countDoctorsFromTable(supabase, "doctors", { since });
  if (doctorsRes.ok && doctorsRes.count > 0) {
    return { ...doctorsRes, source: "doctors" };
  }
  if (doctorsRes.missing || (doctorsRes.ok && doctorsRes.count === 0)) {
    const legacy = await countRows(supabase, "patients", (q) => {
      let query = q.eq("role", "DOCTOR").or("is_lead.eq.false,is_lead.is.null");
      if (since) query = query.gte("created_at", since);
      return query;
    });
    if (legacy.ok) return { ...legacy, source: "patients.role=DOCTOR" };
  }
  return doctorsRes.ok ? { ...doctorsRes, source: "doctors" } : doctorsRes;
}

async function countRegisteredClinics(supabase, { since } = {}) {
  return countRows(supabase, "clinics", (q) => {
    if (!since) return q;
    return q.gte("created_at", since);
  });
}

/**
 * Distinct registered users who uploaded at least one image (not lead stubs).
 */
async function countDistinctPhotoUploadUsers(supabase, { since } = {}) {
  const tables = [
    { table: "patient_files", filter: (q) => q.or("file_type.ilike.%image%,mime_type.ilike.%image%") },
    {
      table: "messages",
      filter: (q) =>
        q.or("file_type.ilike.%image%,attachment_type.ilike.%image%,attachment_url.not.is.null"),
    },
  ];

  for (const { table, filter } of tables) {
    try {
      let q = supabase.from(table).select("patient_id");
      q = filter(q);
      if (since) q = q.gte("created_at", since);
      const { data, error } = await q.limit(25000);
      if (error) {
        if (isMissingTableError(error)) continue;
        continue;
      }
      const ids = new Set(
        (data || [])
          .map((r) => String(r.patient_id || "").trim())
          .filter((id) => id.length > 0),
      );
      if (!ids.size && table !== "messages") continue;
      const registeredOnly = await filterRegisteredPatientIds(supabase, ids);
      return {
        ok: true,
        count: registeredOnly.size,
        source: `${table}.distinct_patient_id`,
      };
    } catch {
      continue;
    }
  }
  return { ok: true, count: 0, source: "none" };
}

/**
 * Distinct users who sent at least one patient message to a clinic (registered users only).
 */
async function countDistinctClinicContactUsers(supabase, { since } = {}) {
  try {
    let q = supabase.from("messages").select("patient_id").eq("sender_role", "PATIENT");
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q.limit(25000);
    if (error) {
      if (isMissingTableError(error)) return { ok: false, count: 0, missing: true };
      return { ok: false, count: 0, error: error.message };
    }
    const ids = new Set(
      (data || [])
        .map((r) => String(r.patient_id || "").trim())
        .filter(Boolean),
    );
    const registeredOnly = await filterRegisteredPatientIds(supabase, ids);
    return {
      ok: true,
      count: registeredOnly.size,
      source: "messages.sender_role=PATIENT.distinct",
    };
  } catch (e) {
    return { ok: false, count: 0, error: e?.message || "count_failed" };
  }
}

/** @param {Set<string>} patientIds */
async function filterRegisteredPatientIds(supabase, patientIds) {
  const ids = [...patientIds];
  if (!ids.length) return new Set();
  const registered = new Set();
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data } = await supabase
      .from("patients")
      .select("id, patient_id, is_lead, role")
      .in("id", chunk);
    for (const row of data || []) {
      if (String(row.role || "").toUpperCase() !== "PATIENT") continue;
      if (row.is_lead === true) continue;
      const legacyId = String(row.patient_id || "");
      if (LEAD_PATIENT_ID_PREFIXES.some((p) => legacyId.startsWith(p))) continue;
      registered.add(String(row.id));
    }
  }
  return registered;
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
    registeredUsersTodayRes,
    registeredDoctorsTodayRes,
    registeredClinicsTodayRes,
    registeredUsersWeekRes,
    registeredDoctorsWeekRes,
    registeredClinicsWeekRes,
    messengerLeadsTodayRes,
    messengerLeadsWeekRes,
    messengerLeadsTotalRes,
    photoUsersTodayRes,
    photoUsersWeekRes,
    photoUsersTotalRes,
    clinicContactsTodayRes,
    clinicContactsWeekRes,
    clinicContactsTotalRes,
  ] = await Promise.all([
    countRegisteredUsers(supabase),
    countRegisteredDoctors(supabase),
    countRegisteredClinics(supabase),
    countRegisteredUsers(supabase, { since: startOfToday }),
    countRegisteredDoctors(supabase, { since: startOfToday }),
    countRegisteredClinics(supabase, { since: startOfToday }),
    countRegisteredUsers(supabase, { since: weekAgo }),
    countRegisteredDoctors(supabase, { since: weekAgo }),
    countRegisteredClinics(supabase, { since: weekAgo }),
    countMessengerAdLeads(supabase, { since: startOfToday }),
    countMessengerAdLeads(supabase, { since: weekAgo }),
    countMessengerAdLeads(supabase),
    countDistinctPhotoUploadUsers(supabase, { since: startOfToday }),
    countDistinctPhotoUploadUsers(supabase, { since: weekAgo }),
    countDistinctPhotoUploadUsers(supabase),
    countDistinctClinicContactUsers(supabase, { since: startOfToday }),
    countDistinctClinicContactUsers(supabase, { since: weekAgo }),
    countDistinctClinicContactUsers(supabase),
  ]);

  const funnel = {
    messengerLeads: messengerLeadsTotalRes.count || 0,
    messengerLeadsToday: messengerLeadsTodayRes.count || 0,
    messengerLeadsWeek: messengerLeadsWeekRes.count || 0,
    appDownloads: null,
    appDownloadsNote: "Track in Meta Events Manager (fb_mobile_activate_app)",
    userRegistrations: totalUsersRes.count || 0,
    userRegistrationsToday: registeredUsersTodayRes.count || 0,
    userRegistrationsWeek: registeredUsersWeekRes.count || 0,
    photoUploadUsers: photoUsersTotalRes.count || 0,
    photoUploadUsersToday: photoUsersTodayRes.count || 0,
    photoUploadUsersWeek: photoUsersWeekRes.count || 0,
    clinicContactUsers: clinicContactsTotalRes.count || 0,
    clinicContactUsersToday: clinicContactsTodayRes.count || 0,
    clinicContactUsersWeek: clinicContactsWeekRes.count || 0,
  };

  return {
    ok: true,
    generatedAt: now.toISOString(),
    timezone: "Europe/Istanbul",
    stats: {
      totalRegisteredUsers: totalUsersRes.count || 0,
      totalRegisteredDoctors: totalDoctorsRes.count || 0,
      totalRegisteredClinics: totalClinicsRes.count || 0,
      registeredUsersToday: registeredUsersTodayRes.count || 0,
      registeredDoctorsToday: registeredDoctorsTodayRes.count || 0,
      registeredClinicsToday: registeredClinicsTodayRes.count || 0,
      registeredUsersThisWeek: registeredUsersWeekRes.count || 0,
      registeredDoctorsThisWeek: registeredDoctorsWeekRes.count || 0,
      registeredClinicsThisWeek: registeredClinicsWeekRes.count || 0,
      messengerLeadsToday: messengerLeadsTodayRes.count || 0,
      photoUploadUsersToday: photoUsersTodayRes.count || 0,
      clinicContactUsersToday: clinicContactsTodayRes.count || 0,
    },
    conversions: {
      userRegistrations: totalUsersRes.count || 0,
      doctorRegistrations: totalDoctorsRes.count || 0,
      clinicRegistrations: totalClinicsRes.count || 0,
      messengerLeads: messengerLeadsTotalRes.count || 0,
      photoUploads: photoUsersTotalRes.count || 0,
      clinicContacts: clinicContactsTotalRes.count || 0,
      newUserRegistrationsToday: registeredUsersTodayRes.count || 0,
      newDoctorRegistrationsToday: registeredDoctorsTodayRes.count || 0,
      newClinicRegistrationsToday: registeredClinicsTodayRes.count || 0,
      newMessengerLeadsToday: messengerLeadsTodayRes.count || 0,
      newPhotoUploadUsersToday: photoUsersTodayRes.count || 0,
      newClinicContactUsersToday: clinicContactsTodayRes.count || 0,
      newUserRegistrationsWeek: registeredUsersWeekRes.count || 0,
      newDoctorRegistrationsWeek: registeredDoctorsWeekRes.count || 0,
      newClinicRegistrationsWeek: registeredClinicsWeekRes.count || 0,
      newMessengerLeadsWeek: messengerLeadsWeekRes.count || 0,
      newPhotoUploadUsersWeek: photoUsersWeekRes.count || 0,
      newClinicContactUsersWeek: clinicContactsWeekRes.count || 0,
    },
    funnel,
    sources: {
      registeredUsers: totalUsersRes.source || "patients.role=PATIENT,!is_lead",
      doctors: totalDoctorsRes.source || "doctors",
      clinics: "clinics",
      messengerLeads: messengerLeadsTotalRes.source || "ai_coordinator_lead_profiles",
      photoUploads: photoUsersTotalRes.source || "distinct_patient_id",
      clinicContacts: clinicContactsTotalRes.source || "messages.distinct",
      appDownloads: "meta_events_manager",
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
  countRegisteredUsers,
  countMessengerAdLeads,
};
