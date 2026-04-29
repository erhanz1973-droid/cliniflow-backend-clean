/**
 * React Native (Expo) — bu dosyayı mobil projeye kopyala: `const ai = require("./lib/cliniflowAiMobile");`
 *
 * 1) Dil değişimi: `patchCliniflowPatientLanguage(API_URL, token, lang)` — PATCH /api/patient/language
 * 2) Sağlık formu: URL’de `patients.id` UUID — **GET/POST `:patientId` must match JWT `patientId`** (see `canonicalPatientUrlIdForMedicalFormRoutes`; stale route UUIDs are replaced by JWT).
 *    Render’da: `logFormStateRender(form, prevFormRef)` veya `trackMedicalFormStateTransition` ile üzerine yazımı yakala.
 *    Debug: `logMedicalFormState(form)` veya `mobile/lib/MedicalFormLogger.jsx`.
 * **i18n:** `t('medical.xxx')` yalnızca etiketler; veri hep sabit anahtarlar (`form.has_allergy`). Asla `form[t('…')]`.
 * Dil değişiminde formu sıfırlama: `setForm(DEFAULT)` bağlama — `patchCliniflowPatientLanguage` ile sadece sunucu dili güncellenir.
 * 3) AI upload: FormData + language
 * 4) AI analyze: JSON body + language
 * 5) tedavi listesi: `GET/POST /api/patient/:patientId/treatments` — `patientTreatmentsCompatibleHeaders(token)` veya yalnız `Authorization: authorizationBearerValue(token)` (backend artık Bearer + `x-patient-token` + ham \`eyJ\` ile uyumlu).
 *
 * **Medical form — final checks (token + URL alignment)**
 * - After login: `await persistCliniflowAuthToken(AsyncStorage, response.token)` (or `AsyncStorage.setItem(cliniflowAiMobile.AUTH_TOKEN_STORAGE_KEY, jwt)`).
 * - Pass **`AsyncStorage` as last arg** into `fetchCliniflowMedicalForm` / `saveCliniflowMedicalForm` — JWT is taken from **`getCliniflowAuthToken` first** (`STATE TOKEN:` vs `STORED TOKEN:` debug). Do not rely on in-memory auth state alone after login.
 * - Legacy: omit AsyncStorage → `token` param used as-is.
 * - Console: `[medical-form] JWT vs URL :patientId` → `aligned: true` when route `patientUrlId` equals JWT `patientId` (or rely on canonical correction + confirm `POST /…/medical-form` **200**).
 * - Success: `saveCliniflowMedicalForm` / `MEDICAL-FORM RESPONSE` shows `status` 200 / `ok` true.
 *
 * Hızlı test bittikten sonra aşağıdaki satırı `null` yap (takım genelinde hep "ru" kalmasın).
 */
const HARDCODE_CLINIFLOW_LANG = "ru";

const ASYNC_STORAGE_KEY = "lang";

/** AsyncStorage key for patient JWT — use after login with `response.token`. */
const AUTH_TOKEN_STORAGE_KEY = "authToken";

