---
phase: AGD-06-search-browse
plan: 02
subsystem: search
tags: [postgresql, full-text-search, tsvector, drizzle-orm, nextjs, ranking, pagination]

requires:
  - phase: AGD-06-01
    provides: search_vector generated STORED column (GIN-indexed), searchPackages tracer, sourcePathCandidates/detailHref, the /artifacts route as a bare tracer
provides:
  - "normalizeQuery + SEARCH_CAPS: bounded, case-preserving query normalization (trim/collapse/truncate at 200 UTF-16 units)"
  - "A D-12-explainable four-term ranking expression (exact name / name prefix / ts_rank description / repository name), each term a named SEARCH_CAPS constant"
  - "A browse branch inside searchPackages itself: empty query skips the full-text predicate entirely rather than matching zero rows via an unconditionally-applied @@"
  - "countSearchResults, sharing one searchWhere() predicate builder with searchPackages — never a second hand-copied WHERE"
  - "A server-rendered /artifacts route: GET search form (no client component), offset pagination via one hrefFor(q,page) URL builder, three structurally distinct empty states"
  - "/skills -> /artifacts, a permanent redirect via next.config.ts's redirects(), with the query string preserved and no inbound link left behind"
affects: [AGD-06-03, AGD-06-04]

actuals:
  tokens: 9720
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Fragment reuse for a shared predicate: searchWhere(q) built once, called from both searchPackages and countSearchResults — the same discipline packages.ts's NOT_LISTED_BECAUSE already established"
    - "Rank-as-constant-zero browse branch: on an empty query, rank is a literal SQL 0, so ORDER BY reduces to the tie-break columns with no separate ordering code path"
    - "One hrefFor(q, page) URL builder shared by every link on a paginated route, so a parameter cannot be dropped from one of several hand-built template strings while the others keep it"

key-files:
  created: []
  modified:
    - src/db/queries/search.ts
    - src/db/queries/search.test.ts
    - src/app/artifacts/page.tsx
    - src/app/skills/page.tsx (deleted)
    - src/app/layout.tsx
    - src/app/page.tsx
    - next.config.ts
    - src/app/globals.css

key-decisions:
  - "The rank expression is four summed CASE/ts_rank terms, one per D-12 signal, with SEARCH_CAPS.exactNameBonus (2.0) and prefixNameBonus (1.0) placed strictly above ts_rank's measured practical ceiling (~0.6) so an exact or prefix name match can never be outranked by any amount of description relevance"
  - "The repository-name signal is a separate escaped ILIKE OR-condition, not folded into the generated search_vector column, because Postgres refuses a subquery in a column generation expression (confirmed live in 06-01's RESEARCH) — 16 repositories, no index needed"
  - "searchWhere(q) branches on the empty string before building any predicate: an empty websearch_to_tsquery matches nothing via @@, not everything, so building the predicate unconditionally would silently render an empty corpus to every browse visitor"
  - "PackageListItem.stars is still selected in searchPackages' projection (matching listPackages' and getPackageDetail's identical field, part of the pre-existing shared type) but never referenced inside rankExpr or searchWhere — the one grep hit for '.stars' in search.ts is that projection line, not a ranking use; see Deviations"
  - "page=99999 exceeds SEARCH_CAPS.maxPage (10,000, held unchanged per Reference A) and is caught by the existing bounded-zod pageParam before it can reach the past-the-end branch, clamping to page 1 rather than crashing — the past-the-end branch itself is verified separately at page=50, which is under the cap and past the real last page (37 for the full corpus)"

patterns-established:
  - "GET-form-first convention for interactive controls: a plain <form method='get'> with native inputs, no 'use client', documented at the form's own call site so the next control (06-03's filters) does not reach for a client component by default"

requirements-completed: [DIS-03, DIS-10]

