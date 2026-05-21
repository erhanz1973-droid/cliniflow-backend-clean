# Cliniflow operations rollout (Phase 3)

**Staged deploy checklist (authoritative):** [`scripts/ROLLOUT_STAGED.md`](scripts/ROLLOUT_STAGED.md)

Coupled surfaces: **patient app** (`cliniflow-app`), **Railway backend** (`cliniflow-backend-clean`), **Supabase migrations**, **admin UI** (Netlify repo + static pages from backend `public/`).

## Verification commands

```bash
cd cliniflow-backend-clean
npm run verify:pre-rollout                    # schema + sim guards (before push)
npm run verify:pre-rollout -- --http --base=https://YOUR-RAILWAY-HOST   # after deploy
npm run verify:schema
node scripts/verify-rollout-http.cjs --base=https://YOUR-RAILWAY-HOST
```

## Staging strategy

| Environment | Backend | Database | Admin UI | Patient app |
|---------------|---------|----------|----------|-------------|
| **Local** | `cd cliniflow-backend-clean && npm start` | Supabase dev project or local | Open `public/admin-*.html` via backend or Netlify dev | Expo dev client → `EXPO_PUBLIC_API_URL` |
| **Staging** (recommended) | Railway service branch / preview + `RAILWAY_ENVIRONMENT=staging` | Dedicated Supabase project or branch | Netlify deploy preview | EAS internal build profile `staging` |
| **Production** | Railway `main` → Root Directory `cliniflow-backend-clean` | Production Supabase | Netlify production admin | App Store / Play production |

**Rules**

1. Run new SQL migrations on **staging Supabase** before production.
2. Deploy backend to staging; verify API before shipping mobile.
3. Never point a production mobile build at a staging API (or vice versa).

## Migration tracking checklist

Apply in filename order under `cliniflow-backend-clean/supabase/migrations/`:

- [ ] `20260517100000_ai_coordinator_lead_pipeline.sql`
- [ ] `20260517120000_ai_coordinator_coordination.sql`
- [ ] `20260517140000_ai_coordinator_workspace.sql`
- [ ] `20260517160000_clinic_partner_hotels.sql`
- [ ] `20260517180000_clinic_treatment_protocols.sql`
- [ ] `20260517200000_ai_visit_plan_drafts.sql`
- [ ] `20260517220000_ai_patient_documents.sql`
- [ ] `20260517240000_ai_patient_documents_consent_attribution.sql`
- [ ] `20260517260000_intake_journey_event_type.sql`

After apply, confirm:

- [ ] `ai_coordinator_lead_profiles.operational_intake_flags` populated on new chats
- [ ] `ai_patient_documents` table exists
- [ ] Timeline accepts `intake_journey` event type (if migration added)

## Backend / app version compatibility

| Capability | Min backend | Patient app |
|------------|-------------|-------------|
| Treatment Guide `contextMode=treatment_guide` | Phase 1 deploy | `treatment-guide` screen |
| `POST /ai/intake-tags`, `GET /api/patient/me/intake-journey` | Phase 2 deploy | Goal chips + checklist |
| Admin intake queues `?queue=` + `/api/admin/ai-leads/queues` | Phase 3 deploy | N/A (admin only) |

**Mismatch symptoms**

- 404 on `/api/patient/me/intake-journey` → app shows empty checklist; upgrade backend first.
- Missing `operational_intake_flags` column → coordinator queues empty; run migrations.
- Old admin HTML cached → hard refresh or bump `?v=` on script includes.

## Production rollout checklist

1. **Migrations** — Supabase SQL editor or CLI; log applied filenames in team channel.
2. **Railway** — push `cliniflow-backend-clean/` only; confirm log shows `cliniflow-backend-clean/index.cjs`.
3. **Env** — `SUPABASE_*`, `JWT_SECRET`, `OPENAI_API_KEY`, `CORS_ORIGINS` / `RAILWAY_PUBLIC_URL` (see `REQUIRED_ENV.md`).
4. **Smoke API**
   - `GET /health` or admin login
   - `GET /api/admin/ai-leads/queues` (auth)
   - `GET /api/patient/me/intake-journey` (patient token)
5. **Admin UI** — open `/admin-ai-leads.html`; intake queue tabs show counts.
6. **Mobile** — internal build against production API; Treatment Guide loads journey without errors.
7. **Rollback** — revert Railway deploy; do **not** drop columns without a planned migration.

## Deployment verification steps

```bash
# After Railway deploy (replace host)
curl -sS "https://YOUR-RAILWAY-HOST/health"
# Admin queues (replace token + clinic context as your admin auth requires)
curl -sS -H "Authorization: Bearer ADMIN_JWT" "https://YOUR-RAILWAY-HOST/api/admin/ai-leads/queues"
```

Manual UI:

- Coordinator: each intake queue tab filters list; lead row shows **blocking reason** and **waiting on patient/clinic**.
- Patient: Treatment Guide shows compact checklist (max 4 items); full journey behind “View full journey”.

## Coordinator UX principles (Phase 3)

The workspace is **not** an enterprise CRM. Each inbox row should answer in ~3 seconds:

1. Who needs attention?
2. What is blocking progression?
3. Who are we waiting on (patient vs clinic)?
4. What should happen next?

**Avoid:** badge overload, dense metrics, parallel taxonomies, clinical certainty language in blockers.

**UI layout:** four primary intake queues visible; implant/cosmetic/ready queues under “More”; SLA tabs collapsed.

## Coordinator simulation (staging)

Repeatable **28-lead** dataset for observing coordinator behavior (not “do you like the UI?”).

```bash
cd cliniflow-backend-clean
export COORDINATOR_SIM_ALLOW=1
node scripts/seed-coordinator-simulation.cjs --clinic-id=<CLINIC_UUID>
# Clear: --clear flag or scripts/clear-coordinator-simulation.cjs
```

Full guide: **`scripts/COORDINATOR_SIMULATION.md`**.

## Workflow stress test (before more automation)

Run on **staging** with **20–30 leads** minimum:

| Scenario | What to verify |
|----------|----------------|
| 30+ concurrent leads | Queue counts load &lt; 3s; inbox scroll stable |
| Incomplete uploads | `awaiting_photos` / `awaiting_xray` queues; patient wait badge |
| Implant workflow | `tag_implant` queue; flags not duplicated in UI |
| Cosmetic workflow | `tag_cosmetic` queue |
| Multilingual intake | `preferredLanguage` visible; patient copy not CRM-heavy |
| Midway abandon | `inactive` workspace; stale timing on lead row |
| Coordinator handoff | `human_followup` queue; “Waiting on clinic” + next action |
| Doctor review pending | `doctor_review` queue; clinic wait |
| Multilingual intake | Language in detail panel only |
| 3-second scan | Coordinator can triage without opening lead |

**Defer until UX validated:** autonomous patient messaging, auto-send reminders (use manual coordinator follow-up first).

## Architecture boundaries (regression watch)

- **Treatment Guide (patient):** educational, calm, operational intake — no travel/tourism sales framing in patient prompts (`contextMode: treatment_guide`).
- **Coordinator workspace (admin):** queues, SLA, logistics, human takeover — travel/hotel context allowed for staff only.

## Related files

- `REQUIRED_ENV.md` — environment variables
- `public/admin-ai-leads.html` — coordinator workspace UI
- `public/admin-ops-rollout.html` — printable checklist for coordinators
- `lib/aiCoordinatorQueues.js` — queue definitions (reads flags/tags only)
