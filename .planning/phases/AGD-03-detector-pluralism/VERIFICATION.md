---
phase: AGD-03-detector-pluralism
verified: 2026-08-11T03:57:22Z
status: passed
score: 6/6 success criteria verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
deferred: []
---

# Phase 3: Detector Pluralism Verification Report

**Phase Goal:** All five artifact types are discovered, and adding a sixth is a one-file change.
**Verified:** 2026-08-11T03:57:22Z
**Status:** passed
**Re-verification:** No — initial verification

This report focuses on the eleven items the orchestrator flagged as unconfirmed by its
own smoke test, per `<verify_specifically>`. Items already established (`bun run
ci`/`build` green, live smoke against `addyosmani/agent-skills`, clean `git status`)
are treated as given and not re-run.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Plugins are detected even when their manifest is absent, via directory shape | ✓ VERIFIED | `src/detect/plugin.ts:143-183` (shape-only match rule, `MIN_SHAPE_COMPONENTS=2`, `isExcludedShapeOnlyRoot`); forced to `status:'partial'`/`meta.detectionConfidence:'shape-only'` at `plugin.ts:191-209` (a hardcoded literal, never conditional on warnings — cannot yield `'ok'`); exercised by `plugin.test.ts:105-231` including synthetic manifest-less trees and the two exclusions, and the negative case at every one of the four real corpora (`plugin.test.ts:113-130`) |
| 2 | A catalog file produces repository seeds rather than being stored as a package | ✓ VERIFIED | `src/detect/catalog.ts` returns `status:'seeds'`, never a package, on the success path; `pipeline.test.ts:614-718` (`catalog (DET-03)`) proves zero package rows + N seed rows for a well-formed marketplace, one failed `catalog` package row + zero seeds for a malformed one, and delisting on repair |
| 3 | MCP server declarations, commands, and hooks are each detected and parsed | ✓ VERIFIED | `src/detect/mcp.ts` (both `.mcp.json`/`server.json` shapes), `src/detect/command.ts` (reuses `parseFrontmatter` unmodified), `src/detect/hook.ts` (both scopes); each unit-tested (`mcp.test.ts`, `command.test.ts`, `hook.test.ts`) and end-to-end in `pipeline.test.ts:819-` against real corpus counts |
| 4 | A malformed artifact is recorded with an explicit parse status and does not fail the rest of the repository | ✓ VERIFIED | Isolation is a pipeline property, not a per-detector accident — see the DET-07 section below. `pipeline.ts` line 238's single `safeParse` call plus `collectCandidates`'s try/catch (`run.ts:23-31`) guard all three former unguarded call sites |
| 5 | Adding a hypothetical new type requires one detector file and one registration | ✓ VERIFIED | `src/detect/run.test.ts:157-218` — a seventh detector (`type:'invented'`), defined only inside the test file, flows through the real `collectCandidates`/`safeParse` and perturbs none of the six real detectors' output. See detailed analysis below |
| 6 | Every detector runs against frozen fixtures with no network access and no token | ✓ VERIFIED | `src/detect/run.test.ts:221-293` — all six detectors over all four frozen corpora with `fetch` stubbed to throw and `GITHUB_TOKEN` stubbed empty; also structurally, `match` has arity 1 for all six |

**Score:** 6/6 ROADMAP success criteria verified, 0 behavior-unverified.

## Detailed Findings, Per Verification Item Requested

### 1. Shape-only plugin detection (criterion 1) — the hard half genuinely works

Read `src/detect/plugin.ts:143-183` in full. `match()` builds two candidate sets:
declared manifests (`.claude-plugin/plugin.json`, any depth) and shape-only roots from
`componentIndex()` (`plugin.ts:83-114`). The shape-only branch applies, in order:
`components.size < MIN_SHAPE_COMPONENTS` (line 170, `MIN_SHAPE_COMPONENTS = 2` at
line 28), `manifestRoots.has(root)` (line 171 — a declared manifest suppresses the
shape-only candidate at the same root, i.e. the manifest overrides the exclusion
rather than double-reporting), and `isExcludedShapeOnlyRoot(root)` (line 172, defined
at lines 133-136: `root === ''` **or** any path segment starting with `.`).

`plugin.parse()` (`plugin.ts:185-211`) branches on `c.needs.length === 0` — the
shape-only signal — and returns a **hardcoded literal** `status: 'partial'` (line 193),
never an expression conditioned on `warnings.length`, so a shape-only result cannot
reach `'ok'` by any code path. `meta.detectionConfidence: 'shape-only'` is set
unconditionally on the same branch (line 206).

