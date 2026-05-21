# Coordinator workflow simulation (staging)

Repeatable **20–30 lead** dataset for observing coordinator ergonomics — not for production.

## Safety guards

| Guard | Purpose |
|--------|---------|
| `COORDINATOR_SIM_ALLOW=1` | Required to run any seed/clear script |
| `NODE_ENV=production` | Blocked unless `COORDINATOR_SIM_FORCE=1` |
| `SUPABASE_URL` contains `prod` | Blocked unless forced |
| `session_id` prefix `sim_coord_` | Identifies simulation leads for cleanup |
| Patient emails `coordinator-sim+*@staging.cliniflow.invalid` | Safe to delete |

## Quick start

```bash
cd cliniflow-backend-clean
export COORDINATOR_SIM_ALLOW=1
# Use staging Supabase credentials in .env

# Optional: reset previous sim data
node scripts/seed-coordinator-simulation.cjs --clinic-id=YOUR_CLINIC_UUID --clear

# Seed 28 scenarios (default)
node scripts/seed-coordinator-simulation.cjs --clinic-id=YOUR_CLINIC_UUID

# Preview without writes
node scripts/seed-coordinator-simulation.cjs --clinic-id=YOUR_CLINIC_UUID --dry-run

# Clear only
node scripts/clear-coordinator-simulation.cjs --clinic-id=YOUR_CLINIC_UUID
```

npm scripts:

```bash
COORDINATOR_SIM_ALLOW=1 npm run sim:coordinator:seed -- --clinic-id=...
COORDINATOR_SIM_ALLOW=1 npm run sim:coordinator:clear -- --clinic-id=...
```

## What gets created

- **28 lead profiles** covering: missing X-ray/photos, doctor review backlog, human handoff, consultation-ready, inactive/stale, implant/cosmetic tags, multilingual (`tr`, `de`, `ru`, `ka`, `ar`, …), escalations, AI unresolved.
- **`operational_intake_flags`** built via the same `buildOperationalIntakeState()` used in production (no parallel taxonomy).
- Optional **simulation documents** (placeholder URLs) where scenarios need doctor review or completeness.
- One **timeline event** per lead.

Scenario facilitator notes live in `scripts/coordinator-simulation-dataset.cjs` (`observerNote` per scenario).

## How to run the observation session

**Do not ask:** “Do you like the UI?”

**Do observe** (15–20 min per coordinator):

| Signal | What it means |
|--------|----------------|
| Hesitation before opening a lead | 3-second scan may be failing |
| Opens wrong queue repeatedly | Queue labels or counts confusing |
| Misses doctor-review backlog | Priority ordering issue |
| Ignores “waiting on clinic” rows | Ownership line not visible enough |
| Repeated clicks same lead | Blocker/next action unclear |
| Scrolling past stale leads | Timing line too subtle |
| Treats list badges as primary (if any) | Regression toward CRM noise |

Use the checklist in `/admin-ops-rollout.html` → **3-second scan** and **Workflow stress test**.

## Regression checklist (repeat after UI changes)

1. `GET /api/admin/ai-leads/queues` — counts match visible tabs  
2. Primary queues filter correctly (`doctor_review`, `awaiting_xray`, …)  
3. Inbox row answers: wait party, blocker, next step  
4. Detail panel still has full SLA / documents / human mode  
5. `npm run sim:coordinator:clear` removes all `sim_coord_*` sessions  

## Files

| File | Role |
|------|------|
| `coordinator-simulation-dataset.cjs` | Scenario definitions (reusable) |
| `seed-coordinator-simulation.cjs` | Insert/update staging data |
| `clear-coordinator-simulation.cjs` | Remove simulation data |
| `../OPERATIONS_ROLLOUT.md` | Deploy + version coupling |
| `../public/admin-ops-rollout.html` | Printable facilitator checklist |
