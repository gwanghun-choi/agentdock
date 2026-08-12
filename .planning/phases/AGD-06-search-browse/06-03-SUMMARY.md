---
phase: AGD-06-search-browse
plan: 03
subsystem: search
tags: [postgresql, sql-filters, drizzle-orm, nextjs, structured-logging, capability-disclosure]

requires:
  - phase: AGD-06-02
    provides: searchWhere() shared predicate builder, SEARCH_CAPS, normalizeQuery, hrefFor, the /artifacts route with ranking/browse/pagination
provides:
  - "ARTIFACT_TYPE_IDS and CAPABILITY_FILTER_IDS (closed id arrays) plus SearchFilters, all conjuncts inside 06-02's shared searchWhere() builder"
  - "The DIS-06 no_network/no_shell/no_scripts absence filters, reading the latest package_version via a correlated subquery and package.files directly, imported from SCRIPT_EXTENSIONS"
  - "A D-34 regression test locking that type=catalog never appears in search output"
  - "SearchLog, a third closed-union member on log(), with resultCount/types/capabilities emitted explicitly rather than omitted"
  - "Facet controls (native <select>/<checkbox> in the existing GET form) and a three-branch empty state with D-38/D-39 zero-result and corpus-scope copy on /artifacts"
affects: [AGD-06-04]

actuals:
  tokens: 12843
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Absence-only capability filters: three NOT EXISTS predicates over the latest package_version (correlated subquery, not a joined alternative) and over package.files directly, all conjuncts of the one shared searchWhere() builder"
    - "Closed-id-array-in-query-module, labels-in-route: ARTIFACT_TYPE_IDS/CAPABILITY_FILTER_IDS live in search.ts for validation; TYPE_FILTER_LABELS/CAPABILITY_FILTER_LABELS live in the route beside the markup"
    - "One log() call per request, from the route (not the react.cache-wrapped query module), timed around both the rows query and the count query together"

key-files:
  created: []
  modified:
    - src/db/queries/search.ts
    - src/db/queries/search.test.ts
    - src/log.ts
    - src/log.test.ts
    - src/app/artifacts/page.tsx
    - src/app/globals.css

key-decisions:
  - "Type and capability conjuncts land inside 06-02's shared searchWhere() builder, never beside it — searchPackages and countSearchResults can never disagree about what is filtered, and all three exclusions plus the type predicate share one PostgreSQL READ COMMITTED statement-level snapshot"
  - "Offered only absence filters (no_network/no_shell/no_scripts) — a presence filter over a detector with known misses (install 0/6 recall, network_request 15% FP) would present a measurement gap as a property of the artifact; an absence filter only ever claims what AgentDock itself observed"
  - "no_scripts reads package.files directly with no version join at all (files lives on package, not package_version, per schema.ts's own comment); no_network/no_shell read the latest package_version via the same correlated-subquery idiom packages.ts already uses twice, never a joined alternative — RESEARCH measured 1,152ms vs 25.5ms for the two shapes of a comparable query"
  - "catalog gets a regression test and no code: a successfully parsed catalog writes zero package rows (routes to the seed channel instead), so a type=catalog row exists only when parsing failed, and NOT_LISTED_BECAUSE's existing parse_status='failed' branch already excludes it"
  - "SearchLog.types/capabilities are typed string[] rather than importing search.ts's closed id types, so log.ts never pulls in @/db/client at module load and log.test.ts stays DB-free"
  - "The zero-result page always renders both 'Clear filters' and 'Browse all artifacts' links (not only 'Clear filters shown when a filter is applied' as Reference C's prose suggested) — the concrete acceptance test (?q=zzzz with no filter applied) requires at least two next-step links in every zero-result state, so the two are unconditional"

patterns-established:
  - "A filter change resets to page 1 by construction: the form has no <page> field at all, so a GET submit cannot carry a stale page forward"

requirements-completed: [DIS-05, DIS-06, DIS-07, DIS-08, DIS-10]