Exercised by `plugin.test.ts`: a synthetic manifest-less tree with two component
shapes yields exactly one shape-only candidate (`plugin.test.ts:132-145`); the same
tree with one shape yields nothing (147-150); a dot-prefixed synthetic root with two
shapes still yields nothing (163-169); a manifest overrides both exclusions
(171-182); the repository-root and dot-directory exclusions are asserted against all
four real corpora with zero shape-only hits (113-121); and `plugin.parse — shape-only`
(190-230) asserts `status`/`meta.detectionConfidence`/the warning text end to end.
**Verdict: MET.** The manifest-less path is genuinely implemented and tested, even
though the live smoke repository did not exercise it (its one plugin had a manifest).

### 2. The seventh-detector proof (criterion 5 / DET-09)

`src/detect/run.test.ts:157-182` defines `seventh: Detector = { type: 'invented', ... }`
entirely inside the test file — `git grep -n "'invented'"` confirms no production file
under `src/` references it. The `DET-09` describe block (184-219) pushes
`[...DETECTORS, seventh]` through the real `collectCandidates` (imported from
`./run`, the same module `pipeline.ts` imports) and the real `safeParse`, and asserts
(a) the seventh's own candidate/artifact come out correctly and (b) the six real
detectors' candidate counts are byte-for-byte identical with and without the
seventh present (208-218) — the property that would fail if a detector reached
across into another's candidates or if the pipeline special-cased any real type.

Crucially, `run.test.ts` carries **no** `describe.skipIf(!DB_URL)` wrapper — confirmed
by reading the whole file; the wrapper only appears in `pipeline.test.ts`. Ran it in
isolation (`bun run test src/detect/run.test.ts`, no `DATABASE_URL` manipulation): all
tests pass. This is exactly the reason CONTEXT.md's decision 3 put these helpers in
`src/detect/run.ts` rather than the pipeline. The test's own comment (`run.test.ts:151-156`)
correctly states what it does *not* prove — persistence, which needs an
`artifact_type` migration and was never claimed to be free.
**Verdict: MET.**

### 3. Criterion 4 and DET-07 isolation

`git diff HEAD -- src/ingest/pipeline.ts` confirms the pre-phase code had two
unguarded `match()` call sites and one unguarded `parse()` call site:
- Needs-collection: `(tree) => DETECTORS.flatMap((d) => d.match(tree.entries)).flatMap((c) => c.needs)`
- Candidate loop: `for (const detector of DETECTORS) { for (const candidate of detector.match(inputs.tree.entries)) { ... await detector.parse(candidate, read) ...`

