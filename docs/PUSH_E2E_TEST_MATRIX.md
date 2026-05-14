# Push E2E test matrix (patient + doctor)

Use this as a release regression script. **Expected** = behavior that should hold after recent observability and dedupe work; adjust if product copy changes.

Legend: **OS** = iOS unless noted. **Experience** = Expo `projectId` / experience id (patient vs doctor app).

---

## 1. App lifecycle vs delivery

| Scenario | Steps | Expected delivery | Expected in-app |
|----------|--------|---------------------|-----------------|
| **Foreground** | App open on chat thread or home; trigger inbound message | Banner / sound per `chatPushForegroundBehavior` + in-app list updates | Unread badge / list consistent with server |
| **Background** | Home → lock or switch app; trigger push | System notification + sound (token + channel ok) | Tap opens correct thread |
| **Terminated** | Force-quit; send push | Notification in tray | Cold start: user lands logged-in; tap deep-links if implemented |

---

## 2. Realtime socket

| Socket | Steps | Expected |
|--------|--------|----------|
| **Connected** | Chat socket connected; new message | Push may still fire; UI often updates from socket first — no duplicate annoying banners if dedupe + client rules align |
| **Disconnected** | Airplane mode on sender device only, or kill socket; message from other party | Push is primary path; when socket reconnects, history reconciles |

---

## 3. Build channels

| Build | Push registration | Expected |
|-------|-------------------|----------|
| **Expo Go** | Limited; project may not match production experience | May not receive production pushes; use for OAuth/UI only unless configured |
| **Dev client** (`expo-dev-client`) | Uses dev experience / credentials | Tokens stored under dev experience — check `byExperience` in `GET /api/ops/push-observability` |
| **Production** (TestFlight / store) | Production experience id | Full APNs/FCM path; receipts and prune rules apply |

---

## 4. Server-side observability (while testing)

- After test traffic, call `GET /api/ops/push-observability` (with `OPS_OBSERVABILITY_KEY`) and confirm `metrics.ticketSuccessRate`, `receiptErrorBuckets`, `byExperience`, and `chatDedupeMemoryHits` / `chatDedupeDbDuplicateHits` move as expected.
- Railway logs: grep `PUSH_METRICS_AGGREGATE`, `PUSH_METRICS_SNAPSHOT`, `[push]`, `push_tokens.cross_owner_duplicate`.

---

## 5. Pre-TestFlight / production smoke (OAuth + push)

Run with **debug env vars unset** (`docs/ENV_OBSERVABILITY_AND_ROLLOUT.md` §4.1). Real device or TestFlight build (not Expo Go) for push.

- [ ] Logout / login still works (Clinifly JWT + Supabase session).
- [ ] Google OAuth sign-in / bridge.
- [ ] Apple OAuth sign-in / bridge.
- [ ] Patient sends chat message → assigned doctor receives push with **doctor app fully terminated** (not just background).
- [ ] Unread badge on doctor app icon updates after inbound messages (may need a second open depending on client).

---

## 6. Cold start / auth edge (related)

| Case | Expected |
|------|----------|
| Expired Clinifly JWT in storage | Cleared on restore; user sees login (`session_restore_cleared_expired`) |
| Corrupt JSON in auth storage | Cleared (`session_restore_cleared_invalid`) |
| Supabase session error after restore | Logged `supabase_session_error`; Clinifly session may still work until API 401 |
| Offline login attempt (OAuth warmup) | Health check timeout → `oauth_login_fail` with `reason: timeout`; user message from i18n |

---

## 7. Sign-off

Tester: _______________  Date: _______________  Build: _______________  API commit: _______________
