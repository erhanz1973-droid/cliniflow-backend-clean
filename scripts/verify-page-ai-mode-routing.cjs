#!/usr/bin/env node
/**
 * Verify meta_page_connections.ai_mode routing for Clinifly vs clinic pages.
 * Usage: node scripts/verify-page-ai-mode-routing.cjs [--apply]
 *   --apply  Run UPDATE for Clinifly page (930773003458773) → clinifly_sales
 */
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  getActivePageConnectionByPageId,
} = require("../lib/omnichannel/metaPageConnections");
const { normalizePageAiMode, PAGE_AI_MODE } = require("../lib/pageAiMode");

const CLINIFLY_PAGE_ID = "930773003458773";
const ELKO_PAGE_ID = "379597088571807";

const APPLY = process.argv.includes("--apply");

function routingDecision(pageAiMode, source = "messenger") {
  const mode = normalizePageAiMode(pageAiMode);
  if (mode === PAGE_AI_MODE.HUMAN && source === "messenger") {
    return { assistant: "none", reason: "human_only_page" };
  }
  const useCliniflySales =
    mode === PAGE_AI_MODE.CLINIFLY_SALES && source === "messenger";
  return {
    assistant: useCliniflySales ? "clinifly_sales" : "clinic",
    pageAiMode: mode,
    useCliniflySales,
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env");
    process.exit(1);
  }
  const sb = createClient(url, key);

  if (APPLY) {
    console.log("\n--- SQL (apply) ---\n");
    const sql = `-- Clinifly Sales AI only on Clinifly Facebook Page
UPDATE meta_page_connections
SET ai_mode = 'clinifly_sales', updated_at = NOW()
WHERE page_id = '${CLINIFLY_PAGE_ID}';

-- Ensure Elko Luxe stays clinic AI
UPDATE meta_page_connections
SET ai_mode = 'clinic', updated_at = NOW()
WHERE page_id = '${ELKO_PAGE_ID}';`;
    console.log(sql);

    const { error: e1 } = await sb
      .from("meta_page_connections")
      .update({ ai_mode: "clinifly_sales", updated_at: new Date().toISOString() })
      .eq("page_id", CLINIFLY_PAGE_ID);
    if (e1) {
      console.error("Clinifly update failed:", e1.message);
      process.exit(1);
    }
    const { error: e2 } = await sb
      .from("meta_page_connections")
      .update({ ai_mode: "clinic", updated_at: new Date().toISOString() })
      .eq("page_id", ELKO_PAGE_ID);
    if (e2) {
      console.error("Elko update failed:", e2.message);
      process.exit(1);
    }
    console.log("\n✓ Updates applied via Supabase API\n");
  }

  console.log("--- SQL (verify) ---\n");
  const verifySql = `SELECT page_id, page_name, clinic_id, ai_mode, status, webhook_subscribed
FROM meta_page_connections
WHERE page_id IN ('${CLINIFLY_PAGE_ID}', '${ELKO_PAGE_ID}')
ORDER BY page_name;`;
  console.log(verifySql + "\n");

  const { data: rows, error } = await sb
    .from("meta_page_connections")
    .select("page_id, page_name, clinic_id, ai_mode, status, webhook_subscribed")
    .in("page_id", [CLINIFLY_PAGE_ID, ELKO_PAGE_ID])
    .order("page_name");
  if (error) {
    console.error("Verify query failed:", error.message);
    process.exit(1);
  }
  console.log("--- Verify results ---\n");
  console.table(rows);

  console.log("\n--- Production routing (active connection only) ---\n");
  for (const pageId of [CLINIFLY_PAGE_ID, ELKO_PAGE_ID]) {
    const row = rows.find((r) => r.page_id === pageId);
    const active = await getActivePageConnectionByPageId(pageId);
    const configuredMode = normalizePageAiMode(row?.ai_mode);
    const decision = routingDecision(configuredMode, "messenger");
    console.log({
      pageId,
      pageName: row?.page_name,
      configured_ai_mode: configuredMode,
      connection_status: row?.status,
      active_connection_found: Boolean(active?.clinic_id),
      messenger_webhook_will_process: Boolean(active?.clinic_id),
      routed_assistant: active ? decision.assistant : "(none — page not active)",
    });
  }

  const cliniflyOk = rows.find((r) => r.page_id === CLINIFLY_PAGE_ID)?.ai_mode === "clinifly_sales";
  const elkoOk = rows.find((r) => r.page_id === ELKO_PAGE_ID)?.ai_mode === "clinic";
  if (!cliniflyOk || !elkoOk) {
    console.error("\nFAIL: ai_mode mismatch", { cliniflyOk, elkoOk });
    process.exit(1);
  }
  console.log("\n✓ ai_mode configuration OK");
  if (!APPLY) {
    console.log("\nRun with --apply to execute updates.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
