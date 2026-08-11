---
phase: AGD-03-detector-pluralism
plan: 01
subsystem: detection-and-ingestion
tags: [detector-isolation, json-parsing, catalog, marketplace, repo-seed, drizzle-migration]
status: complete

requires:
  - phase: AGD-01-walking-skeleton
    provides: the Detector interface, skill.ts as the one reference detector, parseFrontmatter and its cap doctrine
  - phase: AGD-02-durable-ingestion
    provides: the queue, persistScan's transaction, the truncated-scan-no-delist invariant
provides:
  - src/detect/run.ts — collectCandidates, orderedNeeds, safeParse (one guarded match pass, run once per repository)
  - src/detect/json.ts — parseJsonManifest, the three-cap doctrine for untrusted JSON (bytes, array length at any depth, nesting depth)
  - src/detect/catalog.ts — the catalog detector: marketplace.json to repo_seed, never to package
  - agentdock.repo_seed — additive table, no status column, no fan-out
  - the widened ParseResult (status 'seeds' | 'none') and DetectedSeed/ScannedSeed types
affects:
  - AGD-03-02 (plugin, mcp, the CAPS.maxFiles raise) — builds on the guarded match pass and the seeds channel
  - AGD-03-03 (command, hook, the seventh-detector proof) — extends the same registry array and registry canary
  - Phase 5 / COR-03 — repo_seed rows exist and are written; nothing yet turns them into ingest_job rows

tech-stack:
  added: []
  patterns:
    - Detector isolation is a pipeline property (collectCandidates/safeParse), not a per-detector convention
    - ParseResult widened by adding arms discriminated on the existing `status` field, not a new flag on Detector
    - DetectedSeed (detector-facing, 3 fields) vs ScannedSeed (pipeline-enriched with discoveredFrom/discoveredPath) — same shape as DetectedArtifact vs ScannedPackage
    - A tiny host-recognizing predicate (githubRepoFromUrl) exported from src/github/client.ts so a detector never names "github.com" itself

key-files:
  created:
    - src/detect/run.ts
    - src/detect/run.test.ts
    - src/detect/json.ts
    - src/detect/json.test.ts
    - src/detect/catalog.ts
    - src/detect/catalog.test.ts
    - fixtures/adversarial/marketplace-malformed.json
    - drizzle/0003_flaky_selene.sql
  modified:
    - src/detect/types.ts
    - src/detect/index.ts
    - src/detect/skill.test.ts
    - src/ingest/pipeline.ts
    - src/ingest/pipeline.test.ts
    - src/ingest/types.ts
    - src/ingest/persist.ts
    - src/ingest/persist.test.ts
    - src/db/schema.ts
    - scripts/migrate.mjs
    - src/log.ts
    - src/github/client.ts
    - fixtures/adversarial/README.md

decisions:
  - "match() runs exactly once per repository via a captured DetectorPass array, not twice (needs-collection and the candidate loop both reuse it)"
  - "ScannedSeed carries discoveredFrom/discoveredPath (pipeline-known provenance); DetectedSeed (detector-facing) stays the 3-field shape CONTEXT.md specifies, mirroring DetectedArtifact -> ScannedPackage"
  - "The denylist filter is an in-memory set built from one SELECT ... WHERE full_name = ANY(seed names), not a NOT EXISTS on the insert — the same transaction and guarantee, without depending on an unverified drizzle-orm 0.45.2 where()-on-conflict shape"
  - "detectorErrors/seeds/seedsSkipped are optional log fields, present only when non-empty, so JSON.stringify drops them on a clean run and the existing exact-key-set canary in log.test.ts needed no change"
  - "seedsSkipped was not added to the log line — the count exists only inside catalog.parse()'s own warnings string; plumbing a second count through ParseResult for one detector's log line was not worth the type surface, so it was skipped (see Deviations)"

requirements-completed: [DET-07, DET-03, DET-09, DET-08, QUA-03, QUA-05]

