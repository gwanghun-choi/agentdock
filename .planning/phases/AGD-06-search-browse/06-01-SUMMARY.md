---
phase: AGD-06-search-browse
plan: 01
subsystem: search
tags: [postgresql, full-text-search, tsvector, drizzle-orm, nextjs, generated-column]

requires:
  - phase: AGD-04-capability-disclosure
    provides: capability disclosure vocabulary, source permalink contract, package.files inventory
  - phase: AGD-05-corpus-cold-start
    provides: COR-07 listing suppression, dedup semantics, parse-status semantics, the real corpus (1137 packages, 921 listed, 16 repos)
provides:
  - "A generic artifact detail route: sourcePathCandidates/detailHref resolve all six artifact types, not just skill"
  - "A generated, weighted search_vector column on agentdock.package, GIN-indexed, applied to both live and test schemas"
  - "searchPackages: ranked full-text search reusing the listing predicate by reference"
  - "/artifacts: a server-rendered browse-and-search route replacing the misnamed /skills as the phase's tracer"
affects: [AGD-06-02, AGD-06-03, AGD-06-04]

actuals:
  tokens: 16972
  tasks: 4
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Generated STORED tsvector column, PostgreSQL-maintained, no trigger, no application backfill"
    - "Reuse-not-restate: NOT_LISTED_BECAUSE exported and referenced by import, never copied, in both projection and predicate"
    - "Literal-match-first, /SKILL.md-fallback-second detail identity resolution with a stated ORDER BY precedence"

key-files:
  created:
    - src/db/queries/search.ts
    - src/db/queries/search.test.ts
    - src/app/artifacts/page.tsx
    - drizzle/0006_silly_black_tom.sql
  modified:
    - src/db/queries/packages.ts
    - src/db/queries/packages.test.ts
    - src/components/PackageRows.tsx
    - "src/app/r/[owner]/[repo]/[...path]/page.tsx"
    - src/db/schema.ts

key-decisions:
  - "sourcePathFromUrl (unconditional /SKILL.md append) replaced by sourcePathCandidates, trying the literal source_path first and the SKILL.md reconstruction second — fixes 531 of 921 listed artifacts that 404'd"
  - "detailHref percent-encodes each path segment individually so a '#' or '?' in a path no longer truncates the URL, while every existing skill link stays byte-identical"
  - "search_vector is a STORED generated column (A=name, B=summary, C=path with separators replaced by spaces, D=type with '_' replaced by a space) — PostgreSQL maintains it, no trigger, no backfill"
  - "searchPackages recomputes its ts_rank sql fragment in ORDER BY rather than referencing a SELECT alias — Drizzle does not emit a SQL-level AS alias for a computed sql<T> projection field in this pinned version, confirmed by a 42703 error on first attempt"
  - "Install section gated to type === 'skill'; Files section (and its 'No files recorded yet.' placeholder) gated to files.length > 0, rendering nothing rather than an empty placeholder"

patterns-established:
  - "Type-aware detailHref: threading PackageListItem.type through to a query-layer function rather than reconstructing type from the URL"

requirements-completed: [DIS-03, DIS-10]

