# Observability, env flags, and safe rollout

This document complements `PRODUCTION_HARDENING_REPORT.md` and **`docs/CONTROLLED_PRODUCTION_ROLLOUT.md`**: operational metrics, token hygiene, auth telemetry, rollout defaults, and App Store gap tracking.

---

## 1. Push observability (metrics)

**In-process counters** (`lib/pushMetrics.cjs`, reset on deploy):

| Metric / field | Meaning |
|----------------|---------|
| `ticketSuccessRate` | `expoTicketsOk / (ok + error)` from Expo **push** ticket responses |
| `httpBatchSuccessRate` | HTTP 2xx batch sends / total batches |
| `receiptErrorBuckets` | Aggregated terminal errors (batch tickets + merged receipts) |
| `invalidTokensPruned` | Rows removed from `push_tokens` after invalid-device style receipts |
| `chatDedupeMemoryHits` | Duplicate chat push suppressed in memory (TTL) |
| `chatDedupeDbDuplicateHits` | Duplicate suppressed at DB unique constraint |
| `byExperience` | Per Expo experience: batches, ticket ok/err |
| `pushTokenCrossOwnerAudits` | Same `expo_push_token` registered for more than one owner pair |

**Endpoints** (all require `OPS_OBSERVABILITY_KEY`; wrong/missing key → **404** `not_found`):

- `GET /api/ops/push-observability?key=…` — JSON: `metrics`, `pushTokensStaleBuckets`, constraint note.
- `POST /api/ops/push-metrics-reset?key=…` — reset counters (after incident or test).
- `POST /api/ops/push-metrics-aggregate-log?key=…` — emit one `PUSH_METRICS_AGGREGATE` line to stdout.

**Logs**: `PUSH_METRICS_SNAPSHOT` (on-demand via code path), `PUSH_METRICS_AGGREGATE` (manual or interval). **Invalid token rate**: derive \(\Delta\) `invalidTokensPruned` / \(\Delta\) time or per batch from log drain, not a single gauge.

---

## 2. Token hygiene

- **Unique constraint**: `push_tokens_owner_kind_owner_id_expo_token_key` on `(owner_kind, owner_id, expo_push_token)` — prevents duplicate rows per owner+token; **does not** stop the same physical token string on another owner row.
- **Cross-owner audit**: on register, if the same `expo_push_token` appears under different owners, backend increments `pushTokenCrossOwnerAudits` and logs `push_tokens.cross_owner_duplicate`.
- **Stale age report**: `pushTokensStaleBuckets` in ops JSON — counts by `updated_at` (7d / 7–30d / 30–90d / 90d+). Use for cleanup jobs (see hardening report SQL).

---

## 3. Session / auth telemetry (`AUTH_TELEMETRY_V1`)

One JSON line per event (`tag`, `ts`, `event`, …). Grep: `AUTH_TELEMETRY_V1` in Railway (API) and device/Metro logs (app).

| Event (representative) | Where | Notes |
|------------------------|-------|-------|
| `oauth_login_success` | API + app | Includes `provider`, API adds `patientId` |
| `oauth_login_cancel` | App | User dismissed OAuth |
| `oauth_login_fail` | App | e.g. timeout, generic exception |
| `oauth_bridge_refresh_retry` | App | Supabase `refreshSession` then second bridge POST |
| `oauth_supabase_refresh_fail` | App | Bridge returned `invalid_oauth_token` but refresh did not yield a new access token |
| `oauth_provider_mismatch` | API + app | 409 from API; client also logs on known response |
| `oauth_merge_conflict` | API | `patient_merge_conflict` |
| `oauth_bridge_fail` | API | Supabase disabled, canonical id failure, internal_error, other bridge errors |
| `session_restore_ok` / `session_restore_cleared_expired` / `session_restore_cleared_invalid` / `session_restore_fail` | App | Cold start / storage |
| `supabase_session_error` | App | After restore, patient path `getSession` error |


---

## 4. Safe rollout (feature flags)

| Variable | Default | Rollback | Risk notes |
|----------|---------|----------|------------|
| `OPS_OBSERVABILITY_KEY` | empty | Unset → ops routes return 404 | If leaked, exposes metrics + stale buckets — use long random secret; rotate if logged. |
| `RL_OPS_OBSERVABILITY_WINDOW_MS` / `RL_OPS_OBSERVABILITY_MAX` | 15 min / 120 | Raise `MAX` if ops scripts hit 429 | Very high traffic from one NAT IP can throttle legitimate ops |
| `PUSH_METRICS_AGGREGATE_INTERVAL_MS` | `0` (off) | Set to `0` | Values below 120000 ms are ignored; interval adds stdout volume. |
| `CHAT_PUSH_MEMORY_DEDUPE_MS` | `120000` | Set `0` to disable memory dedupe | Multi-replica race: rare duplicate push until DB dedupe. |
| `EXPO_PUSH_RECEIPT_PRUNE` | off | Unset or `0` | When `1`, deletes bad `push_tokens` — watch `invalidTokensPruned` and user complaints. |
| `PUSH_LOG_VERBOSE` | off in prod | Unset | Verbose logs may include more context — still redacted; avoid in high-traffic unless needed. |
| `RL_*` rate limits | library defaults | Increase `RL_*_MAX` or window | Shared NAT → 429 for real users if too tight. |