/** Supabase `patients.id` — use in `/api/patient/:patientId/medical-form` so GET and POST hit the same row. */
const PATIENT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {string|undefined|null} token */
function decodeJwtPayloadNoVerify(token) {
  try {
    var parts = String(token || "").trim().split(".");
    if (parts.length < 2) return null;
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var jsonStr;
    if (typeof Buffer !== "undefined") {
      jsonStr = Buffer.from(b64, "base64").toString("utf8");
    } else if (typeof atob !== "undefined") {
      jsonStr = decodeURIComponent(
        Array.prototype.map
          .call(atob(b64), function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(""),
      );
    } else {
      return null;
    }
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

/**
 * patients.id UUID from Bearer JWT (backend signs `patientId: patientRow.id`).
 * @returns {string|null}
 */
function patientUuidFromPatientJwt(token) {
  var pl = decodeJwtPayloadNoVerify(token);
  if (!pl || typeof pl !== "object") return null;
  var cand = String(pl.patientId || pl.patientUuid || pl.patient_uuid || "").trim();
  return PATIENT_ID_UUID_RE.test(cand) ? cand : null;
}

/**
 * Prefer JWT `patientId` for `/api/patient/:patientId/medical-form` whenever the token contains a UUID.
 * Backend requires URL-resolved DB id === token-resolved id; a **wrong UUID in the route** caused 403.
 * Decode: `decodeCliniflowJwtPayload(token)` or compare `payload.patientId` === path segment.
 *
 * Login: persist the token returned after authenticate — requests must use current JWT so `patientId` matches.
 *
 * @param {string|undefined|null} patientUrlId — route / storage segment (legacy `p_…` ok)
 * @param {string|undefined|null} bearerToken
 * @returns {string}
 */
function canonicalPatientUrlIdForMedicalFormRoutes(patientUrlId, bearerToken) {
  var raw = String(patientUrlId || "").trim();
  var pl = decodeJwtPayloadNoVerify(bearerToken);
  var jwtPatientField =
    pl && typeof pl === "object"
      ? String(pl.patientId ?? pl.patientUuid ?? pl.patient_uuid ?? "").trim()
      : "";
  console.log("[medical-form] JWT vs URL :patientId", {
    jwtPayloadPatientId: jwtPatientField || null,
    urlPatientIdParam: raw || null,
    aligned:
      !!jwtPatientField &&
      !!raw &&
      jwtPatientField.toLowerCase() === raw.toLowerCase(),
  });

  var jwtUuid = patientUuidFromPatientJwt(bearerToken);
  if (jwtUuid) {
    var rawIsUuid = PATIENT_ID_UUID_RE.test(raw);
    var rawNorm = rawIsUuid ? raw.toLowerCase() : "";
    var jwtNorm = jwtUuid.toLowerCase();
    if (!rawIsUuid || rawNorm !== jwtNorm) {
      console.warn("[medical-form] canonical path UUID from JWT (URL was legacy or mismatched)", {
        pathHad: raw,
        using: jwtUuid,
      });
      return jwtUuid;
    }
    console.log("[medical-form] patient path segment:", { mode: "jwt_matches_url", value: jwtUuid });
    return jwtUuid;
  }

  if (PATIENT_ID_UUID_RE.test(raw)) {
    console.warn("[medical-form] patient path segment:", {
      mode: "url_uuid_no_jwt_patientId",
      value: raw,
      note:
        "JWT has no usable patientId — refresh login / store new token after auth; POST may 403.",
    });
    return raw;
  }
  console.warn("[medical-form] patient path segment:", {
    mode: "legacy_fallback",
    value: raw,
    note: "Not a UUID and JWT had no patientId — fix AsyncStorage/route to store patients.id.",
  });
  return raw;
}

/**
 * Decode JWT payload (`patientId`, etc.). Same intent as `JSON.parse(atob(token.split(".")[1]))`;
 * uses base64url-safe decoding (React Native / web / Node tests with Buffer).
 * @param {string|undefined|null} token
 * @returns {object|null}
 */
function decodeCliniflowJwtPayload(token) {
  return decodeJwtPayloadNoVerify(token);
}

/**
 * Same header value for GET and POST medical-form: `Bearer <jwt>` (no duplicate `Bearer`).
 * Defensive: if `token` already starts with `Bearer`, use as-is; else prefix.
 * @param {string|undefined|null} rawToken
 */
function authorizationBearerValue(rawToken) {
  if (rawToken == null || rawToken === "") return "Bearer ";
  var s = String(rawToken).trim();
  if (!s) return "Bearer ";
  if (s.startsWith("Bearer")) return s;
  return "Bearer " + s;
}

/** Raw JWT body for `x-patient-token` (no `Bearer ` prefix). */
function jwtRawTrimmed(rawToken) {
  var s = String(rawToken ?? "").trim();
  if (s.startsWith("Bearer")) s = s.replace(/^Bearer\s+/i, "").trim();
  return s;
}

/**
 * Debug / guard: decoded `patientId` equals route segment (UUID’ler case-insensitive).
 * Intent: `payload.patientId === :patientId` eşleşmesi (aynı intent: `JSON.parse(atob(token.split('.')[1])).patientId`).
 *
 * @param {string|undefined|null} rawToken
 * @param {string|undefined|null} urlPatientSegment
 * @returns {boolean}
 */
function jwtPayloadPatientIdEqualsUrlSegment(rawToken, urlPatientSegment) {
  var pl = decodeCliniflowJwtPayload(rawToken);
  var j =
    pl && typeof pl === "object"
      ? String(pl.patientId ?? pl.patientUuid ?? pl.patient_uuid ?? "").trim()
      : "";
  var u = String(urlPatientSegment ?? "").trim();
  if (!j || !u) return false;
  if (PATIENT_ID_UUID_RE.test(j) && PATIENT_ID_UUID_RE.test(u)) return j.toLowerCase() === u.toLowerCase();
  return j === u;
}

/**
 * `/api/patient/:patientId/treatments` (ve benzeri) — `Authorization` + geriye dönük `x-patient-token`.
 * @returns {{ Authorization: string, "x-patient-token": string }}
 */
function patientTreatmentsCompatibleHeaders(rawToken) {
  return {
    Authorization: authorizationBearerValue(rawToken),
    "x-patient-token": jwtRawTrimmed(rawToken),
  };
}

/**
 * Store raw JWT string (strips accidental `Bearer ` prefix). Call after successful patient login.
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} AsyncStorage
 * @param {string|undefined|null} token — e.g. `response.token`
 * @returns {Promise<boolean>}
 */
async function persistCliniflowAuthToken(AsyncStorage, token) {
  var s = String(token ?? "").trim();
  if (s.startsWith("Bearer")) s = s.replace(/^Bearer\s+/i, "").trim();
  if (!s) {
    console.warn("[persistCliniflowAuthToken] empty token — not stored");
    return false;
  }
  if (!AsyncStorage || typeof AsyncStorage.setItem !== "function") {
    console.warn("[persistCliniflowAuthToken] AsyncStorage missing");
    return false;
  }
  try {
    await AsyncStorage.setItem(AUTH_TOKEN_STORAGE_KEY, s);
    console.log("[persistCliniflowAuthToken] ok — use this token for all API + medical-form routes");
    return true;
  } catch (e) {
    console.warn("[persistCliniflowAuthToken]", e);
    return false;
  }
}

/**
 * Latest stored patient JWT (raw), or empty string.
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} AsyncStorage
 * @returns {Promise<string>}
 */
async function getCliniflowAuthToken(AsyncStorage) {
  if (!AsyncStorage || typeof AsyncStorage.getItem !== "function") return "";
  try {
    var v = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    var s = String(v ?? "").trim();
    if (s.startsWith("Bearer")) s = s.replace(/^Bearer\s+/i, "").trim();
    return s;
  } catch (e) {
    return "";
  }
}

/**
 * Prefer AsyncStorage JWT over React state for `/medical-form` (stale closure → 403).
 * Logs `STATE TOKEN:` vs `STORED TOKEN:` — when both exist and differ, **stored wins**.
 *
 * @param {string|undefined|null} tokenFromState — optional hint from `useState` (may be stale)
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} [AsyncStorage]
 * @returns {Promise<string>} raw JWT
 */
async function resolveMedicalFormToken(tokenFromState, AsyncStorage) {
  var stateTrim = jwtRawTrimmed(tokenFromState);
  var storedTrim = "";
  if (AsyncStorage && typeof AsyncStorage.getItem === "function") {
    storedTrim = jwtRawTrimmed(await getCliniflowAuthToken(AsyncStorage));
  }
  console.log("STATE TOKEN:", stateTrim ? stateTrim : "(empty)");
  console.log(
    "STORED TOKEN:",
    AsyncStorage ? (storedTrim ? storedTrim : "(empty)") : "(skipped — pass AsyncStorage to use persisted JWT)",
  );
  if (AsyncStorage && storedTrim && stateTrim && storedTrim !== stateTrim) {
    console.warn(
      "[medical-form] STATE vs STORED mismatch — using STORED (latest login JWT) to avoid 403",
    );
  }
  var effective = storedTrim || stateTrim;
  if (!effective) {
    console.warn("[medical-form] no JWT in state or AsyncStorage — POST will fail");
  }
  return effective;
}

/**
 * Canonical data keys (`normalizeMedicalFormForUi`). Bind `form.has_allergy`, not translated strings.
 * Labels: `{t('medical.allergy')}:` only — never `data[t('medical.allergy')]`.
 * @readonly
 */
var MEDICAL_FORM_DATA_KEYS = Object.freeze([
  "has_allergy",
  "allergy_details",
  "takes_medication",
  "medication_details",
  "has_chronic_disease",
  "chronic_details",
  "conditions",
  "medicationsList",
  "notes",
  "submittedAt",
]);

/**
 * Logs `FORM STATE:` (use alongside `logFormStateRender` in dev — see also `MobileFormLogger`).
 * @param {object|null|undefined} form
 */
function logMedicalFormState(form) {
  console.log("FORM STATE:", form);
}

/**
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} [AsyncStorage]
 * @returns {Promise<string>}
 */
async function getCliniflowUserLanguage(AsyncStorage) {
  if (HARDCODE_CLINIFLOW_LANG && String(HARDCODE_CLINIFLOW_LANG).trim()) {
    return String(HARDCODE_CLINIFLOW_LANG)
      .trim()
      .slice(0, 2)
      .toLowerCase();
  }
  if (typeof global !== "undefined" && global.userLanguage) {
    return String(global.userLanguage)
      .trim()
      .slice(0, 2)
      .toLowerCase();
  }
  if (AsyncStorage && typeof AsyncStorage.getItem === "function") {
    try {
      const v = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
      if (v != null && String(v).trim() !== "")
        return String(v).trim().slice(0, 2).toLowerCase();
    } catch (e) {
      /* non-fatal */
    }
  }
  return "en";
}

/**
 * PATCH /api/patient/language — backend’de hasta dilini günceller (AI ile uyumlu).
 * Bu çağrıyı **`setForm` ile doğrudan ilişkilendirme**: dil değişince tıbbi form state’ini sıfırlamayın
 * (`setForm(DEFAULT)` i18n değişiminde tetiklenmemeli — yalnızca dil + etiketler güncellenir).
 * Dil değiştiği ekranda şunu çağırın (örnek: `await patchCliniflowPatientLanguage(API_URL, token, "ru", AsyncStorage)`).
 *
 * @param {string} API_URL — örn. process.env.EXPO_PUBLIC_API_URL
 * @param {string} token — patient JWT
 * @param {string} language — iki harf: en | tr | ru | ka
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} [AsyncStorage] — verilirse `lang` anahtarı da yazılır
 * @returns {Promise<object>}
 */
async function patchCliniflowPatientLanguage(API_URL, token, language, AsyncStorage = null) {
  const lang = String(language || "")
    .trim()
    .slice(0, 2)
    .toLowerCase();
  if (!lang) {
    console.warn("[patchCliniflowPatientLanguage] empty language");
    return { ok: false, error: "empty_lang" };
  }

  console.log("TOKEN:", token);

  const base = String(API_URL || "").replace(/\/+$/, "");
  const url = `${base}/api/patient/language`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorizationBearerValue(token),
    },
    body: JSON.stringify({ language: lang }),
  });
  const json = await res.json().catch(function () {
    return {};
  });

  if (AsyncStorage && typeof AsyncStorage.setItem === "function") {
    try {
      await AsyncStorage.setItem(ASYNC_STORAGE_KEY, lang);
    } catch (e) {
      /* non-fatal */
    }
  }

  if (!res.ok || json.ok !== true) {
    console.warn("🌍 PATCH /api/patient/language failed:", res.status, json);
    return json;
  }
  console.log("🌍 MOBILE PATCH language ok:", json);
  return json;
}