coverage:
  - id: D1
    description: "All six artifact types (skill, plugin, catalog, mcp_server, command, hook) resolve at their own /r/{owner}/{repo}/{path} detail URL"
    requirement: DIS-03
    verification:
      - kind: integration
        ref: "src/db/queries/packages.test.ts#generic detail route (D-20/D-21)"
        status: pass
      - kind: manual_procedural
        ref: "curl against bun run dev for one real URL per type — see Live Verification below"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every existing skill detail URL is byte-identical before and after this change"
    verification:
      - kind: integration
        ref: "src/db/queries/packages.test.ts#opens a skill at skills/canvas-design/SKILL.md with a byte-identical href to before this change"
        status: pass
    human_judgment: false
  - id: D3
    description: "A repository holding both a literal path and a skill beneath it resolves to the literal one, deterministically, by a stated ORDER BY"
    verification:
      - kind: integration
        ref: "src/db/queries/packages.test.ts#resolves the literal path deterministically when a repository holds both a command at docs/guide and a skill at docs/guide/SKILL.md"
        status: pass
    human_judgment: false
  - id: D4
    description: "agentdock.package.search_vector is a populated STORED generated column on both live and test schemas, GIN-indexed"
    requirement: DIS-03
    verification:
      - kind: manual_procedural
        ref: "live psql: select count(*) where search_vector is not null = 1137/1137; pg_indexes shows package_search_vector_idx on both schemas"
        status: pass
    human_judgment: false
  - id: D5
    description: "searchPackages reuses NOT_LISTED_BECAUSE by reference (not restated) and never reaches to_tsquery directly"
    requirement: DIS-10
    verification:
      - kind: integration
        ref: "src/db/queries/search.test.ts#COR-07 in search"
        status: pass
      - kind: other
        ref: "grep -oE '[a-zA-Z_]*to_tsquery' src/db/queries/search.ts -> websearch_to_tsquery only"
        status: pass
    human_judgment: false
  - id: D6
    description: "/artifacts?q=mcp returns server-rendered result rows in the HTML before client JS runs, and a non-skill result opens"
    requirement: DIS-03
    verification:
      - kind: manual_procedural
        ref: "curl http://localhost:3000/artifacts?q=mcp -> 200, 25 <li> rows in raw HTML; curl on a non-skill href -> 200"
        status: pass
    human_judgment: false
  - id: D7
    description: "No browser console error across browse -> search -> open detail -> back (backstop truth, this plan's must_haves)"
    verification: []
    human_judgment: true
    rationale: "Flagged 'backstop' verification in the plan's must_haves — requires a real browser pass (gstack browse), which is out of this plan's automated scope; curl-level checks above confirm the HTML and status codes but not a rendered browser session with no console errors."

duration: ~70min
completed: 2026-08-12
status: complete
---

# Phase 6 Plan 1: Search & Browse Tracer Summary

**A generic artifact-primary detail route replacing the SKILL.md-only lookup, a PostgreSQL-native weighted full-text search vector, and a server-rendered `/artifacts` route proving one search query finds one artifact and the artifact opens.**

## Performance

- **Duration:** ~70 min
- **Completed:** 2026-08-12T04:00:56Z
- **Tasks:** 4
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- Fixed the carried Phase 4/5 defect: `sourcePathFromUrl` unconditionally appended `/SKILL.md`, so 531 of 921 listed artifacts (387 commands, 113 plugins, 16 hooks, 15 MCP declarations) had rows and findings but 404'd at their detail URL. Replaced with `sourcePathCandidates` (literal-first, `/SKILL.md`-fallback-second) and a type-aware `detailHref`.
- Added `agentdock.package.search_vector`, a STORED generated `tsvector` column (weighted A=name/B=summary/C=path/D=type), GIN-indexed, applied to both `agentdock` and `agentdock_test` through the project's own migrator — no application backfill.
- Added `searchPackages`, sharing the exported `NOT_LISTED_BECAUSE` fragment with `listPackages` by reference in both `SELECT` and `WHERE`.
- Added `/artifacts`, a server-rendered route that browses (no query) or searches (`?q=`) over the same `PackageRows` component, proving the phase's tracer end to end: query → server-rendered row → opened artifact.

## Task Commits

