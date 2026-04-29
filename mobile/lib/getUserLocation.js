/**
 * Safe, optional location — never throws to callers. Copy into your Expo app.
 *
 * Install only the feature package (do not upgrade expo / react / react-native):
 *   npx expo install expo-location
 *
 * Android / iOS native config: merge keys from `mobile/app-config-merge.example.json`
 * into your app’s `app.json` or `app.config.js` under `expo`.
 *
 * @module lib/getUserLocation
 */
import * as Location from "expo-location";

/**
 * @returns {Promise<import("expo-location").LocationObject | null>}
 */
export async function getUserLocation() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      console.log("Location permission denied");
      return null;
    }

    const location = await Location.getCurrentPositionAsync({});
    return location;
  } catch (e) {
    console.warn("Location error:", e);
    return null;
  }
}