/**
 * GET JSON → RN / UI-friendly **flat** fields only — no `form.allergies` / `form.medications` objects.
 * Use this with `setForm(formState)` and bind `value={form.allergy_details}`, `checked={form.has_allergy}`, etc.
 * Do not merge this with a default state that re-adds nested objects (it will hide the flat values).
 */
function normalizeMedicalFormForUi(data) {
  const src = data && typeof data === "object" ? data : {};
  const hasTopLevelCanon =
    (src.allergies !== undefined ||
      src.medications !== undefined ||
      src.conditions !== undefined) &&
    src.form === undefined &&
    src.formData === undefined;
  const raw = hasTopLevelCanon ? src : src.form || src.formData || {};
  const yn = function (field) {
    if (field && typeof field === "object" && "value" in field) return !!field.value;
    return undefined;
  };
  const detailOf = function (field) {
    if (field && typeof field === "object" && field.detail != null) return String(field.detail).trim();
    return "";
  };

  const a = raw.allergies;
  const m = raw.medications;
  const cd = raw.chronicDiseases;

  const hasAllergy =
    typeof raw.has_allergy === "boolean" ? raw.has_allergy : yn(a) !== undefined ? yn(a) : false;
  const takesMed =
    typeof raw.takes_medication === "boolean"
      ? raw.takes_medication
      : yn(m) !== undefined
        ? yn(m)
        : false;
  const hasChronic =
    typeof raw.has_chronic_disease === "boolean"
      ? raw.has_chronic_disease
      : yn(cd) !== undefined
        ? yn(cd)
        : false;

  const allergy_details =
    String(raw.allergy_details || raw.allergy_detail || raw.allergyDetails || "").trim() ||
    detailOf(a) ||
    "";
  const medication_details =
    String(raw.medication_details || raw.medication_detail || raw.medicationDetails || "").trim() ||
    detailOf(m) ||
    "";
  const chronic_details =
    String(raw.chronic_details || raw.chronic_disease_detail || raw.chronicDetail || "").trim() ||
    detailOf(cd) ||
    "";

  const formState = {
    conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
    medicationsList: raw.medicationsList != null ? String(raw.medicationsList).trim() : "",
    notes: raw.notes != null ? String(raw.notes).trim() : "",
    submittedAt: raw.submittedAt != null ? String(raw.submittedAt).trim() : "",
    has_allergy: hasAllergy,
    allergy_details,
    takes_medication: takesMed,
    medication_details,
    has_chronic_disease: hasChronic,
    chronic_details,
  };

  console.log("FINAL FORM STATE:", formState);
  return formState;
}

