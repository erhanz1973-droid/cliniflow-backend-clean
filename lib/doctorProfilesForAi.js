/**
 * Doctor profiles as structured AI knowledge — no invented specialties or credentials.
 */

"use strict";

const { supabase, isSupabaseEnabled } = require("./supabase");
const procedures = require("../shared/procedures");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIVE_DOCTOR_STATUSES = new Set(["APPROVED", "ACTIVE"]);

const DOCTOR_SELECT_CANDIDATES = [
  "id, doctor_id, full_name, name, title, department, university, graduation_year, experience_years, specialties, languages, profile_procedure_ids, public_profile, status, clinic_id, clinic_code",
  "id, doctor_id, full_name, name, title, department, university, graduation_year, experience_years, specialties, languages, status, clinic_id, clinic_code",
  "id, doctor_id, full_name, name, title, department, specialties, languages, status, clinic_id, clinic_code",
];

/**
 * @param {unknown} row
 */
function normalizeDoctorDisplayName(row) {
  if (!row || typeof row !== "object") return "";
  const trim = (v) => (v == null ? "" : String(v).trim());
  return (
    trim(row.full_name) ||
    trim(row.name) ||
    trim(row.display_name) ||
    [trim(row.first_name), trim(row.last_name)].filter(Boolean).join(" ") ||
    ""
  );
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseStringListField(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,،;|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {unknown} profileProcedureIds
 * @param {string} [lang]
 * @returns {string[]}
 */
function procedureNamesFromIds(profileProcedureIds, lang = "en") {
  let ids = [];
  if (Array.isArray(profileProcedureIds)) ids = profileProcedureIds;
  else if (profileProcedureIds && typeof profileProcedureIds === "string") {
    try {
      const parsed = JSON.parse(profileProcedureIds);
      if (Array.isArray(parsed)) ids = parsed;
    } catch {
      ids = [];
    }
  }
  const L = procedures.normalizeProcedureLang
    ? procedures.normalizeProcedureLang(String(lang || "en").slice(0, 2))
    : "en";
  const byId = new Map(
    (procedures.PROCEDURE_TYPES || []).map((t) => {
      const name = procedures.getMultilingualTypeName
        ? procedures.getMultilingualTypeName(t.type)
        : t.type;
      const label =
        name && typeof name === "object"
          ? String(name[L] || name.en || t.type)
          : String(name || t.type);
      return [t.type, label];
    }),
  );
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))]
    .map((id) => byId.get(id) || null)
    .filter(Boolean);
}

/**
 * @param {{ specialties?: string[], languages?: string[], procedures?: string[], university?: string|null, graduationYear?: number|null, experienceYears?: number|null, title?: string|null }} profile
 */
function assessDoctorProfileCompleteness(profile) {
  const specialtyMissing = !(profile.specialties || []).length;
  const languagesMissing = !(profile.languages || []).length;
  const proceduresMissing = !(profile.procedures || []).length;
  /** @type {string[]} */
  const missingFields = [];
  if (specialtyMissing) missingFields.push("specialty");
  if (languagesMissing) missingFields.push("languages");
  if (proceduresMissing) missingFields.push("procedures");
  if (!profile.university) missingFields.push("university");
  if (profile.graduationYear == null) missingFields.push("graduation_year");
  if (profile.experienceYears == null) missingFields.push("experience_years");
  return {
    specialtyMissing,
    languagesMissing,
    proceduresMissing,
    missingFields,
    complete: missingFields.length === 0,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string|null} clinicName
 * @param {{ specialities?: Array<{ name?: string }>, languages?: Array<{ name?: string }>, procedures?: string[] }} resolved
 */
function mapDoctorProfileRow(row, clinicName, resolved = {}) {
  const fullName = normalizeDoctorDisplayName(row);
  const title = row.title != null ? String(row.title).trim() : "";
  const experienceYears =
    row.experience_years != null && Number.isFinite(Number(row.experience_years))
      ? Number(row.experience_years)
      : null;
  const university = row.university != null ? String(row.university).trim() : "";
  const graduationYear =
    row.graduation_year != null && Number.isFinite(Number(row.graduation_year))
      ? Number(row.graduation_year)
      : null;

  const junctionSpecialties = (resolved.specialities || [])
    .map((s) => String(s?.name || "").trim())
    .filter(Boolean);
  const junctionLanguages = (resolved.languages || [])
    .map((l) => String(l?.name || "").trim())
    .filter(Boolean);
  const columnSpecialties = parseStringListField(row.specialties);
  const columnLanguages = parseStringListField(row.languages);
  const specialties = junctionSpecialties.length ? junctionSpecialties : columnSpecialties;
  const languages = junctionLanguages.length ? junctionLanguages : columnLanguages;
  const procedureList =
    resolved.procedures ||
    procedureNamesFromIds(row.profile_procedure_ids, resolved.lang || "en");

  const profile = {
    id: String(row.id || ""),
    doctorCode: row.doctor_id != null ? String(row.doctor_id).trim() : "",
    fullName,
    title: title || null,
    experienceYears,
    university: university || null,
    graduationYear,
    specialties,
    languages,
    procedures: procedureList,
    clinic: clinicName || null,
  };
  profile.completeness = assessDoctorProfileCompleteness(profile);
  return profile;
}

/**
 * @param {string} clinicId
 */
async function fetchClinicName(clinicId) {
  const { data } = await supabase.from("clinics").select("name").eq("id", clinicId).maybeSingle();
  return data?.name ? String(data.name).trim() : null;
}

/**
 * @param {string} clinicId
 */
async function fetchClinicDoctorRows(clinicId) {
  for (const selectClause of DOCTOR_SELECT_CANDIDATES) {
    const { data, error } = await supabase
      .from("doctors")
      .select(selectClause)
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      const code = String(error.code || "");
      if (["42703", "PGRST204", "PGRST205"].includes(code)) continue;
      throw new Error(error.message || "doctor_fetch_failed");
    }
    return (data || []).filter((row) => {
      const status = String(row.status || "").toUpperCase();
      if (status && !ACTIVE_DOCTOR_STATUSES.has(status)) return false;
      const pub = row.public_profile;
      if (pub === false || pub === "false" || pub === 0) return false;
      return !!normalizeDoctorDisplayName(row);
    });
  }
  return [];
}

