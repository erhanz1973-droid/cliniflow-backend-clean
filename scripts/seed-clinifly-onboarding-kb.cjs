#!/usr/bin/env node
/**
 * Seed clinifly_onboarding_kb_entries from lib/cliniflyOnboardingKbBundled.js
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-clinifly-onboarding-kb.cjs
 */

const { createClient } = require("@supabase/supabase-js");
const { getBundledCliniflyOnboardingKb } = require("../lib/cliniflyOnboardingKbBundled");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const entries = getBundledCliniflyOnboardingKb();

async function main() {
  for (const e of entries) {
    const row = {
      id: e.id,
      screen_key: e.screenKey,
      topic_id: e.topicId,
      priority: e.priority,
      locales: e.locales,
      questions: e.questions,
      user_explanation: e.userExplanation,
      steps: e.steps,
      common_mistakes: e.commonMistakes,
      faq: e.faq,
      ai_support_answers: e.aiSupportAnswers,
      tags: e.tags,
      is_active: true,
    };
    const { error } = await supabase.from("clinifly_onboarding_kb_entries").upsert(row, { onConflict: "id" });
    if (error) {
      console.error(e.id, error.message);
      process.exit(1);
    }
    console.log("OK", e.id);
  }
  console.log("Seeded", entries.length, "onboarding KB entries");
}

main();