Rollback rule: **prefer unset** (revert to code default) over “creative” values unless you documented the behavior.

---

## 5. App Store / compliance — gap checklist

Track these explicitly before store submission:

1. **Delete account flow**  
   - [ ] In-app entry point (Settings or profile).  
   - [ ] Backend: irreversible delete or anonymize + token revoke; confirm `push_tokens` rows removed.  
   - [ ] Apple “Account deletion” URL in App Store Connect if applicable.

2. **Privacy policy URL**  
   - [ ] Public HTTPS URL live and stable.  
   - [ ] Linked from App Store Connect metadata.  
   - [ ] Linked inside the app (settings / legal).

3. **Data deletion request UX**  
   - [ ] Clear copy: what is deleted, delay, identity verification if any.  
   - [ ] Contact or form for requests not covered by in-app delete (GDPR-style).  
   - [ ] Support process documented internally.

---

## 6. Environment variable reference (single table)

| Name | Default (code / unset) | Production recommendation | Risk |
|------|-------------------------|---------------------------|------|
| `OPS_OBSERVABILITY_KEY` | empty | Strong random secret; set in Railway only | Disclosure exposes operational metrics |
| `RL_OPS_OBSERVABILITY_WINDOW_MS` | `900000` (15 min) | Default unless ops IP shared by many admins | 429 on heavy dashboard refresh |
| `RL_OPS_OBSERVABILITY_MAX` | `120` | Increase if 429 during legitimate use | Brute-force key guessing slightly easier if max is huge |
| `PUSH_METRICS_AGGREGATE_INTERVAL_MS` | `0` | `300000` (5m) or `0` if only manual POST | Log volume; values below 120000 ms are ignored |
| `CHAT_PUSH_MEMORY_DEDUPE_MS` | `120000` | Keep default unless debugging dedupe | `0` disables memory layer dedupe |
| `EXPO_PUSH_RECEIPT_PRUNE` | off | Enable after monitoring ticket errors | Deletes tokens aggressively when receipts say invalid |
| `PUSH_LOG_VERBOSE` | off in prod | `0` / unset | Extra logging cost |
| `DOCTOR_PUSH_EXPO_TRACE` | off | Staging only | Verbose / possibly sensitive routing logs |
| `CHAT_PUSH_BADGE_LOG` | off | Enable briefly when debugging badge | Noise |
| `EXPO_PUSH_DEBUG_LOGS` | off | off | Debug noise |
| `CHAT_PUSH_ROUTING_LOG` | off | off | Routing noise |
| `RL_PATIENT_OAUTH_WINDOW_MS` / `RL_PATIENT_OAUTH_MAX` | express-rate-limit defaults | Tune after traffic sample | OAuth 429 |
| `RL_AUTH_REQUEST_OTP_WINDOW_MS` / `RL_AUTH_REQUEST_OTP_MAX` | defaults | Tune after traffic sample | OTP 429 |
| `RL_AUTH_VERIFY_OTP_WINDOW_MS` / `RL_AUTH_VERIFY_OTP_MAX` | defaults | Tune after traffic sample | Verify 429 |
| `RL_PATIENT_LOGIN_WINDOW_MS` / `RL_PATIENT_LOGIN_MAX` | defaults | Tune after traffic sample | Login 429 |
| `RL_DOCTOR_VERIFY_OTP_WINDOW_MS` / `RL_DOCTOR_VERIFY_OTP_MAX` | defaults | Tune after traffic sample | Doctor OTP 429 |
| `JWT_EXPIRES_IN` | `30d` | Align with product security policy | Shorter → more re-login |
| `EXPO_EXPERIENCE_ID_DOCTOR` / `EXPO_EXPERIENCE_ID_PATIENT` | built-in fallbacks | Set explicitly in prod | Wrong id → wrong `byExperience` / filtering |
| `EXPO_ACCESS_TOKEN` | empty | Set if Expo project requires it for push API | Secret handling |

### Mobile (EAS / `cliniflow-app`)

| Name | Default | Production recommendation | Risk |
|------|---------|---------------------------|------|
| `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_API_BASE` | code fallback | Point to production Railway API | Wrong URL → auth/push failures |
| `EXPO_PUBLIC_SUPABASE_URL` | empty | Production Supabase project | Misconfig → OAuth broken |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | empty | Production anon key | Public in binary — expected; still rotate if leaked |
| `EXPO_PUBLIC_TELEMETRY_URL` | unset | Optional future ingest | Must be HTTPS; privacy review |

---

## 7. Related files

- `lib/pushMetrics.cjs`, `lib/authTelemetry.cjs`, `index.cjs` (ops routes, OAuth telemetry).  
- `docs/PUSH_E2E_TEST_MATRIX.md` — manual QA matrix.  
- `docs/CONTROLLED_PRODUCTION_ROLLOUT.md` — smoke checklist, channel safety, rollback gate, 72h monitoring.  
- `PRODUCTION_HARDENING_REPORT.md` — migrations, rate limits, push logging.
