#!/usr/bin/env node
/**
 * Seed clinifly_partner_clinic_playbook_entries from lib/cliniflyPartnerClinicPlaybookData.js
 * Usage: node scripts/seed-partner-clinic-playbook.cjs [--emit-sql]
 */

const { getPartnerClinicPlaybookData } = require("../lib/cliniflyPartnerClinicPlaybookData");

function sqlEscape(str) {
  return String(str || "").replace(/'/g, "''");
}

function formatTextArray(items) {
  if (!items?.length) return "ARRAY[]::text[]";
  return `ARRAY[${items.map((t) => `'${sqlEscape(t)}'`).join(", ")}]`;
}

function rowToInsert(row) {
  return `(
  '${sqlEscape(row.id)}',
  '${sqlEscape(row.section)}',
  '${sqlEscape(row.intent)}',
  '${sqlEscape(row.question)}',
  ${formatTextArray(row.questionAliases)},
  '${sqlEscape(row.shortAnswer)}',
  ${row.detailedAnswer ? `'${sqlEscape(row.detailedAnswer)}'` : "NULL"},
  '${sqlEscape(row.language)}',
  ${Number(row.priority) || 50},
  ${Number(row.sortOrder) || 0},
  ${formatTextArray(row.tags)}
)`;
}

function buildUpsertSql(rows) {
  const values = rows.map(rowToInsert).join(",\n");
  return `-- Auto-generated from lib/cliniflyPartnerClinicPlaybookData.js
INSERT INTO clinifly_partner_clinic_playbook_entries (
  id, section, intent, question, question_aliases, short_answer, detailed_answer, language, priority, sort_order, tags
) VALUES
${values}
ON CONFLICT (id) DO UPDATE SET
  section = EXCLUDED.section,
  intent = EXCLUDED.intent,
  question = EXCLUDED.question,
  question_aliases = EXCLUDED.question_aliases,
  short_answer = EXCLUDED.short_answer,
  detailed_answer = EXCLUDED.detailed_answer,
  language = EXCLUDED.language,
  priority = EXCLUDED.priority,
  sort_order = EXCLUDED.sort_order,
  tags = EXCLUDED.tags,
  is_active = true,
  version = clinifly_partner_clinic_playbook_entries.version + 1,
  updated_at = now();
`;
}

async function main() {
  const rows = getPartnerClinicPlaybookData();
  if (process.argv.includes("--emit-sql")) {
    process.stdout.write(buildUpsertSql(rows));
    return;
  }

  const { supabase, isSupabaseEnabled } = require("../lib/supabase");
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured — use --emit-sql");
    process.exit(1);
  }

  const payload = rows.map((r) => ({
    id: r.id,
    section: r.section,
    intent: r.intent,
    question: r.question,
    question_aliases: r.questionAliases || [],
    short_answer: r.shortAnswer,
    detailed_answer: r.detailedAnswer || null,
    language: r.language,
    priority: r.priority || 50,
    sort_order: r.sortOrder || 0,
    tags: r.tags || [],
    is_active: true,
  }));

  const { error } = await supabase.from("clinifly_partner_clinic_playbook_entries").upsert(payload, {
    onConflict: "id",
  });
  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }
  console.log(`Seeded ${payload.length} Partner Clinic Playbook rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
