# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Express + PostgreSQL REST API backend for a Kanban board app (`kanban-backend`). This is the backend half of a larger `kanban-dashboard-app`; a separate React frontend (not in this directory) runs at `http://localhost:3000` and is the only CORS-allowed origin (see `src/server.js`).

## Commands

- Run the server: `npm start` or `npm run dev` (both just run `node src/server.js`, no watch mode)
- Run tests: `npx jest` — **do not use `npm test`**, its script is a stale placeholder (`echo "Error: no test specified" && exit 1`) and does not actually run Jest
- Run a single test file: `npx jest src/sample.test.js`
- Run tests matching a name: `npx jest -t "name pattern"`
- Coverage is collected automatically on every Jest run (`collectCoverage: true` in `jest.config.js`), output to `coverage/`
- Apply pending DB migrations: `npm run migrate` — check what's applied vs. pending with `npm run migrate:status`

No lint script is configured.

## Environment

Config is loaded via `dotenv` from a `.env` file (gitignored) at the project root, read in both `src/db.js` and `src/server.js`. Required variables: `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `JWT_SECRET`. Note `src/server.js` hardcodes `PORT = 5000` rather than reading `process.env.PORT` — this is intentional, the app runs on 5000.

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
- `controllers/*.js` — route handlers containing business logic; talk to Postgres directly via raw parameterized SQL through `pool.query(...)`.

### Migrations

Schema changes live in `migrations/*.sql`, applied in filename order by `scripts/migrate.js` (`npm run migrate`). Each file runs inside its own transaction and is recorded in the `schema_migrations` table, so re-running is a no-op. Never edit a migration that has already been applied — add a new numbered one instead.

`000_initial_schema.sql` documents the `users`/`tasks` tables that predate the migration system; it uses `IF NOT EXISTS` throughout so it is a no-op against the existing database and a bootstrap for a fresh one.

### Data model

- `users` table: `id`, `username`, `email`, `password_hash` (bcrypt-hashed), `is_active` (boolean, used for soft deactivate/reactivate).
- `tasks` table: `id` (uuid, `gen_random_uuid()`), `user_id` (FK to users), `title`, `description`, `status` (Postgres ENUM: `TODO`, `IN_PROGRESS`, `DONE`), `type` (Postgres ENUM: `EPIC`, `STORY`, `TASK`, `BUG`, defaults to `STORY`), `project_id` (FK to projects), `ticket_number` (int), `created_at`, `updated_at`.
- `companies` table: `id` (uuid), `name`, `description`, `created_by` (FK to users), timestamps. The top-level container above projects — no `key`/ticket-prefix concept, since ticket ids are still derived per-project, not per-company.
- `company_members` table: `(company_id, user_id)` unique, `role` (Postgres ENUM: `OWNER`, `MEMBER`) — same shape as `project_members`, one level up.
- `projects` table: `id` (uuid), `key` (unique, `^[A-Z][A-Z0-9]{1,9}$` — the visible ticket prefix), `name`, `description`, `created_by` (FK to users), `company_id` (FK to companies, `NOT NULL`, `ON DELETE CASCADE`), `next_ticket_number` (atomic counter), timestamps.
- `project_members` table: `(project_id, user_id)` unique, `role` (Postgres ENUM: `OWNER`, `MEMBER`). Projects are multi-user by design; membership — not `tasks.user_id` — is the intended authorization boundary going forward.
- `sprints` table: `id`, `project_id` (FK), `name`, `goal`, `status` (Postgres ENUM: `PLANNED`, `ACTIVE`, `COMPLETED`), `start_date`, `end_date`, timestamps. A partial unique index (`one_active_sprint_per_project`) enforces at most one `ACTIVE` sprint per project — `startSprint` relies on this to turn a race into a `409` rather than checking-then-writing. `tasks.sprint_id` (nullable FK, `ON DELETE SET NULL`) is the Backlog/Sprint split: `NULL` means Backlog.
- `retrospective_notes` table: `id`, `sprint_id` (FK, `ON DELETE CASCADE` — unlike tasks, a note has no identity outside its sprint), `author_id` (FK to users), `category` (Postgres ENUM: `WENT_WELL`, `TO_IMPROVE`, `ACTION_ITEM`), `content`, timestamps.

**Ticket IDs** (`KAN-42`) are *derived*, not stored: `project.key || '-' || task.ticket_number`. `ticket_number` must be assigned atomically via `UPDATE projects SET next_ticket_number = next_ticket_number + 1 ... RETURNING next_ticket_number - 1`, never via `MAX(ticket_number)+1` (races between concurrent users).

Existing rows were backfilled into one auto-created project per user by `004_backfill_default_projects.sql`; `006` closed the expand/contract by making both columns `NOT NULL`.

Likewise, `projects.company_id` went through the same expand/contract: `010` added it nullable, `011_backfill_devtest_company.sql` created a single `devTest` company and pointed every pre-existing project at it, and `012` closed it with `NOT NULL`. `011` is guarded on a specific dev-DB user id existing, so it's a no-op against CI's fresh database — see "Company rules" below.

### Auth flow

Registration hashes passwords with bcrypt and rejects duplicate emails. Login checks `is_active = true`, verifies the bcrypt hash, and issues a JWT (`{ id: user.id }`, 1h expiry) signed with `JWT_SECRET`. There is commented-out (unimplemented) logic in `authController.js` for rate-limiting failed login attempts — not currently enforced.

### Company rules

Companies are the container above projects. `companyController.js` / `companyRoutes.js`, mounted at `/api/companies`. `POST /api/companies` creates the company and its creator's `OWNER` membership in a single transaction, same reasoning as projects — a company without an owner would be unreachable. There's no `key`/ticket-prefix concept at this level.

Deleting a company cascades to its projects (`ON DELETE CASCADE`, which from there cascades further into tasks/sprints/members like a normal project delete), so it returns `409` when the company still has projects unless `?force=true` is passed. The last `OWNER` of a company can be neither demoted nor removed — same `isLastOwner` guard as project membership.

There are two route families for creating a project, both served by `projectController.createProject`:

- `/api/companies/:companyId/projects` — canonical. Behind `requireCompanyMember`.
- `POST /api/projects` — cross-company, requires `company_id` in the body via `requireCompanyMemberFromBody`.

Either way the handler reads `req.company.id` (set by whichever company middleware ran), exactly how `createTask` reads `req.project.id` today. `GET /api/companies/:companyId/projects` (`getCompanyProjects`) is *not* "every project in the company" — it's still filtered by `project_members.user_id = req.user.id`, because being a company member only grants the right to create projects and administer the company, not automatic access to projects you weren't added to. `GET /api/projects` also accepts an optional `?company_id=` filter.

The `devTest` company that migration `011` created owns every project that existed before this feature shipped — see "Data model" above.

### Project rules

Projects are the container for the board, backlog, sprints and retrospectives. `POST /api/projects` creates the project and its creator's `OWNER` membership in a single transaction — a project without an owner would be unreachable even to its creator. If `key` is omitted it is derived from the name (`"Mi Tablero"` → `MIT`, then `MIT2`…); if supplied it is upper-cased and must match `^[A-Z][A-Z0-9]{1,9}$`.

A project's `key` is deliberately **not** editable via `PATCH` — it is the prefix of every ticket id already handed out. Deleting a project cascades to its tasks and members, so it returns `409` when the project still has tasks unless `?force=true` is passed. The last `OWNER` of a project can be neither demoted nor removed.

### Task rules

Tasks are authorized by **project membership**, not by `tasks.user_id` (which is now just who created it). Any member of a project can read and mutate its tasks. There are two route families, both served by the same `taskController.js` handlers:

- `/api/projects/:projectId/tasks` — canonical, the board of one project. Behind `requireProjectMember`.
- `/api/tasks` — cross-project. `GET` is the "my work" view across every project the user belongs to (optional `?project_id=`), `POST` requires `project_id` in the body, and `PATCH`/`DELETE /:id` resolve the project from the task itself.

Handlers read the project from `req.project.id` and scope every query with `WHERE id = $1 AND project_id = $2`, so a task from another project can't be reached through a project you do belong to. `PATCH` accepts `status`, `type` and/or `sprint_id` (at least one). Deletion is still restricted to tasks with `status = 'TODO'`.

`sprint_id` uses `hasOwnProperty` rather than `!== undefined` to tell "not sent" from "sent as `null`" — the latter is how a task moves back to the Backlog. A non-null `sprint_id` is validated against `sprints.project_id` so a task can't end up pointing at another project's sprint. List endpoints (`getProjectTasks`/`getMyTasks`) accept `?sprint_id=<uuid>` or the keyword `?sprint_id=backlog` (there's no way to put a literal `NULL` in a query string) via the shared `buildTaskFilters` — the same filter helper also handles `?status=` and `?type=`, so a new filter is one branch added there rather than a new endpoint.

### Sprint rules

`sprintController.js` / `projectSprintRoutes.js`, mounted at `/api/projects/:projectId/sprints`. Any project member can create/start/complete/delete sprints — unlike project membership management, this isn't OWNER-gated.

- `POST /` creates a sprint in `PLANNED`.
- `GET /:sprintId` returns a single sprint (`404` if it isn't found in the project); mounted after `GET /active` in `projectSprintRoutes.js` so `"active"` doesn't get swallowed by the `:sprintId` param.
- `PATCH /:sprintId` updates `name`/`goal`/`start_date`/`end_date` only (same "at least one field, `undefined` vs `null` distinguishes unset vs. clear" pattern as `updateCompany`/`updateProject`). `status` is deliberately **not** editable here — it only changes through `/start` and `/complete`, which also move tasks and respect `one_active_sprint_per_project`.
- `PATCH /:sprintId/start` moves `PLANNED` → `ACTIVE`; `400` if the sprint isn't `PLANNED`, `409` if another sprint in the project is already `ACTIVE` (caught from the unique-index violation, not pre-checked).
- `PATCH /:sprintId/complete` moves `ACTIVE` → `COMPLETED` and, in the same transaction, sets `sprint_id = NULL` on every non-`DONE` task in that sprint (returned as `moved_to_backlog`) — finished work stays attached to the sprint as history, unfinished work returns to the Backlog instead of being stranded on a closed sprint.
- `DELETE /:sprintId` only allowed while still `PLANNED` — deleting an `ACTIVE`/`COMPLETED` sprint would silently scatter its tasks to the Backlog via `ON DELETE SET NULL`; `completeSprint` is the explicit, auditable way to do that instead.
- `GET /active` is the "Current Sprint" lookup a board view polls; `404` when none is active.

### Retrospective rules

`retroController.js` / `projectRetroRoutes.js`, mounted at `/api/projects/:projectId/sprints/:sprintId/retrospective`. Any project member can read the retro and add notes; editing or deleting a note is restricted to its author, except deletion which the project `OWNER` can also do (light moderation, e.g. removing an inappropriate note).

`GET /` returns notes pre-grouped into `{ WENT_WELL: [...], TO_IMPROVE: [...], ACTION_ITEM: [...] }` rather than a flat list — that's the shape a retro board renders directly, three columns, no client-side grouping. Every handler re-derives `req.user.username` via `NOTE_SELECT`'s join to `users` for `author_name`, since the JWT payload only carries `{ id }`.

## Testing notes

`src/sample.test.js` uses Supertest against the exported `app` and hits the **real** configured Postgres database (no mocking/test DB isolation) — e.g. the happy-path login test depends on a seeded user (`nuevo@mail.com` / `123456`) actually existing in the database. Keep this in mind when adding or running tests: they are integration tests requiring a live, seeded DB connection via the `.env` config, not pure unit tests.

### Controller unit tests (mandatory)

Every controller in `src/controllers/` has a sibling `*.test.js` (e.g. `companyController.js` → `companyController.test.js`) of **unit** tests — distinct from `sample.test.js` above: no Express, no Supertest, no real DB. `src/db.js` is replaced with `jest.mock('../db', () => ({ connect: jest.fn(), query: jest.fn() }))`, and each handler is called directly with a hand-built `req`/`res` (`res.status`/`res.json` as `jest.fn().mockReturnValue(res)` so they chain). Handlers that use a transaction (`pool.connect()`) get a fake `client` (`{ query: jest.fn(), release: jest.fn() }`) returned from `pool.connect.mockResolvedValue(client)`, with `client.query` mocked once per statement in call order (`BEGIN`, the actual queries, `COMMIT`).

**Rule: every new exported controller function must ship with at least 1 happy-path test and 1 negative test in the same commit**, following the existing pattern in that controller's test file (see any `describe('controllerName.functionName', ...)` block for the shape to copy). No commit — and no push to a shared branch (`dev`/`master`) — should introduce a new controller function without matching tests. This is deliberately unit-level and fast (no DB dependency) so it's cheap to run on every change; it complements, not replaces, `sample.test.js`-style integration coverage for critical end-to-end flows.

### CI

`.github/workflows/ci.yml` runs the full Jest suite (unit + `sample.test.js` integration test) on every push and pull request targeting `master` or `dev`, against a real ephemeral `postgres:16` service container — it applies migrations (`npm run migrate`) and seeds the integration test user (`npm run seed:test`) before running `npx jest`, so both test styles run for real in CI, not just locally. Coverage is uploaded as a build artifact. Treat a failing "Test" check as a hard blocker for merging, same as the no-tests-no-commit rule above.