coverage:
  - id: D1
    description: "normalizeQuery bounds, trims, collapses and case-preserves the query; SEARCH_CAPS documents every cap's reason"
    requirement: DIS-10
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#normalizeQuery"
        status: pass
    human_judgment: false
  - id: D2
    description: "All 18 of Reference E's adversarial/edge query inputs (empty, whitespace, absent, repeated array, SQL injection, tsquery operators, unbalanced quote/paren, 5000-char string, emoji, Korean, '100%', 'a_b', case) reach searchPackages without throwing"
    requirement: DIS-10
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#Reference E — the adversarial and edge query set (18 inputs)"
        status: pass
      - kind: manual_procedural
        ref: "curl against bun run dev for the SQL-injection, emoji, Korean, unclosed-paren and repeated-q cases — all 200, no PostgresError/stack-trace substring in the body"
        status: pass
    human_judgment: false
  - id: D3
    description: "'%' and '_' are escaped before every LIKE/ILIKE operand, so '100%' and 'a_b' do not behave as wildcards"
    requirement: DIS-10
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#escapes '%' before the repository-name ILIKE operand / escapes '_' before the repository-name ILIKE operand"
        status: pass
      - kind: manual_procedural
        ref: "live psql via searchPackages({q:'100%'}) against the real corpus: 4 of 921 listed rows, not the whole corpus"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exact name match ranks above name-prefix match ranks above description-only match ranks above repository-name-only match — D-12's stated order, asserted as three separate comparisons"
    requirement: DIS-03
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#ranks an exact name match above.../ranks a name-prefix match above.../ranks a summary-only match above..."
        status: pass
    human_judgment: false
  - id: D5
    description: "Deterministic total order (rank DESC, updated_at DESC, id ASC): repeating a query returns an identical id sequence, and adjacent pages neither repeat nor skip a row"
    requirement: DIS-03
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#breaks a relevance tie by updated_at DESC / breaks a further tie (same updated_at) by id ASC / returns an identical id sequence / page 1 and page 2 together cover..."
        status: pass
    human_judgment: false
  - id: D6
    description: "An empty normalized query browses the whole listed corpus (matching listPackages' own order and countPackages' own count) without the full-text predicate ever being applied"
    requirement: DIS-03
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#an empty normalized query returns the same ordering and count as listPackages/countPackages (browse mode)"
        status: pass
    human_judgment: false
  - id: D7
    description: "No popularity (stars), capability-finding or parse-status term reaches the ranking; parse_status='partial' carries no penalty"
    requirement: DIS-03
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#does not rank parse_status = 'partial' below.../no popularity, capability or parse-status term reaches the ranking"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*[/*]' src/db/queries/search.ts | grep -c 'parse_status\\|parseStatus' -> 0"
        status: pass
    human_judgment: false
  - id: D8
    description: "countSearchResults and searchPackages build their WHERE from one shared searchWhere() helper, never a second hand-copied predicate"
    requirement: DIS-10
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#countSearchResults and searchPackages agree on a non-empty query / an empty normalized query matches countSearchResults against the same options"
        status: pass
    human_judgment: false
  - id: D9
    description: "Query performance measured live against the real corpus (1,137 packages / 921 listed): page 1 and a late page of a common query, plus a late browse page, all well under 200ms; one rendered page issues exactly 2 statements (searchPackages + countSearchResults), each a single round trip"
    requirement: DIS-03
    verification:
      - kind: manual_procedural
        ref: "live EXPLAIN (ANALYZE, BUFFERS) via a throwaway bun script against agentdock, 2026-08-12 — see Performance Measurements below"
        status: pass
    human_judgment: false
  - id: D10
    description: "GET /skills returns a 308 redirect to /artifacts with the query string preserved, and no route in the application links to /skills any more"
    requirement: DIS-03
    verification:
      - kind: manual_procedural
        ref: "curl -sI http://localhost:3000/skills and /skills?page=2 -> 308, location: /artifacts(?page=2)"
        status: pass
      - kind: other
        ref: "grep -rhv '^\\s*[/*]' --include='*.tsx' --include='*.ts' src/app src/components | grep -cE 'href=.\\{?.?/skills' -> 0"
        status: pass
    human_judgment: false
  - id: D11
    description: "The search input and submit button are reachable and submittable with no client JavaScript, each carrying a programmatically associated label"
    requirement: DIS-03
    verification:
      - kind: manual_procedural
        ref: "curl http://localhost:3000/artifacts -> <label for=\"q\">Search artifacts</label> + <input id=\"q\" name=\"q\">; grep confirms no 'use client' directive and no onChange/useState in artifacts/page.tsx"
        status: pass
    human_judgment: false
  - id: D12
    description: "Narrow-viewport (375x800) render of /artifacts and a paginated search result: no clipping, no horizontal scroll, no browser console errors"
    verification:
      - kind: automated_ui
        ref: "gstack browse: viewport 375x800, goto /artifacts and /artifacts?q=mcp&page=2, console --errors (none both times), js scrollWidth>clientWidth (false), screenshots captured"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-12
status: complete
---

# Phase 6 Plan 2: Ranking, Browse, Pagination and the /artifacts Rename Summary

