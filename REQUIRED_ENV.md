# Environment variables (from `index.cjs` + `lib/supabase.js`)

Set these in Railway (or `.env` locally). Names only — **no secrets in git**.

## Critical for DB + API

| Variable | Notes |
|----------|--------|
| `SUPABASE_URL` | Project URL only (no `/rest/v1` suffix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend `lib/supabase.js` only — bypasses RLS (never ship to mobile) |
| `JWT_SECRET` | **≥8 chars** in production (patient/doctor/admin JWT) |

## AI + smile simulation

| Variable | Notes |
|----------|--------|
| `OPENAI_API_KEY` | GPT vision / chat analysis |
| `REPLICATE_API_TOKEN` | Smile / teeth pipelines where Replicate is used |

## Optional feature flags (defaults usually work)

`ENABLE_AI_ANALYSIS`, `ENABLE_SMILE_SIMULATION`, `ENABLE_MULTI_PHOTO_PROGRESS`, `IMAGE_MAX_SIZE_MB`, `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_MAX`, `AI_RATE_LIMIT_WINDOW`, `AI_COST_LIMIT_PER_USER`, `AI_ESTIMATED_COST_PER_CALL`, `AI_DEV_BYPASS_LIMIT`, `AI_ALLOW_DEV_CLIENT_BYPASS`, `AI_LOG_FILE`

## Smile / merge tuning (SIM_*)

Many `SIM_*`, `SIM_MERGE_*`, `SIM_SMILE_*`, `SMILE_CROP_*`, `REPLICATE_*` — optional; see `index.cjs` for defaults.

## Email / OTP / admin

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `BREVO_API_KEY`, `BREVO_FROM_NAME`, `OTP_DEV_BYPASS`, `OTP_ENABLED_FOR_ADMINS`, `OTP_REQUIRED_FOR_NEW_ADMINS`, `SUPERADMIN_*`, `SUPER_ADMIN_*`, `ADMIN_AUTH_DEBUG`

## Maps / geo

`GOOGLE_PLACES_API_KEY`, `GOOGLE_GEOCODING_API_KEY`

## Push notifications

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

## Supabase (extra)

`SUPABASE_DEBUG`, `CLINIC_BY_CODE_CACHE_TTL_MS`

Mobile / Expo may use `EXPO_PUBLIC_SUPABASE_ANON_KEY` (or similar) in the app only — not in this Node server.

## Runtime

`PORT` — Railway sets automatically  
`NODE_ENV` — `production` on Railway  
`PERF_LOGS`, `REVIEW_MODE`, `ALLOW_FILE_FALLBACK`, `DOCTOR_ASSIGN_DEBUG`

---

**Quick grep** (when updating this list):  
`git show HEAD:index.cjs | grep -oE 'process.env.[A-Z0-9_]+' | sort -u`
