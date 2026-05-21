#!/usr/bin/env node
/**
 * Run schema + optional HTTP verification before/after deploy.
 *
 *   node scripts/verify-pre-rollout.cjs
 *   node scripts/verify-pre-rollout.cjs --http --base=https://...
 */

const { spawnSync } = require("child_process");
const path = require("path");

const node = process.execPath;
const scriptsDir = __dirname;

function run(script, extraArgs = []) {
  const r = spawnSync(node, [path.join(scriptsDir, script), ...extraArgs], {
    stdio: "inherit",
    env: process.env,
  });
  return r.status === 0;
}

function main() {
  const http = process.argv.includes("--http");
  const baseIdx = process.argv.findIndex((a) => a.startsWith("--base="));
  const baseArg = baseIdx >= 0 ? process.argv[baseIdx] : null;

  console.log("=== Cliniflow pre-rollout verification ===\n");

  if (!run("verify-supabase-schema.cjs", ["--strict"])) {
    process.exit(1);
  }

  if (!run("verify-simulation-guards.cjs")) {
    process.exit(1);
  }

  if (http) {
    if (!baseArg) {
      console.error("Pass --base=https://YOUR-RAILWAY-HOST with --http");
      process.exit(1);
    }
    if (!run("verify-rollout-http.cjs", [baseArg])) {
      process.exit(1);
    }
  } else {
    console.log("\nSkip HTTP probes (add --http --base=... after Railway deploy).\n");
  }

  console.log("\n=== Pre-rollout checks passed ===\n");
}

main();
