/**
 * MEDICAL FORM — copy **`useMedicalFormWithStoredToken.js`** into the Expo screen (resolver active at runtime),
 * or import from **`./medicalFormApi`** with **AsyncStorage** on every call.
 *
 * Minimal screen wiring:
 *
 * ```js
 * import { useMedicalFormWithStoredToken } from "./useMedicalFormWithStoredToken";
 * import { persistPatientAuthAfterLogin } from "./medicalFormApi";
 *
 * // After login:
 * await persistPatientAuthAfterLogin(AsyncStorage, response.token);
 *
 * const { load, save } = useMedicalFormWithStoredToken(API_URL, tokenFromAuthContext, patientId);
 * await load();   // → STATE TOKEN / STORED TOKEN / GET TOKEN (effective)
 * await save({}); // → POST TOKEN (effective)
 * ```
 *
 * Data vs i18n: stable keys (`form.has_allergy`); labels only via `t()`.
 * Lifecycle: `applyFormStateOnly(setForm, res)` from `fetch` result once.
 */
