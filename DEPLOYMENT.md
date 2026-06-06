# Backend deployment (Railway)

Production API: `https://cliniflow-backend-clean-production.up.railway.app`

## How production deploys

Deployments are handled by **Railway native GitHub integration**, not GitHub Actions.

| Setting | Value |
|---------|--------|
| Platform | [Railway](https://railway.com) |
| GitHub repo | `erhanz1973-droid/cliniflow-backend-clean` |
| Branch | `main` |
| Trigger | Automatic on `git push` to `main` |
| Start command | `node index.cjs` (see `railway.toml` / `railway.json`) |
| Health check | `GET /health` |

Railway injects `RAILWAY_GIT_COMMIT_SHA` at build time. The running commit is exposed on `GET /api/health`:

```bash
curl -sS "https://cliniflow-backend-clean-production.up.railway.app/api/health" | jq .commit
```

Compare that SHA to `main` on this repo to confirm what is live.

## GitHub Actions (disabled)

Historically, `.github/workflows/railway-deploy.yml` ran `railway up --ci` on every push. That workflow **never succeeded** (missing/invalid `RAILWAY_TOKEN`) and was **redundant** with Railway's built-in GitHub deploy. It has been **removed**; do not re-enable without first disabling Railway native auto-deploy to avoid double builds.

## Deploy checklist

1. Push to `main` on **this repo** (`cliniflow-backend-clean`).
2. Watch the deploy in Railway → Project → Deployments (source should show **GitHub**).
3. Confirm startup logs reference `cliniflow-backend-clean/index.cjs`.
4. Smoke test:

```bash
curl -sS "https://cliniflow-backend-clean-production.up.railway.app/health"
curl -sS "https://cliniflow-backend-clean-production.up.railway.app/api/health"
```

See also: [`OPERATIONS_ROLLOUT.md`](OPERATIONS_ROLLOUT.md), [`REQUIRED_ENV.md`](REQUIRED_ENV.md).

## Manual deploy (emergency only)

If GitHub integration is unavailable, deploy from this directory with a project-scoped token:

```bash
cd cliniflow-backend-clean
RAILWAY_TOKEN=<project-token> railway up
```

Prefer fixing Railway GitHub integration over relying on manual CLI deploys.

## Monorepo note

The parent workspace (`cliniflow-backend`) contains this folder as a **git submodule**. Railway is connected to **this repository**, not the monorepo. Pushes to the monorepo `main` alone do **not** deploy production unless the submodule pointer is updated and pushed here.
