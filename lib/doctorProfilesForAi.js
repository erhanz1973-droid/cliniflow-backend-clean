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

const MEDICAL_HONORIFIC_RE = /^(dr\.?|dt\.?|prof\.?|doç\.?|doc\.?|uzm\.?|op\.?|assoc\.?)\s*$/i;

const SPECIALTY_LIKE_TITLE_RE =
  /(implantoloji|ortodonti|endodonti|periodontoloji|cerrahi|pedodonti|protetik|estetik|genel\s+diş|diş\s+hekimi|dentist|general\s+dentistry)/i;

/**
 * @param {string|null|undefined} title
 */
function resolveDoctorHonorific(title) {
  const t = String(title || "").trim();
  if (!t) return "Dr.";
  if (MEDICAL_HONORIFIC_RE.test(t) || /^dr\.?\s/i.test(t)) {
    return /^dr/i.test(t) ? (t.toLowerCase().startsWith("dr.") ? "Dr." : "Dr.") : t;
  }
  return "Dr.";
}

/**
 * Title field sometimes stores specialty («İmplantoloji») — not a name prefix.
 * @param {string|null|undefined} title
 * @param {string[]} specialties
 */
function resolveDoctorRoleFromTitle(title, specialties = []) {
  const t = String(title || "").trim();
  if (!t || MEDICAL_HONORIFIC_RE.test(t) || /^dr\.?\s/i.test(t)) return null;
  if (SPECIALTY_LIKE_TITLE_RE.test(t)) {
    const dup = specialties.some((s) => s.toLowerCase() === t.toLowerCase());
    return dup ? null : t;
  }
  if (t.length >= 3 && t.length <= 80) return t;
  return null;
}

/**
 * Patient-facing name — always «Dr. Ad Soyad», never «İmplantoloji Burhan».
 * @param {ReturnType<typeof mapDoctorProfileRow>} profile
 */
function formatDoctorPatientName(profile) {
  const name = String(profile.fullName || "").trim();
  if (!name) return "";
  const honorific = resolveDoctorHonorific(profile.title);
  return `${honorific} ${name}`.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} message
 */
function patientAskedDoctorAssignment(message) {
  const t = String(message || "").trim();
  if (!t) return false;
  return /\b(doktorum|hangi\s+doktor|kim\s+doktor|doktor\s+kim|kim\s+olacak|hangi\s+hekim|hekimim)\b/i.test(
      t,
    ) ||
    /\b(which\s+doctor|who\s+(is|will\s+be)\s+(my\s+)?doctor|my\s+doctor)\b/i.test(t);
}

/**
 * @param {ReturnType<typeof mapDoctorProfileRow>[]} profiles
 * @param {{ lang?: string, clinicName?: string|null, message?: string }} [opts]
 */
function buildDoctorAssignmentReply(profiles, opts = {}) {
  const tr =
    String(opts.lang || "")
      .slice(0, 2)
      .toLowerCase() === "tr" || /[çğıöşüÇĞİÖŞÜ]/.test(String(opts.message || ""));
  const clinic = String(opts.clinicName || "").trim();
  const names = profiles.map((p) => formatDoctorPatientName(p)).filter(Boolean);

  if (!names.length) {
    return tr
      ? `${clinic ? `${clinic} ` : ""}randevunuzdaki işleme göre klinik hekim atar; kesin isim randevu öncesinde netleşir.`
      : "Your treating dentist is assigned by the clinic based on your appointment — we'll confirm the name before your visit.";
  }

  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} ve ${names[1]}`
        : `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}`;

  if (tr) {
    const prefix = clinic ? `${clinic} bünyesinde ` : "Kliniğimizde ";
    return `${prefix}${list} gibi hekimlerimiz var. Randevunuzdaki işleme göre klinik tarafından doktor atanır; kesin ismi randevu türünüze göre önceden paylaşırız.`;
  }
  const prefix = clinic ? `At ${clinic} we have ` : "Our team includes ";
  return `${prefix}${list}. The clinic assigns your dentist based on your appointment type — we'll confirm the name before your visit.`;
}

/**
 * Fix model output that prefixes specialty as if it were a name («İmplantoloji Burhan»).
 * @param {string} reply
 * @param {ReturnType<typeof mapDoctorProfileRow>[]} profiles
 */
function sanitizeDoctorNamesInReply(reply, profiles) {
  let out = String(reply || "").trim();
  if (!out || !profiles.length) return out;

  for (const p of profiles) {
    const name = String(p.fullName || "").trim();
    if (!name) continue;
    const honorific = resolveDoctorHonorific(p.title);
    const role = resolveDoctorRoleFromTitle(p.title, p.specialties);
    if (role) {
      const bad = new RegExp(
        `\\b${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${name.split(/\s+/)[0]}`,
        "gi",
      );
      out = out.replace(bad, `${honorific} ${name}`);
    }
    const first = name.split(/\s+/)[0];
    if (first && first.length > 2) {
      out = out.replace(
        new RegExp(`\\bİmplantoloji\\s+${first}\\b`, "gi"),
        `${honorific} ${name}`,
      );
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * @param {ReturnType<typeof mapDoctorProfileRow>} profile
 */
function formatDoctorFactsLine(profile) {
  const parts = [];
  const name = profile.fullName || "Team member";
  parts.push(formatDoctorPatientName(profile) || name);
  const role = resolveDoctorRoleFromTitle(profile.title, profile.specialties);
  if (role) {
    parts.push(`role/specialty area: ${role}`);
  }

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
    "* Always address doctors as «Dr. [Full Name]» — NEVER put a specialty word immediately before the surname (use «Dr. Burhan» + specialty in a separate phrase, not specialty+surname as one name).",
    "* If specialty is not listed for a doctor, describe them generically as a dentist / diş hekimi — never as an implant specialist, orthodontist, etc. unless explicitly listed under specialties or procedures.",
    "* If procedures are not listed, do not claim the doctor performs specific treatments.",
    "* If languages are not listed, do not claim which languages they speak.",
    "* You may combine listed facts naturally, e.g. «Dr. Serap Zorlu is a dentist with 15 years of experience and a graduate of Hacettepe University.» when specialty is absent but experience and university are present.",
    "",
    "WHEN PATIENT ASKS «doktorum kim» / who is my doctor:",
    "* 2–3 sentences: clinic assigns the treating dentist based on appointment type and availability — do NOT claim a fixed personal doctor unless confirmed in system.",
    "* You may list team members from this block by correct «Dr. Name» only.",
    "* Do NOT pivot into implant pricing, brands, or treatment sales unless they asked about implant in the SAME message.",
    "* Do NOT say «X and Y are best for implants» unless they asked who does implants AND both have implant listed in specialties/procedures.",
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
  formatDoctorPatientName,
  formatDoctorFactsLine,
  patientAskedDoctorAssignment,
  buildDoctorAssignmentReply,
  sanitizeDoctorNamesInReply,
};