/**
 * @param {string[]} doctorIds
 */
async function resolveJunctionProfiles(doctorIds) {
  const out = new Map();
  if (!doctorIds.length) return out;

  const [spLinks, langLinks] = await Promise.all([
    supabase.from("doctor_specialities").select("doctor_id, speciality_id").in("doctor_id", doctorIds),
    supabase.from("doctor_languages").select("doctor_id, language_id").in("doctor_id", doctorIds),
  ]);

  const specialityIds = [
    ...new Set((spLinks.data || []).map((r) => String(r.speciality_id || "").trim()).filter(Boolean)),
  ];
  const languageIds = [
    ...new Set((langLinks.data || []).map((r) => String(r.language_id || "").trim()).filter(Boolean)),
  ];

  const [spRows, langRows] = await Promise.all([
    specialityIds.length
      ? supabase.from("specialities").select("id, name").in("id", specialityIds)
      : Promise.resolve({ data: [] }),
    languageIds.length
      ? supabase.from("languages").select("id, name").in("id", languageIds)
      : Promise.resolve({ data: [] }),
  ]);

  const spById = new Map((spRows.data || []).map((r) => [String(r.id), String(r.name || "").trim()]));
  const langById = new Map((langRows.data || []).map((r) => [String(r.id), String(r.name || "").trim()]));

  for (const did of doctorIds) out.set(did, { specialities: [], languages: [] });

  for (const link of spLinks.data || []) {
    const did = String(link.doctor_id || "");
    const name = spById.get(String(link.speciality_id || ""));
    if (!did || !name) continue;
    out.get(did)?.specialities.push({ name });
  }
  for (const link of langLinks.data || []) {
    const did = String(link.doctor_id || "");
    const name = langById.get(String(link.language_id || ""));
    if (!did || !name) continue;
    out.get(did)?.languages.push({ name });
  }
  return out;
}

/**
 * @param {string} clinicId
 * @param {{ lang?: string }} [opts]
 */
async function loadClinicDoctorProfilesForAi(clinicId, opts = {}) {
  const id = String(clinicId || "").trim();
  if (!UUID_RE.test(id) || !isSupabaseEnabled()) {
    return { profiles: [], clinicName: null };
  }

  const [rows, clinicName] = await Promise.all([fetchClinicDoctorRows(id), fetchClinicName(id)]);
  const doctorIds = rows.map((r) => String(r.id || "").trim()).filter(Boolean);
  const junction = await resolveJunctionProfiles(doctorIds);
  const lang = String(opts.lang || "en").slice(0, 2);

  const profiles = rows.map((row) => {
    const resolved = junction.get(String(row.id)) || { specialities: [], languages: [] };
    return mapDoctorProfileRow(row, clinicName, {
      ...resolved,
      procedures: procedureNamesFromIds(row.profile_procedure_ids, lang),
      lang,
    });
  });

  return { profiles, clinicName };
}

/**
 * @param {ReturnType<typeof mapDoctorProfileRow>} profile
 */
