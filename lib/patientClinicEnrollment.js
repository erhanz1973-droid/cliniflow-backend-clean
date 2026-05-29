/**
 * Clinic membership gate — clinical writes require enrolled patient (ACTIVE / APPROVED).
 * WhatsApp/Messenger leads may book first visit; AI guides them to install the app and register with clinic code.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ENROLLED_STATUSES = new Set(["ACTIVE", "APPROVED"]);

const MESSAGES = {
  tr: {
    patient_not_found: "Hasta kaydı bulunamadı.",
    patient_not_clinic_member:
      "Hasta kliniğe henüz üye değil. İlk muayeneden sonra hastanın Clinifly uygulamasından kliniğe kayıt olması gerekir; üyelik tamamlanmadan klinik tedavi planı kaydı yapılamaz.",
  },
  en: {
    patient_not_found: "Patient record was not found.",
    patient_not_clinic_member:
      "This patient is not enrolled with the clinic yet. After the first consultation they must join the clinic in the Clinifly app; treatment plans cannot be saved until enrollment is complete.",
  },
  ru: {
    patient_not_found: "Запись пациента не найдена.",
    patient_not_clinic_member:
      "Пациент ещё не зарегистрирован в клинике. После первого приёма он должен оформить членство в приложении Clinifly; план лечения нельзя сохранить до завершения регистрации.",
  },
};

const APP_REGISTRATION_QUESTION_RE =
  /\b(klinik\s*kod|clinic\s*code|uygulama|uygulamasini|uygulamasını|indir|kaydol|kayıt|üye\s*ol|uye\s*ol|register|sign\s*up|download\s*app|clinifly\s*app|app\s*store|google\s*play|hesap\s*aç|membership|enroll)\b/i;

/**
 * @param {string} message
 */
function patientAskedAboutAppRegistration(message) {
  return APP_REGISTRATION_QUESTION_RE.test(String(message || ""));
}

/**
 * @param {string} lang
 * @param {string|null|undefined} clinicCode
 */
function buildAiClinicMembershipAfterBookingNotice(lang = "tr", clinicCode = null) {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const code = String(clinicCode || "").trim().toUpperCase();
  if (key === "tr") {
    let text =
      "Önemli (Clinifly): Tedavi süreciniz, kliniğimize üye olduktan sonra başlar. En hızlı yol: Clinifly hasta uygulamasını indirin (App Store / Google Play), «Klinik kodu ile kaydol» ekranına klinik kodumuzu yazın";
    if (code) text += ` (${code})`;
    text +=
      ". Uygulamada randevu tarihiniz, işlem detayları ve gerektiğinde seyahat bilgileriniz elinizin altında olur. Üyelik tamamlanmadan diş hekiminiz klinik tedavi planınızı sisteme işleyemez.";
    return text;
  }
  if (key === "ru") {
    let text =
      "Важно (Clinifly): Лечение начинается после регистрации в клинике через приложение. Самый быстрый способ: установите приложение Clinifly и на экране регистрации по коду клиники введите код";
    if (code) text += ` ${code}`;
    text +=
      ". В приложении будут дата приёма, детали лечения и при необходимости информация о поездке.";
    return text;
  }
  let text =
    "Important (Clinifly): Your treatment journey starts once you enroll with our clinic in the app. Fastest path: install the Clinifly patient app (App Store / Google Play), choose register with clinic code, and enter our clinic code";
  if (code) text += ` (${code})`;
  text +=
    ". In the app you will see your appointment, treatment details, and travel coordination when needed. Until enrollment is complete, your dentist cannot save your clinical treatment plan.";
  return text;
}

/**
 * Coordinator prompt block — teach AI to recommend app + clinic code for omnichannel leads.
 * @param {{
 *   lang?: string,
 *   clinicCode?: string|null,
 *   channel?: string,
 *   hasActiveAppointment?: boolean,
 * }} opts
 */
