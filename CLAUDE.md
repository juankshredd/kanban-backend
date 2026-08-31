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

- Run the Postman/Newman API-level QA suite (requires the server running on port 5000): `npm run test:postman` — see `postman/README.md`. Regenerate the collection after changing an endpoint with `npm run postman:generate` (never hand-edit the generated JSON).

## Git workflow

`dev` is branch-protected on GitHub ("Changes must be made through a pull request") and `master` presumably more so. **Never push or merge directly into `dev` or `master`** — do all work on a feature branch cut from `dev` (e.g. `feature/<name>`) and open a PR back into `dev` instead, even if a direct push would technically succeed for an admin account. If a push is rejected or bypasses the rule with a warning, treat that as a sign to stop and go through a PR rather than proceeding.

**Always review a PR right after opening it**, using the `/code-review` skill against that PR (`/code-review ultra <PR#>` for a deeper multi-agent pass on larger/riskier changes) — don't wait to be asked. This is a manual, on-demand review done by invoking the skill, not an automated GitHub Action/bot; no CI workflow should be added for this unless explicitly requested. Report findings back in chat, or post them as inline PR comments with `--comment` when useful.

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
- `tasks` table: `id` (uuid, `gen_random_uuid()`), `user_id` (FK to users — the *reporter*, i.e. who created it), `title`, `description`, `status` (Postgres ENUM: `TODO`, `IN_PROGRESS`, `DONE`), `type` (Postgres ENUM: `EPIC`, `FEATURE`, `STORY`, `TASK`, `BUG`, defaults to `STORY`), `project_id` (FK to projects), `ticket_number` (int), `rank` (`numeric`, `NOT NULL` — manual Board/Backlog ordering, one global sequence per project; see "Board & Backlog rules"), `details` (`jsonb`, `NOT NULL DEFAULT '{}'` — type-specific fields, see "Task detail fields" below), `parent_id` (nullable FK to `tasks`, `ON DELETE RESTRICT` by default — the EPIC/FEATURE/STORY/TASK containment chain, see "Task hierarchy" below), `assignee_id` (nullable FK to users, migration `019_task_detail_panel_fields.sql` — separate from `user_id`/reporter), `points` (nullable integer), `labels` (`text[]`, `NOT NULL DEFAULT '{}'` — free-text per task, no shared catalog), `updated_by` (nullable FK to users — who made the last `PATCH`), `created_at`, `updated_at`.
- `companies` table: `id` (uuid), `name`, `description`, `created_by` (FK to users), timestamps. The top-level container above projects — no `key`/ticket-prefix concept, since ticket ids are still derived per-project, not per-company.
- `company_members` table: `(company_id, user_id)` unique, `role` (Postgres ENUM: `OWNER`, `MEMBER`) — same shape as `project_members`, one level up.
- `projects` table: `id` (uuid), `key` (unique, `^[A-Z][A-Z0-9]{1,9}$` — the visible ticket prefix), `name`, `description`, `created_by` (FK to users), `company_id` (FK to companies, `NOT NULL`, `ON DELETE CASCADE`), `next_ticket_number` (atomic counter), timestamps.
- `project_members` table: `(project_id, user_id)` unique, `role` (Postgres ENUM: `OWNER`, `MEMBER`). Projects are multi-user by design; membership — not `tasks.user_id` — is the intended authorization boundary going forward.
- `sprints` table: `id`, `project_id` (FK), `name`, `goal`, `status` (Postgres ENUM: `PLANNED`, `ACTIVE`, `COMPLETED`), `start_date`, `end_date`, timestamps. A partial unique index (`one_active_sprint_per_project`) enforces at most one `ACTIVE` sprint per project — `startSprint` relies on this to turn a race into a `409` rather than checking-then-writing. `tasks.sprint_id` (nullable FK, `ON DELETE SET NULL`) is the Backlog/Sprint split: `NULL` means Backlog.
- `retrospective_notes` table: `id`, `sprint_id` (FK, `ON DELETE CASCADE` — unlike tasks, a note has no identity outside its sprint), `author_id` (FK to users), `category` (Postgres ENUM: `WENT_WELL`, `TO_IMPROVE`, `ACTION_ITEM`), `content`, timestamps.
- `task_relations` table (migration `017_task_relations.sql`, `relation_type` added in `018_task_relation_types.sql`): `id`, `task_id` / `related_task_id` (both FK to `tasks`, `ON DELETE CASCADE`), `relation_type` (Postgres ENUM: `RELATED_TO`, `BLOCKS`, `DUPLICATES`, `CLONES`, defaults to `RELATED_TO`), `created_by` (FK to users), `created_at`. An N:M link between any two tasks in the same project, of several kinds — `RELATED_TO` is symmetric, the other three are directional. Distinct from the `parent_id` hierarchy, see "Task relations" below.
- `task_comments` table (migration `020_task_comments.sql`): `id`, `task_id` (FK, `ON DELETE CASCADE`), `author_id` (FK to users), `content`, `created_at`. The "Activity" feed on a task — see "Task comments" below.

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

