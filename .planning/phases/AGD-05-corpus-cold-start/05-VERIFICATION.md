---
phase: AGD-05-corpus-cold-start
verified: 2026-08-12T09:20:00Z
status: human_needed
score: 16/16 truths verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open the home page (bun run dev) and confirm it renders 'Browse all N skills' with N at or above 500, sourced from countPackages()."
    expected: "N = 921 (or the live count at time of check), consistent with countPackages() measured directly against the dev DB during this verification."
    why_human: "Server-rendered visual output; no browser tool was available in this verification session and no dev server was running to curl."
  - test: "Open the repository page for davila7/claude-code-templates and confirm it shows the partial-read/truncation notice and an artifact count at or near 400 rather than 250."
    expected: "The 'AgentDock read part of this repository...' notice renders, and 400 (of 402 held) artifacts are shown, not capped at 250."
    why_human: "Same as above — requires rendering the page in a browser; the underlying data (tree_truncated=true, CAPS.maxFiles=400 sourced limit) was confirmed by direct query/code read, but the rendered page itself was not."
  - test: "Open a repository page with excluded artifacts (e.g. frumu-ai/tandem, confirmed live to hold 22 of 121 artifacts excluded) and confirm the muted disclosure line reads as a statement of fact, not a quality judgment."
    expected: "Text in the register of '22 of these are on this page and not in AgentDock's listings elsewhere: ... byte-identical to an artifact AgentDock already lists; ... a file whose frontmatter AgentDock could not read. Each one is still readable here.' — no verdict vocabulary, no ranking language."
    why_human: "Rendered-page judgment call (tone/register), even though the source strings were mechanically checked against check-boundaries.mjs rule 6 and pass."
  - test: "05-04's own blocking checkpoint:human-verify task (5 items) was never resumed with an 'approved' signal — no UAT artifact exists in the phase directory."
    expected: "A maintainer runs the 5-step checklist in AGD-05-04-PLAN.md's checkpoint and either types 'approved' or names a discrepancy."
    why_human: "This is a plan-declared blocking gate (type=checkpoint:human-verify) whose resume-signal was never recorded; 3 of its 5 items (home page render, davila7 render, fork/duplicate copy render) remain unverified in a browser as of this verification."
---

# Phase 5: Corpus & Cold Start Verification Report

**Phase Goal:** The index holds enough real artifacts to be worth searching, acquired without a crawler.
**Verified:** 2026-08-12
**Status:** human_needed
**Re-verification:** No — initial verification

## Summary judgment

Every mechanically-checkable claim in this phase's five plans and five SUMMARYs was
re-derived independently in this session — not read and trusted. `bun run ci` was re-run
live (52 files / 883 tests / boundaries OK / biome clean / tsc clean), `countPackages()` was
called directly against the live dev database (921 listed / 1,137 held, matching the
SUMMARYs exactly), a suppressed package was confirmed live to be absent from `listPackages`
but present via `getRepositoryPackages`, `git diff` confirmed the four detector files are
byte-identical, and the precision test's kill-line/recompute logic was read and re-run.
**No fabricated number was found.** The phase's own working style — falsify claims by
running them, not by reading them — held up under a second, independent pass.

The one thing that could not be verified in this session is the rendered browser output the
phase's own `05-04` plan made a **blocking** `checkpoint:human-verify` gate for. That
checkpoint was never resumed (no "approved" signal, no UAT artifact), and the executor's own
summary says so explicitly ("Needs a human: items 1, 3 and 4"). No dev server was running in
this environment and no browser tool was available, so this verification could not close
that gap either. That is the sole reason this report is `human_needed` rather than `passed`
— every underlying fact the checkpoint would confirm was independently checked at the data
layer and is correct; only the rendered page itself is unconfirmed.

## Goal Achievement