The current code (`pipeline.ts:150-158`) captures one `collectCandidates(DETECTORS,
tree.entries)` pass inside the `selectPaths` callback (`let passes: DetectorPass[] =
[]`, assigned inside the callback), and the candidate loop (`pipeline.ts:225`, `for
(const pass of passes)`) reuses that same array — `match()` now runs exactly once per
detector per repository, and there is exactly one place a throw from `match()` could
occur (inside `collectCandidates`'s own try/catch, `run.ts:25-29`). `parse()` is
called exactly once, at `pipeline.ts:238`, through `safeParse` (`run.ts:60-74`), which
also try/catches.

Behavioral proof: `pipeline.test.ts:565-612` (`detector isolation (DET-07)`) plants a
`match()`-throwing detector into the live `DETECTORS` array and asserts the
repository still ingests all 18 reference skills (`found:18, stored:18, failed:0`).
The 03-01 SUMMARY additionally records the RED failure observed against the
pre-change pipeline (`ok:false` / `storage_failed`) — read and cross-checked against
the diff above; the claim is consistent with what the diff shows was removed.
A pipeline-level `parse()`-throw test was **not** built (see Deviations); the plan's
own `<verification>` item 1 only requires both properties to be "provable without a
database," which `safeParse`'s unit tests (`run.test.ts:118-139`) satisfy — this is a
documented, justified scope reduction, not a gap.
**Verdict: MET.**

### 4. Criterion 6 — DET-10, no network / no token

`run.test.ts:221-293`. `it("every registered detector's match takes exactly one
parameter...")` (222-224) is a structural proof (`match` has arity 1 for all six, so
none can accept a reader/fetcher). The runtime proof (226-292) stubs
`globalThis.fetch` to throw and `GITHUB_TOKEN` to empty, then runs all six detectors
via `collectCandidates`/`safeParse` over all four real frozen corpora
(`fixtures/{slug}/tree.json` + captured file bodies), asserting `pass.error` is
`null` for every pass (270) and `globalThis.fetch` was never called (290). Ran this
file in isolation — passes without a database, confirming it is not silently
skipped.
**Verdict: MET.**

### 5. Criterion 3, hooks specifically — no-hooks-key silence

`src/detect/hook.ts:79-87`: `rawHooks = parsed.data.hooks`; if it is not a
non-array object, `parse()` returns `{ ok: true, status: 'none', reason: ... }` — not
`failed`. `pipeline.ts:243` (`if (result.status === 'none') continue;`) writes no
row for `status:'none'`. Tested three ways in `hook.test.ts` (a realistic
`fixtures/adversarial/settings-no-hooks.json` with `enabledPlugins`/
`pluginConfigs`/`permissions` and no `hooks` key, an empty `hooks:{}` object, and a
settings file with no `hooks` key at all). Confirmed the fixture is realistic, not a
strawman empty object.
**Verdict: MET.**

### 6. Criterion 2 completeness — repo_seed exclusions, denylist, no fan-out

`src/detect/catalog.ts:30-67` (`seedFor`): a bare-string (relative) `source` returns
`null` (line 34); `npm`/`archive`/anything unrecognized falls through to the final
`return null` (line 66); only `source:'github'` (with `normalizeRepo`) and
`source:'url'|'git-subdir'` **restricted to `github.com`** via `githubRepoFromUrl`
(`src/github/client.ts:73-`, the one place the literal `github.com` appears for this
purpose, keeping `check:boundaries` rule 5 satisfied) produce a seed.

Denylist filtering: `src/ingest/persist.ts:206-246`, inside the same `db.transaction`
that also does the package upsert and delisting (confirmed by reading up to
`persistScan`'s `return db.transaction(async (tx) => {` at line 53) — one `SELECT`
of denylisted names matching the seed set, then `if (blockedSeeds.has(...)) continue;`
before each insert. This is the documented Rule-1 deviation from the plan's `where(sql\`not
exists...\`)` sketch (drizzle-orm 0.45.2 apparently could not attach the `where` to
that insert shape); functionally equivalent, same transaction, same guarantee.

No fan-out: `grep -rn "enqueueJob" src/` shows it is only called from
`src/app/actions.ts` (the user-submitted-repo path), never from `persist.ts` or
`pipeline.ts`. `repo_seed` (`src/db/schema.ts:188-207`) has no `status` column and no
`enqueued_at`, matching CONTEXT.md decision 4 exactly.
**Verdict: MET.**

### 7. DET-06 nesting — genuinely tested, not just live-untested

`src/detect/nesting.ts` (`assignParentPaths`) is a pure function reading only
`containerRoot`/`sourcePath`, never `type`. `nesting.test.ts` covers: a
plugin-owned skill vs. a top-level skill (10-24), nearest-of-two-nested-containers
(26-47), a root-declaring container linking nothing (49-62), a container never
parenting itself (64-73), no containers present (75-81), and — the DET-09-in-miniature
proof — an invented container-detector type (`'time-capsule'`) still links its
children (83-105), confirming the pass genuinely names no artifact type.

The corpus-level proof: `pipeline.test.ts:720-817` (`the file budget (DET-06 /
the CAPS.maxFiles raise)`) ingests `wshobson-agents`'s real tree (its real
`plugins/*/skills/*/SKILL.md` nesting) through the real pipeline and asserts 91
plugin rows + 180 skill rows with `truncated:false` at the raised cap, and
`truncated:true` at the old cap of 200 (803-816, mutating `CAPS.maxFiles` in a
try/finally, restored after). This exercises the real nested paths from the largest
corpus even though `parentPath`'s literal value isn't re-asserted in that
integration test — the value-correctness half is covered by the pure unit tests
above and by `persist.test.ts:188-201`'s round-trip test on both the insert and
conflict paths.
**Verdict: MET.**

### 8. Executor deviations — spot-checked

- **`scripts/migrate.mjs` seed list**: confirmed changed (`scripts/migrate.mjs:112-119`
  now inserts all six ids: `skill, plugin, catalog, mcp_server, command, hook`), and
  `drizzle/0003_flaky_selene.sql` independently carries the same five non-skill rows.
  `bun run test` (fresh run, 538/538 passing) confirms no `package_type_artifact_type_id_fk`
  failures, which would be the first symptom if either file had been missed.
- **`Candidate.shapeComponents`**: present in `src/detect/types.ts:22-28`, set only
  by `plugin.ts`'s `match()`, read only by `plugin.ts`'s `parse()`, exactly as
  the 03-02 SUMMARY describes.
- **Corpus count re-measurement**: `plugin.test.ts` computes its expected
  `componentIndex` numbers by calling `componentIndex(corpusTree(slug))` directly
  against the frozen `tree.json` files rather than hardcoding the plan's prose table
  — confirmed at `plugin.test.ts:60-75`. The 70/21 (not 71/20) and 3 (not 4)
  dot-directory counts for `wshobson-agents`/`addyosmani-agent-skills` are computed,
  not copied, so a future edit that disagrees with the trees on disk would fail
  immediately rather than silently drift.
- **Wave 3 adversarial substitution**: `fixtures/adversarial/hooks-malformed.json`
  is a syntactically valid top-level JSON array (mirrors `plugin-malformed.json`'s
  precedent) rather than genuinely broken JSON syntax — confirmed the file parses
  under `JSON.parse` but fails `parseJsonManifest`'s "manifest is not a JSON object"
  check, and the genuinely-invalid-JSON case is tested inline in `hook.test.ts`
  (Idiom B), matching the stated precedent in `plugin.test.ts`/`mcp.test.ts`.
**Verdict: all spot-checked deviations MET as claimed.**

### 9. Anti-goal compliance

- No capability detection: `grep -rniE` for `safe|clean|verified|trusted|approved|
  risk.?score|safety.?verdict` across `src/detect/*.ts` and the ingest pipeline
  returns only benign comment usages ("a clean run's log line", "trusted to Phase
  5", "not verbatim-verified") — none is a risk verdict on an artifact.
- MCP `command`/`args`/hook `command` are stored verbatim: confirmed in `mcp.ts:56-60`
  (comment: "Stored verbatim, never interpreted... CAP-05") and `hook.ts:109-117`
  (comment: "Stored, never interpreted: no splitting on shell metacharacters, no URL
  extraction, no flag").
- No UI changes: `git status --porcelain` (43 paths, matches the orchestrator's own
  count) shows zero files under `src/app/` or `src/components/` except the pre-existing
  Phase 2 work already committed separately — the phase's own diff touches only
  `detect/`, `ingest/`, `db/schema.ts`, `github/{client,scan}.ts`, migrations,
  fixtures, `scripts/migrate.mjs`, and three README sentences.
- No seed→job fan-out: confirmed above (item 6).
- No search integration: no changes to any query/search file.
- No plugin-framework abstraction: `grep -rn "class \|extends \|Factory\|abstract "
  src/detect/*.ts` (excluding tests) returns nothing.
**Verdict: MET, no drift.**

### 10. Constraint compliance

- Migrations: `drizzle/0003_flaky_selene.sql` (one `CREATE TABLE`, one
  `CREATE UNIQUE INDEX`, one `INSERT ... ON CONFLICT DO NOTHING`) and
  `drizzle/0004_complete_the_professor.sql` (one `ALTER TABLE ... ADD COLUMN`) — both
  `agentdock`-schema-qualified, no `DROP`/`REVOKE`. `bun run check:boundaries` passes
  (fresh run: "5 migration file(s), package.json, 1 schema module, 45 source
  file(s) — OK").
- No new runtime dependencies: `git diff HEAD -- package.json` is empty.
- No `eval`/`Function`/`child_process`/`node:vm`/dynamic import of repository
  content: confirmed via grep across `src/detect/*.ts` and `src/ingest/*.ts`
  (excluding tests) — zero hits.
- Phase 2 invariants: not independently re-derived here (out of this review's scope
  per the orchestrator's own already-established list), but `bun run ci`
  (538 tests / 28 files, all passing, freshly re-run) includes the full Phase 1/2
  suites, which the phase's own SUMMARYs report running at the end of every task.
**Verdict: MET.**

### 11. Carried items (not gaps — explicitly deferred, documented in both SUMMARYs)

- **`src/ingest/errors.ts`'s `no_artifacts` message is now materially false.**
  Confirmed at `src/ingest/errors.ts:51-53`: *"AgentDock found no SKILL.md files in
  that repository. It currently indexes Agent Skills only."* This is user-facing
  text shown when a repository has no detectable artifact of any of the six types,
  and the second sentence is no longer true — the product detects six types, not
  one. Both 03-02 and 03-03 SUMMARYs record this as a deliberate, documented
  deferral (not in either plan's `files_modified`, no task criterion touches it).
  It is not a stub and not a functional gap — the outcome itself (`no_artifacts`)
  is still correctly triggered — but it is a user-visible inaccuracy that should be
  fixed in the next phase that touches `errors.ts`, or as a trivial standalone fix.
- **`seedsSkipped` was not added to the ingest log line** (03-01, documented
  `ponytail:`-style deferral) — the skipped-seed count exists only inside
  `catalog.ts`'s own warning string, not as a separate structured log field. No
  behavior or test requires it; purely an observability nicety left for later.

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/detect/run.ts` | guarded match/parse pass, round-robin needs | ✓ VERIFIED | 74 lines, matches CONTEXT.md Reference B verbatim |
| `src/detect/json.ts` | 3-cap JSON doctrine | ✓ VERIFIED | byte/array-length/depth caps, `JSON.parse`-only |
| `src/detect/catalog.ts` | marketplace.json → repo_seed | ✓ VERIFIED | 127 lines, six source shapes handled |
| `src/detect/plugin.ts` | manifest + shape-only plugin detection | ✓ VERIFIED | 296 lines |
| `src/detect/mcp.ts` | both MCP declaration shapes | ✓ VERIFIED | 181 lines |
| `src/detect/nesting.ts` | generic containment pass | ✓ VERIFIED | 41 lines, no type name anywhere |
| `src/detect/command.ts` | flat-file commands via shared frontmatter parser | ✓ VERIFIED | 141 lines |
| `src/detect/hook.ts` | both hook scopes | ✓ VERIFIED | 155 lines |
| `src/db/schema.ts` (`repoSeed`, `parentPath`) | additive schema changes | ✓ VERIFIED | no status column, not in identity key |

## Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `pipeline.ts` | `run.ts` | single `collectCandidates`/`safeParse` call sites (was two `match()` + one unguarded `parse()`) | ✓ WIRED |
| `pipeline.ts` | `persist.ts` | `scan.seeds` rides the existing transaction | ✓ WIRED |
| `persist.ts` | `db/schema.ts` | `repoSeed` upsert filtered against `repository_denylist` | ✓ WIRED |
| `plugin.ts` | `nesting.ts` | `containerRoot` set by plugin, read generically | ✓ WIRED |
| `scripts/migrate.mjs` | `drizzle/0003_*.sql` | six-type `artifact_type` seed list mirrored | ✓ WIRED |

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| DET-02 | ✓ SATISFIED | `plugin.ts`, `plugin.test.ts` |
| DET-03 | ✓ SATISFIED | `catalog.ts`, `pipeline.test.ts` catalog block |
| DET-04 | ✓ SATISFIED | `mcp.ts`, `mcp.test.ts` |
| DET-05 | ✓ SATISFIED | `command.ts`, `hook.ts` |
| DET-06 | ✓ SATISFIED | `nesting.ts`, file-budget integration test |
| DET-07 | ✓ SATISFIED | `run.ts` guards, isolation regression test |
| DET-09 | ✓ SATISFIED | `run.test.ts` seventh-detector proof |
| QUA-03 / QUA-05 | ✓ SATISFIED | all detectors unit-tested, adversarial suite grew by 5 fixtures |

No orphaned requirements found against `.planning/ROADMAP.md`'s Phase 3 requirement
list (`DET-02, DET-03, DET-04, DET-05, DET-06, DET-07, DET-09, QUA-03, QUA-05`). The
phase plans additionally self-tag DET-08 and DET-10, which are formally mapped to
Phase 1 in `REQUIREMENTS.md`'s tracking table but whose substance (JSON safe-parsing,
no-network detectors) is exactly what ROADMAP success criteria 4 and 6 ask for here —
extra coverage, not a scope violation.

## Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX` markers found in any file this phase touched
(`grep -rn "TBD\|FIXME\|XXX" src/detect/*.ts src/ingest/pipeline.ts src/ingest/persist.ts
src/db/schema.ts` — no hits). The two carried items above are informational, not
debt markers, and are explicitly documented in both plan SUMMARYs rather than hidden.

## Human Verification Required

None. Every truth in this phase is observable through code, tests, or direct
database/query inspection; nothing in this phase touches UI, visual rendering, or
real-time behavior.

## Gaps Summary

No gaps. All six ROADMAP success criteria are met with code-level evidence beyond
the executor summaries' own claims. The two carried items (the stale `no_artifacts`
message, the missing `seedsSkipped` log field) are pre-existing, explicitly
documented, non-blocking deferrals — recorded here for the next phase's awareness,
not as verification failures.

---

*Verified: 2026-08-11T03:57:22Z*
*Verifier: Claude (gsd-verifier)*
