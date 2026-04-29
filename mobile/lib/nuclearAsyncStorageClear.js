/**
 * Full AsyncStorage wipe — use only while debugging stale RN state.
 *
 * @param {import("@react-native-async-storage/async-storage").default | null} AS
 * @returns {Promise<void>}
 */
export function runNuclearAsyncStorageClear(AS) {
  if (!AS || typeof AS.getAllKeys !== "function") {
    console.warn("[nuclearAsyncStorageClear] AsyncStorage missing");
    return Promise.resolve();
  }
  return AS.getAllKeys()
    .then((keys) => {
      console.log("STORAGE KEYS:", keys);
      return AS.removeItem("persist:root").catch(() => {});
    })
    .then(() => AS.clear())
    .then(() => console.log("STORAGE FULLY CLEARED"))
    .catch((e) => console.warn("[nuclearAsyncStorageClear]", e));
}
