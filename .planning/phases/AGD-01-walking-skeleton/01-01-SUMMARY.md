---
phase: AGD-01-walking-skeleton
plan: 01
subsystem: data-model-and-ingest-persistence
tags: [schema, persistence, fixtures, boundaries, tracer]
status: complete

requires: []
provides:
  - agentdock.repository / artifact_type / package / package_version / repository_denylist
  - src/ingest/types.ts — RepoScan / ScannedPackage contract
  - src/ingest/persist.ts — persistScan()
  - src/db/queries/packages.ts — listPackages / countPackages / permalink
  - fixtures/anthropics-skills/ — frozen 501-entry corpus at f17010c9
  - check-boundaries rule 5 (no-raw-html, no-execution, no-disk-write, no-host-sprawl)
affects:
  - scripts/migrate.mjs (reference-data seeding)
  - package.json (4 runtime deps + 1 dev dep, 2 new scripts)

tech-stack:
  added:
    - react-markdown@10.1.0
    - remark-gfm@4.0.1
    - rehype-sanitize@6.0.0
    - js-yaml@4.3.1
    - "@types/js-yaml@4.0.9 (dev)"
  patterns:
    - Idempotency delegated to unique constraints, never to read-then-write
    - Repository identity = GitHub node id, not full_name
    - Reference data reasserted by the migrator, not only by a reviewed migration

key-files:
  created:
    - src/ingest/types.ts
    - src/ingest/persist.ts
    - src/ingest/persist.test.ts
    - src/db/queries/packages.ts
    - src/app/skills/page.tsx
    - scripts/capture-fixtures.mjs
    - scripts/seed-fixture.mjs
    - drizzle/0001_outstanding_the_santerians.sql
    - fixtures/anthropics-skills/ (repo.json, tree.json, 18 bodies)
  modified:
    - src/db/schema.ts
    - scripts/check-boundaries.mjs
    - scripts/check-boundaries.test.ts
    - scripts/migrate.mjs
    - package.json

decisions:
  - Foreign keys are bigint, not bigserial (corrects RESEARCH.md sketch)
  - artifact_type is a table with an FK, not a text CHECK constraint
  - js-yaml pinned to 4.3.1, deliberately one major behind
  - Reference data seeded by scripts/migrate.mjs so agentdock_test gets it too
  - stripJsComments must not treat `//` in `https://` as a comment start

metrics:
  duration: ~35m
  completed: 2026-08-10

actuals:
  tokens: 61000
  tasks: 3
  commits: 0
---

# Phase AGD-01 Plan 01: Walking Skeleton Foundation Summary

Five tables in `agentdock` behind one reviewed migration, a transactional
`persistScan()` whose idempotency is enforced by unique constraints rather than
by application logic, and a real `anthropics/skills` skill rendered on `/skills`
with a `blob/<commit-sha>/` permalink verified to return 200 from github.com.

## Not committed

**No `git commit` or `git push` was run.** The maintainer commits. Every change
below is left in the working tree. The plan's per-task commit protocol was
deliberately skipped for this reason; task boundaries are described below so the
work can still be split into commits by hand if wanted.

## What was verified, with real output

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | `Checked 199 installs across 328 packages (no changes)` |
| `bun run fixtures:capture` | `anthropics-skills: 501 entries, 18 SKILL.md, 18 bodies captured, permalink 200` |
| `bun run db:generate` | `drizzle/0001_outstanding_the_santerians.sql` |
| `bun run db:migrate` | `agentdock: applied 1 of 2 migration(s).` |
| `bun run db:test:setup` | `agentdock_test: applied 1 of 2 migration(s).` |
| `bun run db:seed` (1st) | `3 package(s), 3 new version(s)` |
| `bun run db:seed` (2nd) | `3 package(s), 0 new version(s)` — idempotent |
| `bun run check:boundaries` | `2 migration file(s), package.json, 1 schema module, 10 source file(s)` → OK |
| `bun run build` | Compiled successfully; `/skills` listed as `ƒ (Dynamic)` |
| `bun run ci` | boundaries OK, biome clean, `tsc --noEmit` clean, **40 tests passed (4 files)** |
| `CI=1 bun run test` | `2 passed | 2 skipped (4)` files, `21 passed | 8 skipped (29)` tests |

Ordering note: `bun run build` was run **before** `bun run ci`, as required.

End-to-end tracer proof, from the running production server:

