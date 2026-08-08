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

- `server.js` — app entry point; wires up CORS, JSON body parsing, and mounts route modules at `/api/auth`, `/api/tasks`, `/api/users`, `/api/projects`. Exports the `app` instance (used directly by Supertest in tests, no separate `app.js`).
- `db.js` — single shared `pg` `Pool` instance, imported by controllers directly (no query-builder/ORM layer).
- `routes/*.js` — thin route definitions that wire an Express `Router` to middleware + controller functions. `projectRoutes.js` applies `authMiddleware` once via `router.use(...)` rather than per route, so nested routers mounted under `/:projectId` inherit it. `projectTaskRoutes.js` and `projectSprintRoutes.js` are mounted there behind `requireProjectMember` with `Router({ mergeParams: true })` and therefore declare no access middleware of their own — that is the pattern for future project-scoped routers (retro).
- `middlewares/authMiddleware.js` — verifies the `Authorization: Bearer <token>` JWT (signed with `JWT_SECRET`), attaches the decoded payload (`{ id }`) to `req.user`. All task, user and project routes require this.
- `middlewares/projectAccess.js` — all project authorization. Each variant differs only in where the project id comes from, and all attach `req.project` + `req.projectRole`. **This is the authorization pattern for anything scoped to a project** — mount one of these on the route instead of re-checking membership inside each controller. Non-members get `404` (not `403`) so project existence isn't leaked; a member who lacks OWNER gets `403`.
  - `requireProjectMember` / `requireProjectOwner` — id from `req.params.projectId`.
  - `requireProjectMemberFromBody` — id from `req.body.project_id`, for cross-project endpoints like `POST /api/tasks`.
  - `requireProjectMemberForResource(table)` — id resolved by looking up the resource itself, for `PATCH`/`DELETE /api/tasks/:id`. A factory so retro notes reuse it too; `table` comes from the `PROJECT_SCOPED_TABLES` whitelist, never from the request.
- `middlewares/validateRegister.js` — request-body validation for registration, applied only to `POST /api/auth/register`.
- `controllers/*.js` — route handlers containing business logic; talk to Postgres directly via raw parameterized SQL through `pool.query(...)`.

### Migrations

Schema changes live in `migrations/*.sql`, applied in filename order by `scripts/migrate.js` (`npm run migrate`). Each file runs inside its own transaction and is recorded in the `schema_migrations` table, so re-running is a no-op. Never edit a migration that has already been applied — add a new numbered one instead.

`000_initial_schema.sql` documents the `users`/`tasks` tables that predate the migration system; it uses `IF NOT EXISTS` throughout so it is a no-op against the existing database and a bootstrap for a fresh one.

### Data model

- `users` table: `id`, `username`, `email`, `password_hash` (bcrypt-hashed), `is_active` (boolean, used for soft deactivate/reactivate).
- `tasks` table: `id` (uuid, `gen_random_uuid()`), `user_id` (FK to users), `title`, `description`, `status` (Postgres ENUM: `TODO`, `IN_PROGRESS`, `DONE`), `type` (Postgres ENUM: `EPIC`, `STORY`, `TASK`, `BUG`, defaults to `STORY`), `project_id` (FK to projects), `ticket_number` (int), `created_at`, `updated_at`.
- `projects` table: `id` (uuid), `key` (unique, `^[A-Z][A-Z0-9]{1,9}$` — the visible ticket prefix), `name`, `description`, `created_by` (FK to users), `next_ticket_number` (atomic counter), timestamps.
- `project_members` table: `(project_id, user_id)` unique, `role` (Postgres ENUM: `OWNER`, `MEMBER`). Projects are multi-user by design; membership — not `tasks.user_id` — is the intended authorization boundary going forward.
- `sprints` table: `id`, `project_id` (FK), `name`, `goal`, `status` (Postgres ENUM: `PLANNED`, `ACTIVE`, `COMPLETED`), `start_date`, `end_date`, timestamps. A partial unique index (`one_active_sprint_per_project`) enforces at most one `ACTIVE` sprint per project — `startSprint` relies on this to turn a race into a `409` rather than checking-then-writing. `tasks.sprint_id` (nullable FK, `ON DELETE SET NULL`) is the Backlog/Sprint split: `NULL` means Backlog.

**Ticket IDs** (`KAN-42`) are *derived*, not stored: `project.key || '-' || task.ticket_number`. `ticket_number` must be assigned atomically via `UPDATE projects SET next_ticket_number = next_ticket_number + 1 ... RETURNING next_ticket_number - 1`, never via `MAX(ticket_number)+1` (races between concurrent users).

Existing rows were backfilled into one auto-created project per user by `004_backfill_default_projects.sql`; `006` closed the expand/contract by making both columns `NOT NULL`.

### Auth flow

Registration hashes passwords with bcrypt and rejects duplicate emails. Login checks `is_active = true`, verifies the bcrypt hash, and issues a JWT (`{ id: user.id }`, 1h expiry) signed with `JWT_SECRET`. There is commented-out (unimplemented) logic in `authController.js` for rate-limiting failed login attempts — not currently enforced.

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
- `PATCH /:sprintId/start` moves `PLANNED` → `ACTIVE`; `400` if the sprint isn't `PLANNED`, `409` if another sprint in the project is already `ACTIVE` (caught from the unique-index violation, not pre-checked).
- `PATCH /:sprintId/complete` moves `ACTIVE` → `COMPLETED` and, in the same transaction, sets `sprint_id = NULL` on every non-`DONE` task in that sprint (returned as `moved_to_backlog`) — finished work stays attached to the sprint as history, unfinished work returns to the Backlog instead of being stranded on a closed sprint.
- `DELETE /:sprintId` only allowed while still `PLANNED` — deleting an `ACTIVE`/`COMPLETED` sprint would silently scatter its tasks to the Backlog via `ON DELETE SET NULL`; `completeSprint` is the explicit, auditable way to do that instead.
- `GET /active` is the "Current Sprint" lookup a board view polls; `404` when none is active.

## Testing notes

`src/sample.test.js` uses Supertest against the exported `app` and hits the **real** configured Postgres database (no mocking/test DB isolation) — e.g. the happy-path login test depends on a seeded user (`nuevo@mail.com` / `123456`) actually existing in the database. Keep this in mind when adding or running tests: they are integration tests requiring a live, seeded DB connection via the `.env` config, not pure unit tests.