### ROADMAP Success Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | MCP registry synced without consuming GitHub quota | ✓ VERIFIED | `src/registry/client.ts` (`ALLOWED_HOSTS = {registry.modelcontextprotocol.io}`, no token header); `src/registry/sync.test.ts:150-151` asserts captured hosts exclude `api.github.com`; live: SUMMARY 05-01 records core unchanged (57→57) across a `--no-enqueue` registry run. |
| 2 | Operator seed list bulk-populates the index unattended | ✓ VERIFIED | `config/seeds.json` (15 seeds, 2 link lists, 6 rejected, confirmed present and parseable: `node -e` read it live); `src/corpus/seedList.ts` loads/validates/normalizes; `scripts/corpus-sync.mjs --source=seeds` drives one command end to end (05-02, 05-04 SUMMARYs record live runs). |
| 3 | Catalog files fan out into further repository seeds | ✓ VERIFIED | `src/corpus/fanout.ts` + `src/corpus/fanout.test.ts` (DB-backed integration block, re-run live in this session: 43/43 tests pass in `fanout.test.ts`+`seeds.test.ts`+`packages.test.ts`); live DB: `wshobson/agents` produced 4 `git-subdir` seeds (`discovered_from='wshobson/agents'`), confirmed present in the live `repo_seed` table queried in this session. |
| 4 | Topic search sharded so the result cap does not silently truncate coverage | ✓ VERIFIED (redefined, intent preserved) | `src/github/search.ts` (`shardLadder`, `subdivide`, `STAR_CEILING` guard) + `src/corpus/search.ts` (`unreachableShards`, `belowFloorShards`, both surfaced and printed, never silently dropped). The 05-CONTEXT/05-03 redefinition — name every shard and its measured size instead of claiming to enumerate 57,970 repositories — is judged to satisfy the criterion's stated intent ("does not silently truncate coverage"): the sweep never pages a shard to 1,000 and abandons it, and a second live-measured gap (the *below-floor* region reporting nothing) was found and closed with its own `belowFloorShards` category — the same "report what you skipped" discipline applied a second time on the same criterion. See "Criterion 4" note below for the residual judgment call. |
| 5 | At least 500 parsed artifacts exist | ✓ VERIFIED | `countPackages()` called live in this session: **921**. Matches 05-04-SUMMARY exactly. `notListedBecause` breakdown confirmed live: 921 listed / 1,137 held / 16 repositories / 0 forks, matching the orchestrator's pre-verification numbers exactly. |
| 6 | Forks/duplicates do not flood listings; suppression is read-time and never alters stored data | ✓ VERIFIED | `NOT_LISTED_BECAUSE` in `src/db/queries/packages.ts:127-149` is a pure `sql<...>` CASE expression used only inside `SELECT`/`WHERE` clauses of `listPackages`/`countPackages`; `git grep` for `UPDATE`/tombstone/canonical-flag writes touching packages/repository in the corpus/db-query code found none. `packages.test.ts:393-415` ("leaves every stored row byte-identical after every listing query") — read and confirmed present; full suite passes. |
| 7 | A submitted repository below the visibility floor is reachable by direct link but absent from listings | ✓ VERIFIED | Live in this session: `getRepositoryPackages('frumu-ai','tandem')` → 121 total, 22 with `notListedBecause !== null`; `listPackages({fullName:'frumu-ai/tandem'})` → 99 rows (121 − 22). Confirms COR-07's two halves agree exactly. |

### COR-01 … COR-07, DAT-07

| Req | Status | Evidence |
|---|---|---|
| COR-01 | ✓ VERIFIED | See criterion 1. |
| COR-02 | ✓ VERIFIED | See criterion 2. |
| COR-03 | ✓ VERIFIED | See criterion 3 + `05-01` tracer (registry seed → job → 121 rendered artifacts, recorded with exact commit/job ids). |
| COR-04 | ✓ VERIFIED | `src/corpus/links.ts` extracts via `githubRepoFromUrl` only, no host literal (`git grep -n "github.com" src/corpus/links.ts` → none); `raw.githubusercontent.com`-only host capture asserted in `links.test.ts`. |
| COR-05 | ✓ VERIFIED (see criterion 4) | |
| COR-06 | ✓ VERIFIED | See criterion 5. |
| COR-07 | ✓ VERIFIED | See criterion 7; UI copy verified clean of verdict vocabulary (below). |
| DAT-07 | ✓ VERIFIED | See criterion 6. |
| CAP-13 | ✓ VERIFIED | See "CAP-13 record" below. |

**Score:** 16/16 must-have truths verified (7 ROADMAP criteria + 9 requirement IDs, deduplicated by shared evidence). 0 behavior-unverified. 0 overrides.

---

## Deep-dive: the six items called out by name

### 1. Success criteria — see table above. All seven verified.