function formatDoctorFactsLine(profile) {
  const parts = [];
  const honorific = profile.title ? `${profile.title} ` : "Dr. ";
  const name = profile.fullName || "Team member";
  parts.push(`${honorific}${name}`.trim());

  if (profile.experienceYears != null) {
    parts.push(`${profile.experienceYears} years of experience`);
  }
  if (profile.university) {
    let edu = `graduate of ${profile.university}`;
    if (profile.graduationYear != null) edu += ` (${profile.graduationYear})`;
    parts.push(edu);
  } else if (profile.graduationYear != null) {
    parts.push(`graduation year ${profile.graduationYear}`);
  }
  if (profile.specialties.length) {
    parts.push(`specialties: ${profile.specialties.join(", ")}`);
  }
  if (profile.languages.length) {
    parts.push(`languages: ${profile.languages.join(", ")}`);
  }
  if (profile.procedures.length) {
    parts.push(`procedures: ${profile.procedures.slice(0, 12).join(", ")}`);
  }
  if (profile.clinic) {
    parts.push(`clinic: ${profile.clinic}`);
  }
  return parts.join("; ");
}

/**
 * @param {ReturnType<typeof mapDoctorProfileRow>[]} profiles
 */
function buildProfileCompletenessAdminLines(profiles) {
  const lines = ["PROFILE COMPLETENESS (internal — improve profiles to strengthen AI answers):"];
  for (const p of profiles) {
    const missing = [];
    if (p.completeness.specialtyMissing) missing.push("specialty");
    if (p.completeness.languagesMissing) missing.push("languages");
    if (p.completeness.proceduresMissing) missing.push("procedures");
    if (!missing.length) {
      lines.push(`• ${p.fullName || p.doctorCode}: complete`);
      continue;
    }
    lines.push(`• ${p.fullName || p.doctorCode}: missing ${missing.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * @param {ReturnType<typeof mapDoctorProfileRow>[]} profiles
 * @param {string|null} clinicName
 */
function buildDoctorProfilesPromptBlock(profiles, clinicName) {
  if (!profiles.length) return "";

  const lines = [
    "CLINIC DOCTOR PROFILES (configured data only — authoritative for team questions):",
    "* Use ONLY the facts listed below. Do NOT invent university, specialty, procedures, languages, or titles.",
    "* If specialty is not listed for a doctor, describe them generically as a dentist / diş hekimi — never as an implant specialist, orthodontist, etc. unless explicitly listed under specialties or procedures.",
    "* If procedures are not listed, do not claim the doctor performs specific treatments.",
    "* If languages are not listed, do not claim which languages they speak.",
    "* You may combine listed facts naturally, e.g. «Dr. Serap Zorlu is a dentist with 15 years of experience and a graduate of Hacettepe University.» when specialty is absent but experience and university are present.",
  ];

  if (clinicName) lines.push(`Clinic: ${clinicName}`);
  lines.push("\nDoctors:");
  for (const p of profiles) {
    lines.push(`- ${formatDoctorFactsLine(p)}`);
  }

  lines.push("", buildProfileCompletenessAdminLines(profiles));
  return lines.join("\n");
}

/**
 * @param {string} clinicId
 * @param {{ clinicName?: string|null, lang?: string }} [params]
 */
async function buildDoctorProfilesPromptForAi(clinicId, params = {}) {
  const { profiles, clinicName } = await loadClinicDoctorProfilesForAi(clinicId, {
    lang: params.lang,
  });
  if (!profiles.length) return null;
  return buildDoctorProfilesPromptBlock(profiles, params.clinicName || clinicName);
}

/**
 * Admin / dashboard: per-doctor completeness flags.
 * @param {string} clinicId
 */
async function fetchDoctorProfileCompletenessForClinic(clinicId) {
  const { profiles, clinicName } = await loadClinicDoctorProfilesForAi(clinicId);
  return {
    clinicName,
    doctors: profiles.map((p) => ({
      id: p.id,
      doctorCode: p.doctorCode,
      fullName: p.fullName,
      specialtyMissing: p.completeness.specialtyMissing,
      languagesMissing: p.completeness.languagesMissing,
      proceduresMissing: p.completeness.proceduresMissing,
      missingFields: p.completeness.missingFields,
      complete: p.completeness.complete,
    })),
  };
}

module.exports = {
  assessDoctorProfileCompleteness,
  mapDoctorProfileRow,
  loadClinicDoctorProfilesForAi,
  buildDoctorProfilesPromptBlock,
  buildDoctorProfilesPromptForAi,
  fetchDoctorProfileCompletenessForClinic,
  procedureNamesFromIds,
};
