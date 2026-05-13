# Controlled production rollout

Single playbook for smoke tests, channel safety, telemetry samples, ops security, rollback, App Store gaps, post-launch monitoring, and release status. **Scope:** no large architecture changes — flags, env, and process.

Related: `ENV_OBSERVABILITY_AND_ROLLOUT.md`, `PUSH_E2E_TEST_MATRIX.md`, `PRODUCTION_HARDENING_REPORT.md`.

---

## 1. Production smoke test script (checklist)

Run on a **production-like** build (TestFlight / internal prod track) against the **intended** Railway API. Record pass/fail and who ran the script.

**Severity legend:** **P0** = ship blocker if failed; **P1** = rollback or hotfix candidate; **P2** = monitor / fix next patch.

| # | Test | Expected result | Rollback note | Severity |
|---|------|-----------------|---------------|----------|
| 1 | **Google login** | Supabase session + bridge returns Clinifly JWT; lands in patient home | If bridge fails: revert last API deploy; check `EXPO_PUBLIC_*` and Supabase redirect URLs | P0 |
| 2 | **Apple login** | Same as Google on iOS; no duplicate-account merge error for normal user | Same; verify Sign in with Apple capability + bundle id | P0 |
| 3 | **OTP fallback** | Phone OTP path issues JWT; clinic code respected | Tight `RL_*` → raise limits temporarily (env only), not code rollback | P0 |
| 4 | **Session restore** | Kill app → reopen → still authenticated (valid JWT); corrupt/expired storage → clean login | If false positives clearing session: rollback app build that changed `refreshAuth` | P0 |
| 5 | **Logout / login** | Logout clears API token + storage; login again works | If logout stuck: emergency API rollback; verify `signOut` + storage keys | P1 |
| 6 | **Background push** | With app backgrounded, inbound message shows system notification | Wrong experience id → fix `EXPO_EXPERIENCE_ID_*` / app `projectId`; not a full arch rollback | P1 |
| 7 | **Terminated push** | Force-quit → push appears; tap opens app | Same as background; verify APNs entitlements | P1 |
| 8 | **Badge update** | Unread increases; opening thread clears badge per product rules | If badge wrong: check server ordering + `CHAT_PUSH_BADGE_LOG=1` briefly | P2 |
| 9 | **Socket reconnect** | Toggle airplane mode → restore; chat catches up without duplicate spam | Dedupe issues: `CHAT_PUSH_MEMORY_DEDUPE_MS` tuning or rollback recent push-only deploy | P2 |
| 10 | **Offline app launch** | App opens to login or last screen without crash; no infinite spinner on auth gate | If hang: rollback app splash/auth changes; OAuth warmup timeout should surface user message | P1 |
| 11 | **Deep link login return** | OAuth browser/session completes; redirect URL returns to app with session | Misconfigured `redirectTo` / scheme → fix Supabase + `app.json` scheme only | P0 |

**Tester:** _______________ **Build / commit:** _______________ **API:** _______________ **Date:** _______________

---

## 2. Release channel safety (environment validation)

### EAS profiles (`cliniflow-app/eas.json`)

| Profile | Purpose | Risk |
|---------|---------|------|
| `development` | Dev client, internal | Must not point `EXPO_PUBLIC_API_URL` at production if testing destructive actions |
| `preview` | Staging / internal QA | Common mistake: staging API URL baked into build but Supabase **production** keys → OAuth succeeds against wrong project |
| `production` | Store / TestFlight | Must use production API + production Supabase + matching `extra.eas.projectId` |

### Bundle / package identity (`app.json` + `app.config.js`)

| Platform | Field | Current (repo) | Mix-up risk |
|----------|--------|------------------|-------------|
| iOS | `bundleIdentifier` | `net.clinifly.mobile` | Apple Services / Sign in with Apple are tied to this id |
| Android | `package` | `com.clinifly.mobile` | **Different string than iOS** — intentional, but easy to confuse in dashboards; OAuth redirect and SHA certs must match **this** package |

### Pre-flight checklist (per channel)