```
link:   https://github.com/anthropics/skills/blob/f17010c9bb483898c1d9c9f42dde2b3a98889434/skills/algorithmic-art/SKILL.md
status: 200
```

Table ownership, both schemas — `artifact_type`, `package`, `package_version`,
`repository`, `repository_denylist` all present and all owned by `agentdock_app`.
`agentdock_test` held 0 leftover rows after the suite, so the development schema
was never written by a test.

## Migration

`drizzle/0001_outstanding_the_santerians.sql`.

Reviewed by hand before applying. drizzle-kit emitted **no** `CREATE SCHEMA`
line this time (the schema is already in the 0000 snapshot), so nothing had to be
deleted — unlike Phase 0. Every `CREATE TABLE`, `ALTER TABLE` and `CREATE INDEX`
target is qualified to `agentdock`. The lowercased-full-name uniqueness came out
correctly as an expression index (`USING btree (lower("full_name"))`), not as a
column. One line was hand-added after generation:

```sql
INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES ('skill', 'Agent Skill') ON CONFLICT DO NOTHING;
```

## Fixture capture

`fixtures/anthropics-skills/` — `repo.json`, `tree.json` (**501 entries**), and
**18** `SKILL.md` bodies, all pinned to `f17010c9bb483898c1d9c9f42dde2b3a98889434`.
436 KB total, committed (not gitignored).

**Core API requests spent: 2** (repo metadata + recursive tree). The 18 body
fetches went to `raw.githubusercontent.com`, which costs no core quota, and the
permalink probe went to `github.com`, also not core. This matches RESEARCH.md's
cost model exactly.

The load-bearing assertion passed: the SHA the Trees API returned for the pinned
ref is the **commit** SHA, and `github.com/{owner}/{repo}/blob/{that}/{path}`
returned 200. The finding this phase was designed around still holds.

## The js-yaml pin, and why it is one major behind

`js-yaml` is pinned to **4.3.1**, not the current 5.x major. Verified from
`node_modules/js-yaml/package.json` (the resolved tree), not from the manifest
range — a manifest can say one thing while the installed tree holds another, and
the previous major of this parser is the one whose default load was the unsafe
path.

Reason to stay on 4.x: this parser eats attacker-controlled supply-chain input.
The 5.x line is roughly eight weeks old with patches still landing; the 4.x line
is five years mature, still maintained, and every safety property this phase
depends on was verified against 4.3.1 directly. **A future `bun update` must not
be allowed to jump this silently** — moving it is a decision, not an accident.

`postinstall` is `null` for all four new runtime packages (checked individually).
No raw-HTML rehype plugin, frontmatter wrapper, syntax highlighter, or HTTP
mocking library was installed — the research rejected each by name.

## Deviations from Plan

### 1. [Rule 3 — Blocking] `agentdock_test` could never receive the `artifact_type` seed

- **Found during:** Task 1, immediately after `bun run db:test:setup`.
- **Issue:** `package.type` has a foreign key to `artifact_type`. The dev schema
  gets its `skill` row from the hand-added `INSERT` in the reviewed migration.
  But `db:test:generate` regenerates the test schema's DDL **from scratch** into
  the gitignored `.drizzle-test/`, so a hand edit to `drizzle/` can never reach
  it. Confirmed empirically: `agentdock.artifact_type` had 1 row,
  `agentdock_test.artifact_type` had 0. Every Task 2 test — and every
  database-backed suite in plans 01-02 through 01-06 — would have failed on
  `package_type_artifact_type_id_fk` with a confusing FK error.
- **Fix:** Added an idempotent reference-data insert to `scripts/migrate.mjs`,
  applied after migrations for whichever schema is targeted, `ON CONFLICT DO
  NOTHING`. Fixed at the shared choke point both schemas route through rather
  than in each test file's `beforeAll`, so later plans inherit the fix instead of
  rediscovering the bug.
- **Files modified:** `scripts/migrate.mjs`
- **Verified:** both schemas now report `[{"id":"skill","label":"Agent Skill"}]`;
  re-running both migrate commands is still a clean no-op.

### 2. [Rule 1 — Bug] Reference H's comment stripper silently disabled the host rule

- **Found during:** Task 3, caught by the test written for the behaviour.
- **Issue:** `checkSourceBoundaries` stripped line comments with
  `/\/\/[^\n]*/g`. That matches the `//` inside `https://api.github.com/...` and
  deletes the rest of the line — so the `no-host-sprawl` rule could **never fire
  on an actual URL literal**, which is the only form it exists to catch. The
  ING-02 control as specified was vacuous. The test `reports a GitHub hostname
  named outside the client directory` failed with `expected '' to match
  /no-host-sprawl/`, which is exactly how it surfaced.
