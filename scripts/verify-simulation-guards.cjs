#!/usr/bin/env node
/**
 * Static + env checks: coordinator simulation must stay staging-only.
 */

const fs = require("fs");
const path = require("path");
const { SERVER_ENTRY_FILES } = require("./rollout-manifest.cjs");

const root = path.join(__dirname, "..");
let failed = false;

function fail(msg) {
  console.error("[sim-guards] FAIL:", msg);
  failed = true;
}

function ok(msg) {
  console.log("[sim-guards] OK:", msg);
}

for (const file of SERVER_ENTRY_FILES) {
  const p = path.join(root, file);
  const content = fs.readFileSync(p, "utf8");
  if (/seed-coordinator-simulation|clear-coordinator-simulation/i.test(content)) {
    fail(`${file} must not invoke simulation seed scripts`);
  }
  if (/COORDINATOR_SIM_ALLOW/i.test(content)) {
    fail(`${file} must not read COORDINATOR_SIM_ALLOW at runtime`);
  }
}
ok("server entry does not wire simulation scripts");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const startScript = pkg.scripts?.start || "";
if (/seed-coordinator|sim:coordinator/.test(startScript)) {
  fail('package.json "start" must not run simulation seeds');
}
ok('npm start is not coupled to simulation');

const seedPath = path.join(root, "scripts", "seed-coordinator-simulation.cjs");
const seedSrc = fs.readFileSync(seedPath, "utf8");
if (!seedSrc.includes('COORDINATOR_SIM_ALLOW !== "1"')) {
  fail("seed script missing COORDINATOR_SIM_ALLOW guard");
}
if (!seedSrc.includes("NODE_ENV === \"production\"")) {
  fail("seed script missing production guard");
}
ok("seed script has env guards");

if (process.env.COORDINATOR_SIM_ALLOW === "1" && process.env.RAILWAY_ENVIRONMENT === "production") {
  fail("COORDINATOR_SIM_ALLOW=1 on Railway production — remove immediately");
}

if (failed) process.exit(1);
console.log("\n[sim-guards] All simulation isolation checks passed.\n");
