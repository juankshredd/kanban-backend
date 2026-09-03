# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Domain-specific documentation lives in nested `CLAUDE.md` files, loaded automatically only when Claude reads files in that directory (Claude Code's nested-memory-file mechanism — not always-loaded like this root file, so don't expect their content to be in context unless that directory is actually being touched):

- `src/controllers/CLAUDE.md` — data model (all table schemas), and business rules per domain (auth, companies, projects, tasks incl. detail fields/hierarchy/relations/comments, sprints, board & backlog, retrospectives).
- `migrations/CLAUDE.md` — migration mechanics (numbering, transactional apply, never-edit-an-applied-migration).
- `specs/CLAUDE.md` — spec-driven development convention: when to write a spec, the template to copy, and its lifecycle from draft through merging into the docs above.

## Project

Express + PostgreSQL REST API backend for a Kanban board app (`kanban-backend`). This is the backend half of a larger `kanban-dashboard-app`; a separate React frontend (not in this directory) is the only CORS-allowed origin, controlled by the `CORS_ORIGIN` env var (see `src/server.js` and Environment below) — `http://localhost:3000` locally, the deployed Vercel frontend in production.

## Commands

- Run the server: `npm start` or `npm run dev` (both just run `node src/server.js`, no watch mode)
- Run tests: `npx jest` — **do not use `npm test`**, its script is a stale placeholder (`echo "Error: no test specified" && exit 1`) and does not actually run Jest
- Run a single test file: `npx jest src/sample.test.js`
- Run tests matching a name: `npx jest -t "name pattern"`
- Coverage is collected automatically on every Jest run (`collectCoverage: true` in `jest.config.js`), output to `coverage/`
- Apply pending DB migrations: `npm run migrate` — check what's applied vs. pending with `npm run migrate:status`

No lint script is configured.

- Run the Postman/Newman API-level QA suite (requires the server running on port 5000): `npm run test:postman` — see `postman/README.md`. Regenerate the collection after changing an endpoint with `npm run postman:generate` (never hand-edit the generated JSON).

## Git workflow

`dev` is branch-protected on GitHub ("Changes must be made through a pull request") and `main` (the default branch, merged into from `dev` via PR) presumably more so — a direct push to `main` now also triggers a real production deploy on Render via CI, see Deployment below. **Never push or merge directly into `dev` or `main`** — do all work on a feature branch cut from `dev` (e.g. `feature/<name>`) and open a PR back into `dev` instead, even if a direct push would technically succeed for an admin account. If a push is rejected or bypasses the rule with a warning, treat that as a sign to stop and go through a PR rather than proceeding. (A local `master` branch may exist from before the project was renamed to `main` — it isn't on GitHub and isn't part of this workflow.)

**Cut the feature branch before the first edit, not before the first push.** If `git branch --show-current` reports `dev` or `main` at the start of a task, create/switch to a feature branch before touching any file — including docs-only changes (e.g. editing this file, adding a `specs/` entry). Don't let edits accumulate uncommitted on `dev` on the assumption they'll be moved to a branch later.

**Always review a PR right after opening it**, using the `/code-review` skill against that PR (`/code-review ultra <PR#>` for a deeper multi-agent pass on larger/riskier changes) — don't wait to be asked. This is a manual, on-demand review done by invoking the skill, not an automated GitHub Action/bot; no CI workflow should be added for this unless explicitly requested. Report findings back in chat, or post them as inline PR comments with `--comment` when useful.

## Environment

Config is loaded via `dotenv` from a `.env` file (gitignored) at the project root, read in both `src/db.js` and `src/server.js`. Required variables: `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `JWT_SECRET`. `src/server.js` reads `PORT` from `process.env.PORT`, falling back to `5000` when unset — local dev and CI never set `PORT`, so both still run on 5000; Render assigns its own via the injected env var. Three more optional variables exist for production only: `DB_SSL` (`"true"` enables `{ rejectUnauthorized: false }` in `src/db.js`'s `pg` `Pool` — required by Render's managed Postgres, unset/absent everywhere else), `RENDER_SYNC_HOOK_URL` (a GitHub Actions secret, not a `.env` var — see Deployment below), and `CORS_ORIGIN` (comma-separated list of allowed origins for `cors()` in `src/server.js`; falls back to `http://localhost:3000` when unset, so local dev/CI are unaffected — production sets it to the deployed Vercel frontend URL).

## Architecture

Standard layered Express structure under `src/`:

- `server.js` — app entry point; wires up CORS, JSON body parsing, and mounts route modules at `/api/auth`, `/api/tasks`, `/api/users`, `/api/projects`, `/api/companies`. Exports the `app` instance (used directly by Supertest in tests, no separate `app.js`).
- `db.js` — single shared `pg` `Pool` instance, imported by controllers directly (no query-builder/ORM layer).
- `routes/*.js` — thin route definitions that wire an Express `Router` to middleware + controller functions. `companyRoutes.js` and `projectRoutes.js` each apply `authMiddleware` once via `router.use(...)` rather than per route, so nested routers mounted under `/:companyId` / `/:projectId` inherit it. `companyProjectRoutes.js`, `projectTaskRoutes.js` and `projectSprintRoutes.js` are mounted behind `requireCompanyMember` / `requireProjectMember` with `Router({ mergeParams: true })` and therefore declare no access middleware of their own. `projectRetroRoutes.js` goes one level deeper still: it mounts *inside* `projectSprintRoutes.js` under `/:sprintId/retrospective`, so it sees both `:projectId` and `:sprintId` via the same `mergeParams` chain.
- `middlewares/authMiddleware.js` — verifies the `Authorization: Bearer <token>` JWT (signed with `JWT_SECRET`), attaches the decoded payload (`{ id }`) to `req.user`. All task, user, project and company routes require this.
- `middlewares/companyAccess.js` — company authorization, structurally identical to `projectAccess.js` one level up: attaches `req.company` + `req.companyRole`. `requireCompanyMember`/`requireCompanyOwner` take the id from `req.params.companyId`; `requireCompanyMemberFromBody` takes it from `req.body.company_id` (mounted on the flat `POST /api/projects`, same role `requireProjectMemberFromBody` plays for `POST /api/tasks`). Same 404-for-non-members / 403-for-non-owner convention as projects. **Company membership does not imply project access** — it only gates company administration and *who may create a project inside that company*; `project_members` remains the sole authority over a project's own tasks/sprints/retro.
- `middlewares/projectAccess.js` — all project authorization. Each variant differs only in where the project id comes from, and all attach `req.project` + `req.projectRole`. **This is the authorization pattern for anything scoped to a project** — mount one of these on the route instead of re-checking membership inside each controller. Non-members get `404` (not `403`) so project existence isn't leaked; a member who lacks OWNER gets `403`.
  - `requireProjectMember` / `requireProjectOwner` — id from `req.params.projectId`.
  - `requireProjectMemberFromBody` — id from `req.body.project_id`, for cross-project endpoints like `POST /api/tasks`.
  - `requireProjectMemberForResource(table)` — id resolved by looking up the resource itself, for `PATCH`/`DELETE /api/tasks/:id`. A factory; `table` comes from the `PROJECT_SCOPED_TABLES` whitelist, never from the request. Retro notes don't use this variant — they're one level deeper (project → sprint → note), so `retroController.js` instead re-validates `sprint_id` belongs to `req.project.id` on every handler (see `findSprintInProject`/`findOwnNote`) rather than trying to force a two-hop lookup through the single-table factory.
- `middlewares/validateRegister.js` — request-body validation for registration, applied only to `POST /api/auth/register`.
- `controllers/*.js` — route handlers containing business logic; talk to Postgres directly via raw parameterized SQL through `pool.query(...)`. See `src/controllers/CLAUDE.md` for the data model and per-domain business rules.

## Postman / Newman (API-level QA suite)

`postman/` holds a generated Postman collection (155 requests across 10 ordered folders) that exercises the whole API end-to-end against a real running server — complementary to the Jest suites above, which mock `src/db` and never hit Postgres. See `postman/README.md` for how it's organized, how to run it, and how to regenerate it after an endpoint changes. CI runs it with Newman on every push/PR, after the Jest step.

## Deployment

Production runs on Render (free tier), defined as code in `render.yaml` (a Render Blueprint: one `web` service + one free Postgres database, wired together via `fromDatabase`). Deployment is **not** Render's native auto-deploy-on-push — it's gated behind CI. Migrations run in `buildCommand`, not `startCommand`/`preDeployCommand` — the free plan doesn't support `preDeployCommand`, and free services spin down after ~15 min idle, so anything in `startCommand` re-runs on every wake-from-sleep, not just on real deploys. The flow is: push to `main` → `.github/workflows/ci.yml`'s `test` job runs Jest + Postman → only if that succeeds does the `deploy` job `curl`s Render's **Sync Hook** (not a per-service Deploy Hook — see below). A push that fails CI never reaches Render.

**Two separate auto-deploy switches exist, both must stay off, or CI gating is bypassed:**
- `autoDeployTrigger: off` on the web service itself, in `render.yaml`.
- **Blueprint-level Auto-Sync**, in the Render dashboard on the Blueprint's own page (not the service's page) — Render's default is to sync/redeploy on every push to the linked branch, independently of the per-service setting above. This must be turned off manually in the dashboard; it isn't expressible in `render.yaml`, so nothing catches it if it silently gets re-enabled. Verified off as of 2026-09-02 — worth re-checking occasionally, since a flipped toggle here would bypass CI gating with no error anywhere.