/**
 * After `fetchCliniflowMedicalForm(...)`, set RN state once — never merge with EMPTY defaults:
 * ✅ `applyFormStateOnly(setForm, res)`
 * ❌ `setForm({ ...DEFAULT, ...res.formState })`
 *
 * @param {function} setForm — React `setForm` from `useState`
 * @param {object} fetchResult — return value of `fetchCliniflowMedicalForm` / `saveThenRefreshMedicalForm().refreshed`
 */
function applyFormStateOnly(setForm, fetchResult) {
  const next = fetchResult && fetchResult.formState;
  if (!next || typeof next !== "object") return;
  setForm(next);
}

/**
 * Call at top of render while debugging (or use `<MedicalFormLogger form={form} />` in mobile/lib).
 * If you pass `prevFormRef` (React `useRef(null)` updated here), warns when populated form becomes cleared → conflicting useEffect.
 *
 * @param {object|null|undefined} form
 * @param {{ current?: object|null|undefined }} [prevFormRef]
 */
function logFormStateRender(form, prevFormRef) {
  console.log("FORM STATE RENDER:", form);
  if (prevFormRef) trackMedicalFormStateTransition(prevFormRef, form);
}

/** True if normalized flat shape has meaningful patient-visible content. */
function medicalFormStateHasRenderableData(form) {
  if (!form || typeof form !== "object") return false;
  if (
    form.has_allergy === true ||
    form.takes_medication === true ||
    form.has_chronic_disease === true
  )
    return true;
  if (String(form.allergy_details || "").trim()) return true;
  if (String(form.medication_details || "").trim()) return true;
  if (String(form.chronic_details || "").trim()) return true;
  if (String(form.medicationsList || "").trim()) return true;
  if (String(form.notes || "").trim()) return true;
  const c = form.conditions;
  if (Array.isArray(c) && c.some(function (x) { return x && x !== "none"; })) return true;
  return false;
}