Handlers read the project from `req.project.id` and scope every query with `WHERE id = $1 AND project_id = $2`, so a task from another project can't be reached through a project you do belong to. `PATCH` accepts `status`, `type`, `sprint_id`, `details`, `parent_id`, `assignee_id`, `points`, `labels` and/or `after_task_id` (at least one). Deletion is still restricted to tasks with `status = 'TODO'`, and is also blocked (`409`) if the task still has children (see "Task hierarchy" below). Every successful `PATCH` also sets `updated_by = req.user.id` alongside `updated_at` — there is no way to write a task without recording who did it.

`sprint_id`/`assignee_id`/`parent_id` all use `hasOwnProperty` rather than `!== undefined` to tell "not sent" from "sent as `null`" — `sprint_id: null` moves a task back to the Backlog, `assignee_id: null` unassigns it. A non-null `sprint_id` is validated against `sprints.project_id`; a non-null `assignee_id` is validated against `project_members` (`validateAssigneeId`, same `{ value }`/`{ error }` shape as `validateParentId`) — assigning to someone outside the project would leave them with no way to see the task anywhere. `points` must be a non-negative integer or `null`; `labels` is **replaced wholesale**, not merged (same contract as `details`), via `normalizeLabels`.

List endpoints (`getProjectTasks`/`getMyTasks`) accept `?sprint_id=<uuid>` or the keyword `?sprint_id=backlog` (there's no way to put a literal `NULL` in a query string) via the shared `buildTaskFilters` — the same filter helper also handles `?status=`, `?type=`, `?parent_id=` and `?search=` (case-insensitive `ILIKE` over `title` OR the derived ticket key, for the "Add related card" search panel), so a new filter is one branch added there rather than a new endpoint. `getProjectTasks` orders by `rank` (see "Board & Backlog rules" below); `getMyTasks` still orders by `created_at DESC` since it spans multiple projects, where one project's `rank` isn't a meaningful cross-project order.

#### Task detail fields

Each card `type` has its own extra fields beyond the common `title`/`description`, stored in the single `details` JSONB column rather than one column per field — `TASK_DETAIL_FIELDS` in `taskController.js` is the whitelist of allowed keys per type (currently `BUG`: `steps_to_reproduce`, `expected_behavior`, `actual_behavior`; `STORY`: `acceptance_criteria`; `EPIC`/`TASK`: none yet), and `normalizeDetails(type, details)` validates a submitted `details` object against it — unknown keys or non-string values are `400`s. Adding a field, or a field set for a currently-empty type, is a one-line change to that map, not a migration.

`details` is **replaced wholesale**, not merged, on every write — same contract as `type`/`sprint_id` — so sending `{}` clears all fields. `createTask` validates it against the task's (possibly just-defaulted) type and defaults to `{}` when omitted. `updateTask` validates it against whatever type the task will have *after* this same request: if `type` is also being sent, that's the effective type with no extra query; otherwise the task's current `type` is looked up first (mirrors the existing "look up current `sprint_id` when `after_task_id` arrives alone" pattern in the same handler).

The reverse case is guarded too: if `type` changes but `details` is *not* sent in the same request (including via `PATCH /:id/type`, which forwards only `{ type }`), `updateTask` looks up the task's already-stored `details` and re-validates them against the new type, `400`ing rather than silently leaving now-invalid fields (e.g. a BUG's `steps_to_reproduce`) on a task that just became a STORY. Send `details` explicitly in the same request to change both at once.

