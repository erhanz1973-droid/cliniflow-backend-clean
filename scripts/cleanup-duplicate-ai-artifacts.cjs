#!/usr/bin/env node
/**
 * Dedupe polluted AI intake artifacts (dry-run by default).
 *
 * Usage:
 *   node scripts/cleanup-duplicate-ai-artifacts.cjs --patient-id=<uuid> [--apply]
 *
 * Keeps oldest row per content_hash (documents) or originalImageUrl path (ai_result messages).
 * Archives duplicate ai_patient_documents; deletes duplicate ai_result messages (optional).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { supabase, isSupabaseEnabled } = require("../lib/supabase");

const APPLY = process.argv.includes("--apply");
const patientArg = process.argv.find((a) => a.startsWith("--patient-id="));
const patientId = patientArg ? patientArg.split("=")[1]?.trim() : null;

function normalizeDentalImageKey(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("http")) {
    try {
      return decodeURIComponent(new URL(s).pathname).split("?")[0];
    } catch {
      return s.split("?")[0];
    }
  }
  return s.split("?")[0];
}

function parseAi(row) {
  const raw = row.attachments ?? row.attachment;
  if (!raw) return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return o?.aiResult || o?.ai_result || null;
  } catch {
    return null;
  }
}

async function dedupeDocuments(pid) {
  let qb = supabase
    .from("ai_patient_documents")
    .select("id, patient_id, document_type, session_id, uploaded_at, storage_metadata, file_url")
    .neq("upload_status", "archived")
    .order("uploaded_at", { ascending: true });
  if (pid) qb = qb.eq("patient_id", pid);

  const { data, error } = await qb.limit(5000);
  if (error) throw error;

  const groups = new Map();
  for (const row of data || []) {
    const meta = row.storage_metadata && typeof row.storage_metadata === "object" ? row.storage_metadata : {};
    const hash = String(meta.content_hash || meta.contentHash || "").toLowerCase();
    const key = hash || `${row.patient_id}|${row.document_type}|${row.session_id || ""}|${row.file_url}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let archiveCount = 0;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    const keep = rows[0];
    const dupes = rows.slice(1);
    console.log(`[documents] keep ${keep.id} — archive ${dupes.length} duplicate(s)`);
    archiveCount += dupes.length;
    if (APPLY) {
      const ids = dupes.map((r) => r.id);
      await supabase
        .from("ai_patient_documents")
        .update({ upload_status: "archived", updated_at: new Date().toISOString() })
        .in("id", ids);
    }
  }
  return archiveCount;
}

async function dedupeAiResultMessages(pid) {
  let qb = supabase
    .from("messages")
    .select("id, patient_id, type, attachments, attachment, created_at")
    .eq("type", "ai_result")
    .order("created_at", { ascending: true });
  if (pid) qb = qb.eq("patient_id", pid);

  const { data, error } = await qb.limit(5000);
  if (error) throw error;

  const groups = new Map();
  for (const row of data || []) {
    const ai = parseAi(row);
    if (!ai) continue;
    const hash = String(ai.contentHash || ai.content_hash || "").toLowerCase();
    const imgKey = normalizeDentalImageKey(ai.originalImageUrl || "");
    const key = hash || `${row.patient_id}|${imgKey}`;
    if (!key || key === `${row.patient_id}|`) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let deleteCount = 0;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    const keep = rows[0];
    const dupes = rows.slice(1);
    console.log(`[ai_result] keep ${keep.id} — remove ${dupes.length} duplicate(s)`);
    deleteCount += dupes.length;
    if (APPLY) {
      const ids = dupes.map((r) => r.id);
      await supabase.from("messages").delete().in("id", ids);
    }
  }
  return deleteCount;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured.");
    process.exit(1);
  }
  console.log(APPLY ? "APPLY mode — writing changes" : "DRY RUN — pass --apply to execute");
  if (patientId) console.log("Patient filter:", patientId);

  const docDupes = await dedupeDocuments(patientId);
  const msgDupes = await dedupeAiResultMessages(patientId);
  console.log(`Done. document duplicates: ${docDupes}, ai_result duplicates: ${msgDupes}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
