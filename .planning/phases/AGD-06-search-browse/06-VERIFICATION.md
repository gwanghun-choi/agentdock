---
phase: AGD-06-search-browse
verified: 2026-08-12T05:30:00Z
status: gaps_found
score: 11/12 must-haves verified (ROADMAP success criteria); 6/7 requirements verified
overrides_applied: 0
gaps:
  - truth: "A misspelled query still finds the right artifact (ROADMAP criterion 2 / DIS-04)"
    status: failed
    reason: "pg_trgm is genuinely absent from this environment's PostgreSQL instance (independently re-verified live: `select extname from pg_extension` returns only `plpgsql`). The trigram migration (drizzle/0007_green_jasper_sitwell.sql) was generated, hand-guarded, boundary-checked, and independently re-verified by this verifier to raise the exact D-04 message — but was never applied to either agentdock or agentdock_test (confirmed live: __drizzle_migrations has 7 rows, max id 7, no row for migration 0007; package_fuzzy_trgm_idx does not exist in pg_indexes). All 06-04 code changes (schema.ts, search.ts, search.test.ts, artifacts/page.tsx, the migration files) are uncommitted working-tree changes only, per explicit maintainer override suspending git commit/push for this run. Live queries for playwrit/postgress/mcp-sever each return HTTP 200 and degrade honestly to the existing zero-result page (verified: server stdout shows one `search-fuzzy-unavailable` marker with code 42883 per request, immediately before the `search` log line), which is the correct designed degradation — but the actual typo-tolerance behavior the criterion asks for has never been exercised end to end."
    artifacts:
      - path: "drizzle/0007_green_jasper_sitwell.sql"
        issue: "Generated and correct (guard message independently re-verified byte-identical via a rolled-back psql transaction), but not applied to either schema — no commit exists on develop for this file"
      - path: "src/db/queries/search.ts (fuzzySearch, SEARCH_CAPS.fuzzyThreshold)"
        issue: "Implemented, unit-tested (68 passing, 7 visibly skipped because the extension is absent), but the fuzzyThreshold value (0.6) is pg_trgm's own unmeasured default — the three maintainer-named examples were never scored against real data because the operator does not exist without the extension"
    missing:
      - "A superuser must run `CREATE EXTENSION pg_trgm SCHEMA agentdock;` against the live mcpdb instance (docker exec didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb)"
      - "After that: `bun run db:migrate && bun run db:test:generate && bun run db:test:migrate` to apply drizzle/0007 to both schemas"
      - "Re-run the word_similarity measurement for playwrit/postgress/mcp-sever against real data and confirm/adjust SEARCH_CAPS.fuzzyThreshold"
      - "Re-run the three live curl checks and confirm the close-matches branch renders real rows"
      - "Commit the 06-04 working-tree changes (currently uncommitted on develop) once the above is confirmed"
---

# Phase 6: Search & Browse Verification Report