/** True if `form` is null/undefined or has no renderable data (treat as "wiped" for overwrite detection). */
function medicalFormStateLooksCleared(form) {
  if (form == null) return true;
  if (typeof form !== "object") return true;
  return !medicalFormStateHasRenderableData(form);
}

/**
 * Compare previous render to current; call from `logFormStateRender(form, ref)` or manually each render.
 * @param {{ current?: object|null|undefined }} prevFormRef
 * @param {object|null|undefined} form
 */
function trackMedicalFormStateTransition(prevFormRef, form) {
  if (!prevFormRef) return;
  var prev = prevFormRef.current;
  if (medicalFormStateHasRenderableData(prev) && medicalFormStateLooksCleared(form)) {
    console.warn(
      "[cliniflow medical-form] Possible overwrite: had data, then cleared. Look for setForm(DEFAULT_EMPTY), a second useEffect, translated keys used as form paths (form[t(...)])), or parent remount.",
      { prev: prev, next: form },
    );
  }
  prevFormRef.current = form;
}

/**
 * POST /PUT /api/patient/:patientId/medical-form — health questionnaire.
 * Logs HTTP status + JSON for comparison with Railway `FORM BODY` / `UPSERT RESULT`.
 *
 * @param {string} API_URL
 * @param {string} token — patient Bearer
 * @param {string} patientUrlId — must match URL :patientId and JWT resolution
 * @param {object} body — { formData?: object } or flattened fields
 * @param {"POST"|"PUT"} [method] — default POST
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} [AsyncStorage] — if set, token from storage overrides stale `token` arg
 */
