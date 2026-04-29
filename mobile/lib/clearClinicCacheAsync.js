/**
 * Drops AsyncStorage entries that often hold stale clinic/search/auth-adjacent blobs
 * after an API URL change. Bump FLUSH_MARKER when you need everyone to purge again.
 *
 * Usage (App.tsx / root layout, once):
 *   import AsyncStorage from "@react-native-async-storage/async-storage";
 *   import { ensureClinicStaleDataFlushedOnce } from "./lib/clearClinicCacheAsync";
 *   useEffect(() => {
 *     ensureClinicStaleDataFlushedOnce(AsyncStorage).catch(console.warn);
 *   }, []);
 */
const FLUSH_MARKER = "__cliniflow_clinic_flush_v1";

/** @param {import("@react-native-async-storage/async-storage").default | null | undefined} AS */
async function getAllKeysSafe(AS) {
  if (!AS || typeof AS.getAllKeys !== "function") return [];
  try {
    return await AS.getAllKeys();
  } catch (_e) {
    return [];
  }
}

/** @param {string} key */
function looksClinicStale(key) {
  const k = String(key).toLowerCase();
  return (
    k.includes("clinic") ||
    k.includes("nearby_clinic") ||
    k.includes("onboarding") ||
    k.includes("cliniflow") ||
    /^persist:.+clinic/i.test(key)
  );
}

/**
 * @param {import("@react-native-async-storage/async-storage").default | null | undefined} AS
 */
export async function clearClinicRelatedAsyncStorage(AS) {
  const keys = await getAllKeysSafe(AS);
  const toRemove = keys.filter((k) => looksClinicStale(k));
  if (!toRemove.length) {
    console.log("[clearClinicCacheAsync] no clinic-shaped keys found");
    return;
  }
  if (typeof AS.multiRemove === "function") {
    await AS.multiRemove(toRemove);
  } else if (typeof AS.removeItem === "function") {
    for (const k of toRemove) {
      await AS.removeItem(k);
    }
  }
  console.log("[clearClinicCacheAsync] removed keys:", toRemove.length, toRemove);
}

/**
 * One-time purge after migrating API URL (avoid wiping on every boot).
 *
 * @param {import("@react-native-async-storage/async-storage").default} AS
 */
export async function ensureClinicStaleDataFlushedOnce(AS) {
  if (!AS || typeof AS.getItem !== "function") return;
  try {
    const done = await AS.getItem(FLUSH_MARKER);
    if (done === "done") return;
    console.log("[clearClinicCacheAsync] first-run purge after API base update");
    await clearClinicRelatedAsyncStorage(AS);
    await AS.setItem(FLUSH_MARKER, "done").catch(() => {});
  } catch (e) {
    console.warn("[ensureClinicStaleDataFlushedOnce]", e);
  }
}
