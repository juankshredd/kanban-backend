# <Feature name>

## Summary

One or two sentences: what this adds or changes, and why.

## Routes affected

- `METHOD /api/...` — new or modified. Which auth/company/project middleware variant gates it (see root `CLAUDE.md` → Architecture for the list).

## Request / response shape

- Request body / query params, with which fields are required vs. optional.
- Response shape and status codes, including error cases (`400`/`403`/`404`/`409`/...).

## Data model changes

- New or changed tables, columns, enums. Note if a migration is needed — see `migrations/CLAUDE.md` for numbering and transactional-apply rules.

## Business rules & edge cases

- Ownership/authorization boundaries.
- Nulls-vs-omitted handling, cascades, races, or anything a reviewer would otherwise have to infer from the diff.

## Test plan

- Happy path(s):
- Negative case(s):
- (This should map 1:1 to what lands in the controller's `*.test.js`.)

## Out of scope

What this deliberately does not cover, to keep implementation from creeping mid-task.

## Open questions

Anything undecided before implementation starts — resolve these before or during planning, not silently during coding.