async function saveCliniflowMedicalForm(API_URL, token, patientUrlId, body, method, AsyncStorage) {
  const effectiveToken = await resolveMedicalFormToken(token, AsyncStorage);
  const m = String(method || "POST").toUpperCase() === "PUT" ? "PUT" : "POST";
  if (m === "PUT") console.log("PUT TOKEN (effective):", effectiveToken);
  else console.log("POST TOKEN (effective):", effectiveToken);
  if (!String(effectiveToken ?? "").trim()) {
    console.warn("[saveCliniflowMedicalForm] TOKEN is missing — Authorization will fail; POST/PUT requires patient JWT.");
  }

  const base = String(API_URL || "").replace(/\/+$/, "");
  const canonicalId = canonicalPatientUrlIdForMedicalFormRoutes(patientUrlId, effectiveToken);
  const id = encodeURIComponent(canonicalId);
  const url = `${base}/api/patient/${id}/medical-form`;
  const payload = body && typeof body === "object" ? body : {};
  console.log("FORM BODY (client):", payload);

  const auth = authorizationBearerValue(effectiveToken);
  const res = await fetch(url, {
    method: m,
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  console.log("MEDICAL-FORM RESPONSE:", { status: res.status, ok: res.ok, json });
  return { status: res.status, ok: res.ok, ...json };
}

/**
 * GET /api/patient/:patientId/medical-form — use the same `patientUrlId` string as POST.
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} [AsyncStorage]
 */
async function fetchCliniflowMedicalForm(API_URL, token, patientUrlId, AsyncStorage) {
  const effectiveToken = await resolveMedicalFormToken(token, AsyncStorage);
  const canonicalId = canonicalPatientUrlIdForMedicalFormRoutes(patientUrlId, effectiveToken);
  const pid = String(canonicalId || "").trim();
  console.log("GET PATIENT ID (canonical for URL):", pid);
  console.log("GET TOKEN (effective):", effectiveToken);

  const base = String(API_URL || "").replace(/\/+$/, "");
  const url = `${base}/api/patient/${encodeURIComponent(pid)}/medical-form`;

  const authGet = authorizationBearerValue(effectiveToken);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authGet,
    },
  });

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  console.log("HEALTH GET RESPONSE:", data);
  const merged = { status: res.status, ok: res.ok, ...data };
  const formState = normalizeMedicalFormForUi(merged);
  // UI: use `formState` only (flat). Avoid merging with a default that contains `allergies` / `medications` objects.
  return { ...merged, formState };
}

