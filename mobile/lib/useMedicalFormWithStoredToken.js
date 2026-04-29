/**
 * Drop-in hook: wires **AsyncStorage** into medical-form fetches so `resolveMedicalFormToken` always runs
 * (console: `STATE TOKEN`, `STORED TOKEN`, `POST TOKEN (effective)`).
 *
 * @param {string} API_URL
 * @param {string} tokenFromState — from React state/context (may be stale; storage wins when set)
 * @param {string} patientUrlId — route param / `patients.id`
 */

import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fetchMedicalForm,
  saveMedicalFormPost,
  saveMedicalFormThenRefreshPost,
} from "./medicalFormApi";

export function useMedicalFormWithStoredToken(API_URL, tokenFromState, patientUrlId) {
  const load = useCallback(
    function () {
      return fetchMedicalForm(API_URL, tokenFromState, patientUrlId, AsyncStorage);
    },
    [API_URL, tokenFromState, patientUrlId],
  );

  const save = useCallback(
    function (body) {
      return saveMedicalFormPost(API_URL, tokenFromState, patientUrlId, body, AsyncStorage);
    },
    [API_URL, tokenFromState, patientUrlId],
  );

  const saveThenRefresh = useCallback(
    function (body) {
      return saveMedicalFormThenRefreshPost(API_URL, tokenFromState, patientUrlId, body, AsyncStorage);
    },
    [API_URL, tokenFromState, patientUrlId],
  );

  return { load, save, saveThenRefresh, AsyncStorage };
}
