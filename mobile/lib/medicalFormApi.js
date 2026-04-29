/**
 * Medical form HTTP — **always pass `AsyncStorage`** so `resolveMedicalFormToken` runs
 * (`STATE TOKEN` / `STORED TOKEN` / `POST TOKEN (effective)` logs). Copy this file next to `cliniflowAiMobile.js` if needed.
 *
 * Usage (Expo screen):
 *   import AsyncStorage from "@react-native-async-storage/async-storage";
 *   import {
 *     persistPatientAuthAfterLogin,
 *     fetchMedicalForm,
 *     saveMedicalForm,
 *     saveMedicalFormThenRefresh,
 *   } from "./medicalFormApi";
 */

import {
  persistCliniflowAuthToken,
  fetchCliniflowMedicalForm,
  saveCliniflowMedicalForm,
  saveThenRefreshMedicalForm,
} from "../../lib/cliniflowAiMobile";

function warnIfMissingStorage(AsyncStorage, label) {
  if (!AsyncStorage || typeof AsyncStorage.getItem !== "function") {
    console.error(
      `[medicalFormApi] ${label}: missing AsyncStorage — token resolver inactive; POST may 403 (stale JWT).`,
    );
    return false;
  }
  return true;
}

/** After patient login OTP success — call with `response.token`. */
export async function persistPatientAuthAfterLogin(AsyncStorage, token) {
  warnIfMissingStorage(AsyncStorage, "persistPatientAuthAfterLogin");
  return persistCliniflowAuthToken(AsyncStorage, token);
}

/** GET medical form — `AsyncStorage` last arg activates stored JWT. */
export async function fetchMedicalForm(API_URL, tokenFromState, patientUrlId, AsyncStorage) {
  warnIfMissingStorage(AsyncStorage, "fetchMedicalForm");
  return fetchCliniflowMedicalForm(API_URL, tokenFromState, patientUrlId, AsyncStorage);
}

/**
 * POST/PUT medical form — args align with `saveCliniflowMedicalForm`; **`AsyncStorage` last** (resolver).
 *
 * @param {"POST"|"PUT"} [method]
 */
export async function saveMedicalForm(
  API_URL,
  tokenFromState,
  patientUrlId,
  body,
  method,
  AsyncStorage,
) {
  warnIfMissingStorage(AsyncStorage, "saveMedicalForm");
  return saveCliniflowMedicalForm(
    API_URL,
    tokenFromState,
    patientUrlId,
    body,
    method || "POST",
    AsyncStorage,
  );
}

/**
 * Save then GET — **`AsyncStorage` last** so save + refresh both resolve JWT from storage.
 *
 * @param {"POST"|"PUT"} [saveMethod]
 */
export async function saveMedicalFormThenRefresh(
  API_URL,
  tokenFromState,
  patientUrlId,
  body,
  saveMethod,
  AsyncStorage,
) {
  warnIfMissingStorage(AsyncStorage, "saveMedicalFormThenRefresh");
  return saveThenRefreshMedicalForm(
    API_URL,
    tokenFromState,
    patientUrlId,
    body,
    saveMethod || "POST",
    AsyncStorage,
  );
}

/** POST only — 5 args (no `method` param). */
export async function saveMedicalFormPost(API_URL, tokenFromState, patientUrlId, body, AsyncStorage) {
  return saveMedicalForm(API_URL, tokenFromState, patientUrlId, body, "POST", AsyncStorage);
}

/** PUT only — 5 args. */
export async function saveMedicalFormPut(API_URL, tokenFromState, patientUrlId, body, AsyncStorage) {
  return saveMedicalForm(API_URL, tokenFromState, patientUrlId, body, "PUT", AsyncStorage);
}

/** Save + refresh — 5 args (`saveMethod` default POST). */
export async function saveMedicalFormThenRefreshPost(API_URL, tokenFromState, patientUrlId, body, AsyncStorage) {
  return saveMedicalFormThenRefresh(API_URL, tokenFromState, patientUrlId, body, "POST", AsyncStorage);
}