**A four-term, D-12-explainable ranking expression, a browse branch that never touches `websearch_to_tsquery('')`, offset pagination with a total order, and the `/skills` → `/artifacts` rename with a working permanent redirect.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-12T04:29:30Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Turned 06-01's tracer ranking (`ts_rank` alone) into D-12's stated four-signal order: exact name match (2.0) → name prefix (1.0) → `ts_rank` description relevance → repository name match (0.1, escaped `ILIKE`), each a named `SEARCH_CAPS` constant referenced once, never inlined.
- Found and closed the empty-query trap live: `websearch_to_tsquery('english', '')` matches nothing via `@@`, so `searchPackages` now branches on the normalized query being `''` *before* building any predicate — the browse branch shares `listPackages`' own `updated_at DESC, id ASC` order rather than reinventing it.
- Added `countSearchResults`, built from the same `searchWhere()` helper `searchPackages` uses — one predicate, never a second hand-copied `WHERE`.
- Escaped `%`/`_` before every `LIKE`/`ILIKE` operand; verified live against the real corpus that `'100%'` returns 4 of 921 listed rows, not the whole corpus.
- Extended `/artifacts` with a no-JS `<form method="get">` search box, offset pagination through one `hrefFor(q, page)` URL builder, and three structurally distinct empty states (corpus empty / past the end / zero search results, the last a placeholder with a `TODO(06-03)`).
- Renamed `/skills` to `/artifacts` via `next.config.ts`'s `redirects()` — verified live to return a 308 and preserve the query string (`/skills?page=2` → `/artifacts?page=2`); no fallback page was needed. `src/app/skills/page.tsx` is deleted; nav and the home page's "Browse all" link now point at `/artifacts`.

## Task Commits

1. **Task 1: Bounded, case-folded, and safe on input nobody sanitized** - `b9298fd` (feat)
2. **Task 2: An order a reader can explain, a browse path that does not go through the query, and a page 40 that is as fast as page 1** - `6e3ae20` (feat)
3. **Task 3: A search box that needs no JavaScript, and a route whose name is finally true** - `8f59427` (feat)

_No separate plan-metadata commit: `commit_docs: false` in `.planning/config.json` — see Final Commit below._

## Files Created/Modified

- `src/db/queries/search.ts` - `SEARCH_CAPS`, `normalizeQuery`, `escapeLikeOperand`, `searchWhere`, `rankExpr`, `searchPackages` (browse branch + full ranking), `countSearchResults`
- `src/db/queries/search.test.ts` - normalizeQuery unit tests, the 18-row Reference E table, the D-12 ordering/pagination/browse-mode suite
- `src/app/artifacts/page.tsx` - GET search form, `hrefFor`, three empty states, pagination
- `src/app/skills/page.tsx` - deleted
- `src/app/layout.tsx` - nav link `/skills` → `/artifacts`, text "Skills" → "Artifacts"
- `src/app/page.tsx` - "Browse all N artifacts" link now targets `/artifacts`
- `next.config.ts` - `redirects()`: `/skills` → `/artifacts`, permanent
- `src/app/globals.css` - one `.search` rule for the form row

## Result Counts and Ordering Evidence (recorded per plan's `<output>` instruction)

