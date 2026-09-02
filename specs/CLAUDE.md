# CLAUDE.md — specs/

Loaded automatically whenever Claude reads files in this directory — see the root `CLAUDE.md` for project-wide context. `specs/` is a **staging area for decisions**, not a permanent record; the permanent record is `src/controllers/CLAUDE.md` (data model, business rules) and `migrations/CLAUDE.md` (migration mechanics).

## When to write a spec

Any non-trivial feature: a new endpoint, a new controller function, a new business rule, or a change that touches an authorization boundary (which middleware variant gates a route, who counts as a member/owner, or an addition to an authorization-relevant whitelist like `PROJECT_SCOPED_TABLES`). Skip it for pure bug fixes, refactors with no behavior change, or one-line additions to a non-authorization whitelist (e.g. adding a key to `TASK_DETAIL_FIELDS`) — if the whitelist entry changes what's authorized rather than what's validated, it still needs a spec.

## Convention

- One file per feature: `specs/<feature-slug>.md`, named for the feature, not the ticket (`specs/task-watchers.md`, not `specs/KAN-42.md`).
- Copy `specs/TEMPLATE.md` as the starting point and fill in only what's actually known; leave gaps in "Open questions" rather than guessing.

## Lifecycle

1. Write the spec before implementation starts.
2. Bring it to Claude Code — expect a plan drafted from the spec (Plan mode) rather than from a bare prompt.
3. If implementation diverges from the spec (an edge case surfaces, an existing pattern forces a different shape), update the spec too — by the time a PR is up, the spec should describe what actually got built, not what was originally guessed.
4. Once merged, fold anything durable into `src/controllers/CLAUDE.md` / `migrations/CLAUDE.md` (data model, business rules, migration mechanics) and, for anything touching an authorization boundary or middleware wiring, the root `CLAUDE.md` Architecture section as well — then delete the spec file. Specs don't accumulate indefinitely.
5. If an endpoint was added or changed, regenerate the Postman collection (`npm run postman:generate`) — that's the executable counterpart to the written spec.

## Relationship to the test mandate

The spec's "Test plan" section should map 1:1 to the mandatory happy-path + negative test pair required for every new controller function (root `CLAUDE.md`). Writing that mapping down before code exists is the point — it's the cheapest place to catch a missing case, before it's a gap in a `*.test.js` file.