1. **Task 1: The failing tests** - `e0aa617` (test) — RED baseline: `search.test.ts` fails on `Cannot find module './search'`; `packages.test.ts` fails 9 of 28 cases because the pre-change `sourcePathFromUrl`/`detailHref` 404 every non-skill type.
2. **Task 2: Promote the artifact, demote the skill** - `f6df940` (feat) — `sourcePathCandidates`/type-aware `detailHref`, `getPackageDetail`'s `inArray` + stated `ORDER BY` precedence, `TYPE_LABELS` gains five labels, Install/Files sections gated.
3. **Task 3: [BLOCKING] The search vector column** - `953dd5e` (feat) — generated STORED `search_vector` column + GIN index, applied to both schemas.
4. **Task 4: End-to-end tracer** - `219a828` (feat) — `search.ts`, `/artifacts/page.tsx`, wired end to end and verified live.

_No separate plan-metadata commit: `commit_docs: false` in `.planning/config.json` — see Final Commit below._

## Files Created/Modified

- `src/db/queries/search.ts` - `searchPackages`: ranked FTS query, reuses `NOT_LISTED_BECAUSE`, D-15 tie-break
- `src/db/queries/search.test.ts` - first direct test of `searchPackages`; COR-07, DAT-07, partial-not-penalized cases
- `src/app/artifacts/page.tsx` - server-rendered browse+search route (tracer scope only)
- `src/db/queries/packages.ts` - `sourcePathCandidates`/type-aware `detailHref`, `getPackageDetail`'s `inArray`/`ORDER BY`, `NOT_LISTED_BECAUSE` exported
- `src/db/queries/packages.test.ts` - six-type round-trip, skill regression, literal-vs-SKILL.md collision cases
- `src/components/PackageRows.tsx` - threads `p.type` through `detailHref`
- `src/app/r/[owner]/[repo]/[...path]/page.tsx` - six `TYPE_LABELS`, Install gated to skill, Files gated to non-empty
- `src/db/schema.ts` - `search_vector` generated column + GIN index, `tsvector` customType
- `drizzle/0006_silly_black_tom.sql` - the generated column + index migration

## RED Baseline (Task 1, verbatim excerpt)

```
FAIL  src/db/queries/search.test.ts > the search query
Error: Cannot find module '/src/db/queries/search' imported from
  /home/ghchoi/workspace_gh/agentdock/src/db/queries/search.test.ts

FAIL  src/db/queries/packages.test.ts > ... > opens a command at .claude/commands/build.md
AssertionError: expected undefined to be '.claude/commands/build.md'
  (5 more non-skill-type cases failed the same way)

FAIL  src/db/queries/packages.test.ts > ... > sourcePathCandidates: ...
TypeError: packages.sourcePathCandidates is not a function

Test Files  2 failed (2)
     Tests  9 failed | 19 passed | 7 skipped (35)
```

## Live Verification

**Six detail URLs, one per artifact type, against the real corpus (`bun run dev`, curl):**

| Type | URL | Status |
|---|---|---|
| skill | `/r/anthropics/skills/skills/canvas-design` | 200 |
| plugin | `/r/wshobson/agents/plugins/accessibility-compliance/.claude-plugin/plugin.json` | 200 |
| catalog | `/r/davila7/claude-code-templates/cli-tool/components/.claude-plugin/marketplace.json` | 200 |
| mcp_server | `/r/davila7/claude-code-templates/.mcp.json` | 200 |
| command | `/r/davila7/claude-code-templates/.claude/commands/cleanup-cache.md` | 200 |
| hook | `/r/davila7/claude-code-templates/cli-tool/templates/javascript-typescript/.claude/settings.json` | 200 |

**Migration DDL (Task 3):** `drizzle-kit generate` emitted correct DDL on the first attempt — spike-tested in a rolled-back transaction before applying; **no hand-correction was needed**. Emitted (verbatim, `drizzle/0006_silly_black_tom.sql`):

```sql
ALTER TABLE "agentdock"."package" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english',
            replace(replace(coalesce(source_path, ''), '/', ' '), '.', ' ')), 'C') ||
          setweight(to_tsvector('english', replace(coalesce(type, ''), '_', ' ')), 'D')) STORED;--> statement-breakpoint
CREATE INDEX "package_search_vector_idx" ON "agentdock"."package" USING gin ("search_vector");
```

