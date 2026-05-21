#!/usr/bin/env node
/**
 * Post-deploy HTTP smoke tests (Railway backend).
 *
 *   node scripts/verify-rollout-http.cjs --base=https://YOUR-RAILWAY-HOST
 *   node scripts/verify-rollout-http.cjs --base=https://... --patient-token=... --admin-token=...
 *
 * Without tokens: verifies routes exist (401/400 acceptable, not 404).
 * With tokens: verifies authenticated coordinator + patient intake APIs.
 */

const fs = require("fs");
const path = require("path");
const {
  HTTP_ROUTE_PROBES,
  FORBIDDEN_HTTP_PATHS,
  SERVER_ENTRY_FILES,
} = require("./rollout-manifest.cjs");

function parseArgs() {
  const out = {
    base: "",
    patientToken: process.env.ROLLOUT_PATIENT_TOKEN || "",
    adminToken: process.env.ROLLOUT_ADMIN_TOKEN || "",
    timeoutMs: 15000,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--base=")) out.base = a.slice(7).replace(/\/+$/, "");
    if (a.startsWith("--patient-token=")) out.patientToken = a.slice("--patient-token=".length);
    if (a.startsWith("--admin-token=")) out.adminToken = a.slice("--admin-token=".length);
    if (a.startsWith("--timeout=")) out.timeoutMs = parseInt(a.slice(10), 10) || 15000;
  }
  return out;
}

async function fetchStatus(base, probe, headers = {}) {
  const url = base + probe.path;
  const init = {
    method: probe.method,
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(probe.timeoutMs || 15000),
  };
  if (probe.body != null && probe.method !== "GET") {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(probe.body);
  }
  const res = await fetch(url, init);
  return res.status;
}

function verifyNoSimulationRoutesInServer() {
  const root = path.join(__dirname, "..");
  const issues = [];
  for (const file of SERVER_ENTRY_FILES) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    if (/seed-coordinator-simulation|sim_coord_|COORDINATOR_SIM_ALLOW/i.test(content)) {
      issues.push(`${file} references simulation seed tooling`);
    }
    if (/registerSimulation|\/simulation/i.test(content)) {
      issues.push(`${file} may expose simulation HTTP routes`);
    }
  }
  return issues;
}

async function main() {
  const args = parseArgs();
  if (!args.base) {
    console.error("Usage: node scripts/verify-rollout-http.cjs --base=https://YOUR-RAILWAY-HOST");
    process.exit(1);
  }

  const staticIssues = verifyNoSimulationRoutesInServer();
  if (staticIssues.length) {
    console.error("[http] Simulation exposure check FAILED:\n", staticIssues.join("\n"));
    process.exit(1);
  }
  console.log("[http] OK — index.cjs does not register simulation HTTP routes.");

  const results = [];

  for (const probe of HTTP_ROUTE_PROBES) {
    try {
      const status = await fetchStatus(args.base, probe);
      const ok = probe.expectStatuses.includes(status);
      results.push({ route: `${probe.method} ${probe.path}`, status, ok, expected: probe.expectStatuses.join("|") });
    } catch (e) {
      results.push({ route: `${probe.method} ${probe.path}`, status: "ERR", ok: false, error: e.message });
    }
  }

  for (const p of FORBIDDEN_HTTP_PATHS) {
    try {
      const status = await fetchStatus(args.base, { method: "GET", path: p, expectStatuses: [404] });
      const ok = status === 404;
      results.push({ route: `GET ${p} (must 404)`, status, ok });
    } catch (e) {
      results.push({ route: `GET ${p}`, status: "ERR", ok: false, error: e.message });
    }
  }

  if (args.patientToken) {
    try {
      const status = await fetchStatus(
        args.base,
        { method: "GET", path: "/api/patient/me/intake-journey", expectStatuses: [200] },
        { Authorization: `Bearer ${args.patientToken}` },
      );
      results.push({
        route: "GET /api/patient/me/intake-journey (auth)",
        status,
        ok: status === 200,
      });
    } catch (e) {
      results.push({ route: "GET intake-journey (auth)", status: "ERR", ok: false, error: e.message });
    }
  }

  if (args.adminToken) {
    try {
      const status = await fetchStatus(
        args.base,
        { method: "GET", path: "/api/admin/ai-leads/queues", expectStatuses: [200] },
        { Authorization: `Bearer ${args.adminToken}` },
      );
      results.push({ route: "GET /api/admin/ai-leads/queues (auth)", status, ok: status === 200 });
    } catch (e) {
      results.push({ route: "GET queues (auth)", status: "ERR", ok: false, error: e.message });
    }
  }

  console.log("\n[http] Probes against", args.base, "\n");
  console.table(results);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("\n[http] FAILED", failed.length, "probe(s).");
    process.exit(1);
  }
  console.log("\n[http] OK — core routes responding.");
  if (!args.patientToken || !args.adminToken) {
    console.log("Tip: pass --patient-token / --admin-token (or ROLLOUT_* env) for authenticated checks.");
  }
}

main().catch((e) => {
  console.error("[http] Fatal:", e.message || e);
  process.exit(1);
});