- [ ] `EXPO_PUBLIC_API_URL` (or `EXPO_PUBLIC_API_BASE`) matches **staging** vs **production** intent for that profile’s EAS env/secrets.
- [ ] `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` are the **same project** as the OAuth redirect URLs configured in Supabase Auth.
- [ ] Railway `CORS_ORIGINS` / public URL allows the app’s origin if using web OAuth flows.
- [ ] Backend `JWT_SECRET` / Supabase service role are **only** on server; never in `EXPO_PUBLIC_*`.

---

## 3. Telemetry review — example log payloads (copy-paste samples)

Lines are **representative**; `traceId`, ids, and timestamps vary. Grep tags in logs as indicated.

### `oauth_login_success` (`AUTH_TELEMETRY_V1`)

```json
{"tag":"AUTH_TELEMETRY_V1","ts":"2026-05-12T10:00:00.000Z","event":"oauth_login_success","traceId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","provider":"google","patientId":"11111111-2222-3333-4444-555555555555"}
```

### `oauth_bridge_fail` (`AUTH_TELEMETRY_V1`)

```json
{"tag":"AUTH_TELEMETRY_V1","ts":"2026-05-12T10:01:00.000Z","event":"oauth_bridge_fail","traceId":"b2c3d4e5-f6a7-8901-bcde-f12345678901","provider":"google","httpStatus":503,"error":"supabase_disabled"}
```

### `session_restore_fail` (`AUTH_TELEMETRY_V1`, app)

```json
{"tag":"AUTH_TELEMETRY_V1","ts":"2026-05-12T10:02:00.000Z","event":"session_restore_fail","reason":"exception","message":"Network request failed"}
```

### Push delivery (`PUSH_DELIVERY_V1`)

Canonical tag in code is **`PUSH_DELIVERY_V1`** (not `push_delivery_v1`). Emitted when trace/unified logging paths call `pushDeliveryV1` (e.g. doctor trace / unified flag).

```json
{"tag":"PUSH_DELIVERY_V1","ts":"2026-05-12T10:03:00.000Z","traceId":"c3d4e5f6-a7b8-9012-cdef-123456789012","phase":"expo_batch","doctorId":null,"patientId":"22222222-3333-4444-5555-666666666666","recipientKind":"patient","threadId":"33333333-4444-5555-6666-777777777777","experiencePartition":"@owner/clinifly-new","expoTicketIds":["0193abcd-ef01-2345-6789-abcdef012345"],"httpOk":true,"httpStatus":200,"batchSize":1,"droppedCrossExperience":0,"pruneCount":null,"detailsError":null,"tokenPreview":"ExponentPushToken[xxxx…","tokenPreviews":null,"message":null}
```

### Provider mismatch (`AUTH_TELEMETRY_V1`)

Event name: **`oauth_provider_mismatch`**.

```json
{"tag":"AUTH_TELEMETRY_V1","ts":"2026-05-12T10:04:00.000Z","event":"oauth_provider_mismatch","traceId":"d4e5f6a7-b8c9-0123-def0-234567890123","provider":"google","httpStatus":409,"error":"oauth_provider_mismatch"}
```

---

## 4. Ops endpoint security audit (`/api/ops/*`)

| Control | Status | Notes |
|---------|--------|--------|
| **Auth** | Shared secret | `OPS_OBSERVABILITY_KEY` must be set; query `?key=` or header `X-Ops-Key`. Missing/wrong key → **404** `not_found` (no hint that route exists). |
| **Rate limit** | Yes | `opsObservabilityLimiter` on all `/api/ops/*` routes — tune with `RL_OPS_OBSERVABILITY_WINDOW_MS`, `RL_OPS_OBSERVABILITY_MAX`. Mitigates brute-force of key and scrape noise. |
| **Key rotation** | Operational | Generate new secret in Railway → update runbook/1Password → deploy; old clients/scripts fail until updated. Prefer header over query string in logs. |
| **Accidental exposure** | Risk if leaked | Response includes metrics + stale token **counts** (not raw tokens). Do not embed key in mobile apps or public repos; never log full URL with `?key=`. |
| **Method surface** | Minimal | GET observability; POST reset / aggregate — no destructive DB ops via these routes. |

