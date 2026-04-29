import { getApiBaseUrl } from "./apiConfig.js";

/**
 * Hit public + one protected route to verify TCP + same host as web.
 * Admin route may return 401 — still proves you reached the deployed API.
 */
export async function runBackendDebugProbes() {
  const base = getApiBaseUrl();
  console.log("[probe] API URL used:", base);

  const paths = ["/api/health", "/api/ping", "/api/version", "/api/admin/billing/usage"];

  for (const path of paths) {
    const url = `${base}${path}`;
    console.log("[fetch]", url);
    try {
      const r = await fetch(url);
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_e) {
        data = text;
      }
      console.log(`BACKEND DATA [${path}] status=${r.status}:`, data);
    } catch (e) {
      console.warn(`[probe] failed ${path}`, e);
    }
  }
}