**Populated row count:** `select count(*) from agentdock.package where search_vector is not null` → **1137** (of 1137 total, no application backfill ran).

**Lexeme split, live corpus values:**
- `source_path = 'plugins/claude/context7/.mcp.json'` → `'claud':2 'context7':3 'json':5 'mcp':4 'plugin':1` (separators split correctly)
- `'mcp_server'` (the D-weight expression) → `'mcp':1 'server':2` (underscore-replace confirmed)

**`EXPLAIN (ANALYZE, BUFFERS)` — FTS predicate alone** (`search_vector @@ websearch_to_tsquery('english','mcp')`, 1137-row corpus):
```
Bitmap Heap Scan on package (actual time=0.072..0.105 rows=52 loops=1)
  ->  Bitmap Index Scan on package_search_vector_idx (actual time=0.064..0.064 rows=52 loops=1)
Execution Time: 0.166 ms
```
GIN index chosen (`package_search_vector_idx`).

**`EXPLAIN (ANALYZE, BUFFERS)` — shipped `searchPackages` SQL, from Drizzle's own `.toSQL()` output** (`q='mcp'`, `limit=25`, same 1137-row corpus):
```
Limit (actual time=7.785..8.780 rows=25 loops=1)
  ->  Sort ... Sort Method: quicksort  Memory: 63kB
        ->  Hash Join ... rows=47 loops=1
              ->  Bitmap Heap Scan on package
                    ->  Bitmap Index Scan on package_search_vector_idx (rows=52 loops=1)
Planning Time: 4.868 ms
Execution Time: 9.384 ms
```
One statement (one client-server round trip) — no per-row query for `commitSha`, `fullName` or `scannedAt`; the GIN index is used.

**`GET /artifacts?q=mcp`:** HTTP 200, **25** `<li>` result rows present in the raw HTML body (curl, no client JS executed). Non-skill href taken verbatim from that HTML — `/r/davila7/claude-code-templates/.mcp.json` (type `mcp_server`) — returns **200**.

