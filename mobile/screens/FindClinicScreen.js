/**
 * Find Clinic: one combined search field (city synonym + free text). No separate city screen, no location gate.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { SearchBar } from "../../components/ui/SearchBar";
import { fetchBrowseClinics } from "../lib/findClinicApi";
import { getApiBaseUrl } from "../lib/apiConfig";
import { runBackendDebugProbes } from "../lib/debugBackendProbe";
import { runNuclearAsyncStorageClear } from "../lib/nuclearAsyncStorageClear";
import {
  CLINIFLOW_LOG_NETWORK_PROBES_ON_MOUNT,
  CLINIFLOW_NUCLEAR_ASYNC_STORAGE_ON_MOUNT,
} from "../lib/debugRuntimeFlags";
import { useLanguage } from "../lib/language-context";
import { parseQuery } from "../lib/parseQuery";

const API_BASE = getApiBaseUrl();

/** Default browse context when search is cleared (replace with profile / stored city later). */
export const DEFAULT_FIND_CITY_CODE = "tbilisi";

const DEBOUNCE_MS = 300;

async function readOptionalPatientJwt() {
  try {
    const AS = (await import("@react-native-async-storage/async-storage")).default;
    /** @type {string[]} */
    const keys = ["@cliniflow:patient_jwt", "@cliniflow:patient_token", "patientJwt", "jwt"];
    // eslint-disable-next-line no-await-in-loop
    for (const k of keys) {
      const v = await AS.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
  } catch (_e) {
    /* AsyncStorage unavailable in some test envs */
  }
  return null;
}

/** Top inset for header back row (status bar / notch) when not using SafeAreaProvider. */
const HEADER_TOP_PAD =
  Platform.OS === "ios"
    ? 52
    : (typeof StatusBar.currentHeight === "number" ? StatusBar.currentHeight : 24) + 8;

/** @param {{ initialCityCode?: string, onGoBack?: () => void }} [props] Hydrate from geo / profile when available (still no permission prompt). */
export default function FindClinicScreen(props) {
  const { t, currentLanguage } = useLanguage();
  const initial =
    typeof props?.initialCityCode === "string" && props.initialCityCode.trim()
      ? props.initialCityCode.trim().toLowerCase()
      : DEFAULT_FIND_CITY_CODE;

  const [input, setInput] = useState("");
  /** Browse context label + GET city_code (synced from parser + fallbacks). */
  const [cityCode, setCityCode] = useState(initial);
  /** Free-text remainder sent as ?query= */
  const [query, setQuery] = useState("");

  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);

  /** When the field has no city token, keep filtering under the last explicit city (or default). */
  const lastCityContextRef = useRef(initial);

  /** Stable UI strings — avoid `t(...)` churn on unrelated re-renders; refresh when locale changes. */
  const uiCopy = useMemo(
    () => ({
      find_clinic_search_label: t("find_clinic_search_label"),
      find_clinic_shown_base: t("find_clinic_shown_count"),
    }),
    [t, currentLanguage],
  );

  useEffect(() => {
    lastCityContextRef.current = initial;
    setCityCode(initial);
  }, [initial]);

  useEffect(() => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.log("SCREEN MOUNTED", "FindClinicScreen");
    }

    if (CLINIFLOW_LOG_NETWORK_PROBES_ON_MOUNT) {
      runBackendDebugProbes().catch((e) => console.warn("[FindClinicScreen] probe", e));
    }
    if (CLINIFLOW_NUCLEAR_ASYNC_STORAGE_ON_MOUNT) {
      try {
        const AS = require("@react-native-async-storage/async-storage").default;
        runNuclearAsyncStorageClear(AS);
      } catch (e) {
        console.warn(
          "[FindClinicScreen] install @react-native-async-storage/async-storage for storage clear:",
          e?.message || e,
        );
      }
    }
  }, []);

  useEffect(() => {
    const raw = input.trim();
    if (!raw) {
      lastCityContextRef.current = initial;
      setCityCode(initial);
      setQuery("");
      return;
    }
    const parsed = parseQuery(raw);
    if (parsed.cityCode) lastCityContextRef.current = parsed.cityCode;
    setCityCode(lastCityContextRef.current);
    setQuery(parsed.query);
  }, [input, initial]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const raw = input.trim();
      const cityForApi = !raw ? initial : lastCityContextRef.current;
      const queryForApi = !raw ? "" : parseQuery(raw).query;

      if (cancelled) return;
      setLoading(true);
      setListError(null);

      const token = await readOptionalPatientJwt();
      const { ok, clinics: rows, error } = await fetchBrowseClinics(
        API_BASE,
        { cityCode: cityForApi, query: queryForApi },
        token,
      );

      if (cancelled) return;
      if (!ok) {
        setClinics((prev) => (Array.isArray(prev) && prev.length ? prev : []));
        setListError(error || "browse_failed");
      } else {
        setClinics(rows);
        setListError(null);
      }
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, initial]);

  const cityLabelKey = `city.${cityCode}`;
  const cityLabel = useMemo(
    () => t(cityLabelKey),
    [t, currentLanguage, cityLabelKey],
  );

  return (
    <View style={styles.container}>
      {typeof props?.onGoBack === "function" ? (
        <View style={[styles.topHeader, { paddingTop: HEADER_TOP_PAD }]}>
          <TouchableOpacity
            onPress={props.onGoBack}
            style={styles.topBackBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.topBackText}>← Back</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Pressable style={styles.pinRow} hitSlop={8} disabled>
        <Text style={styles.pinEmoji} accessibilityLabel={cityLabel}>
          📍
        </Text>
        <Text style={styles.pinText}>{cityLabel}</Text>
      </Pressable>

      <SearchBar
        label={uiCopy.find_clinic_search_label}
        value={input}
        onChangeText={setInput}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {query.trim() ? <Text style={styles.queryHint}>{query}</Text> : null}

      {loading ? <ActivityIndicator color="#94a3b8" /> : null}

      {listError ? (
        <Text style={styles.warn}>{String(listError).slice(0, 160)}</Text>
      ) : null}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {clinics.map((c) => (
          <View key={String(c.id || c.clinicCode)} style={styles.card}>
            <Text style={styles.clinicName}>{c.name || "—"}</Text>
            <Text style={styles.clinicMeta} numberOfLines={2}>
              {[c.city || c.city_code, c.country, c.clinicCode].filter(Boolean).join(" · ")}
            </Text>
          </View>
        ))}
        {!loading && clinics.length === 0 && !listError ? (
          <Text style={styles.muted}>{uiCopy.find_clinic_shown_base.replace("%{count}", "0")}</Text>
        ) : null}
      </ScrollView>

      <Text style={styles.footerCount}>
        {uiCopy.find_clinic_shown_base.replace("%{count}", String(clinics.length))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16, gap: 12, backgroundColor: "#020617" },
  topHeader: {
    marginHorizontal: -16,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e293b",
  },
  topBackBtn: { alignSelf: "flex-start", paddingVertical: 6, paddingRight: 12 },
  topBackText: { fontSize: 16, fontWeight: "600", color: "#93c5fd" },
  pinRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pinEmoji: { fontSize: 18 },
  pinText: { color: "#e2e8f0", fontSize: 16, fontWeight: "700" },
  queryHint: { color: "#64748b", fontSize: 12 },
  warn: { color: "#f97316", fontSize: 12 },
  muted: { color: "#64748b", fontSize: 13 },
  list: { flex: 1 },
  card: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e293b",
  },
  clinicName: { color: "#f1f5f9", fontSize: 16, fontWeight: "600" },
  clinicMeta: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
  footerCount: { color: "#64748b", fontSize: 12 },
});