`updateTask` consolidates every one of these "look up the current value of a field this request doesn't touch" cases (current `details`, current `parent_id`, current `type`, current `sprint_id`) into a single `SELECT type, details, parent_id, sprint_id FROM tasks WHERE id = $1 AND project_id = $2`, fetched at most once per request behind one `needsCurrentRow` check, rather than a separate query per field — this is deliberate: the field list only grows over time, and one round trip regardless of how many optional fields combine in a request is the difference between a board reorder-plus-edit staying cheap or not.

#### Task hierarchy

Cards form a fixed, four-level containment chain — `EPIC` → `FEATURE` → `STORY` → `TASK`/`BUG` — via a single nullable self-referencing `tasks.parent_id`. `TASK_PARENT_TYPE` in `taskController.js` maps each type to the *one* type its parent must be (`EPIC: null`, `FEATURE: 'EPIC'`, `STORY: 'FEATURE'`, `TASK`/`BUG: 'STORY'`); `validateParentId(parentId, childType, projectId)` is the single async helper enforcing it (parent must exist in the same project and have the required type), reused by `createTask` and both directions of `updateTask` (setting a new `parent_id`, and re-validating an *existing* `parent_id` when only `type` changes — the parent-side mirror of the `details` safeguard above). Because the chain has a fixed depth with exactly one legal parent type per child type, a cycle is structurally impossible without needing an ancestor walk to check for one.

Deleting a task with children is blocked: `parent_id`'s FK has no `ON DELETE` action (defaults to `RESTRICT`), so Postgres raises `23503` and `deleteTask` turns that into `409 { message: 'Cannot delete: task has child tasks' }` — same explicit-block-over-silent-cascade philosophy as company/project deletion, rather than orphaning children or cascading through possibly-non-`TODO` tasks. `createTask`/`updateTask` catch the same `23503` (`409 { message: 'parent_id no longer exists' }`) for the narrower race where `validateParentId`'s lookup passes but the parent is deleted by another request before the write lands — `validateParentId` and the write it guards aren't in the same transaction, so this stays possible even though it's rare. List endpoints accept `?parent_id=<uuid>` (direct children of that task) or `?parent_id=none` (root tasks — any task with no parent, not just `EPIC`s, see below) via `buildTaskFilters`, same pattern as `?sprint_id=backlog`.