/**
 * POST/PUT save, then GET so the screen can replace local state with fresh `form` / `formData`.
 *
 * @param {"POST"|"PUT"} saveMethod — match the screen’s save method
 * @param {import("@react-native-async-storage/async-storage").AsyncStorage | null} [AsyncStorage]
 */
async function saveThenRefreshMedicalForm(API_URL, token, patientUrlId, body, saveMethod, AsyncStorage) {
  const save = await saveCliniflowMedicalForm(API_URL, token, patientUrlId, body, saveMethod || "POST", AsyncStorage);
  const httpOk = save.status >= 200 && save.status < 300;
  if (!httpOk || save.ok === false) {
    return { save, refreshed: null };
  }
  const refreshed = await fetchCliniflowMedicalForm(API_URL, token, patientUrlId, AsyncStorage);
  return { save, refreshed };
}

/**
 * POST /api/chat/ai-upload — multipart; asla JSON body ile file gönderme.
 */
async function postCliniflowAiUpload(API_URL, token, imageUri, userLanguage) {
  const formData = new FormData();
  formData.append("file", {
    uri: imageUri,
    name: "photo.jpg",
    type: "image/jpeg",
  });
  formData.append("language", userLanguage);

  console.log("🌍 MOBILE LANG (upload):", userLanguage);

  const base = String(API_URL || "").replace(/\/+$/, "");
  const url = `${base}/api/chat/ai-upload`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
}

/**
 * POST /api/chat/ai-analyze
 */
async function postCliniflowAiAnalyze(API_URL, token, body, userLanguage) {
  const payload = { ...(body && typeof body === "object" ? body : {}), language: userLanguage };
  console.log("🌍 MOBILE LANG (analyze):", userLanguage);

  const base = String(API_URL || "").replace(/\/+$/, "");
  const url = `${base}/api/chat/ai-analyze`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

const ai = {
  HARDCODE_CLINIFLOW_LANG,
  ASYNC_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  MEDICAL_FORM_DATA_KEYS,
  persistCliniflowAuthToken,
  getCliniflowAuthToken,
  resolveMedicalFormToken,
  getCliniflowUserLanguage,
  patchCliniflowPatientLanguage,
  postCliniflowMedicalForm: function (API_URL, token, patientUrlId, body, AsyncStorage) {
    return saveCliniflowMedicalForm(API_URL, token, patientUrlId, body, "POST", AsyncStorage);
  },
  saveCliniflowMedicalForm,
  fetchCliniflowMedicalForm,
  normalizeMedicalFormForUi,
  patientUuidFromPatientJwt,
  decodeCliniflowJwtPayload,
  canonicalPatientUrlIdForMedicalFormRoutes,
  authorizationBearerValue,
  jwtRawTrimmed,
  jwtPayloadPatientIdEqualsUrlSegment,
  patientTreatmentsCompatibleHeaders,
  applyFormStateOnly,
  logMedicalFormState,
  logFormStateRender,
  medicalFormStateHasRenderableData,
  medicalFormStateLooksCleared,
  trackMedicalFormStateTransition,
  saveThenRefreshMedicalForm,
  postCliniflowAiUpload,
  postCliniflowAiAnalyze,
};

module.exports = ai;
/** @type {typeof ai} */
module.exports.default = ai;
