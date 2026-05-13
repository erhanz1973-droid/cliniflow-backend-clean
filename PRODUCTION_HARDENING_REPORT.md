# Production hardening report (OAuth + Push + Auth)

Date: 2026-05-12  
Scope: `cliniflow-backend-clean` (Railway), `cliniflow-app` (patient mobile).

---

## 1. Push / notification hardening

### Changes

- **`lib/pushLog.cjs`**: Structured `[push]` JSON logs; `debug` suppressed in production unless `PUSH_LOG_VERBOSE=1`; redacts long strings and Expo token fields.
- **`traceMiddleware`**: Every HTTP request gets `req.traceId` and response header `x-request-id` (client may send `x-request-id` / `x-correlation-id` / `x-trace-id` to correlate with logs).
- **Duplicate notification guard**: In-process TTL map before `chat_push_dispatches` insert (`CHAT_PUSH_MEMORY_DEDUPE_MS`, default 120000 ms; set `0` to disable). DB unique constraint remains the cross-instance source of truth.
- **`tryClaimChatPushDispatch`**: Uses `pushLog` on DB failures; memory dedupe integrated as above.
- **Expo receipt pruning**: `EXPO_PUSH_RECEIPT_PRUNE=1` now runs silent receipt merge for **patient** pushes too (not only doctor trace path).
- **`expoReceiptRowImpliesPruneToken`**: Removed blanket “any error + code” prune; only device/token/register-class errors prune (reduces false deletions on transient Expo/APNs errors).
- **`postExpoGetReceipts` / `postExpoNotificationsBatch`**: Errors routed through `pushLog.warn`.
- **`app.set("trust proxy", 1)`**: So `express-rate-limit` and logs see correct client IP behind Railway.

### Risks

- **Memory dedupe** is per-process; two Railway replicas can still double-send until DB dedupe wins — acceptable tradeoff.
- **Stricter receipt prune** may leave a few truly-dead tokens until next manual sweep — safer than over-pruning valid devices.

### Migration

- **`supabase/migrations/20260514180000_push_tokens_hygiene.sql`**: Adds `push_tokens_updated_at_idx` only (no data deletes on apply).

### Manual tests (push)

See **`docs/PUSH_E2E_TEST_MATRIX.md`** for foreground / background / terminated, socket on/off, Expo Go vs dev client vs production, and cold-start expectations.

**Env toggles**: `CHAT_PUSH_BADGE_LOG=1`, `DOCTOR_PUSH_EXPO_TRACE=1`, `EXPO_PUSH_RECEIPT_PRUNE=1`, `PUSH_LOG_VERBOSE=1` (staging only). Ops: `OPS_OBSERVABILITY_KEY`, `PUSH_METRICS_AGGREGATE_INTERVAL_MS` — see `docs/ENV_OBSERVABILITY_AND_ROLLOUT.md`.

### Production impact

- Low risk; **rate limits** (section 4) may return **429** to abusive clients. Receipt pruning with `EXPO_PUSH_RECEIPT_PRUNE=1` deletes invalid rows from `push_tokens` — enable after monitoring.

---

## 2. OAuth hardening (app + API)

### Changes

- **`lib/patientOAuth.ts`**: On `invalid_oauth_token` from bridge, **one** `supabase.auth.refreshSession()` retry then re-`POST /api/patient/auth/oauth`.
- **`signInWithApple`**: Catches native errors — maps cancel vs `apple_credential_invalid`.
- **`lib/auth.tsx`**: `signOut` calls `getSupabaseAuthClient()?.auth.signOut()` so Supabase session does not outlive Clinifly logout.
- **Session restore**: Existing `refreshAuth()` still restores Clinifly JWT from storage; Supabase continues `persistSession` + `autoRefreshToken` in `supabaseAuthClient.ts` (unchanged).

### Risks

- **Supabase `SIGNED_OUT` without listener**: If refresh fails while app is open, Clinifly JWT may remain until next API 401 — mitigated by bridge retry + user re-login. Full passive sync would need a guarded `onAuthStateChange` (avoid recursion with `signOut`).