- **Fix:** Extracted a shared `stripJsComments()` helper using
  `/(^|[^:])\/\/[^\n]*/g`, which refuses to treat `//` as a comment start when
  preceded by `:`. Both `checkSchemaModule` and `checkSourceBoundaries` now use
  it, so the same latent bug is fixed for both callers rather than only the one
  the test happened to cover.
- **Files modified:** `scripts/check-boundaries.mjs`
- **Regression test added:** `still sees a host when the URL sits behind other
  code on the line`.

### 3. [Minor] `sourceFiles()` exported; `@types/js-yaml` pinned exactly

- `sourceFiles()` was exported so the "test files are not scanned" behaviour —
  listed in the plan but implemented in the walk, not the matcher — is actually
  checkable. Its failure would otherwise be silent (the rule would just quietly
  scan less). Two tests cover it.
- `@types/js-yaml` was installed as `^4.0.9` by `bun add -d` and changed to an
  exact `4.0.9`, matching the exact-pin convention every other entry in this
  manifest already follows.

### 4. Per-task commits skipped

The plan's execution protocol calls for an atomic commit per task. The phase's
hard constraints forbid the executor from committing. Constraints won; nothing
was committed.

## Requirements satisfied

| ID | Evidence |
|---|---|
| DAT-01 | `repository_node_id_key` unique on `github_node_id`; test `keeps repository identity across a rename` passes |
| DAT-02 | `unique('package_identity')` on `(repository_id, type, source_path)`; repeat scan returns identical `packageIds` |
| DAT-03 | `unique('package_version_content_key')`; identical re-ingest yields `newVersions: 0` via `onConflictDoNothing` |
| DAT-04 | `commit_sha`, `scanned_at`, `etag`, `content_hash`, `license_spdx` all present in migration 0001 and written by `persistScan` |
| DAT-05 | `meta jsonb` on `package` behind the `artifact_type` FK |
| DAT-06 | `repository_denylist` table exists in both schemas |
| PRV-01 | Rendered `blob/f17010c9…/…/SKILL.md` returned **200**, proven against live github.com, not assumed |
| ING-05 / ING-10 | `no-disk-write` and `no-execution` rules fail `bun run check:boundaries`; positive control confirmed exit 1 |
| DET-10 | Frozen 501-entry corpus committed; no test opens a socket |
| D-03 (CONTEXT.md Q3) | `artifact_type` holds exactly one row in both schemas |

The boundary rules were confirmed to actually bite, not merely to be unit-tested:
a temporary `src/__boundary_probe.ts` naming `api.github.com` and `writeFileSync`
made `bun run check:boundaries` exit 1 with both violations named. The probe was
then removed and the check returned to OK.

## Known Stubs

Intentional and scoped by the plan; each is owned by a named later plan.

| Stub | File | Reason |
|---|---|---|
| `frontmatter: {}` and `parseStatus: 'ok'` hardcoded | `scripts/seed-fixture.mjs` | Real parsing arrives in plan 01-03. Populating these now would be scaffolding to delete. |
| `name`/`slug` derived from the directory name | `scripts/seed-fixture.mjs` | Same — the parser owns this. |
| `/skills` is unstyled, no detail page, no pagination UI | `src/app/skills/page.tsx` | Presentation is plan 01-06's. This page exists to prove a stored row reaches a rendered permalink. |
| `countPackages()` exported but unused | `src/db/queries/packages.ts` | Consumed by the listing/pagination work in plan 01-06. |
| Seed loads only the first 3 of 18 skills | `scripts/seed-fixture.mjs` | Per Reference G; enough for a tracer, cheap to widen later. |

None of these block the plan's goal.

## Notes for later plans

- `src/github/` does not exist yet. It is the **only** directory where
  `api.github.com` or `raw.githubusercontent.com` may appear in `src/` — rule 5
  now enforces this, so plan 01-02 must create the client there.
- `.drizzle-test/` is regenerated and gitignored. Never hand-edit it; anything
  that must exist in the test schema belongs in `scripts/migrate.mjs`.
- `bun test` still hangs in this environment. `bun run test` is the entrypoint.
- The unauthenticated core budget was touched for only 2 requests this session.