---

## 5. Rollback plan (“deploy sonrası ne kapatılır”)

| Feature | What to turn off / revert | Order |
|---------|---------------------------|--------|
| **OAuth** | Not a single flag — **revert Railway deploy** to last known-good image; verify Supabase dashboard not changed mid-incident | First if auth totally broken |
| **Push partitioning** | Set `EXPO_EXPERIENCE_ID_PATIENT` / `EXPO_EXPERIENCE_ID_DOCTOR` to match previous release values; redeploy API | If wrong experience drops all pushes |
| **Receipt prune** | Unset `EXPO_PUSH_RECEIPT_PRUNE` or set `0` → redeploy | If mass token deletion / users lose pushes |
| **Telemetry** | Client: no compile flag required — logs are stdout; reduce noise by not scraping. Server: telemetry is log-only; **cannot** disable `AUTH_TELEMETRY_V1` without code revert | Low priority rollback |
| **Refresh retry** | Revert **app** build that contains `patientOAuth.ts` bridge retry if it causes loops (rare) | Second line after API stable |

**Fastest safe lever:** Railway **instant rollback** to previous deployment + env var toggles above (no git revert required if image history is intact).

---

## 6. App Store — final gap list (net)

| Item | Owner | Notes |
|------|--------|------|
| Privacy policy URL | Legal / product | Live HTTPS; in App Store Connect + in-app |
| Delete account flow | Product + app | In-app path + confirmation |
| Account deletion backend | Backend | API + DB + `push_tokens` cleanup + audit trail |
| Screenshots | Design | Required sizes per locale |
| Support URL | Ops | Public page or mailto policy |
| Reviewer notes | Product | Test account, OAuth steps, feature flags |

---

## 7. Post-launch monitoring (first 72 hours)

### Metrics to watch

| Metric / signal | Source | Action if bad |
|-----------------|--------|----------------|
| `AUTH_TELEMETRY_V1` `oauth_bridge_fail` rate | Railway logs | Spike → Supabase outage, wrong anon key in builds, or rate limit |
| `oauth_provider_mismatch` count | Railway logs | Spike → legacy duplicate-email rows; support playbook |
| `ticketSuccessRate` / `httpBatchSuccessRate` | `GET /api/ops/push-observability` or `PUSH_METRICS_AGGREGATE` | Sustained drop → Expo/APNs incident or credential |
| `invalidTokensPruned` jump | Same | Correlate with user reports; consider disabling receipt prune |
| HTTP 5xx rate | Railway / proxy | Above SLO → rollback deploy |
| OTP / login **429** rate | `rate_limit_exceeded` in JSON | Tune `RL_*` env |

### Critical log greps

- `AUTH_TELEMETRY_V1` + `oauth_bridge_fail`
- `PUSH_DELIVERY_V1` + `"httpOk":false`
- `[push]` + `"level":"error"`
- `push_tokens.cross_owner_duplicate`

### Suggested rollback triggers (tune to your SLO)

| Trigger | Response |
|---------|----------|
| OAuth error rate **> 5×** baseline for **30 min** | Rollback API; verify Supabase status |
| Push ticket success rate **under 85%** for **1 h** (with volume) | Check Expo status; consider `EXPO_PUSH_RECEIPT_PRUNE=0` |
| Global 5xx **> 1%** of requests for **15 min** | Rollback API |

---

## 8. Final status table (at release gate)

| Category | Items |
|----------|--------|
| **Release blockers** | Privacy URL missing; delete account not implemented if store requires it; OAuth smoke fails on prod build |
| **High risk** | Wrong `EXPO_PUBLIC_*` in production EAS profile; `OPS_OBSERVABILITY_KEY` in client or repo; receipt prune on without monitoring |
| **Medium risk** | Rate limits too tight for launch traffic; iOS/Android package confusion in Firebase/Apple consoles |
| **Production ready** | Push dedupe + metrics deployed; ops routes gated + rate limited; session restore telemetry in app; rollback runbook agreed |

**Sign-off:** Engineering _______________ Product _______________ Date _______________
