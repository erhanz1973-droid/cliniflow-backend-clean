/**
 * Phase 1: Supabase OAuth access token → resolve/link `patients` row for Clinifly JWT bridge.
 * Does not issue JWT (index.cjs signs + TOK_FILE) — returns patient row + normalized fields or error.
 */

const { updatePatient } = require("./supabase.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OAUTH_PROVIDERS = new Set(["google", "apple"]);

const PATIENT_OAUTH_SELECT =
  "id, patient_id, name, phone, email, status, clinic_id, clinic_code, referral_code, language, auth_user_id, auth_provider, provider_subject, avatar_url";

/**
 * Prefer newest row when duplicate emails exist (ambiguous legacy data).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function fetchPatientByEmailLatestForOauth(supabase, emailNorm) {
  const e = String(emailNorm || "").trim().toLowerCase();
  if (!e) return null;
  const { data, error } = await supabase
    .from("patients")
    .select(`${PATIENT_OAUTH_SELECT}, clinics(id, name, clinic_code)`)
    .eq("email", e)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const code = String(error.code || "");
    if (code !== "PGRST116") {
      console.warn("[patient-oauth] fetchPatientByEmailLatestForOauth:", error.message || error);
    }
    return null;
  }
  return data || null;
}

function normalizeEmail(raw) {
  const e = String(raw || "").trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} accessToken
 */
async function verifySupabaseAccessToken(supabase, accessToken) {
  const tok = String(accessToken || "").trim();
  if (!tok) {
    return { user: null, error: { message: "missing_token", status: 400 } };
  }
  try {
    const { data, error } = await supabase.auth.getUser(tok);
    if (error || !data?.user) {
      return {
        user: null,
        error: { message: error?.message || "invalid_oauth_token", status: 401 },
      };
    }
    return { user: data.user, error: null };
  } catch (e) {
    return { user: null, error: { message: String(e?.message || e), status: 401 } };
  }
}

/**
 * Prefer Supabase identity list; fall back to declared provider for logging only.
 */
function pickOAuthIdentity(user, declaredProvider) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const want = String(declaredProvider || "").trim().toLowerCase();
  let chosen =
    (want && identities.find((i) => String(i?.provider || "").toLowerCase() === want)) || null;
  if (!chosen && identities.length === 1) chosen = identities[0];
  if (!chosen && identities.length > 1) {
    chosen =
      identities.find((i) => ["google", "apple"].includes(String(i?.provider || "").toLowerCase())) ||
      identities[0];
  }

  const provider = String(chosen?.provider || want || "").trim().toLowerCase();
  const idData = chosen?.identity_data && typeof chosen.identity_data === "object" ? chosen.identity_data : {};
  const subject =
    String(idData.sub || chosen?.id || user?.id || "").trim() ||
    String(chosen?.identity_id || "").trim();

  const meta = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const email =
    normalizeEmail(user?.email) ||
    normalizeEmail(idData.email) ||
    normalizeEmail(meta.email);

  const fullName =
    String(meta.full_name || meta.name || idData.full_name || idData.name || "").trim() || "";
  const avatarUrl =
    String(meta.avatar_url || meta.picture || idData.avatar_url || idData.picture || "").trim() || null;

  return { provider, subject, email, fullName, avatarUrl, authUserId: String(user?.id || "").trim() };
}

async function fetchPatientByAuthUserId(supabase, authUserId) {
  if (!UUID_RE.test(authUserId)) return null;
  const sel = PATIENT_OAUTH_SELECT;
  const { data, error } = await supabase.from("patients").select(sel).eq("auth_user_id", authUserId).maybeSingle();
  if (error) {
    const code = String(error.code || "");
    const msg = String(error.message || "").toLowerCase();
    if (code === "42703" || msg.includes("auth_user_id")) return null;
    console.warn("[patient-oauth] fetchPatientByAuthUserId:", error.message || error);
    return null;
  }
  return data || null;
}

async function fetchPatientByProviderSubject(supabase, provider, subject) {
  const p = String(provider || "").trim().toLowerCase();
  const s = String(subject || "").trim();
  if (!p || !s) return null;
  const sel = PATIENT_OAUTH_SELECT;
  const { data, error } = await supabase
    .from("patients")
    .select(sel)
    .eq("auth_provider", p)
    .eq("provider_subject", s)
    .maybeSingle();
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (String(error.code || "") === "42703" || msg.includes("provider_subject")) return null;
    console.warn("[patient-oauth] fetchPatientByProviderSubject:", error.message || error);
    return null;
  }
  return data || null;
}