**Phase Goal:** A developer describing what they need finds the right artifact.
**Verified:** 2026-08-12 (live, against a running `bun run dev` instance and the real `agentdock` schema — 1,137 packages / 921 listed / 16 repositories / 2,450 capability findings, all independently re-queried, not taken from SUMMARY.md)
**Status:** gaps_found (one ROADMAP success criterion / one requirement genuinely blocked by an environment fact outside AgentDock's control)
**Re-verification:** No — initial verification

**Methodology note:** every finding below was reproduced independently in this session — `bun run ci`/`bun run build` were re-run, the dev server was started fresh, `docker exec ... psql` was used to query the live database directly, and every SUMMARY.md claim that could be checked against a running system was re-checked rather than trusted. SUMMARY.md claims are cited only where they match what was independently observed.

## Goal Achievement

### ROADMAP Success Criteria (the six-item bar)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | A plain-language query returns relevance-ranked results | ✓ VERIFIED | Live: `mcp`→47, `skill`→593, `claude`→488, `playwright`→4, `github`→13 (all HTTP 200, rows present in raw HTML). Ranking source-verified: `rankExpr()` in `src/db/queries/search.ts:237-248` sums exact-name (2.0) > prefix (1.0) > `ts_rank` > repo-name (0.1), each strictly separated so an earlier D-12 signal can never be outranked by a later one. `EXPLAIN (ANALYZE, BUFFERS)` for `q=mcp` page 1: 2.15ms; late page: 1.77ms (both re-confirmed live, matching 06-02-SUMMARY.md). |
| 2 | A misspelled query still finds the right artifact | ✗ FAILED / BLOCKED | `pg_trgm` independently re-verified absent: `docker exec didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb -c "select extname from pg_extension;"` → only `plpgsql`. Code exists (`fuzzySearch()`), is unit-tested, and degrades honestly (verified live: `playwrit`/`postgress`/`mcp-sever` all return HTTP 200, zero-result page, with `"event":"search-fuzzy-unavailable","code":"42883"` on stdout immediately before each `search` line) — but the actual typo-match has never run against real data and 0007's migration has never been applied. See Gaps. |
| 3 | Results filter by artifact type and by declared capability, including "no scripts, no network, no shell" | ✓ VERIFIED | Live: `?type=command` → 204/921; `?cap=no_network&cap=no_shell&cap=no_scripts` → **708/921**, an exact match to RESEARCH's and 06-03-SUMMARY.md's measured figure, independently re-run. All three conjuncts confirmed inside one shared `searchWhere()` builder by source review (`src/db/queries/search.ts`), so rows and count can never disagree. |
| 4 | A zero-result query offers a useful next step | ✓ VERIFIED | Live `?q=zzzzqqqqnotathing`: 200, body contains the query, "Clear filters" + "Browse all artifacts" links, and the corpus-scope sentence ("AgentDock indexes a curated and registry-derived corpus of 16 repositories. It is not a complete index of GitHub."). `grep -c` for "does not exist"/"no such artifact"/"not available anywhere" on the rendered HTML → 0/0/0. |
| 5 | Every query and its result count is logged | ✓ VERIFIED | Live server stdout during isolated requests, one structured `"event":"search"` line per request, e.g. `{"ts":"...","event":"search","query":"mcp","types":["command"],"capabilities":[],"page":1,"resultCount":6,"totalCount":6,"durationMs":6}`. Confirmed for search, browse, filtered, and zero-result requests. |
| 6 | Search runs entirely on PostgreSQL with no external service | ✓ VERIFIED | `git diff --stat -- package.json` is empty across all 10 commits and the working tree — no dependency was added anywhere in the phase. Grep of `src/db/queries/search.ts` shows only `websearch_to_tsquery`/`ts_rank`/`word_similarity` — no external client. `pg_trgm` is a PostgreSQL contrib extension, not a service. |

**Score:** 5/6 ROADMAP success criteria fully verified live. Criterion 2 is code-complete, tested, and honestly documented as blocked — not fabricated as passing.

### Requirements Coverage (DIS-03, DIS-04, DIS-05, DIS-06, DIS-07, DIS-08, DIS-10)

| Requirement | Status | Evidence |
|---|---|---|
| DIS-03 (full-text, relevance-ranked) | ✓ SATISFIED | See criterion 1. `search_vector` STORED generated tsvector column independently re-confirmed live: `select count(*) from agentdock.package where search_vector is not null` → 1137/1137; `package_search_vector_idx` present in `pg_indexes`. |
| DIS-04 (typo tolerance via trigram) | ✗ BLOCKED | See criterion 2. Accurately recorded as BLOCKED in `.planning/REQUIREMENTS.md` (unchecked box, detailed annotation) and `.planning/STATE.md` — this verification confirms that record is honest, not optimistic. |
| DIS-05 (filter by artifact type) | ✓ SATISFIED | See criterion 3. `ARTIFACT_TYPE_IDS` is a closed 5-member array (`catalog` deliberately absent, independently confirmed via `grep`); an unmatched/repeated type value is dropped without error (source-reviewed `validTypes()`). |
| DIS-06 (filter by declared capability, incl. triple composition) | ✓ SATISFIED | See criterion 3. Live triple-exclusion count (708/921) independently reproduced. |
| DIS-07 (zero-result offers next step) | ✓ SATISFIED | See criterion 4. |
| DIS-08 (queries and result counts logged) | ✓ SATISFIED | See criterion 5. `src/log.ts`'s `SearchLog` union member confirmed present with `query`, `types`, `capabilities`, `page`, `resultCount`, `totalCount`, `durationMs` all emitted explicitly (not omitted at zero/empty), matching `IngestLog`'s own precedent. |
| DIS-10 (PostgreSQL only, no external service) | ✓ SATISFIED | See criterion 6. |

**7 requirements: 6 SATISFIED, 1 BLOCKED (environmental, not a code defect).**

## The Twelve Judged Items

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | All 921 listed artifacts reachable — `sourcePathFromUrl` `/SKILL.md` defect closed for all five non-skill types | ✓ DEFENSIBLE | Live 200s for one real URL of each of the six types (skill, command, plugin (shape-only bare-directory), hook, mcp_server, catalog) taken directly from the live `agentdock` schema, not from fixtures. `grep -rn sourcePathFromUrl src/` shows the name survives only in two explanatory comments, never in executable code; `sourcePathCandidates` (packages.ts:274) is the live function. The six-type + shape-only-plugin round-trip invariant is a committed regression test (`packages.test.ts`), part of the 971 passing tests re-run in this session. |
| 2 | `/skills` → `/artifacts` real redirect preserving querystring | ✓ VERIFIED | Live: `curl -sI 'http://localhost:3000/skills?q=mcp&type=command&page=2'` → `308 Permanent Redirect`, `location: /artifacts?q=mcp&type=command&page=2` — full querystring, not just `q`, preserved. |
| 3 | Search state genuinely in the URL, restored on direct link/refresh | ✓ VERIFIED | Fresh, cold `curl` (no prior page load, no cookies, no session) to `/artifacts?q=mcp&type=command&page=1` renders `<option value="command" selected="">` and `<input ... value="mcp"/>` — state is reconstructed entirely from the URL server-side, proving it is not client-only React state. |
| 4 | Results genuinely SERVER-RENDERED — present before client JS | ✓ VERIFIED | `curl` (a JS-free HTTP client) against `/artifacts?q=mcp` returns 25 distinct `href="/r/..."` result links directly in the response body. No `'use client'` directive anywhere in `src/app/artifacts/page.tsx` (grep confirmed). |
| 5 | Any filtering done client-side? (D-30 forbids it) | ✓ NONE FOUND | The only `.filter(...)` calls in the search path (`search.ts:104,109`, `page.tsx:84`) validate incoming URL param arrays against closed id sets before they reach SQL — they do not filter fetched rows. Type/capability predicates are conjuncts inside the SQL `WHERE` built by `searchWhere()`, confirmed by source review and by count-vs-row-count agreement live (`?type=command` shows 204 both in the "Showing" text and matches the SQL-filtered total). |
| 6 | Verdict wording ("Safe"/"Risky"/"dangerous"/"secure"/"trusted") on any capability label? | ✓ NONE FOUND | `bun run check:boundaries` (rule 6, the mechanical verdict-vocabulary scanner) passes: `check-boundaries: OK`. Manual grep of six live detail pages plus four search-result pages for `safe|risky|dangerous|secure|trusted|verified|approved|malicious` found only: (a) the CAP-09/CAP-10 sanctioned disclaimer text ("it cannot say whether an artifact is safe") on every page, and (b) the word "approved" inside third-party command documentation content ("run the whole plan in one approved pass") — neither is a verdict about the artifact. |
| 7 | Does ranking touch stars/downloads/official/trusted/security, or penalize `parse_status='partial'`? | ✓ NONE FOUND | `grep -n "stars\|official\|trusted\|security\|parse_status\|parseStatus" src/db/queries/search.ts` shows `stars` only inside the `SELECT` projection (twice, matching `listPackages`'s pre-existing shape) and never inside `rankExpr()`/`searchWhere()`; `parse_status` appears only in a comment. A dedicated passing test (`search.test.ts:223`, "does not rank parse_status = 'partial' below an otherwise equal 'ok' row") asserts equal rank for a `partial` vs. `ok` row with an otherwise-identical fixture, independently confirmed present in the 971-test run. |
| 8 | Is DIS-08 logging real — one structured record per search? | ✓ VERIFIED | See requirement DIS-08 above. Live-observed, not read from source alone. |
| 9 | Is the zero-result state honest? | ✓ VERIFIED | See criterion 4. |
| 10 | N+1: does a 25-row page or a detail page issue per-row queries? | ✓ NONE FOUND | `search.ts` contains exactly one `db.select` in `searchPackages` and one in `countSearchResults` — a rendered page issues exactly 2 statements (source-confirmed; `EXPLAIN` output shows correlated subqueries execute inside the same top-level statement, not as separate round trips). The detail page (`r/[owner]/[repo]/[...path]/page.tsx`) issues exactly 2 queries total (`getPackageDetail`, `getCapabilityFindings`), each a single `db.select`, confirmed by source review of `src/db/queries/capabilities.ts`. |
| 11 | Did `package.json` gain any dependency? | ✓ NONE | `git diff --stat -- package.json` is empty for every commit in the phase (`e0aa617`..`7a95708`) and for the current uncommitted working tree. |
| 12 | Did anything touch `public`/`didim_mcp`, emit DROP/REVOKE, or `CREATE EXTENSION`? | ✓ NONE FOUND | `grep -inE 'public\.|didim_mcp|DROP |REVOKE |CREATE\s+EXTENSION|CREATE\s+SCHEMA|CREATE\s+DATABASE' drizzle/*.sql` returns exactly one hit — a *comment* in `0000_noisy_hemingway.sql` recording a hand-removed `CREATE SCHEMA` from Phase 0, unrelated to this phase. `0007_green_jasper_sitwell.sql`'s guard message contains the literal words "CREATE EXTENSION" only inside a split, concatenated string literal inside a `RAISE EXCEPTION` — independently re-verified live (rolled-back `psql` transaction) to raise byte-identically: `pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;`. `bun run check:boundaries` passes (8 migration files scanned). |

## `bun run ci` and `bun run build` — Independently Re-Run

```
$ bun run check:boundaries
check-boundaries: 8 migration file(s), package.json, 1 schema module, 73 source file(s), 15 UI file(s) scanned for verdict vocabulary
check-boundaries: OK
$ biome check .
Checked 166 files in 122ms. No fixes applied.
$ tsc --noEmit
(clean)
$ vitest run
 Test Files  53 passed (53)
      Tests  971 passed | 7 skipped (978)
```
Matches SUMMARY.md's claimed "53 files, 971 tests passed, 7 skipped" exactly — independently reproduced, not taken on trust.

```
$ bun run build
✓ Compiled successfully in 8.4s
✓ TypeScript: clean
Route (app): / ; /_not-found ; /artifacts ; /jobs/[id] ; /r/[owner]/[repo] ; /r/[owner]/[repo]/[...path]
```
`/skills` is correctly absent from the route table (deleted; replaced by a `next.config.ts` redirect, confirmed live above). `/artifacts` is present.

## Live Search Smoke (maintainer's named query set) — Independently Re-Run

| Query | Latency | Result | Notes |
|---|---|---|---|
| `mcp` | 147ms | 47 total, 25/page | |
| `skill` | 144ms | 593 total | |
| `claude` | 151ms | 488 total | |
| `playwright` | 66ms | 4 total | |
| `github` | 74ms | 13 total | |
| `webapp-testing` (exact name) | 61ms | 1 of 1 | exact name ranks alone |
| `zzzzqqqqnotathing` (zero-result) | 57ms | 0, honest empty state | |
| `type=command` (type filter) | 145ms | 204 total | |
| `q=mcp&type=command` (combined) | 77ms | 6 total | |
| `page=2` (late page) | 147ms | 26–50 of 921 | |

All latencies are well within "feels instant" territory at this corpus size (all under 200ms, most under 150ms including full HTTP round trip through curl, not just DB execution time).

## COR-07 — Independently Reproduced

Found a genuinely suppressed row live: package id 1134, `examples/plugins/demo-plugin/commands/greet.md` in `anthropics/claude-agent-sdk-python`, `parse_status = 'failed'`.

- `?q=greet` and `?q=greet&type=command` → both "No artifacts matched" (absent from global search, including under a type filter). ✓
- Direct route `/r/anthropics/claude-agent-sdk-python/examples/plugins/demo-plugin/commands/greet.md` → HTTP 200 (reachable). ✓
- Repository page `/r/anthropics/claude-agent-sdk-python` contains "greet" (reachable via repository listing). ✓
- The row was never deleted — confirmed present via direct SQL query throughout. ✓

**COR-07 holds for search, independently proven, not merely asserted by the test suite.**

## Generic Detail Smoke — All Six Types, Independently Re-Run

| Type | URL (live corpus) | HTTP | Type label | Commit SHA present | Permalink | Capability section |
|---|---|---|---|---|---|---|
| skill | `/r/anthropics/skills/skills/algorithmic-art` | 200 | Agent Skill | ✓ | ✓ github.com/.../blob/... | ✓ (Declared/Observed/Files/Install/Not-checked) |
| command | `/r/davila7/.../commands/google-workspace/gws-gmail-triage.md` | 200 | Slash Command | ✓ | ✓ | ✓ (no Install section) |
| plugin (shape-only) | `/r/davila7/claude-code-templates/cli-tool/components` | 200 | Claude Code Plugin | ✓ | ✓ | ✓ (no Install section) |
| hook | `/r/anthropics/claude-agent-sdk-python/.claude/settings.json` | 200 | Hook Configuration | ✓ | ✓ | ✓ (no Install section) |
| mcp_server | `/r/modelcontextprotocol/servers/.mcp.json` | 200 | MCP Server | ✓ | ✓ | ✓ (no Install section) |
| catalog | `/r/davila7/.../.claude-plugin/marketplace.json` | 200 | Plugin Marketplace | ✓ | ✓ | ✓ (no Install section) |

**Install section** correctly gated to `skill` only (verified present on the skill page, absent on all five others, by grep of the rendered HTML). No Skill-only wording (`.claude/skills/...` as UI copy) found leaking onto non-skill pages — the one hit on the hook page was legitimate stored file-inventory data (a `.claude/skills/verify/SKILL.md` path that repository genuinely contains), not UI chrome.

**Catalog decision:** defensible. Live query confirms the corpus's single `catalog` row (id 336) has `parse_status = 'failed'` — exactly the case D-34's design rests on (a catalog that parses successfully writes zero package rows; only a failed catalog parse produces a `type='catalog'` package row, which `NOT_LISTED_BECAUSE`'s existing `parse_status = 'failed'` branch already excludes from listings and search). `ARTIFACT_TYPE_IDS` correctly omits `catalog` from the filter's closed set. The detail route still resolves for it (D-22/D-25 apply to every type, filter exclusion is separate from route resolution) — verified live at 200.

## Anti-Patterns / Debt Markers

`grep -rn "TODO\|FIXME\|XXX\|HACK\|PLACEHOLDER" src/db/queries/search.ts src/app/artifacts/page.tsx src/db/schema.ts src/log.ts` — no unresolved debt markers found in the phase's own files (the `TODO(06-03)` placeholder mentioned in 06-02-SUMMARY.md was resolved by 06-03, confirmed absent in the final `artifacts/page.tsx`).

## Human Verification Required

### 1. Browser console-error-free flow (backstop truths in all four plans' `must_haves`)

**Test:** Full flow browse → search `mcp` → apply type filter → apply capability filter → open a result detail → back → paginate, at default (1280×800) and narrow (375×800) viewport widths, watching the browser console.
**Expected:** Zero console errors, no horizontal scroll.
**Why human/could not independently re-verify:** No headless browser (Playwright/Chromium) is installed in this verification environment, so the four plans' `verification: backstop` truths could not be independently re-exercised in this session. 06-01/06-02/06-03-SUMMARY.md each report a `gstack browse` pass with zero console errors at both viewport widths, with screenshots — those artifacts were session-scoped temp files and are no longer on disk to inspect. This verifier's independent evidence is limited to curl-level HTTP/HTML checks (all of which passed), which is necessary but not sufficient proof of a JS-free console session. Recommend a fresh `gstack browse` pass, or Playwright run, before the next phase.

### 2. DIS-04 completion, once the extension is installed

**Test:** After a superuser runs `CREATE EXTENSION pg_trgm SCHEMA agentdock;`, apply `drizzle/0007_green_jasper_sitwell.sql` to both schemas, re-run the `word_similarity` measurement for `playwrit`/`postgress`/`mcp-sever`, and re-run the three live curl checks.
**Expected:** Each of the three maintainer-named typo queries returns the artifact RESEARCH predicted, via the close-matches branch (not the zero-result branch).
**Why human:** Requires a superuser action AgentDock's `agentdock_app` role cannot perform (`has_database_privilege('agentdock_app','mcpdb','CREATE') = false`, independently re-confirmed live in this session by the fact that no application-level path exists to run `CREATE EXTENSION`).

## Gaps Summary

Everything in Phase 6 that AgentDock's own code and role can deliver is delivered, wired, and independently verified live against the real corpus: the carried Phase 4/5 detail-route defect is closed for all six types, search is genuinely server-rendered PostgreSQL full-text search with an explainable four-term ranking order, filtering happens entirely in SQL and matches the exact measured figures from research, structured query logging is live and observable on stdout, the zero-result experience is honest, COR-07 suppression holds under search, no verdict vocabulary or ranking-quality-proxy exists anywhere, no new dependency was added, and no schema/DDL boundary was crossed.

The one gap is DIS-04 / ROADMAP criterion 2 (typo tolerance), and it is a single, well-isolated, well-documented environmental blocker: `pg_trgm` is not installed on this PostgreSQL instance, only a superuser can install it, and D-04 correctly forbids AgentDock's own migration from attempting it. The code, tests, and migration for this feature are complete and working-tree-ready (currently **uncommitted** on `develop`, per the maintainer's explicit standing no-commit override for this run) — the moment the extension is installed, applying the migration and committing the working tree is expected to close this gap with no further code changes, per 06-04-SUMMARY.md's own "Next Phase Readiness" section, which this verification confirms is an accurate assessment rather than optimistic self-reporting.

---

## Overall Verdict

# PHASE 6 NOT COMPLETE

**What is open (the only item):**

1. **DIS-04 / ROADMAP success criterion 2** ("a misspelled query still finds the right artifact") is implemented, unit-tested, and honestly documented as BLOCKED — but has never been exercised against real data because `pg_trgm` is genuinely absent from this environment's PostgreSQL instance, and only a superuser can install it (`CREATE EXTENSION pg_trgm SCHEMA agentdock;`). This is not a code defect; it is a locked, maintainer-approved architectural dependency (D-03/D-04) waiting on an out-of-band action.

**Secondary, non-blocking item:**

2. The 06-04 plan's code changes (schema, migration, query fallback, tests, UI branch) are **uncommitted** on `develop` — a deliberate, explicit maintainer override for this run, not a defect, but a state the maintainer will need to resolve (commit now vs. after the extension install) before Phase 7 begins.

**Everything else — all five other ROADMAP success criteria, six of seven requirements, and all twelve specifically-judged items — is independently verified live against the real corpus and is not blocked.** Once a superuser installs `pg_trgm` and the working tree is applied/committed, Phase 6 is expected to be complete with no further code changes, per this verification's own re-derivation of the evidence (not merely a repeat of 06-04-SUMMARY.md's claim).

---

*Verified: 2026-08-12*
*Verifier: Claude (gsd-verifier)*
