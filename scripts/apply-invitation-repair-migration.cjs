#!/usr/bin/env node
/**
 * Apply invitation redeem schema repair on Supabase (DDL).
 * Usage: SUPABASE_DB_URL=postgresql://... node scripts/apply-invitation-repair-migration.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const SQL_PATH = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260603120000_invitation_redeem_schema_repair.sql",
);

async function main() {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  if (!DB_URL) {
    console.error("SUPABASE_DB_URL not set. Paste this SQL in Supabase SQL Editor:\n");
    console.log("---");
    console.log(sql);
    console.log("---");
    process.exit(1);
  }
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(sql);
    console.log("✅ Invitation redeem schema repair applied.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