/**
 * @returns {Promise<{ ok: true, patient: object, emailNormalized: string, declaredProvider: string } | { ok: false, status: number, error: string, message: string }>}
 */
async function resolvePatientOAuthSession({ supabase, accessToken, declaredProvider, clinicCode }) {
  if (!supabase || typeof supabase.auth?.getUser !== "function") {
    return { ok: false, status: 503, error: "supabase_unavailable", message: "Supabase client not configured." };
  }

  const prov = String(declaredProvider || "").trim().toLowerCase();
  if (!OAUTH_PROVIDERS.has(prov)) {
    return { ok: false, status: 400, error: "invalid_provider", message: "provider must be google or apple." };
  }

  const { user, error: verr } = await verifySupabaseAccessToken(supabase, accessToken);
  if (!user) {
    return {
      ok: false,
      status: verr?.status || 401,
      error: "invalid_oauth_token",
      message: verr?.message || "Could not validate Supabase access token.",
    };
  }

  const picked = pickOAuthIdentity(user, prov);
  if (!picked.authUserId || !UUID_RE.test(picked.authUserId)) {
    return { ok: false, status: 401, error: "invalid_oauth_token", message: "Supabase user id missing." };
  }

  if (picked.provider && picked.provider !== prov) {
    return {
      ok: false,
      status: 400,
      error: "provider_mismatch",
      message: `Token identity provider (${picked.provider}) does not match declared provider (${prov}).`,
    };
  }

  const emailNorm = picked.email;
  let patient =
    (await fetchPatientByAuthUserId(supabase, picked.authUserId)) ||
    (emailNorm ? await fetchPatientByEmailLatestForOauth(supabase, emailNorm) : null) ||
    (await fetchPatientByProviderSubject(supabase, prov, picked.subject));

  if (!patient) {
    return {
      ok: false,
      status: 404,
      error: "patient_not_found",
      message:
        "No Clinifly patient linked to this account. Complete registration with your clinic code, then sign in with OAuth again.",
      meta: { clinicCodeHint: clinicCode ? String(clinicCode).trim().toUpperCase() : null },
    };
  }

  const prevProv = String(patient.auth_provider || "").trim().toLowerCase();
  const prevAuth = patient.auth_user_id != null ? String(patient.auth_user_id).trim() : "";
  if (
    prevProv &&
    prevProv !== prov &&
    (!prevAuth || !UUID_RE.test(prevAuth))
  ) {
    return {
      ok: false,
      status: 409,
      error: "oauth_provider_mismatch",
      message:
        "This patient record was previously associated with a different OAuth provider. Use the original provider or phone login, or contact support.",
    };
  }

  const existingAuth = patient.auth_user_id != null ? String(patient.auth_user_id).trim() : "";
  if (existingAuth && UUID_RE.test(existingAuth) && existingAuth !== picked.authUserId) {
    return {
      ok: false,
      status: 409,
      error: "patient_merge_conflict",
      message: "This patient record is already linked to a different auth account.",
    };
  }

  const patch = {
    auth_user_id: picked.authUserId,
    auth_provider: prov,
    provider_subject:
      (picked.subject && String(picked.subject).trim()) ||
      (patient.provider_subject != null ? String(patient.provider_subject).trim() : "") ||
      null,
    avatar_url:
      (picked.avatarUrl && String(picked.avatarUrl).trim()) ||
      (patient.avatar_url != null ? String(patient.avatar_url).trim() : "") ||
      null,
  };
  if (emailNorm && !String(patient.email || "").trim()) {
    patch.email = emailNorm;
  }
  if (picked.fullName && (!patient.name || !String(patient.name).trim())) {
    patch.name = picked.fullName.slice(0, 200);
  }

  try {
    const pid = String(patient.id || "").trim();
    if (pid && UUID_RE.test(pid)) {
      const updated = await updatePatient(pid, patch);
      if (updated) patient = { ...patient, ...updated };
    }
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("auth_user_id") || msg.includes("provider_subject") || msg.includes("avatar_url")) {
      console.warn("[patient-oauth] link columns missing — run migration 20260513120000_patients_oauth_linking.sql");
    } else {
      console.warn("[patient-oauth] updatePatient link:", e?.message || e);
    }
  }

  return {
    ok: true,
    patient,
    emailNormalized: emailNorm || String(patient.email || "").trim().toLowerCase(),
    declaredProvider: prov,
  };
}

module.exports = {
  resolvePatientOAuthSession,
  verifySupabaseAccessToken,
  pickOAuthIdentity,
  OAUTH_PROVIDERS: [...OAUTH_PROVIDERS],
};