coverage:
  - id: D1
    description: "A throwing detector (match() or parse()) costs only its own candidates; every other detector's findings are stored, and the repository still ingests"
    requirement: "DET-07"
    verification:
      - kind: unit
        ref: "src/detect/run.test.ts#collectCandidates / safeParse describe blocks"
        status: pass
      - kind: integration
        ref: "src/ingest/pipeline.test.ts#detector isolation (DET-07) > stores every skill the reference corpus holds even when a registered detector throws from match()"
        status: pass
    human_judgment: false
  - id: D2
    description: "marketplace.json produces repository seeds and is never stored as a package on the success path; a malformed one produces exactly one failed catalog row and zero seeds"
    requirement: "DET-03"
    verification:
      - kind: unit
        ref: "src/detect/catalog.test.ts (all describe blocks)"
        status: pass
      - kind: integration
        ref: "src/ingest/pipeline.test.ts#catalog (DET-03) (all five tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The pipeline's one-time change (collectCandidates/orderedNeeds/safeParse, the status switch) is complete; Detector is unchanged; the registry canary is rewritten, not deleted"
    requirement: "DET-09"
    verification:
      - kind: unit
        ref: "src/detect/skill.test.ts#the registry > holds one element per artifact type, each a distinct type string"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every new JSON parse path is capped three ways (input bytes, array length at any depth, nesting depth) before anything downstream sees it"
    requirement: "DET-08"
    verification:
      - kind: unit
        ref: "src/detect/json.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D5
    description: "repo_seed is additive, passes the boundary scanner, and is applied to both agentdock and agentdock_test"
    verification:
      - kind: other
        ref: "bun run check:boundaries; bun run db:migrate; bun run db:test:setup; manual psql-equivalent column/row check (see below)"
        status: pass
    human_judgment: false

duration: not machine-timed (single continuous session, no per-task timestamps recorded)
completed: 2026-08-11
status: complete

actuals:
  tokens: 18600
  tasks: 3
  commits: 0
---

# Phase AGD-03 Plan 01: Isolation, the Widened Result, and the Catalog Tracer Summary

Detector isolation became a pipeline property instead of a `skill.ts`-only accident, `marketplace.json` now yields `repo_seed` rows through a JSON manifest parser capped three separate ways, and none of it touches `skill.ts`.

## Not committed

**No `git commit` and no `git push` were run**, per this plan's hard constraint. Everything below is unstaged in the working tree — `git status --porcelain` shows every file as ` M` or `??`, nothing staged. Recommended commit message at the bottom.

## Accomplishments

- `src/detect/run.ts`: one guarded `match()` pass (`collectCandidates`), a round-robin `needs` interleaver (`orderedNeeds`), and a guarded `parse()` (`safeParse`) — all pure, all taking the detector list as a parameter.
- The DET-07 regression was written and **observed to fail against the pre-change pipeline** before any fix landed (see below).
- `pipeline.ts` now calls `match()` exactly once per repository (captured in the `selectPaths` callback, reused by the candidate loop) instead of twice, unguarded.
- `ParseResult` gained `status: 'seeds'` and `status: 'none'` arms, discriminated on the field every arm already carries. `skill.ts` is byte-for-byte unmodified.
- `src/detect/json.ts`: `parseJsonManifest` — byte cap before `JSON.parse`, then an iterative-recursion walk bounded by an explicit depth cap that also enforces the array-length cap at every depth, not just a named field.
- `src/detect/catalog.ts`: the tracer. Matches `.claude-plugin/marketplace.json` by path, parses the six documented source shapes, and returns `status: 'seeds'` for github/url/git-subdir entries and nothing for the other three shapes.
- `agentdock.repo_seed`: additive table, migration `drizzle/0003_flaky_selene.sql`, applied to both `agentdock` and `agentdock_test`.
- Seeds persist inside `persistScan`'s existing transaction, filtered against `repository_denylist`, upserted on `full_name`.
- The `no_artifacts` early return now also checks `seeds.length`, so a catalog-only repository ingests.
- `scripts/migrate.mjs`'s artifact-type seed list carries all six types now (`skill`, `plugin`, `catalog`, `mcp_server`, `command`, `hook`), and its stale comment ("this list only has to carry what the FKs need to exist at all") is corrected to state the real rule: every migration's hand-added `artifact_type` INSERT must be mirrored here, row for row, because `agentdock_test` never sees a `drizzle/` migration's own INSERT.
- The DET-09 registry canary in `skill.test.ts` is rewritten (not deleted) to assert `['skill', 'catalog']` and distinct types, so it still fails the moment someone adds a detector file without registering it.

## The DET-07 regression, observed failing before the fix

Per the plan's Task 1 instruction, the pipeline-level test was written and run **against the unmodified `pipeline.ts`** before `collectCandidates`/`safeParse` were wired in. Actual failure output:

```
FAIL  src/ingest/pipeline.test.ts > ingestRepository > detector isolation (DET-07)
  > stores every skill the reference corpus holds even when a registered detector throws from match()
AssertionError: expected { ok: false, …(3) } to match object { ok: true, found: 18, …(2) }
  {
-   "failed": 0,
-   "found": 18,
-   "ok": true,
-   "stored": 18,
+   "ok": false,
  }
```

A detector planted into `DETECTORS` whose `match()` always throws caused the *entire* pipeline call to return `{ ok: false, outcome: 'storage_failed' }` — the throw propagated out of the `selectPaths` callback, past `fetchRepoScanInputs`, into `pipeline.ts`'s one outer `try/catch`. This is exactly the bug `03-RESEARCH.md`'s "correction" section describes: isolation held only because `skill.parse` catches internally, not because the pipeline guards anything. After wiring `collectCandidates`/`orderedNeeds`/`safeParse` in, the same test passes with `found: 18, stored: 18, failed: 0` and the throwing detector's error recorded in `detectorErrors` instead of aborting the run.

## Corpus measurements taken while implementing

`marketplace.json` found by `catalog.match()`, real corpora, one candidate each (matches the plan's Measurement 1 table):

| corpus | `.claude-plugin/marketplace.json` candidates |
|---|---|
| `anthropics-skills` | 1 |
| `addyosmani-agent-skills` | 1 |
| `baoyu-skills` | 1 |
| `wshobson-agents` | 1 |

None of the four corpora captured the file's *body* (`scripts/capture-fixtures.mjs` is hard-coded to `SKILL.md`, confirmed by `ls fixtures/*/files/ | grep -i marketplace` returning nothing in all four) — `catalog.parse()` is tested with inline strings (Idiom B) throughout, per the plan's Measurement 1 binding.

Six source shapes, one inline fixture (`src/detect/catalog.test.ts`'s `SIX_SHAPES`), seven entries (relative + all six documented `source` shapes plus one non-GitHub `url` to prove the host check, not just the shape check):

| source shape | seed produced? |
|---|---|
| relative (`./plugins/x`) | no — inside this repository |
| `github` (`repo: owner/repo`) | **yes** |
| `url`, `github.com` host | **yes** |
| `git-subdir`, `github.com` host | **yes**, `hint.source.path` carries the subdirectory |
| `url`, non-`github.com` host (`gitlab.com`) | no |
| `npm` | no |
| `archive` | no |

3 of 7 seeded, 4 of 7 not — `catalog.ts`'s warning reads `"4 of 7 entries are not GitHub-reachable and produced no seed"`, asserted verbatim in `catalog.test.ts`.

Malformed-catalog row counts (`fixtures/adversarial/marketplace-malformed.json`, `plugins` is an object rather than an array), through the real pipeline against the `anthropics-skills` corpus (18 skills + 1 catalog file):

```
{ ok: true, found: 19, stored: 19, failed: 1, seeds: 0 }
```

One `package` row, `type = 'catalog'`, `parse_status = 'failed'`, zero `repo_seed` rows. A well-formed marketplace against the same corpus:

```
{ ok: true, found: 18, stored: 18, failed: 0, seeds: 2 }
```

(the two GitHub-reachable entries in that test's marketplace; the third is `relative` and produces no seed) — zero `package` rows of `type = 'catalog'`, two `repo_seed` rows keyed on `full_name`. A subsequent ingest that fixes the marketplace delists the earlier failed `catalog` row (`delisted_at` moves from `null` to non-null) with no special-case code: a parsed catalog contributes no package id to the new run's `packageIds`, so the pipeline's existing generic delisting logic removes it.

## Migration

`drizzle/0003_flaky_selene.sql`, generated with `bun run db:generate`, hand-reviewed (no `CREATE SCHEMA` emitted — the schema already exists from `0000`), hand-extended with the five-row `artifact_type` INSERT (`ON CONFLICT DO NOTHING`), exactly as `0001` was:

```sql
CREATE TABLE "agentdock"."repo_seed" ( ... );
--> statement-breakpoint
CREATE UNIQUE INDEX "repo_seed_full_name_key" ON "agentdock"."repo_seed" USING btree ("full_name");--> statement-breakpoint
INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES
  ('plugin', 'Claude Code Plugin'), ('catalog', 'Plugin Marketplace'),
  ('mcp_server', 'MCP Server'), ('command', 'Slash Command'), ('hook', 'Hook Configuration')
ON CONFLICT DO NOTHING;
```

Additive only: one `CREATE TABLE`, one `CREATE UNIQUE INDEX`, one `INSERT ... ON CONFLICT DO NOTHING`. No `DROP`, no `ALTER` on an existing column, both schema-qualified. `bun run check:boundaries` passed both before and after applying.

Applied to both schemas (`bun run db:migrate`, `bun run db:test:setup`) and verified directly:

```
agentdock artifact_type:      [catalog, command, hook, mcp_server, plugin, skill]
agentdock repo_seed columns:  [id, full_name, source_kind, discovered_from, discovered_path, hint, created_at, updated_at]
agentdock_test artifact_type: [catalog, command, hook, mcp_server, plugin, skill]
agentdock_test repo_seed columns: [id, full_name, source_kind, discovered_from, discovered_path, hint, created_at, updated_at]
```

## Verification run (in the required order)

| Command | Result |
|---|---|
| `bun run check:boundaries` | `4 migration file(s), package.json, 1 schema module, 40 source file(s)` — OK |
| `bun run lint` | `Checked 85 files` — clean (after `biome check --write .` fixed import order/formatting; one leftover unused import in `catalog.test.ts` fixed by hand) |
| `bun run typecheck` | clean |
| `bun run test` | **432 passed** across **23 files**, 0 failed, 0 skipped (database was available; the `describe.skipIf(!DB_URL)` blocks all ran) |
| `bun run ci` | all four gates above, in sequence, all green |

## Deviations from Plan

### Auto-fixed / necessary companion edits

**1. [Rule 2 — missing critical] `scripts/migrate.mjs`'s stale comment and short artifact-type list**

- **Found during:** Task 2, per the plan's own critical-finding callout.
- **Issue:** the seed list only inserted `'skill'`, and the comment claimed "Phase 3's four extra types are added by migration; this list only has to carry what the FKs need to exist at all" — exactly backwards, since `db:test:setup` regenerates `agentdock_test`'s DDL from scratch and never sees the migration's own hand-added INSERT.
- **Fix:** the seed list now inserts all six rows; the comment states the real rule (every migration's hand-added `artifact_type` INSERT must be mirrored here, row for row).
- **Files:** `scripts/migrate.mjs`, `drizzle/0003_flaky_selene.sql`.
- **Verification:** `artifact_type` has all six ids in both schemas (query output above); `persist.test.ts` and `pipeline.test.ts` (both database-backed) pass in full.

**2. [Rule 1 — bug] `src/log.ts`'s `IngestLog` type had no field for detector errors, and the plan's action text explicitly asks for one**

- **Found during:** Task 1, applying the action text "a `detectorErrors: string[]` field on it costs nothing."
- **Issue:** `src/log.ts` is a closed type with an exact-key-set canary in `log.test.ts` (`expect(Object.keys(parsed).sort()).toEqual(KEYS)`), not in this plan's `files_modified`. Adding a required field would break that canary on every existing call site.
- **Fix:** `detectorErrors` (and later `seeds` is on `IngestResult`, not the log line) is an *optional* field, populated in `pipeline.ts`'s `emit()` only when non-empty. `JSON.stringify` drops an `undefined` key entirely, so a clean run's log line has the exact same key set as before and `log.test.ts` needed no change.
- **Files:** `src/log.ts`, `src/ingest/pipeline.ts`.
- **Verification:** `src/log.test.ts` passes unmodified; a manual check that `JSON.stringify({a: undefined})` omits `a` is the mechanism, not a new test.

**3. [Rule 1 — bug] `githubRepoFromUrl` added to `src/github/client.ts`, not in `files_modified`**

- **Found during:** Task 3, implementing `catalog.ts`'s `url`/`git-subdir` seed extraction.
- **Issue:** CONTEXT.md's Reference E says the hostname check "reuses nothing from `src/github/client.ts`... the honest alternative is to export a tiny predicate from `src/github/` and call it" — but `src/github/client.ts` isn't in this plan's `files_modified` list.
- **Fix:** added one exported function, `githubRepoFromUrl(url: URL)`, which checks `hostname === 'github.com'` and reuses `normalizeRepo`'s exact validation rather than re-implementing owner/repo parsing. `check:boundaries` rule 5 (`no-host-sprawl`) never fires because the literal `'github.com'` stays inside `src/github/`.
- **Files:** `src/github/client.ts`.
- **Verification:** `bun run check:boundaries` passes; `catalog.test.ts`'s six-shape tests exercise it directly.

**4. [Rule 1 — bug] `ScannedSeed` (in `src/ingest/types.ts`) instead of reusing `DetectedSeed` verbatim on `RepoScan.seeds`**

- **Found during:** Task 2, wiring `RepoScan.seeds`.
- **Issue:** Reference C says `RepoScan` gains `seeds: DetectedSeed[]`, but `repo_seed`'s `discovered_from`/`discovered_path` columns are `NOT NULL`, and `DetectedSeed` (the detector-facing type, 3 fields: `fullName`, `sourceKind`, `hint`) carries neither — a detector cannot know which repository is being scanned or which of its own candidate paths produced a given seed.
- **Fix:** added `ScannedSeed` to `src/ingest/types.ts` with the two extra provenance fields, filled in `pipeline.ts` at the point where a `'seeds'` result is pushed (`discoveredFrom: fullName` — the repo being scanned — and `discoveredPath: candidate.sourcePath`). This mirrors the codebase's own existing pattern: `DetectedArtifact` (detector-facing) vs. `ScannedPackage` (pipeline-enriched with `blobSha`, `contentHash`, etc.).
- **Files:** `src/ingest/types.ts`, `src/ingest/pipeline.ts`, `src/ingest/persist.ts`, `src/ingest/persist.test.ts`.
- **Verification:** `persist.test.ts`'s `describe('seeds', ...)` block asserts `discovered_from`/`discovered_path` land correctly.

**5. [Rule 1 — bug] `pipeline.test.ts`'s existing raw-fetch-count assertions (18 → 19) and a default marketplace.json stub**

- **Found during:** Task 3, registering `catalog` in `DETECTORS`.
- **Issue:** every existing `pipeline.test.ts` test uses the real `anthropics-skills` tree, which (per Measurement 1) already contains `.claude-plugin/marketplace.json` — but its body was never captured to disk. With `catalog` live, every existing test would either (a) count that path as "skipped" (no captured body), silently flipping `truncated: false` to `true` across the whole file, or (b) if not skipped, add a 19th raw fetch that three existing exact-count assertions (`toHaveLength(18)`) would fail on.
- **Fix:** `stubGitHub()`'s raw-host handler now serves an empty, well-formed marketplace (`{"plugins":[]}`) for `.claude-plugin/marketplace.json` whenever a test doesn't explicitly override it — no package, no seed, no failure, no truncation. Three assertions of `raw.githubusercontent.com` fetch count were updated from `18` to `19` (18 skills + 1 marketplace read), which is now genuinely true rather than stale.
- **Files:** `src/ingest/pipeline.test.ts`.
- **Verification:** all 26 tests in the file pass, including the pre-existing ones whose counts were corrected.

**6. [Rule 1 — bug] Type-narrowing breakage across `skill.test.ts`**

- **Found during:** Task 2, immediately after widening `ParseResult`.
- **Issue:** `skill.test.ts`'s existing `if (!result.ok) return; ... result.artifact` pattern stopped compiling: `result.ok === true` now matches three arms (`ok/partial`, `seeds`, `none`), and only two of those carry `.artifact`/`.warnings`. `skill.ts` itself must stay untouched per the plan, so the type widening is real and correct — the test file's narrowing needed to catch up.
- **Fix:** added one local type-guard helper, `isArtifact(result): result is Extract<ParseResult, {status:'ok'|'partial'}>`, and replaced every `result.ok`-only narrow with it (~20 call sites). No test assertion changed in substance — `skill.parse()` never actually returns `'seeds'`/`'none'`, so this is a compile-time-only fix.
- **Files:** `src/detect/skill.test.ts`.
- **Verification:** `bun run typecheck` clean; all `skill.test.ts` assertions pass unchanged.

### Deliberately skipped (ponytail: documented corner cut)

**`seedsSkipped` was not added to the ingest log line.** Reference C's prose mentions "the log line gains `seeds` and `seedsSkipped`", but no `<behavior>` bullet, `<verify>` command, or `<done>` criterion in any task requires it, and the only place the "not GitHub-reachable" count exists is inside `catalog.ts`'s own `warnings` string — plumbing a second numeric field through `ParseResult` for one detector's benefit was not worth the type surface. `seeds: number` (the count actually persisted) **was** added, to `IngestResult`'s success arm, per the explicit Reference C requirement. `ponytail: log line carries seed count but not the skipped-entry count; add a seedsSkipped field to ParseResult's 'seeds' arm when a second consumer needs it.`

**No pipeline-level `parse()`-throw regression test.** A registered fake detector whose `parse()` throws needs a `type` that satisfies `package.type`'s foreign key to `artifact_type` for its failed row to persist — using a fake type (`'boom'`) crashes the transaction on an unrelated FK violation, and reusing a real type (`'skill'`) makes the test claim something it doesn't test. `safeParse`'s guarantee (`run.test.ts`) and the pipeline's `match()`-throw regression together satisfy `<verification>` item 1 ("Both provable without a database"), so this was not built. Documented as a comment in `pipeline.test.ts` at the point it would have gone.

---

**Total deviations:** 6 auto-fixed/necessary companion edits (2 Rule 1 mechanical corrections to keep existing test canaries valid, 1 Rule 1 plumbing gap in the plan's own reference type, 1 Rule 2 critical-finding fix mandated by the phase brief, 2 Rule 1 fixes for cascading test breakage from the type widening), 2 deliberately skipped items (documented above, neither required by any `<behavior>`/`<verify>`/`<done>` criterion).
**Impact on plan:** All auto-fixes were required for `bun run ci` to pass at all; none add scope beyond what Task 1–3's `<behavior>` lists already specified.

## Requirements satisfied

| ID | Evidence |
|---|---|
| DET-07 | RED failure captured above; GREEN via `collectCandidates`/`safeParse`; both unit-provable (`run.test.ts`) and pipeline-provable (`pipeline.test.ts`) |
| DET-03 | `catalog.ts` returns `status:'seeds'`, never a package, on the success path; malformed → one failed `catalog` row, zero seeds; both proven end to end |
| DET-09 | Registering `catalog` was one import + one array element in `index.ts`; the rewritten registry canary (`skill.test.ts`) fails if a future detector isn't added there |
| DET-08 | `parseJsonManifest`: byte cap before `JSON.parse`, array-length cap at any depth, explicit-depth-bounded walk; `JSON.parse` has no code-execution mechanism |
| QUA-03 / QUA-05 | `run.test.ts`, `json.test.ts`, `catalog.test.ts` all run with no network and no token; `fixtures/adversarial/marketplace-malformed.json` joins the permanent adversarial suite with a README row |

## Known Stubs

None. `seedsSkipped` (see Deviations, "Deliberately skipped") is not a stub in the sense of dead UI wiring — it is a log-line embellishment that was never load-bearing for any of this plan's `<behavior>` bullets.

## Next Phase Readiness

- 03-02 (plugin, mcp, the `CAPS.maxFiles` raise) can extend `DETECTORS` with one import + one array element and extend the registry canary's expected array; the guarded match/parse machinery and the seeds channel are proven working end to end by this plan's tracer.
- 03-03 (command, hook, the seventh-detector proof) has all six eventual types' worth of machinery already exercised once (skill: package path; catalog: seeds path).
- `repo_seed` rows exist and are queryable, but nothing calls `enqueueJob` on them — Phase 5/COR-03's fan-out work is untouched, as required by this phase's anti-goals.
- No blockers. `bun run ci` is green; the migration is applied to both schemas; nothing is staged for commit.

## Recommended commit message (not executed)

```
feat(03-01): guard detector isolation and route marketplace.json to repo_seed

- src/detect/run.ts: one guarded match() pass, round-robin needs, guarded parse()
- ParseResult widened with 'seeds'/'none' arms; skill.ts untouched
- src/detect/json.ts: byte/array-length/depth caps for untrusted JSON manifests
- src/detect/catalog.ts: marketplace.json -> repo_seed, never a package
- agentdock.repo_seed (drizzle/0003_flaky_selene.sql), applied to both schemas
- scripts/migrate.mjs: six-type artifact_type seed list, corrected comment
- pipeline.ts: match() runs once per repo; status switch routes seeds/none/failed/ok
```

## Self-Check: PASSED

- All 8 created files exist on disk (`src/detect/run.ts`, `run.test.ts`, `json.ts`, `json.test.ts`, `catalog.ts`, `catalog.test.ts`, `fixtures/adversarial/marketplace-malformed.json`, `drizzle/0003_flaky_selene.sql`) — confirmed via the tool calls that created them.
- `agentdock.repo_seed` exists in both `agentdock` and `agentdock_test` with the documented 8 columns — confirmed via direct query, output quoted above.
- `bun run ci` passed in full: boundaries OK, lint clean, typecheck clean, 432/432 tests across 23 files.
- `git status --porcelain` shows all 25 changed/new paths with no staged entries (no leading `M`/`A` without a space) — nothing was `git add`ed at any point in this session; no commit or push was run.

---
*Phase: AGD-03-detector-pluralism*
*Plan: 01*
*Completed: 2026-08-11*