**On criterion 4 specifically:** the plan's own redefinition is honest about what changed and why (05-CONTEXT C11, reasoned from a live measurement: `topic:claude-code` = 57,970 repos, 63% at 0-1 stars, two indivisible star buckets each ~18x the 1,000-result cap). I judge this to satisfy intent rather than quietly miss it, for three independently-checkable reasons:
- The code never truncates a shard to 1,000 and moves on — `walkShard` in `src/github/search.ts:264-273` returns `overCap: true` and stops at exactly one request the moment `totalCount > RESULT_CAP`, and the caller in `src/corpus/search.ts:172-186` either subdivides or names the shard `unreachableShards` with its measured size. This is mechanically distinct from silent truncation.
- A second, unplanned instance of the same silence was caught live during execution (05-03 SUMMARY: reporting only `unreachableShards` at the shipped floor of 10 stars would print zero unreachable shards while skipping 49,926 of 57,970 repositories in one topic — because the *floor* itself, not the cap, is where the coverage gap actually lives) and closed with an additional `belowFloorShards` category, spending one extra request per topic. This is evidence the "name everything you skip" discipline was genuinely internalized, not applied once and declared done.
- Live-measured zero core cost for the whole mechanism (`core 40/60 → 40/60` across an 8-request search sweep, re-affirmed by a second 28-request run) means the interpretation costs nothing to be wrong about — the sweep can be pointed at a lower `searchMinStars` later without an architecture change if a maintainer decides the trade should shift.

### 2. DAT-07's "can never corrupt stored data"

Confirmed genuinely read-time. `NOT_LISTED_BECAUSE` (`src/db/queries/packages.ts:127`) is referenced only inside `.select(...)` and `.where(...)` clauses of `listPackages` and `countPackages`; no `UPDATE`, tombstone column, or canonical flag was introduced anywhere in `05-03`'s files (`packages.ts`, `packages.test.ts`, `page.tsx`, `escaping.test.tsx` — read in full). The `packages.test.ts:393-415` byte-snapshot test (`leaves every stored row byte-identical after every listing query`) is present and was included in the 883-test run confirmed live in this session. `schema.ts` diff shows no new column for suppression state.

### 3. COR-07 not a quality judgment

`src/app/r/[owner]/[repo]/page.tsx` (read in full) uses only location/measurement language: `A fork on GitHub`, `byte-identical to an artifact AgentDock already lists`, `a file whose frontmatter AgentDock could not read`. `bun run check:boundaries` (re-run live) passes with `15 UI file(s) scanned for verdict vocabulary` and `OK`. The rule's `VERDICT_WORDS` list (`safe, clean, verified, trusted, approved, malicious, grade, risk score`) and its `SANCTIONED` exemption list (`scripts/check-boundaries.mjs:311-325`) were read directly: the only "safe"/"verified" strings remaining in `src/app/layout.tsx` and `src/app/r/[owner]/[repo]/[...path]/page.tsx` are the four exact CAP-09 disclaimer sentences on the `SANCTIONED` allow-list — confirmed by grepping both files and matching the strings character-for-character against the rule's own ledger. No phase-5 file introduces a new "safe"/"verified"/"trusted" occurrence.

### 4. CAP-13 record

`fixtures/capability-precision.md` was read in full and carries: the `npx`/`not-npx` split each at 15% (lines 32-33), the `declaredCapabilities` history including the intermediate 70%/50.9% failure and the fixed 0% (lines 25, 34, and the narrative section starting "declaredCapabilities — CAP-02's own honest state"), dual-labelled `install` rows under both readings (`keep-positive`/`reject-positive` table), and `observedRemoteExecution`/`observedHiddenContent` recorded as "0 (no real instance)" — never a bare 0% — across both v1 and v2 rows. `src/analyze/precision.test.ts` was read and re-run live (3/3 tests pass): it mechanically recomputes every row's hit count against its declared corpus set and mechanically enforces the 20% kill line bidirectionally (a row ≥20% must say "deleted"; a row <20% must not). **`git status`/`git diff` confirm `src/analyze/install.ts`, `network.ts`, `shell.ts`, `hidden.ts` are absent from the working tree diff — byte-identical to their pre-phase state**, exactly as claimed. (Two other detector files, `src/detect/skill.ts` and `src/detect/command.ts`, were modified — that is the tokenizer fix in item 5 below, correctly outside the "no detector pattern changed" scope which the plan and SUMMARY both limit to the `src/analyze/` capability analyzers, not the `src/detect/` artifact parsers.)

### 5. Tokenizer fix's blast radius