coverage:
  - id: D1
    description: "A type filter for 'command' returns only command rows in SQL, and the row count equals countSearchResults for the same filters; an unmatched type value is dropped rather than producing an empty page, and a repeated type value does not throw"
    requirement: DIS-05
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#06-03 type and capability filters (DIS-05/DIS-06) > returns only rows of the requested type, and searchPackages/countSearchResults agree"
        status: pass
      - kind: unit
        ref: "src/db/queries/search.test.ts#06-03 type and capability filters (DIS-05/DIS-06) > drops an unmatched type value and returns the unfiltered result set"
        status: pass
      - kind: unit
        ref: "src/db/queries/search.test.ts#06-03 type and capability filters (DIS-05/DIS-06) > accepts a repeated type value without throwing"
        status: pass
    human_judgment: false
  - id: D2
    description: "no_network excludes an artifact whose latest version has a network_request finding and keeps one whose only finding is on an older version; no_shell excludes Bash and Bash(git:*) declared grants and keeps Read; no_scripts excludes each of the seven SCRIPT_EXTENSIONS and keeps an artifact with only .md/.json files"
    requirement: DIS-06
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#capability filters read the latest version... > no_network excludes.../no_shell excludes.../no_scripts excludes a bundled %s file (x7)/keeps an artifact whose files contain only .md and .json paths"
        status: pass
    human_judgment: false
  - id: D3
    description: "All three capability filters applied together return a subset of any two applied together; filters compose with a text query and the empty browse query, and countSearchResults agrees with searchPackages in all four combinations; filter application does not change the relative order of two rows that both survive it"
    requirement: DIS-06
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#06-03 type and capability filters (DIS-05/DIS-06) > applying all three capability filters returns a subset of applying any two / filters compose with a text query.../ does not change the relative order..."
        status: pass
    human_judgment: false
  - id: D4
    description: "A type=catalog row (parse_status=failed, matching the real pipeline) never appears in search output for a text query, the browse query, or any filter combination — the D-34 regression"
    requirement: DIS-05
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#catalog exclusion (D-34 regression) > a type=catalog row... never appears..."
        status: pass
    human_judgment: false
  - id: D5
    description: "A row snapshot of the sentinel-prefixed rows is byte-identical before and after every filtered query — SELECT-only filtering satisfies DAT-07 by construction under filters too"
    verification:
      - kind: unit
        ref: "src/db/queries/search.test.ts#06-03 type and capability filters (DIS-05/DIS-06) > leaves every stored row byte-identical after every filtered query"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live corpus: the triple-exclusion filter passes 708 of 921 listed artifacts (matches RESEARCH's measured figure exactly); EXPLAIN (ANALYZE, BUFFERS) is 60.5ms using the existing capability_finding_identity index, no new index added"
    requirement: DIS-06
    verification:
      - kind: manual_procedural
        ref: "throwaway bun script against the live agentdock schema, 2026-08-12 — see Performance Measurements below"
        status: pass
    human_judgment: false
  - id: D7
    description: "The search log line's key set is exactly closed (capabilities, durationMs, event, page, query, resultCount, totalCount, ts, types); resultCount/types/capabilities/query are emitted explicitly (0, [], [], '') rather than omitted for zero/unfiltered/browse entries; the existing ingest/worker cases and the outside-the-union type-check case still pass"
    requirement: DIS-08
    verification:
      - kind: unit
        ref: "src/log.test.ts#the search log line (11 cases)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The search log line carries neither planted sentinel in an ordinary populated line; a second case plants a sentinel inside the free-form query field and asserts it survives, documenting rather than hiding that the query field is genuinely free-form"
    requirement: DIS-08
    verification:
      - kind: unit
        ref: "src/log.test.ts#the search log line > carries neither planted sentinel.../DOES carry a sentinel planted inside the query field"
        status: pass
    human_judgment: false
  - id: D9
    description: "Facet controls (one <select name=type>, three name=cap checkboxes, a <label> for each) render server-side with no client JavaScript, inside the same GET form as the search input; a filtered request re-renders the select/checkboxes as selected/checked from the URL; check:boundaries rule six passes with the new copy"
    requirement: DIS-05
    verification:
      - kind: manual_procedural
        ref: "curl http://localhost:3000/artifacts and curl '.../artifacts?type=command&cap=no_network&cap=no_scripts' — see Live Verification below"
        status: pass
      - kind: other
        ref: "bun run check:boundaries — exit 0"
        status: pass
    human_judgment: false
  - id: D10
    description: "A zero-result page (?q=zzzzqqqqnotathing, no filters applied) returns 200, contains the query string, at least two next-step links, the corpus-scope sentence, and none of the three forbidden non-existence phrasings, grepped from the rendered HTML body"
    requirement: DIS-07
    verification:
      - kind: manual_procedural
        ref: "curl 'http://localhost:3000/artifacts?q=zzzzqqqqnotathing' — see Live Verification below"
        status: pass
    human_judgment: false
  - id: D11
    description: "Server stdout shows exactly one line matching \"event\":\"search\" per request, for both a filtered search request and a plain browse request"
    requirement: DIS-08
    verification:
      - kind: manual_procedural
        ref: "server stdout during isolated curl calls to /artifacts?q=mcp&type=command and /artifacts — see Live Verification below"
        status: pass
    human_judgment: false
  - id: D12
    description: "No new runtime dependency: package.json is unchanged across all three tasks"
    requirement: DIS-10
    verification:
      - kind: other
        ref: "git diff --stat -- package.json (empty, checked after every task)"
        status: pass
    human_judgment: false
  - id: D13
    description: "The rendered browse → search → filter → open detail → back → paginate flow produces no browser console error at default (1280x800) and narrow (375x800) viewport widths, and no horizontal scroll"
    verification:
      - kind: automated_ui
        ref: "gstack browse pass, 2026-08-12 — see Browser Verification below"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-08-12
status: complete
---

# Phase 6 Plan 3: Type and Capability Filters, Structured Query Logging, and a Zero-Result Page That Tells the Truth Summary

**Type and capability filters (`no_network`/`no_shell`/`no_scripts`) applied in SQL inside 06-02's shared `searchWhere()` builder, a third `SearchLog` closed-union member on `log()`, and native `<select>`/checkbox facets on `/artifacts` with a zero-result page that states the fact, offers next steps, and discloses corpus scope.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-08-12T04:49:50Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- `ARTIFACT_TYPE_IDS` (five listable ids, `catalog` deliberately absent) and `CAPABILITY_FILTER_IDS` (`no_network`/`no_shell`/`no_scripts`) as closed arrays in `search.ts`; both `searchPackages` and `countSearchResults` now accept `filters: SearchFilters`, with the type and capability conjuncts living inside 06-02's shared `searchWhere()` builder — never a second, hand-copied predicate.
- The three DIS-06 absence filters: `no_network`/`no_shell` read the latest `package_version` via the same correlated-subquery idiom `packages.ts` already uses twice; `no_scripts` reads `package.files` directly (no version join at all) and its regex is built from the imported `SCRIPT_EXTENSIONS` constant, never retyped.
- A D-34 regression test locking that a `type = 'catalog'` row (which only ever exists with `parse_status = 'failed'`, per the pipeline's own seed-channel routing) never appears in search output for any query or filter combination.
- `SearchLog` joins `IngestLog`/`WorkerLog` as a third closed-union member on the one `log()` function; `resultCount`, `types`, `capabilities` and `query` are all emitted explicitly (`0`, `[]`, `[]`, `''`) rather than omitted, following `IngestLog.seedsSkipped`'s own precedent.
- `/artifacts` gained a native `<select name="type">` and three `<input type="checkbox" name="cap">` inside the existing GET form (no `'use client'`), re-rendering selection from the URL; a restructured empty-state branching (`!hasQuery && !hasFilters` for corpus-empty, `total > 0 && items.length === 0` for past-the-end, everything else for zero-result) and a D-39 corpus-scope sentence on every result page.
- Live corpus: **708 of 921** listed artifacts pass all three capability exclusions — an exact match to RESEARCH's measured figure — at **60.5ms** `EXPLAIN (ANALYZE, BUFFERS)`, using the existing `capability_finding_identity` index with no new index added.

## Task Commits

1. **Task 1: Narrowing that happens in SQL, on the version the artifact's own page shows** - `d18db49` (feat)
2. **Task 2: One more line shape on the one log function, and the key set stays closed** - `a3e6548` (feat)
3. **Task 3: Facets that need no JavaScript, and a zero-result page that does not speak for GitHub** - `7a95708` (feat)

_No separate plan-metadata commit: `commit_docs: false` in `.planning/config.json` — STATE.md/ROADMAP.md/REQUIREMENTS.md were updated on disk but deliberately not committed (see Final Commit below), matching 06-01/06-02's own precedent._

## Files Created/Modified

- `src/db/queries/search.ts` - `ARTIFACT_TYPE_IDS`, `CAPABILITY_FILTER_IDS`, `SearchFilters`, `validTypes`/`validCapabilities`, `LATEST_PACKAGE_VERSION_ID`, `capabilityAbsence`, `CAPABILITY_PREDICATES`, `SCRIPT_PATH_PATTERN`; `searchWhere`/`searchPackages`/`countSearchResults` all extended to accept and apply `filters`
- `src/db/queries/search.test.ts` - 25 new cases: type filter behavior, three capability filters (including one case per `SCRIPT_EXTENSIONS` entry), triple-combination subset property, four-combination count agreement, order preservation, byte-identical snapshot under filters, the D-34 catalog regression
- `src/log.ts` - `SearchLog` (exported), `log()`'s signature widened to `IngestLog | WorkerLog | SearchLog`
- `src/log.test.ts` - 11 new cases: exact key set, zero/empty-array/empty-string presence, ordinary sentinel-absence, the deliberate query-field sentinel-presence case, ingest/worker regression, event-union type-check rejection
- `src/app/artifacts/page.tsx` - `TYPE_FILTER_LABELS`, `CAPABILITY_FILTER_LABELS`, `SCOPE_SENTENCE`, `parseTypeFilter`/`parseCapabilityFilter`, `appliedFilterLabels`, `hrefFor` extended with filters, facet markup inside the existing form, restructured three-branch empty state, one `log()` call per request
- `src/app/globals.css` - `.facets` rule (flex row for the select + capability fieldset, matching `.search`'s own register)

## Live Verification (2026-08-12, `bun run dev`, curl)

**Facet controls, unfiltered:**
```
$ curl -s http://localhost:3000/artifacts | grep -o 'name="type"' | wc -l   → 1
$ curl -s http://localhost:3000/artifacts | grep -o 'name="cap"' | wc -l    → 3
$ curl -s http://localhost:3000/artifacts | grep -o '<label' | wc -l        → 5
```

**Filtered request, selection re-rendered from the URL:**
```
$ curl -s 'http://localhost:3000/artifacts?type=command&cap=no_network&cap=no_scripts'
→ 200
→ <option value="command" selected="">
→ <input type="checkbox" name="cap" checked="" value="no_network"/>
→ <input type="checkbox" name="cap" value="no_shell"/>
→ <input type="checkbox" name="cap" checked="" value="no_scripts"/>
```
Unfiltered total: `Showing 1–25 of 921`. Filtered total: `Showing 1–25 of 202` — 202 < 921, the SQL filter narrows the result set.

**Zero-result page** (`?q=zzzzqqqqnotathing`, no filters applied):
```
$ curl -s 'http://localhost:3000/artifacts?q=zzzzqqqqnotathing'
→ 200
→ contains "zzzzqqqqnotathing"
→ two next-step links: href="/artifacts?q=zzzzqqqqnotathing" (Clear filters), href="/artifacts" (Browse all artifacts)
→ contains "AgentDock indexes a curated and registry-derived corpus of 16 repositories. It is not a complete index of GitHub."
→ grep -c 'does not exist' / 'no such artifact' / 'not available anywhere' → 0, 0, 0
```

**`bun run check:boundaries`:** `check-boundaries: OK` (7 migration files, package.json, 1 schema module, 73 source files, 15 UI files scanned for verdict vocabulary) — run again after every copy change in Task 3.

**A detail link from a filtered result page opens (COR-07/filter-path consistency):**
```
$ curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/r/anthropics/claude-agent-sdk-python/.claude/commands/generate-changelog.md'
→ 200
```

**Exactly one `"event":"search"` line per request** (isolated curl calls, server stdout):
```
{"ts":"2026-08-12T04:47:29.068Z","event":"search","query":"mcp","types":["command"],"capabilities":[],"page":1,"resultCount":6,"totalCount":6,"durationMs":7}
{"ts":"2026-08-12T04:47:29.170Z","event":"search","query":"","types":[],"capabilities":[],"page":1,"resultCount":25,"totalCount":921,"durationMs":36}
```
The first line is `GET /artifacts?q=mcp&type=command`; the second is `GET /artifacts` (browse). Each isolated curl call produced exactly one matching line — verified by counting server stdout lines against curl call counts throughout the session.

## Performance Measurements (live, `agentdock` schema, 1,137 packages / 921 listed, 16 repositories, 2026-08-12)

Measured with a throwaway `bun` script running the exact SQL shape `searchWhere`'s triple-exclusion conjuncts produce, against the real corpus:

- **Total listed** (fork/unparsed/duplicate-excluded, matching `countPackages()`): **921**
- **Passes all three capability exclusions** (`no_network` AND `no_shell` AND `no_scripts`): **708** — an exact match to 06-RESEARCH.md's measured 708/921, confirming the corpus and the detector outcomes have not drifted since Wave 0 research.
- **`EXPLAIN (ANALYZE, BUFFERS)`** for the full triple-exclusion filter plus the listing predicate, `LIMIT 25`:
  ```
  Limit (actual time=60.221..60.229 rows=25 loops=1)
    Buffers: shared hit=34333
    -> Sort (Sort Key: p.updated_at DESC, p.id) — Sort Method: top-N heapsort
      -> Nested Loop Anti Join (actual time=0.287..60.038 rows=708 loops=1)
        -> Nested Loop Anti Join (actual rows=821 loops=1)
          -> Hash Join (actual rows=844 loops=1)  [package x repository, NOT_LISTED_BECAUSE + no_scripts]
          -> Index Only Scan using capability_finding_identity  [no_network exclusion]
        -> Index Scan using capability_finding_version_idx  [no_shell exclusion, Filter: signal ~~* 'Bash%']
  Planning Time: 1.002 ms
  Execution Time: 60.505 ms
  ```
  Under the plan's 200ms re-measure threshold (D-46) with no new index added — the existing `capability_finding_identity` unique index absorbs both the `no_network` lookup (an Index Only Scan) and, via `capability_finding_version_idx`, the `no_shell` lookup.

## Browser Verification (D-51, gstack `browse`)

Full flow at two viewport widths, 2026-08-12: browse → search `?q=mcp` → type filter `command` → capability filter `no_network` → open a result detail directly → back → page 2 (past-the-end at that narrow filter combination, confirming the existing branch still holds under filters) → zero-result page.

- **1280×800:** zero console errors at every step (console buffer cleared and re-checked per navigation); `document.body.scrollWidth > document.documentElement.clientWidth` is `false` on the browse page.
- **375×800:** zero console errors on browse, on the filtered search, and on the zero-result page; no horizontal scroll on any of the three (`scrollWidth > clientWidth` is `false` in all cases). Screenshots captured at `/tmp/.../scratchpad/facets-desktop.png` (1280×800, facets + filtered rows) and `/tmp/.../scratchpad/zero-narrow.png` (375×800, zero-result copy + scope sentence) — session-scoped, not committed.
- One stale console entry (`WebSocket ... ws://localhost:3000/_next/hmr ... net::ERR_CONNECTION_REFUSED`, repeated) was present in the browse daemon's buffer from *before* this session's navigation — an artifact of the daemon's persistent state across unrelated prior sessions, not caused by this page. Clearing the console buffer immediately before each navigation (`console --clear` then `goto`) confirmed zero errors are actually produced by these pages.

## Decisions Made

- Filters are conjuncts inside 06-02's shared `searchWhere()` builder rather than a parallel predicate, so the rows query and the count query can never disagree about what is filtered — the same discipline that prevents `countPackages`' missing-join bug class from Phase 5.
- Absence-only capability filters (never "has network access"): the Phase 4/5 detector ledger (`install` 0/6 recall, `network_request` 15% FP, `remote_execution`/`hidden_content` zero live positives) means a presence filter would present a measurement gap as a property of an artifact; an absence filter only ever claims what AgentDock itself observed.
- `no_scripts` needs no version join — `files` lives on `package`, not `package_version` — while `no_network`/`no_shell` read the latest `package_version` via the correlated-subquery idiom already established in `packages.ts`, never a joined alternative (RESEARCH measured 1,152ms vs 25.5ms for the two shapes).
- `catalog` gets a regression test and zero production code: it is already excluded by `NOT_LISTED_BECAUSE`'s `parse_status = 'failed'` branch as a fact about the ingestion pipeline, not something this plan needs to implement.
- `SearchLog.types`/`capabilities` are typed `string[]` rather than importing `search.ts`'s closed union types — keeps `log.ts` free of any `@/db/client` dependency at module load, so `log.test.ts` stays DB-free exactly as before.
- The zero-result page's "Clear filters" link renders unconditionally (not gated on `hasFilters` as Reference C's prose literally reads) — the plan's own acceptance test requires at least two next-step links on a zero-result query with **no filter applied at all** (`?q=zzzzqqqqnotathing`), which only "Clear filters" + "Browse all artifacts" together satisfy. Documented as a deliberate reading of the acceptance criterion over the narrative text where the two conflicted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `capture()` spy stacking inside a single log.test.ts case**
- **Found during:** Task 2 (writing the "log() still accepts an ingest entry and a worker entry unchanged" test)
- **Issue:** Calling `capture()` twice inside one `it()` stacked a second `vi.spyOn` on top of the first without restoring in between, so the second call's `expect(spy).toHaveBeenCalledTimes(1)` assertion saw 2 accumulated calls and failed.
- **Fix:** Split into two separate `it()` cases (one per entry type), each with its own `capture()` call — matches the existing suite's one-assertion-per-`it()` convention rather than adding an explicit `vi.restoreAllMocks()` mid-test.
- **Files modified:** `src/log.test.ts`
- **Verification:** `bun run test -- src/log.test.ts` — all 44 cases pass.
- **Committed in:** `a3e6548` (Task 2 commit)

**2. [Rule 1 - Bug] Biome formatting fix on a JSX text run split across a `{page}` interpolation**
- **Found during:** Task 3 lint run
- **Issue:** `bun run lint` flagged the past-the-end branch's JSX (`There is no page {page}.{' '}` / `<Link>...</Link> of {total} artifacts.`) for a different line-wrap than Biome's formatter prefers.
- **Fix:** Ran `bun run format`, verified `bun run lint`/`bun run typecheck`/`bun run test` all still pass and the rendered output is unchanged (grep on the curl output confirms the copy is byte-identical, only source formatting moved).
- **Files modified:** `src/app/artifacts/page.tsx`
- **Committed in:** `7a95708` (Task 3 commit)

**3. [environment noise, not committed] `next dev` rewrites `next-env.d.ts`**
- **Found during:** Task 3 live verification (`bun run dev`)
- **Issue:** Same as 06-01/06-02's documented deviation: Next.js 16.3.0's dev server repoints `next-env.d.ts` at `.next/dev/types/*`.
- **Fix:** `git checkout -- next-env.d.ts` before committing Task 3. `AGENTS.md`/`CLAUDE.md` scaffold files remain untracked, out of this plan's scope (same as prior plans).
- **Files modified:** none (discarded)

---

**Total deviations:** 3 (1 test-isolation bug fix, 1 lint-driven formatting cleanup, 1 environment-noise discard)
**Impact on plan:** No scope creep. The spy-stacking fix was necessary for the test suite to run correctly; the rest is incidental cleanup, matching 06-01/06-02's own pattern.

## Issues Encountered

None beyond the deviations above — `bun run ci`-equivalent (check:boundaries + lint + typecheck + test) is green at the end of the plan: 53 files, 970 tests.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources were introduced. `artifactsTruncated` remains deliberately unsurfaced on this route (D-53, carried from 06-02) — not a stub, an explicit scope decision documented in Reference C.

## User Setup Required

None - no external service configuration required. (`pg_trgm` remains a maintainer out-of-band install, owned by 06-04, not this plan.)

## Next Phase Readiness

- `ARTIFACT_TYPE_IDS`, `CAPABILITY_FILTER_IDS`, `SearchFilters`, and the extended `searchWhere`/`searchPackages`/`countSearchResults` signatures are the primitives 06-04 (trigram fallback, gated on the maintainer's out-of-band `pg_trgm` install) extends directly.
- `SearchLog` is the first line DIS-08's query log actually emits in production code — the log evidence semantic search is gated on (per PROJECT.md's open question) begins accumulating from this plan forward.
- The three empty-state branches and `hrefFor`'s filter-carrying behavior are exercised under every filter combination this plan's test suite covers; 06-04 should extend `hrefFor` and the facet form rather than introduce a second URL builder if it adds a fuzzy-match toggle.
- `check-boundaries.mjs` rule six now scans three new filter-copy strings (`TYPE_FILTER_LABELS`, `CAPABILITY_FILTER_LABELS`, the D-08 and D-38/D-39 sentences) with zero violations — any future capability-related copy in this file should be run past `bun run check:boundaries` before considering it finished, per the plan's own instruction.

## Self-Check: PASSED

All files modified by this plan exist on disk in their expected final state
(`src/db/queries/search.ts`, `src/db/queries/search.test.ts`, `src/log.ts`,
`src/log.test.ts`, `src/app/artifacts/page.tsx`, `src/app/globals.css`). All
three task commits (`d18db49`, `a3e6548`, `7a95708`) are present in git
history on `develop`.

---
*Phase: AGD-06-search-browse*
*Completed: 2026-08-12*
