/**
 * Clinic membership gate — clinical writes require enrolled patient (ACTIVE / APPROVED).
 * WhatsApp leads and PENDING registrations may book first visit but cannot receive treatment plans until they join via the app.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

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

const AI_MEMBERSHIP_NOTICE = {
  tr:
    "Önemli (Clinifly): Tedavi süreciniz, ilk muayenenizden sonra kliniğimize üye olarak başlar. Randevunuz oluşturuldu; muayene öncesi veya sonrasında size iletilecek bağlantıyla uygulamadan kliniğe üye olmanızı rica ederiz. Üyelik tamamlanmadan diş hekiminiz klinik tedavi planınızı sisteme işleyemez — bu Clinifly güvenlik kuralıdır.",
  en:
    "Important (Clinifly): Your treatment journey starts after your first visit, once you enroll with our clinic in the app. Your appointment is booked; please use the link we send you to complete clinic membership before or after the visit. Until enrollment is complete, your dentist cannot save your clinical treatment plan in Clinifly.",
  ru:
    "Важно (Clinifly): Лечение начинается после первого визита, когда вы оформите членство в клинике через приложение. Запись создана; пожалуйста, завершите регистрацию по ссылке до или после приёма. До этого врач не сможет сохранить план лечения в системе.",
};

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
 * Respond and return false when blocked; return true when patient may receive clinical writes.
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
 * @param {string} patientId
 */
async function patientNeedsClinicEnrollmentNotice(patientId) {
  const row = await fetchPatientEnrollmentRow(patientId);
  if (!row) return false;
  return !isPatientEnrolledForClinicalCare(row);
}

/**
 * @param {string} [lang]
 */
function buildAiClinicMembershipAfterBookingNotice(lang = "tr") {
  const key = String(lang || "tr").slice(0, 2).toLowerCase();
  return AI_MEMBERSHIP_NOTICE[key] || AI_MEMBERSHIP_NOTICE.en;
}

module.exports = {
  ENROLLED_STATUSES,
  isPatientEnrolledForClinicalCare,
  messageForEnrollmentError,
  buildEnrollmentErrorBody,
  respondDoctorClinicalPatientGate,
  fetchPatientEnrollmentRow,
  patientNeedsClinicEnrollmentNotice,
  buildAiClinicMembershipAfterBookingNotice,
};