One-time setup (manual, in the Render dashboard — not scriptable from here):
1. Render dashboard → New → Blueprint → connect this GitHub repo. Render reads `render.yaml` and creates the `kanban-db` database and `kanban-backend` web service.
2. Set `JWT_SECRET` and `CORS_ORIGIN` (the deployed frontend's URL, e.g. `https://kanban-frontend-ecru-phi.vercel.app`) on the web service (Render dashboard → service → Environment) — both are `sync: false` in the blueprint, i.e. deliberately not stored in the repo. `CORS_ORIGIN` must be an origin only (scheme + host, no path like `/login` and no trailing slash) — the browser's `Origin` header never includes a path, so a value with one appended silently fails to match and reproduces the CORS error. Because it's `sync: false`, merging and deploying the code that reads it does **not** set it on Render — it has to be added by hand in this step, and skipping it leaves prod CORS broken even though the code is correct (bit us on 2026-09-02, see follow-up below).
3. Turn off Auto-Sync on the Blueprint's own dashboard page (see above).
4. Copy the trigger URL from the **Blueprint's** page → **Sync Hook** (`https://api.render.com/sync/exs-...`) — deliberately *not* the individual web service's Deploy Hook (`https://api.render.com/deploy/srv-...`); for a Blueprint-managed service the sync hook is what re-reads `render.yaml` and redeploys. Regenerating this secret later, go by the URL shape (`/sync/exs-...`), not just "whatever hook Render shows me" — the service's own Deploy Hook URL will also `curl` successfully (2xx) but silently stops enforcing the Blueprint-level gating this setup relies on. Set it with `gh secret set RENDER_SYNC_HOOK_URL "<the sync hook URL>"` (or GitHub repo Settings → Secrets and variables → Actions) — this must match the `secrets.RENDER_SYNC_HOOK_URL` name `ci.yml` references.

Verified working end-to-end on 2026-09-02: CI passing on `main` → `deploy` job → Render sync → live service confirmed reachable (`/test-db` returns a real Postgres row after free-tier cold start).

**Known follow-ups, not yet done:**
- Render's free Postgres plan **expires after 30 days** and needs manual renewal in the dashboard — not automated, not alerted; a lapsed database will take the API down until someone notices and renews it.
- Branch protection / required-status-checks on `main` isn't confirmed configured — nothing currently stops a direct push to `main` (bypassing the Git workflow rule above) from also bypassing CI before it reaches Render.
- On 2026-09-02, `CORS_ORIGIN` support was merged and deployed to `main` (CI green, Render sync succeeded) but the env var itself had never been set on the Render dashboard, so production register/login kept failing with a CORS preflight error for a while after the "fix" had already shipped. Fixed by setting it manually per step 2 above; there's no CI/deploy-time check that catches an unset `sync: false` var, so this can recur (e.g. after recreating the service, or the frontend moving to a new domain).

## Testing notes

`src/sample.test.js` uses Supertest against the exported `app` and hits the **real** configured Postgres database (no mocking/test DB isolation) — e.g. the happy-path login test depends on a seeded user (`nuevo@mail.com` / `123456`) actually existing in the database. Keep this in mind when adding or running tests: they are integration tests requiring a live, seeded DB connection via the `.env` config, not pure unit tests.

### Controller unit tests (mandatory)

Every controller in `src/controllers/` has a sibling `*.test.js` (e.g. `companyController.js` → `companyController.test.js`) of **unit** tests — distinct from `sample.test.js` above: no Express, no Supertest, no real DB. `src/db.js` is replaced with `jest.mock('../db', () => ({ connect: jest.fn(), query: jest.fn() }))`, and each handler is called directly with a hand-built `req`/`res` (`res.status`/`res.json` as `jest.fn().mockReturnValue(res)` so they chain). Handlers that use a transaction (`pool.connect()`) get a fake `client` (`{ query: jest.fn(), release: jest.fn() }`) returned from `pool.connect.mockResolvedValue(client)`, with `client.query` mocked once per statement in call order (`BEGIN`, the actual queries, `COMMIT`).

**Rule: every new exported controller function must ship with at least 1 happy-path test and 1 negative test in the same commit**, following the existing pattern in that controller's test file (see any `describe('controllerName.functionName', ...)` block for the shape to copy). No commit — and no push to a shared branch (`dev`/`main`) — should introduce a new controller function without matching tests. This is deliberately unit-level and fast (no DB dependency) so it's cheap to run on every change; it complements, not replaces, `sample.test.js`-style integration coverage for critical end-to-end flows.

### CI

`.github/workflows/ci.yml` runs the full Jest suite (unit + `sample.test.js` integration test) on every push and pull request targeting `main` or `dev`, against a real ephemeral `postgres:16` service container — it applies migrations (`npm run migrate`) and seeds the integration test user (`npm run seed:test`) before running `npx jest`, so both test styles run for real in CI, not just locally. Coverage is uploaded as a build artifact. Treat a failing "Test" check as a hard blocker for merging, same as the no-tests-no-commit rule above.