`toolTokens` (`src/detect/skill.ts:38`, depth-aware paren-tracking version) is now the single implementation; `src/detect/command.ts:2` imports it and its former byte-identical private copy was deleted (confirmed via `git diff` on both files). No Phase 3 assertion moved: `git diff src/detect/skill.test.ts` shows the change is purely additive (one new `it(...)` block covering the new depth-aware cases plus regression cases for shapes that already worked); the pre-existing `'Read Write, Bash' → ['Read','Write','Bash']` assertion is unchanged. Live re-run in this session: `src/detect/skill.test.ts`, `src/detect/command.test.ts`, `src/analyze/declared.test.ts` — 64/64 pass. Full suite (883/883) also passes with these files in their current state, confirming no downstream Phase-3-owned assertion (skill/command parsing) regressed.

### 6. Five falsified plan claims — each verified fixed in code with a regression test

| # | Claim that broke | Fix location | Regression test confirmed present |
|---|---|---|---|
| 1 | Registry watermark advancing on a partial/capped pass would hide unreached names forever | `src/db/queries/syncState.ts` (`schema_meta` key `corpus_sweep:mcp-registry`, advances only on `stoppedBecause==='exhausted'`) | `src/registry/sync.test.ts:307-347` — "does NOT advance when the sweep stopped at its page cap" + seed_cap/parse_failure siblings, read directly. |
| 2 | Global FIFO seed ordering meant 7,971 registry seeds sat ahead of every operator seed (319 capped invocations / 11 days to reach the densest repo) | `src/db/queries/seeds.ts:103` (`unenqueuedSeeds(limit, only?)`) + `src/corpus/fanout.ts:40` (`fanOutSeeds({..., only})`) | `nameScope` function present with empty-set-selects-nothing semantics; used live and correctly in `scripts/corpus-sync.mjs`'s `--source=seeds` path per 05-02/05-04 live runs. |
| 3 | The floor predicate `<> 'ok'` would have left 469 listed (below COR-06's 500) and mislabeled 353 successfully-parsed `partial` artifacts as unparseable | `src/db/queries/packages.ts:129` (`= 'failed'`, not `<> 'ok'`) | `src/db/queries/packages.test.ts` — "does not treat a partially parsed artifact as unlisted" style assertions present (grepped `'partial'`/`'failed'` cases at lines 135-170); full test file passes live (43/43 combined with fanout/seeds). |
| 4 | `db:test:setup` was claimed (twice, in the plan) to empty `agentdock_test`; it is a no-op once schema matches | `scripts/test-reset.mjs` + `bun run db:test:reset` (`TRUNCATE ... RESTART IDENTITY CASCADE`, schema name hardcoded, `current_database()` asserted) | `package.json:27` registers `db:test:reset`; script reads as described, confirmed via direct read; no test file needed since this is an operational script, but its own internal safety assertion (`current_database() === 'mcpdb'`) functions as a guard. |
| 5 | `bodies: 'all'` in `scripts/capture-fixtures.mjs` would have thrown on `disler/claude-code-hooks-mastery` (0 SKILL.md) and silently captured zero commands from `anthropics/claude-code` (the repo chosen specifically for its commands) | Per-pin `select` field; new `artifacts` selector reuses `collectCandidates`/`orderedNeeds` from `src/detect/run.ts`, confirmed by direct read of `scripts/capture-fixtures.mjs:20,45-46` | The script's own load-bearing permalink assertion (sha resolves as a commit, `blob/<sha>/path` returns 200) is the check; SUMMARY records it passing for all three new pins, and `fixtures/anthropics-claude-code/`, `fixtures/disler-hooks-mastery/`, `fixtures/obra-superpowers/` are present in the working tree with the expected file counts (46/22/17), confirmed via `ls`. |

### 7. Honest gaps recorded, not smoothed

- **Fork suppression, zero real positives:** stated in `05-03-SUMMARY.md` and `05-04-SUMMARY.md` ("Fork suppression still has zero real positives across sixteen repositories"), and independently reconfirmed live in this session (`select count(*) from repository where is_fork=true` → **0**). Not stated as a clean pass anywhere; the code comment at `src/db/queries/packages.ts` describes the mechanism, not a false claim of validation.
- **`network_request` gained zero hits from a doubled corpus:** `fixtures/capability-precision.md:35,220` — "15% on no new evidence" / "network_request stays at 2/13 = 15% on ZERO new evidence" — explicit, not glossed over.
- **`install` detects 0 of 6 real `npm ci` occurrences:** `fixtures/capability-precision.md:343-346` records the recall table naming exact `corpus/file:line` addresses for all 6 misses (`addyosmani-agent-skills skills/ci-cd-and-automation/SKILL.md:82,126,150,338,347,356`).
- **`anthropics/skills` reads truncated despite all 19 candidates being readable:** `05-04-SUMMARY.md` — "The count itself is destroyed... anthropics/skills... reports truncated with 19 candidate paths against a cap of 400... nothing was over any cap... All 19 candidates were re-fetched by hand for this summary and all 19 read cleanly." Recorded as a real defect (`artifactsTruncated` conflating three unrelated causes at `src/github/scan.ts:122`), carried forward as a known ceiling, not fixed in this phase and honestly labeled as such (correctly out of scope — a logging/attribution change, not required by any of this phase's requirements).

All four are written into artifacts that persist in the repository (`fixtures/capability-precision.md`, which will be committed, and the phase's `SUMMARY.md` files, which are permanent `.planning/` history) — not only spoken in a chat transcript that disappears.

---

## Anti-patterns scan

`grep -n "TBD\|FIXME\|XXX"` and `TODO\|HACK\|PLACEHOLDER` across the phase's changed/created files (`src/registry/`, `src/corpus/`, `src/db/queries/{seeds,syncState,packages}.ts`, `src/github/search.ts`, `scripts/corpus-sync.mjs`, `scripts/test-reset.mjs`) found no unresolved debt markers. Deliberate simplifications are marked with `ponytail:` comments naming a measured ceiling and an upgrade trigger (e.g., `ponytail: CREATE INDEX ON package_version (content_hash)` in `packages.ts:122`, unindexed anti-join notes in `seeds.ts`) — consistent with this project's own convention, not a hidden gap.

## Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| COR-01 | 05-01 | ✓ SATISFIED | See table above. |
| COR-02 | 05-02 | ✓ SATISFIED | See table above. |
| COR-03 | 05-01, 05-02 | ✓ SATISFIED | See table above. |
| COR-04 | 05-02 | ✓ SATISFIED | See table above. |
| COR-05 | 05-03 | ✓ SATISFIED | See criterion 4 discussion. |
| COR-06 | 05-04 | ✓ SATISFIED | See table above. |
| COR-07 | 05-03 | ✓ SATISFIED | See table above. |
| DAT-07 | 05-03 | ✓ SATISFIED | See table above. |
| CAP-13 | 05-05 | ✓ SATISFIED | See item 4 above. |

No orphaned requirements: `.planning/REQUIREMENTS.md`'s Phase-5 mapping (COR-01…COR-07, DAT-07) matches exactly what the five plans' `requirements:` frontmatter declares, plus CAP-13 from the phase brief (correctly captured as `05-05`, outside the ROADMAP's original three-plan text but declared in `05-CONTEXT.md` and STATE.md's carried-forward table).

## Human Verification Required

1. **Home page renders `Browse all N skills`, N ≥ 500.** Data-layer value confirmed live (`countPackages()` = 921); rendering not confirmed — no dev server running, no browser tool available in this session.
2. **`davila7/claude-code-templates` repository page shows the partial-read notice and ~400 (not 250) artifacts.** Underlying data confirmed (`tree_truncated=true`, limit sourced from `CAPS.maxFiles=400`); rendering not confirmed.
3. **A repository page's exclusion-disclosure line reads as fact, not judgment, when actually rendered.** Source strings mechanically checked (rule 6 passes, `git diff` shows exact copy); the *visual* register was not independently eyeballed in a browser.
4. **05-04's own blocking `checkpoint:human-verify` was never resumed.** No "approved" signal, no UAT file exists in `.planning/phases/AGD-05-corpus-cold-start/`. This is the phase's own declared gate for exactly the three items above, and it remains open per the executor's own summary ("Needs a human: items 1, 3 and 4").

## Gaps Summary

No code-level, test-level, or data-level gap was found. Every mechanically verifiable
claim across all five plans checked out on independent re-derivation, including the
kind of live measurement this phase's own workflow repeatedly demonstrated it takes
seriously (watermark semantics, seed ordering, the visibility floor, `db:test:setup`,
fixture capture, and the tokenizer fix were all caught by *running* the code during
execution, not by reading it — and every one of those fixes was re-confirmed present
and tested in this session). The sole open item is procedural: a blocking
`checkpoint:human-verify` task that the plan itself defined was never resumed with a
human's "approved," and this verification pass had no browser/dev-server available to
close it in its place. Recommend a maintainer run `bun run dev` and the five-item
checklist in `AGD-05-04-PLAN.md`'s checkpoint before treating the phase as fully closed.

---

*Verified: 2026-08-12*
*Verifier: Claude (gsd-verifier)*