function buildPatientAppOnboardingPromptBlock(opts = {}) {
  const key = String(opts.lang || "tr").slice(0, 2).toLowerCase();
  const code = String(opts.clinicCode || "").trim().toUpperCase();
  const channel = String(opts.channel || "whatsapp").toLowerCase();
  const hasAppt = opts.hasActiveAppointment === true;

  const channelLabel =
    channel === "messenger"
      ? "Facebook Messenger"
      : channel === "instagram"
        ? "Instagram"
        : channel === "whatsapp"
          ? "WhatsApp"
          : "this chat";

  const codeLine = code
    ? key === "tr"
      ? `* Clinic code to type on that screen: **${code}** (spell clearly for the patient).`
      : `* Clinic code for that screen: **${code}** (share clearly).`
    : key === "tr"
      ? "* Clinic code: if not in context, say the clinic team will share it — still recommend installing the app now."
      : "* Clinic code: if unknown, say the clinic will share it — still recommend installing the app.";

  if (key === "tr") {
    return [
      "PATIENT APP ONBOARDING (Clinifly — mandatory for this lead):",
      `* Patient reached us via ${channelLabel} but is NOT yet enrolled in the clinic app (lead/pending).`,
      "* After first consultation booking OR when they ask how to continue / register:",
      "  - Recommend installing the **Clinifly patient app** (App Store / Google Play) — this is the fastest path.",
      '  - In the app, on the screen **«Klinik kodu ile kaydol»**, they must enter the clinic code (not in chat instead of the app).',
      codeLine,
      "  - Once enrolled they can see: appointment date/time, treatment steps, documents, and travel info when relevant — all in one place.",
      hasAppt
        ? "* They already have an appointment on the calendar — tie your message to completing app registration before/after the visit."
        : "* If no appointment yet, still mention app enrollment before detailed treatment planning in the system.",
      "* Tone: warm coordinator; one clear CTA; do not be pushy every single message unless they ask or you just confirmed a booking.",
      "* Do NOT promise clinical treatment details in WhatsApp/Messenger only — point to the app after enrollment.",
    ].join("\n");
  }

  return [
    "PATIENT APP ONBOARDING (Clinifly — mandatory for this lead):",
    `* Patient contacted via ${channelLabel} but is NOT enrolled in the clinic app yet.`,
    "* Recommend installing the **Clinifly patient app** (App Store / Google Play) — fastest path.",
    '* On **Register with clinic code**, they must enter the clinic code in the app.',
    codeLine,
    "* After enrollment: appointment, treatment details, and travel coordination (when needed) live in the app.",
    hasAppt ? "* Appointment exists — link registration to before/after the visit." : "",
    "* Warm tone; one clear CTA; avoid repeating every turn unless relevant.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {Record<string, unknown>|null|undefined} patient
 */
function isPatientEnrolledForClinicalCare(patient) {
  if (!patient || typeof patient !== "object") return false;
  const st = String(patient.status || "")
    .trim()
    .toUpperCase();
  if (!st) return true;
  return ENROLLED_STATUSES.has(st);
}

/**
 * @param {string} [lang]
 * @param {string} code
 */
function messageForEnrollmentError(code, lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  const bucket = MESSAGES[key] || MESSAGES.en;
  return bucket[code] || bucket.patient_not_clinic_member;
}

/**
 * @param {string} code
 * @param {string} [lang]
 */
function buildEnrollmentErrorBody(code, lang = "tr") {
  return {
    ok: false,
    error: code,
    message: messageForEnrollmentError(code, lang),
  };
}

/**
 * @param {import('express').Response} res
 * @param {Record<string, unknown>|null|undefined} patient
 * @param {{ lang?: string }} [opts]
 */
function respondDoctorClinicalPatientGate(res, patient, opts = {}) {
  const lang = opts.lang || "tr";
  if (!patient) {
    res.status(404).json(buildEnrollmentErrorBody("patient_not_found", lang));
    return false;
  }
  if (!isPatientEnrolledForClinicalCare(patient)) {
    res.status(403).json(buildEnrollmentErrorBody("patient_not_clinic_member", lang));
    return false;
  }
  return true;
}

/**
 * @param {string} patientId UUID
 */
async function fetchPatientEnrollmentRow(patientId) {
  const id = String(patientId || "").trim();
  if (!id || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase
      .from("patients")
      .select("id, status, is_lead, clinic_id")
      .eq("id", id)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} clinicId
 */
async function fetchClinicCodeByClinicId(clinicId) {
  const id = String(clinicId || "").trim();
  if (!UUID_RE.test(id) || !isSupabaseEnabled()) return null;
  try {
    const { data } = await supabase.from("clinics").select("clinic_code").eq("id", id).maybeSingle();
    const code = data?.clinic_code ? String(data.clinic_code).trim().toUpperCase() : "";
    return code || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} patientId
 */
async function patientNeedsClinicEnrollmentNotice(patientId) {
  const row = await fetchPatientEnrollmentRow(patientId);
  if (!row) return false;
  return !isPatientEnrolledForClinicalCare(row);
}

module.exports = {
  ENROLLED_STATUSES,
  isPatientEnrolledForClinicalCare,
  messageForEnrollmentError,
  buildEnrollmentErrorBody,
  respondDoctorClinicalPatientGate,
  fetchPatientEnrollmentRow,
  fetchClinicCodeByClinicId,
  patientNeedsClinicEnrollmentNotice,
  patientAskedAboutAppRegistration,
  buildAiClinicMembershipAfterBookingNotice,
  buildPatientAppOnboardingPromptBlock,
};