`GET /api/projects/:projectId/hierarchy` (`boardController.getTaskHierarchy`) returns the whole project's tree in one request — one `SELECT` of every task in the project (reusing `TASK_SELECT`) followed by an O(n) two-pass in-memory grouping by `parent_id` (no recursion: build a wrapper-with-`children` object per task first, then push each into its parent's `children` array by reference), returned as `{ roots: [...] }`. "Root" means *any* task with `parent_id IS NULL`, not only `EPIC`s — `parent_id` is optional for every type (a `STORY` can exist before it's attached to a `FEATURE`), so filtering roots to `type === 'EPIC'` would silently drop such tasks from the one endpoint whose job is showing the complete tree. Exists so a frontend rendering a full Epic→Feature→Story→Task view does it in one round trip instead of one request per node.

#### Task relations

Beyond the `parent_id` hierarchy, tasks can also be linked with a second, unrelated kind of relation, of several **types**: `RELATED_TO` (symmetric, A↔B, no direction), and `BLOCKS`/`DUPLICATES`/`CLONES` (directional — one task points at another). Untyped-by-card-type (any type can link to any other) and multivalued (a task can have any number of links, including more than one type against the same other task). That shape doesn't fit as a column on `tasks`; it's modeled by its own N:M table, `task_relations`, and its own controller, `taskRelationController.js` (a separate file from `taskController.js`, same precedent as `retroController.js` living apart from `sprintController.js`).

- `POST /api/projects/:projectId/tasks/:id/relations` (canonical) or `POST /api/tasks/:id/relations` (cross-project, via `requireProjectMemberForResource('tasks')`) — body `{ related_task_id, relation_type? }`. `relation_type` defaults to `RELATED_TO` when omitted (keeps the original pre-`018` contract working); otherwise it's validated against the `RELATION_TYPES` whitelist. A single `id = ANY($1)` query confirms both tasks belong to the same project (`404` if not); `related_task_id.toLowerCase() === id.toLowerCase()` is rejected with `400` before touching the DB (case-insensitive because Postgres treats a `uuid` that way regardless of the casing it's written in — a plain `===` doesn't).
- Uniqueness is enforced by **two partial unique indexes**, not an app-level check-then-insert (`018_task_relation_types.sql`): `idx_task_relations_symmetric_unique` covers `relation_type = 'RELATED_TO'` on the **unordered pair** (`LEAST`/`GREATEST`, since A-relates-to-B and B-relates-to-A are the same edge); `idx_task_relations_directional_unique` covers the other three types on the **exact stored order** (`task_id, related_task_id`, since `task1 BLOCKS task2` and `task2 BLOCKS task1` are different, both-valid edges). Either violation is the same race-into-`409` trick as `one_active_sprint_per_project`: `23505` → `409 'This relation already exists'`. A `23503` is the same kind of race `parent_id no longer exists` handles for the hierarchy — `taskRelationController.js` inspects `error.constraint` to blame the right side (`task_id`, `related_task_id`, or `created_by`, if the acting user's own row vanished) rather than always assuming `related_task_id`.
- `GET .../:id/relations` (`fetchRelationsForTask`, exported so `boardController.getTaskDetail` can reuse it — see "Board & Backlog rules" below) resolves "the other task" from whichever side of the stored pair matches `:id` via a `CASE`, then re-projects those ids through `TASK_SELECT` (filtered by `project_id` too, as defense in depth — not solely relying on `createRelation` already having enforced same-project) — two queries plus a merge in JS, same pattern as `getBacklogView`. Each row's **label is resolved relative to the requesting side**: `RELATED_TO` is always `'relates to'`; a directional type reads as its forward label (`'blocks'`/`'duplicates'`/`'clones'`) from the `task_id` side, or its inverse (`'is blocked by'`/`'is duplicated by'`/`'is cloned by'`) from the `related_task_id` side — so the same stored row shows differently depending on which task you're looking from, without storing it twice. Returns `[{ relation_id, related_since, type, task: {...} }]`.
- `DELETE .../:id/relations/:relationId` — matches by the **relation row's own id**, not by the other task, plus `AND (task_id = $2 OR related_task_id = $2)` so the anchor task must actually be part of that relation. Deliberately not "by task pair": since two tasks can now have more than one `relation_type` active between them simultaneously, "delete the link between task A and task B" is ambiguous — `relationId` isn't.
- Unlike `parent_id` (`ON DELETE RESTRICT`, since a parent with children can't just vanish), `task_relations`' FKs are `ON DELETE CASCADE` — any relation is a loose reference, not containment, so deleting either task simply drops the link instead of blocking the delete.
- The link-type picker in the frontend's ticket modal also offers `"is child of"` — that one is **not** a `task_relations` row at all, it's the same search UI reused to set `parent_id` (`PATCH /api/tasks/:id { parent_id }`, already covered by "Task hierarchy" above).

#### Task comments

`taskCommentController.js`, mounted the same way as relations (`/api/projects/:projectId/tasks/:id/comments` and `/api/tasks/:id/comments`). The "Activity" feed on a task — same access pattern as `retrospective_notes`: any project member can read and add; deleting is restricted to the comment's author or the project `OWNER` (light moderation, same as retro notes). **No editing** — nothing in the product surface calls for it yet, so it isn't built. `@mentions` inside `content` are stored as plain text; highlighting them is a frontend rendering concern (regex over `@username`), not something this API parses, validates, or notifies on.

### Sprint rules

`sprintController.js` / `projectSprintRoutes.js`, mounted at `/api/projects/:projectId/sprints`. Any project member can create/start/complete/delete sprints — unlike project membership management, this isn't OWNER-gated.

- `POST /` creates a sprint in `PLANNED`.
- `GET /:sprintId` returns a single sprint (`404` if it isn't found in the project); mounted after `GET /active` in `projectSprintRoutes.js` so `"active"` doesn't get swallowed by the `:sprintId` param.
- `PATCH /:sprintId` updates `name`/`goal`/`start_date`/`end_date` only (same "at least one field, `undefined` vs `null` distinguishes unset vs. clear" pattern as `updateCompany`/`updateProject`). `status` is deliberately **not** editable here — it only changes through `/start` and `/complete`, which also move tasks and respect `one_active_sprint_per_project`.
- `PATCH /:sprintId/start` moves `PLANNED` → `ACTIVE`; `400` if the sprint isn't `PLANNED`, `409` if another sprint in the project is already `ACTIVE` (caught from the unique-index violation, not pre-checked).
- `PATCH /:sprintId/complete` moves `ACTIVE` → `COMPLETED` and, in the same transaction, sets `sprint_id = NULL` on every non-`DONE` task in that sprint (returned as `moved_to_backlog`) — finished work stays attached to the sprint as history, unfinished work returns to the Backlog instead of being stranded on a closed sprint.
- `DELETE /:sprintId` only allowed while still `PLANNED` — deleting an `ACTIVE`/`COMPLETED` sprint would silently scatter its tasks to the Backlog via `ON DELETE SET NULL`; `completeSprint` is the explicit, auditable way to do that instead.
- `GET /active` is the "Current Sprint" lookup a board view polls; `404` when none is active.

### Board & Backlog rules

`tasks.rank` (numeric, migration `013_task_rank.sql`) is **one global ordering sequence per project**, not one per sprint — this mirrors Jira's own model (a single ranked list; the Board and each Backlog section are just that list filtered by `sprint_id`), so relative order is automatically correct in any filtered view without maintaining a separate sequence per sprint/Backlog. `numeric`, not `float`: inserting between two neighbors via `(a + b) / 2` never loses precision even after many reorders, so there's no rebalance job. New tasks (`createTask`) always append to the end of the project's sequence (bottom of the Backlog, since new tasks have no `sprint_id` yet).

Reordering goes through the existing `PATCH /api/tasks/:id` (`updateTask`), via an optional `after_task_id` — same `hasOwnProperty` trick as `sprint_id` (`null` = top of the destination list, absent = don't touch rank). By default the destination list is `project_id` + whatever `sprint_id` the task ends up with *after this same request* (its current `sprint_id` is looked up if not sent), matched with `IS NOT DISTINCT FROM` rather than `=` so Backlog-to-Backlog reorders (`sprint_id IS NULL`) work. This means one API call carries both "move to a different sprint" and "drop at this exact position" — exactly what a single drag-and-drop event needs to send.

An optional `reorder_scope: 'siblings'` switches the destination list to **children of the same `parent_id`** instead (again, `parent_id` sent in this request if present, otherwise looked up) — filtered *only* by `parent_id`, not also `sprint_id`, since two subtasks of the same parent aren't guaranteed to share a sprint. `400` if the task has no `parent_id` to scope by. This is deliberately explicit rather than inferred from "does the task have a `parent_id`": Board/Backlog listings aren't filtered by `parent_id` at all, so a `STORY` with a parent `FEATURE` still shows up and gets dragged around the ordinary Board — inferring "has a parent → must mean sibling-reorder" would silently break that drag for any task that happens to have one. `reorder_scope` is how the ticket-detail modal's "Child issues" panel reorders subtasks without touching their Board/Backlog position, using the exact same `rank` column and `after_task_id` mechanics — one more filtered view over the same global sequence, same as `sprint_id` already is.

`boardController.js`, mounted directly in `projectRoutes.js` (leaf `GET`s, not a nested resource family — same pattern as `getProjectById`) except `getTaskDetail`, wired instead into `projectTaskRoutes.js`/`taskRoutes.js` since its URL nests under `/tasks/:id`, exposes four read-optimized aggregate views built for a Jira-style UI so the frontend isn't composing several calls per screen:

- `GET /api/projects/:projectId/board` — the active sprint + its tasks (ordered by `rank`) in one call; `404` if there's no active sprint. Deliberately separate from `sprintController.getActiveSprint` (used elsewhere for lighter widgets like a "Current Sprint" pill) so that endpoint doesn't get bloated with a full task list it doesn't need.
- `GET /api/projects/:projectId/backlog` — every `PLANNED` sprint (ordered by `start_date`, nulls last) with its own tasks embedded, plus the unassigned Backlog tasks. Always exactly 3 queries (sprints, backlog tasks, all-sprints'-tasks via `sprint_id = ANY(...)`) regardless of how many future sprints exist, instead of `1 + N` round trips.
- `GET /api/projects/:projectId/hierarchy` — the whole EPIC→FEATURE→STORY→TASK/BUG tree in one call; see "Task hierarchy" above.
- `GET /api/projects/:projectId/tasks/:id/detail` (`getTaskDetail`, also under `/api/tasks/:id/detail`) — the ticket-detail modal's single call: the task itself, its parent (or `null`), its children (ordered by `rank`), its relations (grouped by the already-resolved label from `taskRelationController.fetchRelationsForTask`, e.g. `{ "blocks": [...], "is blocked by": [...] }`), and its sprint (`{ id, name, start_date, end_date }`, or `null`). The four lookups only depend on the already-fetched task row, not on each other, so they run via `Promise.all` rather than sequential `await`s — the one place in this codebase currently doing that, since here it actually collapses 4 round trips into the time of the slowest one instead of the sum.

All four reuse `taskController.js`'s `TASK_SELECT` (exported for this reason) rather than redefining the task projection — the first SQL fragment shared across controller files; every other `*_SELECT` (`SPRINT_SELECT`, `NOTE_SELECT`, `COMMENT_SELECT`) is still private to its own controller.

### Retrospective rules

`retroController.js` / `projectRetroRoutes.js`, mounted at `/api/projects/:projectId/sprints/:sprintId/retrospective`. Any project member can read the retro and add notes; editing or deleting a note is restricted to its author, except deletion which the project `OWNER` can also do (light moderation, e.g. removing an inappropriate note).

`GET /` returns notes pre-grouped into `{ WENT_WELL: [...], TO_IMPROVE: [...], ACTION_ITEM: [...] }` rather than a flat list — that's the shape a retro board renders directly, three columns, no client-side grouping. Every handler re-derives `req.user.username` via `NOTE_SELECT`'s join to `users` for `author_name`, since the JWT payload only carries `{ id }`.

## Postman / Newman (API-level QA suite)

`postman/` holds a generated Postman collection (155 requests across 10 ordered folders) that exercises the whole API end-to-end against a real running server — complementary to the Jest suites above, which mock `src/db` and never hit Postgres. See `postman/README.md` for how it's organized, how to run it, and how to regenerate it after an endpoint changes. CI runs it with Newman on every push/PR, after the Jest step.

## Testing notes

`src/sample.test.js` uses Supertest against the exported `app` and hits the **real** configured Postgres database (no mocking/test DB isolation) — e.g. the happy-path login test depends on a seeded user (`nuevo@mail.com` / `123456`) actually existing in the database. Keep this in mind when adding or running tests: they are integration tests requiring a live, seeded DB connection via the `.env` config, not pure unit tests.

### Controller unit tests (mandatory)

Every controller in `src/controllers/` has a sibling `*.test.js` (e.g. `companyController.js` → `companyController.test.js`) of **unit** tests — distinct from `sample.test.js` above: no Express, no Supertest, no real DB. `src/db.js` is replaced with `jest.mock('../db', () => ({ connect: jest.fn(), query: jest.fn() }))`, and each handler is called directly with a hand-built `req`/`res` (`res.status`/`res.json` as `jest.fn().mockReturnValue(res)` so they chain). Handlers that use a transaction (`pool.connect()`) get a fake `client` (`{ query: jest.fn(), release: jest.fn() }`) returned from `pool.connect.mockResolvedValue(client)`, with `client.query` mocked once per statement in call order (`BEGIN`, the actual queries, `COMMIT`).

**Rule: every new exported controller function must ship with at least 1 happy-path test and 1 negative test in the same commit**, following the existing pattern in that controller's test file (see any `describe('controllerName.functionName', ...)` block for the shape to copy). No commit — and no push to a shared branch (`dev`/`master`) — should introduce a new controller function without matching tests. This is deliberately unit-level and fast (no DB dependency) so it's cheap to run on every change; it complements, not replaces, `sample.test.js`-style integration coverage for critical end-to-end flows.

### CI

`.github/workflows/ci.yml` runs the full Jest suite (unit + `sample.test.js` integration test) on every push and pull request targeting `master` or `dev`, against a real ephemeral `postgres:16` service container — it applies migrations (`npm run migrate`) and seeds the integration test user (`npm run seed:test`) before running `npx jest`, so both test styles run for real in CI, not just locally. Coverage is uploaded as a build artifact. Treat a failing "Test" check as a hard blocker for merging, same as the no-tests-no-commit rule above.