**Browse mode (`GET /artifacts`, no `q`):** HTTP 200, 25 rows (sanity check beyond the plan's required scope).

**`bun run ci`:** green — 53 files, 900 tests, `check:boundaries` OK, `lint` OK, `typecheck` OK.

## Decisions Made

- `sourcePathFromUrl` renamed (not duplicated) to `sourcePathCandidates`, catching the one call site (`getPackageDetail`) at the type level, so no future caller can find and reuse the broken suffix-append path.
- `getPackageDetail`'s literal-vs-`SKILL.md` precedence is stated in an `ORDER BY case when ... then 0 else 1 end`, not left to row order, per the plan's decision 2.
- Drizzle does not emit a SQL-level `AS` alias for a computed `sql<T>` projection field in this pinned version (`drizzle-orm@0.45.2`) — confirmed by a live `42703: column "rank" does not exist` when `ORDER BY rank desc` referenced the SELECT alias by name. Fixed by binding the `ts_rank(...)` fragment to a local `const rank` and reusing that same object in both `SELECT` and `ORDER BY` (`desc(rank)`), rather than a second hand-written copy of the expression.
- Files section: removed the "No files recorded yet." placeholder entirely rather than keeping it as an else-branch, per decision 6 in the plan (D-24: no empty section to fill space). No test asserted on that exact string (checked before removing).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ORDER BY rank desc` referencing a non-existent SQL alias**
- **Found during:** Task 4 (running the search test suite)
- **Issue:** `searchPackages` selected `rank: sql<number>\`ts_rank(...)\`` and then wrote `.orderBy(sql\`rank desc\`, ...)`, assuming Drizzle emits `AS "rank"` for a named computed projection field. It does not (confirmed live: `PostgresError: column "rank" does not exist`, code 42703).
- **Fix:** Bound the `ts_rank(...)` fragment to `const rank = sql<number>\`...\`` and referenced that same object in both the `SELECT` projection and `.orderBy(desc(rank), ...)` — one definition, two uses, matching the project's own reuse-not-restate discipline rather than adding a second hand-written copy of the expression.
- **Files modified:** `src/db/queries/search.ts`
- **Verification:** `bun run test -- src/db/queries/search.test.ts` — all 7 cases pass, including the partial-not-penalized rank-equality assertion.
- **Committed in:** `219a828` (Task 4 commit)

**2. [Rule 1 - Bug] Two Biome formatting fixes picked up by this task's own lint gate**
- **Found during:** Task 2 and Task 4 lint runs
- **Issue:** `bun run format --write` reformatted two lines in `search.test.ts` (quote style) and one block in `search.ts` (a multi-line `db.select()...` chain wrapped in parens) to satisfy `bun run lint`.
- **Fix:** Ran `bun run format`, verified `bun run lint` and the affected test suite both still pass.
- **Files modified:** `src/db/queries/search.test.ts`, `src/db/queries/search.ts`
- **Committed in:** `f6df940` (search.test.ts fix) and `219a828` (search.ts, part of its own commit)

**3. [environment noise, not committed] `next dev` scaffolds `AGENTS.md`, `CLAUDE.md`, and rewrites `next-env.d.ts`**
- **Found during:** live verification (`bun run dev`)
- **Issue:** Next.js 16.3.0's dev server writes `AGENTS.md`/`CLAUDE.md` agent-rule files and repoints `next-env.d.ts` at `.next/dev/types/*` instead of `.next/types/*`.
- **Fix:** `git checkout -- next-env.d.ts` before each commit; left the two untracked scaffold files alone (out of scope, not part of this plan's `files_modified`).
- **Files modified:** none (discarded)

---

**Total deviations:** 3 (1 bug fix essential for correctness, 1 lint-driven formatting cleanup, 1 environment-noise discard)
**Impact on plan:** No scope creep. The `rank` alias fix was necessary for `searchPackages` to run at all; the rest is incidental cleanup.

## Issues Encountered

None beyond the deviations above — `bun run ci` is green (53 files, 900 tests) at the end of the plan.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources were introduced. The tracer's `/artifacts` route intentionally omits filters, a pager, zero-result copy, and query logging (explicitly out of this plan's scope per its Reference D; 06-02/06-03 add them), but it is not a stub — it is a complete, working end-to-end slice for the tracer's stated scope.

## User Setup Required

None - no external service configuration required. (`pg_trgm` remains a maintainer out-of-band install, owned by 06-04, not this plan.)

## Next Phase Readiness

- `sourcePathCandidates`/`detailHref` and `search_vector` are the load-bearing primitives 06-02 (ranking, filters, pagination) and 06-03 (DIS-05/06/07/08) build on directly.
- `src/app/skills/page.tsx` is untouched, as the plan required — 06-02 owns its rename and the `/skills` → `/artifacts` redirect.
- `searchPackages` currently has no query-length cap, no `type`/capability filter, and no browse/empty-query branch inside itself (the caller branches) — all deliberately deferred to 06-02/06-03 per the plan's Reference C.
- The plan's one `backstop`-verification truth (no browser console error across browse → search → open detail → back) has not been exercised in a real browser session in this plan; curl-level HTML/status checks pass. Recommend a gstack `browse` pass as part of 06-03's D-51 verification, which already covers this ground.

## Self-Check: PASSED

All files created by this plan exist on disk (`src/db/queries/search.ts`,
`src/db/queries/search.test.ts`, `src/app/artifacts/page.tsx`,
`drizzle/0006_silly_black_tom.sql`). All four task commits
(`e0aa617`, `f6df940`, `953dd5e`, `219a828`) are present in git history.

---
*Phase: AGD-06-search-browse*
*Completed: 2026-08-12*
