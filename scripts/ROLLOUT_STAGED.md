# Staged rollout — operational system deploy

This is **not** a UI-only release. Backend, Supabase schema, mobile app, and coordinator workspace must move together.

Use verification scripts in `scripts/` after each stage.

---

## Stage 1 — Railway backend (first)

**Deploy:** push to **`cliniflow-backend-clean` repo `main`** — Railway native GitHub integration auto-deploys (see [`../DEPLOYMENT.md`](../DEPLOYMENT.md)).

**Railway healthcheck:** `/api/health` (see repo `railway.json`).

### After deploy — automated checks

```bash
cd cliniflow-backend-clean

# Against staging/production URL after deploy:
node scripts/verify-rollout-http.cjs --base=https://YOUR-RAILWAY-HOST

# Optional authenticated probes:
export ROLLOUT_PATIENT_TOKEN="..."
export ROLLOUT_ADMIN_TOKEN="..."
node scripts/verify-rollout-http.cjs --base=https://YOUR-RAILWAY-HOST
```

### Manual / Railway logs

- [ ] Server boots without migration/runtime fatals
- [ ] `GET /api/health` → `{ ok: true }`
- [ ] `GET /api/health?deep=1` → `database.ok: true` (if Supabase configured)
- [ ] `POST /ai/intake-tags` → **not 404** (400/401 without body/token is OK)
- [ ] `GET /api/patient/me/intake-journey` → **not 404**
- [ ] `GET /api/admin/ai-leads/queues` → **not 404**

**Critical backend surfaces:** Treatment Guide chat, `operationalIntakeFlags`, intake journey, upload guidance, readiness recompute, clinic routing, coordinator queues.

---

## Stage 2 — Supabase migrations (before mobile)

**Do not ship mobile** until schema verification passes.

```bash
node scripts/verify-supabase-schema.cjs --strict
node scripts/verify-supabase-schema.cjs --list-migrations
```

### Required migrations (order)

1. `20260517100000_ai_coordinator_lead_pipeline.sql`
2. `20260517120000_ai_coordinator_coordination.sql`
3. `20260517140000_ai_coordinator_workspace.sql`
4. `20260517220000_ai_patient_documents.sql` — includes `operational_intake_flags`
5. `20260517240000_ai_patient_documents_consent_attribution.sql`
6. `20260517260000_intake_journey_event_type.sql` — `intake_journey_updated` event type

(See full list in `scripts/rollout-manifest.cjs`.)

### Watch for

- [ ] Partial migration state (some columns exist, others missing)
- [ ] Duplicate indexes / failed constraints in Supabase logs
- [ ] `operational_intake_flags` column present and jsonb
- [ ] `ai_patient_documents` table exists
- [ ] `ai_coordinator_lead_profiles` / `ai_coordinator_lead_events` exist

---

## Stage 3 — Mobile app (synchronized)

Old builds may break: missing journey/checklist fields, wrong CTAs, upload confusion.

**Ship:** EAS Update **or** new store build pointing at the deployed API URL.

### Verify on device

- [ ] Treatment Guide entry (not legacy AI-only paths)
- [ ] Goal chips → saves via `/ai/intake-tags`
- [ ] Checklist refreshes from `/api/patient/me/intake-journey`
- [ ] Photo / document upload updates flags
- [ ] Journey stepper expands; default view stays calm (≤4 checklist items)
- [ ] No “AI preview” notification spam
- [ ] Clinic CTA / routing correct for linked clinic

**Version note:** document minimum app build or OTA channel in release notes.

---

## Stage 4 — Coordinator workspace smoke test

Use a **limited** clinic (staging or production-safe), not full blast.

- [ ] `/admin-ai-leads.html` — primary queues load with counts
- [ ] 3-second scan: wait party, blocker, next step on inbox rows
- [ ] Doctor review / awaiting X-ray / human follow-up filters match reality
- [ ] Upload on patient side updates coordinator list after refresh
- [ ] Human messages still push; no notification loops / stale realtime spam

Optional: `COORDINATOR_SIM_ALLOW=1` seed on **staging only** — see `COORDINATOR_SIMULATION.md`.

---

## Stage 5 — Simulation tooling isolation

Simulation must **never** run in production unintentionally.

```bash
node scripts/verify-simulation-guards.cjs
```

- [ ] `COORDINATOR_SIM_ALLOW` **not** set on Railway production
- [ ] No cron / `npm start` hook runs seed scripts
- [ ] No HTTP route exposes seeding (`verify-rollout-http` checks forbidden paths)
- [ ] Cleanup: `sim_coord_*` sessions only on staging

---

## Stage 6 — Rollout strategy (recommended)

```
Backend deploy → schema verify → mobile deploy → limited real users
→ coordinator observation → broader rollout
```

**Do not** skip schema verification or deploy mobile against an old backend.

---

## Stage 7 — Post-deploy focus (pause feature expansion)

Prioritize for 1–2 weeks:

- Realtime stability & reconnect
- Notification hygiene
- Coordinator queue ergonomics (observation, not new AI)
- Patient confusion / upload friction
- Lifecycle edge cases

Defer: autonomous patient messaging, new scoring systems, heavy automation.

---

## One-command local checklist

Before push:

```bash
node scripts/verify-pre-rollout.cjs
```

After Railway deploy:

```bash
node scripts/verify-pre-rollout.cjs --http --base=https://YOUR-RAILWAY-HOST
```

Facilitator UI: `/admin-ops-rollout.html`
