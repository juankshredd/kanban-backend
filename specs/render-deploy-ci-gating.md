# Render deployment + CI-gated auto-deploy

## Summary

Deploy the backend to Render (free tier, Node web service + Postgres), connected to this GitHub repo. Deployment is automatic on every push to `main`, but gated behind GitHub Actions CI (Jest + Postman/Newman) passing first — not Render's native auto-deploy-on-push, which fires independently of test results.

## Not routes/endpoints — infra change

This spec doesn't fit the "Routes affected" / "Request-response shape" sections of `TEMPLATE.md`; it's deployment infrastructure, not an API change. Kept in `specs/` anyway because it's non-trivial and changes previously-documented "intentional" behavior (see below).

## Decisions (resolved 2026-09-01 with the user)

- **Production branch:** `main` (GitHub default branch, already the target of the existing `dev` → `main` merge PRs).
- **Render service:** not created yet — ship a `render.yaml` Blueprint the user imports via Render's dashboard (New → Blueprint). I cannot create Render accounts/services myself; no API/CLI access.
- **Production database:** provision via Render's free Postgres tier through the same blueprint, rather than an externally-managed DB. Known limitation: Render's free Postgres expires after 30 days and needs manual renewal in the dashboard — acceptable for this project's current stage, called out here so it doesn't surprise anyone later.

## Changes required

1. **`src/server.js`** — `PORT` is currently hardcoded to `5000`, documented in root `CLAUDE.md` as intentional. Render assigns its own port via `process.env.PORT` and routes traffic there; a hardcoded port means Render's health checks never succeed. Change to `process.env.PORT || 5000` (keeps local dev behavior identical — `.env` never sets `PORT`, so it still falls back to `5000`). Root `CLAUDE.md`'s note about this being intentional needs updating to match.
2. **`src/db.js`** — add conditional SSL (`DB_SSL=true` enables `{ rejectUnauthorized: false }`, otherwise no SSL). Render's managed Postgres requires SSL; CI's local `postgres:16` container and local dev do not use it, so this must stay opt-in via env var, not a hardcoded environment check.
3. **`.github/workflows/ci.yml`**:
   - Fix an existing bug found while implementing this: the trigger list is `branches: [master, dev]`, but the repo's real remote branches are `main`/`dev`/`staging` — there is no `origin/master` (it's a stale local-only branch from before the project was renamed). CI has therefore never run against `main`. Fixed to `[main, dev]`.
   - Add a `deploy` job: `needs: test`, runs only `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, calls Render's Deploy Hook URL (`secrets.RENDER_DEPLOY_HOOK_URL`) via `curl`. This is the actual gating mechanism — deployment cannot fire unless the `test` job (Jest + Postman) succeeded first.
4. **`render.yaml`** — Blueprint defining the web service (`plan: free`, `runtime: node`, `autoDeploy: false` since GitHub Actions triggers deploys via the hook instead of Render's native push trigger, `startCommand: npm run migrate && npm start`, `healthCheckPath: /test-db`) and a `free`-plan Postgres database, with the web service's DB env vars wired via `fromDatabase`.

## Out of scope

- CORS is still hardcoded to `http://localhost:3000` in `src/server.js` — the deployed backend won't accept requests from a deployed frontend until that's made configurable. Not addressed here since it wasn't asked for and isn't required for the backend to deploy/pass health checks; flagged as a follow-up.
- Branch protection / required-status-checks configuration on `main` (GitHub repo settings) — recommended so a PR can't merge into `main` with failing CI, but that's a repo-settings change outside this PR's diff; left for the user to enable if wanted.
- `.env.example` — not added; not required for this change.

## Test plan

- Infra/config change — no new controller functions, so the mandatory happy-path/negative unit-test rule doesn't apply here.
- Verified manually: existing Jest suite and `sample.test.js` still pass locally after the `PORT`/`DB_SSL` changes (both are additive/backward-compatible — unset `PORT`/`DB_SSL` reproduce the old behavior exactly).
- CI itself (`ci.yml`) is the executable verification that the pipeline works: the same workflow that gates deploys also has to pass on this PR's own push, on `dev`.

## Open questions

- None outstanding — all three infra decisions were confirmed with the user before implementation.