### Migration

- None for this section.

### Manual tests

1. OAuth login → kill app → relaunch → still authed (Clinifly + optional Supabase).
2. Logout → confirm both storages cleared; OAuth again works.
3. Revoke Apple app password / disconnect: next sign-in should surface error or phone fallback.

### Production impact

- Low; refresh retry adds one extra round-trip on expired access token edge.

---

## 3. Account linking safety

### Changes (`lib/patientAuthOauth.cjs`)

- **Email lookup**: `fetchPatientByEmailLatestForOauth` — `order(created_at desc).limit(1)` when duplicate emails exist (instead of ambiguous `maybeSingle` on duplicates).
- **Provider mismatch**: If `patients.auth_provider` is set to another OAuth slug **and** `auth_user_id` is still empty (partial state), return **409** `oauth_provider_mismatch` (blocks silent cross-provider hijack of same email row).
- **Merge patch**: Prefer non-empty `picked.subject` / `picked.avatarUrl`; do not overwrite with empty strings.

### Risks

- Legitimate “switch provider” flows that relied on empty `auth_user_id` with stale `auth_provider` now get **409** — user should use phone login or support.

### Migration

- Existing migration `20260513120000_patients_oauth_linking.sql` must be applied in prod (already in repo).

### Manual tests

- OTP-created patient → OAuth same email → row links (`auth_user_id` set).
- Two patients same email (legacy) → newest `created_at` wins for OAuth email match — verify intended policy.

### Production impact

- Medium for edge duplicate-email clinics; monitor `oauth_provider_mismatch` in logs.

---

## 4. Rate limit / security

### Changes

- **`lib/httpRateLimits.cjs`** (`express-rate-limit`): Default **IPv6-safe** IP keying from the library (works with `app.set("trust proxy", 1)` on Railway). Separate limiter instances per route group:  
  - `POST /api/patient/auth/oauth` — `patientOauthLimiter`
  - `POST /auth/request-otp` — `authRequestOtpLimiter`  
  - `POST /auth/verify-otp-patient`, `POST /auth/verify-otp-doctor`, `POST /auth/verify-otp`, `POST /api/auth/verify-otp` — `authVerifyOtpLimiter`  
  - `POST /api/patient/login` — `patientLoginLimiter`  
  - `POST /api/doctor/verify-otp` — `doctorVerifyOtpLimiter`  

**Env knobs** (optional):  
`RL_PATIENT_OAUTH_WINDOW_MS`, `RL_PATIENT_OAUTH_MAX`, `RL_AUTH_REQUEST_OTP_WINDOW_MS`, `RL_AUTH_REQUEST_OTP_MAX`, `RL_AUTH_VERIFY_OTP_WINDOW_MS`, `RL_AUTH_VERIFY_OTP_MAX`, `RL_PATIENT_LOGIN_WINDOW_MS`, `RL_PATIENT_LOGIN_MAX`, `RL_DOCTOR_VERIFY_OTP_*`.

### Risks

- Shared NAT / corporate egress may hit OTP limits — tune `RL_*` or add trusted proxy configuration if you terminate TLS elsewhere.

### Migration

- None.

### Manual tests

- Burst 50 logins from one IP → expect 429 JSON `{ error: "rate_limit_exceeded" }`.

### Production impact

- **429** possible for heavy legitimate users — adjust limits after first week of metrics.

---

## 5. Database cleanup

### Changes

- **Migration** `20260514180000_push_tokens_hygiene.sql`: index on `push_tokens(updated_at desc)` for stale sweeps.

### Recommended manual SQL (Supabase SQL editor — not auto-run)

Review counts in a transaction before delete:

```sql
-- Invalid token shape
select count(*) from public.push_tokens
where expo_push_token is null or trim(expo_push_token) = ''
   or left(trim(expo_push_token), 8) <> 'Exponent';

-- Orphan patient tokens
select count(*) from public.push_tokens pt
where pt.owner_kind = 'patient'
  and not exists (select 1 from public.patients p where p.id = pt.owner_id);

-- Stale (example 180d)
select count(*) from public.push_tokens where updated_at < now() - interval '180 days';
```

Then run corresponding `DELETE` variants when satisfied.

### Production impact

- Index creation is **online** on Postgres; brief lock on `push_tokens` — run in low-traffic window if table is huge.

---

## 6. App Store readiness checklist

Detailed gap checklist (delete account, privacy URL, data deletion UX) lives in **`docs/ENV_OBSERVABILITY_AND_ROLLOUT.md`** §5.

| Item | Status |
|------|--------|
| Delete account flow | **Gap** — see checklist doc |
| Privacy policy URL | **Gap** — see checklist doc |
| Data deletion request UX | **Gap** — see checklist doc |
| Apple Sign-In compliance (Sign in with Apple when third-party login exists) | **Met** (Google + Apple on iOS) |
| Notification permission rationale | **Partial** — verify `Info.plist` purpose strings + in-app pre-prompt copy |
| Onboarding smoke test (OAuth + phone + OTP path) | **Manual** — run before each release |
| Production env validation (`EXPO_PUBLIC_*`, Railway secrets, Supabase redirect URLs) | **Manual** — use staging checklist |

---

## 7. Deliverable summary

| Area | Migrations | Prod impact |
|------|------------|-------------|
| Push logging + dedupe + receipts | Optional index migration | Low; enable receipt prune cautiously |
| OAuth refresh + Apple errors + signOut sync | None | Low |
| Account linking | Prior OAuth columns migration | Medium edge cases |
| Rate limits | None | 429 for abuse / mis-tuned limits |
| App Store | N/A | Gaps listed above |

### Foreground / background / terminated matrix

See **`docs/PUSH_E2E_TEST_MATRIX.md`**.

### Unread badge consistency

No code change in this pass: server already **awaits** `bumpChatUnreadCountersAfterInsert` before `enqueueChatMessagePushNotifications` — re-verify with `CHAT_PUSH_BADGE_LOG=1` after deploy.

---

## 8. Observability and ops endpoints (2026-05)

- **Push metrics**: `lib/pushMetrics.cjs` — success rates, receipt buckets, invalid prune count, dedupe hits, per-experience stats, cross-owner token audits. Scraped via `GET /api/ops/push-observability` or log lines `PUSH_METRICS_AGGREGATE` / `PUSH_METRICS_SNAPSHOT`.
- **Auth telemetry**: `lib/authTelemetry.cjs` — grep `AUTH_TELEMETRY_V1` on OAuth bridge failures/success; mirrors app `lib/authTelemetry.ts`.
- **Session restore hardening (app)**: `lib/auth.tsx` — expired JWT clear, corrupt storage clear, `session_restore_fail` on storage/exception paths, Supabase `getSession` errors logged.
- **Single env + rollout table**: `docs/ENV_OBSERVABILITY_AND_ROLLOUT.md` §6.  
- **Controlled rollout playbook** (smoke tests, ops security audit, 72h monitoring, release status): `docs/CONTROLLED_PRODUCTION_ROLLOUT.md`.

---

## Files touched (reference)

**Backend:** `index.cjs`, `lib/pushLog.cjs`, `lib/pushMetrics.cjs`, `lib/authTelemetry.cjs`, `lib/httpRateLimits.cjs`, `lib/patientAuthOauth.cjs`, `supabase/migrations/20260514180000_push_tokens_hygiene.sql`, `docs/PUSH_E2E_TEST_MATRIX.md`, `docs/ENV_OBSERVABILITY_AND_ROLLOUT.md`, `docs/CONTROLLED_PRODUCTION_ROLLOUT.md`  

**App:** `lib/auth.tsx`, `lib/patientOAuth.ts`, `lib/authTelemetry.ts`, `app/(app)/login/patient.tsx`, `lib/i18n.ts`