- **`SEARCH_CAPS`:** `maxQueryLength: 200` (UTF-16 code units — RESEARCH measured a 5,000-char query as harmless, this is a cost control), `pageSize: 25` (moved from `skills/page.tsx`'s `PAGE_SIZE`), `maxPage: 10_000` (unchanged from `skills/page.tsx`'s `pageParam`), `repoNameBonus: 0.1`, `exactNameBonus: 2.0`, `prefixNameBonus: 1.0` (the two above `ts_rank`'s measured practical ceiling of ~0.6 for a single-term hit).
- **`'100%'` live result count:** 4 (of 921 listed rows in the real `agentdock` schema) — the escape holds against real data, not just synthetic fixtures.
- **Three ranking-order comparisons**, each its own fixture-named test in `search.test.ts`:
  - `ranks an exact name match above a match that only appears in the summary` — exact name `zephyrantha` vs. a summary repeating the word five times.
  - `ranks a name-prefix match above a match that only appears in the summary` — name-prefix `quixotropic widget` vs. a five-times-repeated summary match.
  - `ranks a summary-only match above a match that only appears in the repository name` — summary word `flumadiddle` vs. a repository literally named `...flumadiddle-repo-only`.

## Performance Measurements (live, `agentdock` schema, 1,137 packages / 921 listed, 2026-08-12)

Measured with a throwaway `bun` script calling `searchPackages`/`countSearchResults` directly and running `EXPLAIN (ANALYZE, BUFFERS)` on the identical SQL shape (not committed — deleted after use).

**`searchPackages({ q: 'mcp' })` — page 1 (offset 0), 47 total matches:**
```
Limit  (actual time=1.462..2.031 rows=25 loops=1)
  ->  Sort ... Sort Method: top-N heapsort  Memory: 48kB
        ->  Hash Join ... Join Filter: (search_vector @@ 'mcp' OR full_name ~~* '%mcp%')
              ->  Seq Scan on package  (rows=1137, Filter: delisted_at IS NULL)
Execution Time: 2.152 ms
```

**Same query, late page (offset 22, last full page of 47 rows):**
```
Execution Time: 1.773 ms
```

**Browse mode (`q: ''`), late page (offset 896 of 921):**
```
Sort Key: updated_at DESC, id
Execution Time: 6.518 ms
```

All three are comfortably under the 200ms gate — no index was added on top of the existing `package_search_vector_idx` GIN index; the planner chooses a full sequential scan over `package` (1,137 rows, cheap at this corpus size) plus a `Hash Join`/`Join Filter` for the OR-disjunction against `repository.full_name`, rather than the GIN bitmap scan, because the disjunction spans two joined tables. This is a measured, accepted trade-off (D-46: no index on intuition) — revisit only if a future corpus size measurably crosses the gate.

**Statement count for one rendered page:** 2 — one `searchPackages` call, one `countSearchResults` call. Each is a single round trip: the correlated `commitSha` and `notListedBecause` subqueries execute inside the same top-level statement (visible as `SubPlan 1`/`SubPlan 2` in the `EXPLAIN` output above), not as separate queries.

## `redirects()` outcome

The config form worked on the first attempt — no fallback page was needed. Verified live:
```
$ curl -sI http://localhost:3000/skills
HTTP/1.1 308 Permanent Redirect
location: /artifacts

$ curl -sI "http://localhost:3000/skills?page=2"
HTTP/1.1 308 Permanent Redirect
location: /artifacts?page=2
```

## Narrow-viewport browse result (D-51, via gstack `browse`)

- Viewport 375×800, `GET /artifacts`: 200, search form and rows render without clipping, `document.body.scrollWidth > document.documentElement.clientWidth` is `false` (no horizontal scroll), zero console errors.
- Same viewport, `GET /artifacts?q=mcp&page=2`: 200, "Showing 26–47 of 47 for "mcp"." renders, `← Previous` link present, "Page 2 of 2", zero console errors.
- Screenshots captured at `/tmp/.../scratchpad/narrow-artifacts.png` and `narrow-artifacts-page2.png` (session-scoped, not committed).

## Decisions Made

- The rank expression is four summed terms, each on its own line, with the two name-match constants placed strictly above `ts_rank`'s measured ceiling so D-12's first two signals can never be outranked by description relevance — see `key-decisions` in frontmatter.
- The repository-name match stays a separate escaped `ILIKE` OR-condition rather than folding into the generated column (Postgres cannot reference another table in a generated-column expression, confirmed live in 06-01).
- `searchWhere(q)` branches on the empty string before building any predicate, closing the empty-query trap at its root rather than papering over it at the call site.
- `page=99999` exceeds `SEARCH_CAPS.maxPage` (10,000, held unchanged) and is caught by the bounded-zod `pageParam` before it can reach the past-the-end branch — clamped safely to page 1, never a crash. The past-the-end branch itself is verified separately at `page=50` (under the cap, past the real last page of 37), both with and without a query present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `postgres.js` rejects a raw JS `Date` bound inside an `IN (...)` tuple**
- **Found during:** Task 2 (the id-tie-break test)
- **Issue:** `UPDATE package SET updated_at = ${new Date()} WHERE id IN (${idA}, ${idB})` threw `TypeError: The "string" argument must be of type string...Received an instance of Date` from `postgres.js`'s binder.
- **Fix:** Used SQL's own `now()` instead of a bound JS `Date` value, so both rows get an identical server-evaluated timestamp in one statement with no awkward binding.
- **Files modified:** `src/db/queries/search.test.ts`
- **Verification:** `bun run test -- src/db/queries/search.test.ts` — the id-tie-break test passes.
- **Committed in:** `6e3ae20` (Task 2 commit)

**2. [Rule 1 - Bug] "browse mode matches the live corpus" test assumed a pre-populated `agentdock_test` schema**
- **Found during:** Task 2 (the browse-mode-equals-listPackages test)
- **Issue:** The test asserted `total > 0` against `countPackages()` with no fixtures inserted; `agentdock_test` starts empty (the real 921-row corpus lives only in the live `agentdock` schema, confirmed by `packages.test.ts`'s own precedent of inserting its own rows before asserting against `countPackages()`), so the assertion failed with `total === 0`.
- **Fix:** Insert three PREFIX-scoped fixtures before the assertion, matching `packages.test.ts`'s established convention for whole-table count assertions.
- **Files modified:** `src/db/queries/search.test.ts`
- **Verification:** `bun run test -- src/db/queries/search.test.ts` passes; separately verified the real numbers live against `agentdock` (921 listed rows) via the throwaway perf script.
- **Committed in:** `6e3ae20` (Task 2 commit)

**3. [Rule 1 - Bug] Two Biome formatting fixes picked up by the lint gate**
- **Found during:** Task 1 and Task 3 lint runs
- **Issue:** `bun run format --write` reformatted a multi-line `db.select()...` chain (parenthesization) and one quote-style change in a test string.
- **Fix:** Ran `bun run format`, verified `bun run lint`/`bun run test` still pass.
- **Files modified:** `src/db/queries/search.ts`, `src/db/queries/search.test.ts`
- **Committed in:** `b9298fd` and `6e3ae20`

**4. [environment noise, not committed] `next dev` rewrites `next-env.d.ts`**
- **Found during:** Task 3 live verification (`bun run dev`)
- **Issue:** Same as 06-01's documented deviation: Next.js 16.3.0's dev server repoints `next-env.d.ts` at `.next/dev/types/*`.
- **Fix:** `git checkout -- next-env.d.ts` before committing Task 3. `AGENTS.md`/`CLAUDE.md` scaffold files remain untracked, out of this plan's scope.
- **Files modified:** none (discarded)

---

**Total deviations:** 4 (2 bug fixes essential for correctness, 1 lint-driven formatting cleanup, 1 environment-noise discard)
**Impact on plan:** No scope creep. Both correctness fixes were necessary for the test suite to run and to assert the right thing; the rest is incidental cleanup.

## Issues Encountered

- The literal acceptance criterion `grep -c 'repository.stars\|repositoryStars\|\.stars' src/db/queries/search.ts` is 0 does **not** hold: it is 1, matching the `stars: repository.stars,` line in `searchPackages`' `SELECT` projection. This is a pre-existing, required field on the shared `PackageListItem` type (identical to `listPackages`' and `getPackageDetail`'s own projections since prior phases) — it is never referenced inside `rankExpr` or `searchWhere`, and the actual D-13 requirement ("stars never a ranking input") is independently verified by the `no popularity, capability or parse-status term reaches the ranking` test, which forces two rows with wildly different star counts to identical rank. The literal grep is a false positive against a legitimate, unrelated projection field; documented rather than silently ignored.

## User Setup Required

None - no external service configuration required. (`pg_trgm` remains a maintainer out-of-band install, owned by 06-04, not this plan.)

## Next Phase Readiness

- `SEARCH_CAPS`, `normalizeQuery`, `searchWhere`, `rankExpr`, and `hrefFor` are the primitives 06-03 (DIS-05/06/07/08: type filter, capability filter, zero-result copy, query logging) extends directly — the plan's own Reference C/D names these as the exact extension points.
- The zero-search-result branch in `artifacts/page.tsx` is a deliberate placeholder (`TODO(06-03)`), structurally distinct from the other two empty states but carrying no final copy — 06-03 owns D-38's wording.
- `/skills` no longer has a live page; every published link resolves through the 308 redirect. No dependent phase reads `src/app/skills/page.tsx`.
- Performance is measured, not assumed: a late browse page at 921 rows is 6.5ms, a late search page is 1.8ms — both leave enormous headroom before D-46's re-measure-before-indexing threshold matters again.

## Self-Check: PASSED

All files modified by this plan exist on disk in their expected final state
(`src/db/queries/search.ts`, `src/db/queries/search.test.ts`,
`src/app/artifacts/page.tsx`, `next.config.ts`, `src/app/layout.tsx`,
`src/app/page.tsx`, `src/app/globals.css`); `src/app/skills/page.tsx` is
confirmed absent. All three task commits (`b9298fd`, `6e3ae20`, `8f59427`)
are present in git history on `develop`.

---
*Phase: AGD-06-search-browse*
*Completed: 2026-08-12*
