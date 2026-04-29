/**
 * Optional debug component — remove in production.
 * Prefer **`useMedicalFormWithStoredToken`** for API calls — it passes AsyncStorage into `cliniflowAiMobile` token resolver (STATE vs STORED logs).
 *
 * Path assumes: `MedicalFormLogger.jsx` in `mobile/lib/` and `lib/cliniflowAiMobile.js` at repo root (or copy both next to each other → import `"./cliniflowAiMobile"`).
 */

import React from "react";
import { logMedicalFormState, logFormStateRender } from "../../lib/cliniflowAiMobile";

export function MedicalFormLogger({ form, prevFormRef }) {
  logMedicalFormState(form);
  logFormStateRender(form, prevFormRef);
  return null;
}
