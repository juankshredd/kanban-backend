# CLAUDE.md — migrations/

Loaded automatically (per Claude Code's nested-memory-file mechanism) whenever Claude reads files in this directory — see the root `CLAUDE.md` for project-wide context that isn't repeated here.

## Migrations

Schema changes live in `migrations/*.sql`, applied in filename order by `scripts/migrate.js` (`npm run migrate`). Each file runs inside its own transaction and is recorded in the `schema_migrations` table, so re-running is a no-op. Never edit a migration that has already been applied — add a new numbered one instead.

`000_initial_schema.sql` documents the `users`/`tasks` tables that predate the migration system; it uses `IF NOT EXISTS` throughout so it is a no-op against the existing database and a bootstrap for a fresh one.

`003_tasks_project_columns.sql` added `tasks.project_id` and `tasks.ticket_number`, nullable at first; existing rows were backfilled into one auto-created project per user by `004_backfill_default_projects.sql`; `006` closed the expand/contract by making both `project_id` and `ticket_number` `NOT NULL`.

Likewise, `projects.company_id` went through the same expand/contract: `010` added it nullable, `011_backfill_devtest_company.sql` created a single `devTest` company and pointed every pre-existing project at it, and `012` closed it with `NOT NULL`. `011` is guarded on a specific dev-DB user id existing, so it's a no-op against CI's fresh database — see "Company rules" in `src/controllers/CLAUDE.md`.

For the actual table schemas (columns, types, FKs, enums), see "Data model" in `src/controllers/CLAUDE.md` — that's where they're documented, since they're consumed and validated there.
