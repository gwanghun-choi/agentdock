---
phase: AGD-04-capability-disclosure
plan: 02
subsystem: capability-analysis
tags: [declared-capabilities, network-classification, remote-execution, redos-lock, capability-precision, cap-13]
status: complete

requires:
  - phase: AGD-04-capability-disclosure
    plan: 01
    provides: "src/analyze/{types,lines,run,index}.ts, the Analyzer type, ANALYZE_CAPS, CAPABILITY_CATEGORIES, the install analyzer and its corpus-loading test convention"
provides:
  - src/analyze/declared.ts — declaredCapabilities, the declared channel (allowed-tools tokens verbatim + meta.servers[].command + meta.handlers[].command), never decomposing a coarse grant, never reading envKeys
  - src/analyze/network.ts — observedNetwork, the request-versus-reference URL split with the named xmlns exclusion
  - src/analyze/shell.ts — observedRemoteExecution, the narrow remote-execution literal shape
  - src/analyze/redos.test.ts + fixtures/adversarial/redos-line.md — the CAP-14 lock as a runnable test over a committed hostile fixture
  - scripts/capability-precision.mjs — reproduces the CAP-13 labelling sample per analyzer, per category
  - fixtures/capability-precision.md — the CAP-13 audit record: one row per shipped analyzer plus the already-deleted html_comment_naive row
  - src/analyze/precision.test.ts — the mechanized kill switch (coverage, drift, kill-line)
  - toolTokens exported from src/detect/skill.ts (was private), reused by declared.ts rather than re-implemented
affects:
  - AGD-04-03 (hidden content) — appends its own row(s) to the same fixtures/capability-precision.md and registers into the same ANALYZERS array
  - AGD-04-04 (full panel, backfill) — the declared/observed two-section split and the "not checked" copy for observedRemoteExecution both read directly from this plan's analyzer output and precision rows

tech-stack:
  added: []
  patterns:
    - "declared.ts reads only already-parsed structured data (frontmatter['allowed-tools'] via the reused toolTokens, meta.servers[].command, meta.handlers[].command) — never a text scan, never sharing a category with the observed-capability analyzers"
    - "network.ts and shell.ts follow install.ts's shape exactly: scanLines + a bounded regex with a negated-class terminator, no nested quantifier, evidence capped at ANALYZE_CAPS.maxEvidenceChars"
    - "capability-precision.mjs groups a multi-category analyzer's hits by category before sampling, because CONTEXT.md's own decision 6 records a separate precision claim per category (network_request vs external_reference) from one analyzer function"
    - "precision.test.ts's kill-line assertion is the inverse relationship, not a blanket '<20%' check: rate >= 20% requires verdict 'deleted', rate < 20% requires verdict not 'deleted' — this is what lets the already-earned 100% html_comment_naive row coexist with the mechanical gate in the same file"

key-files:
  created:
    - src/analyze/declared.ts
    - src/analyze/declared.test.ts
    - src/analyze/network.ts
    - src/analyze/network.test.ts
    - src/analyze/shell.ts
    - src/analyze/shell.test.ts
    - src/analyze/redos.test.ts
    - src/analyze/precision.test.ts
    - scripts/capability-precision.mjs
    - fixtures/capability-precision.md
    - fixtures/adversarial/redos-line.md
    - fixtures/adversarial/allowed-tools-coarse.md
  modified:
    - src/analyze/index.ts
    - src/detect/skill.ts
    - fixtures/adversarial/README.md
    - package.json

decisions:
  - "toolTokens exported from skill.ts rather than duplicated a third time (command.ts already duplicates it once) — declared.ts imports it directly, so the string-or-list tolerance has one implementation feeding two call sites instead of drifting between three"
  - "network_request measured at 13 hits (not CONTEXT.md's planning-time estimate of 6): the shipped same-line-verb rule is exactly what the plan's own must_haves truth specifies ('a URL with a fetch verb on its line is a network request'), and the honest, actually-run count differs from a pre-code estimate — recorded as measured, not adjusted to match the plan's earlier guess"
  - "observedNetwork produces two precision rows from one analyzer (network_request, external_reference), because CONTEXT.md decision 6 requires a separate recorded rate per category, not a blended one; precision.test.ts's coverage check accepts either bare or category-suffixed Analyzer cells for the same registered id"
  - "the kill-line test encodes an inverse relationship (rate>=20% <=> verdict deleted) rather than a blanket 'no row >= 20%' check, because Reference F requires the already-earned html_comment_naive row (100%, deleted) to live in the same file the mechanical gate reads"
  - "redos-line.md is one committed ~31KB line built from four bounded near-miss/worst-case shapes (unterminated https://, an install-pattern near-miss run, a long uniform run, a curl-shaped near-miss); generated once by a throwaway script into the committed file, never generated inside the test"

requirements-completed: [CAP-02, CAP-04, CAP-05, CAP-13, CAP-14, QUA-03, QUA-05]

coverage:
  - id: D1
    description: "A declared grant (allowed-tools string, YAML list, or a coarse Bash(*)) is one finding per token carrying the token verbatim, never split and never decomposed into inferred sub-capabilities; a Bash(*) grant produces exactly one finding across the whole registry, never a derived network/filesystem/install one"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "src/analyze/declared.test.ts — 'allowed-tools, verbatim, never decomposed' and 'the coarse Bash(*) grant — one finding across the WHOLE registry, never a derived one'"
        status: pass
    human_judgment: false
  - id: D2
    description: "meta.servers[].command and meta.handlers[].command surface as declared findings verbatim; meta.servers[].envKeys never reaches any finding field, including metadata"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "src/analyze/declared.test.ts — 'the meta channel, verbatim, envKeys never surfaced' (all three tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The declared analyzer produces zero findings over the four frozen corpora, and the test records that zero explicitly rather than omitting it — the one requirement in the phase with no real-world instance to validate against"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "src/analyze/declared.test.ts — 'measured against the four frozen corpora'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Outbound URLs split into network_request and external_reference by an explicit same-line fetch verb, not by URL shape; a Markdown link's closing paren/bracket/backtick is never swallowed"
    requirement: "CAP-04"
    verification:
      - kind: unit
        ref: "src/analyze/network.test.ts — 'request versus reference' and 'a Markdown link terminator is not swallowed'"
        status: pass
    human_judgment: false
  - id: D5
    description: "An xmlns namespace URI produces no finding at all; a genuine w3.org documentation link with no xmlns still produces an external_reference — both directions asserted"
    requirement: "CAP-04"
    verification:
      - kind: unit
        ref: "src/analyze/network.test.ts — 'the xmlns exclusion, both directions' (both tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The URL analyzer reproduces the measured corpus counts (64 findings, 13 network_request, 51 external_reference) so a pattern change is a visible diff"
    requirement: "CAP-04"
    verification:
      - kind: unit
        ref: "src/analyze/network.test.ts — 'measured against the four frozen corpora'"
        status: pass
    human_judgment: false
  - id: D7
    description: "curl|sh, wget&&bash and iwr|iex each fire exactly one remote_execution finding; the mere presence of bash/shell/exec/command with no download and no pipe fires nothing; the corpus produces zero findings, recorded as untested rather than clean"
    requirement: "CAP-05"
    verification:
      - kind: unit
        ref: "src/analyze/shell.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every shipped analyzer completes over a committed ~31KB hostile fixture inside a generous wall-clock bound; the per-line cap observably fires (non-zero skipped-line count); no analyzer exceeds maxFindingsPerDetector on the fixture"
    requirement: "CAP-14"
    verification:
      - kind: unit
        ref: "src/analyze/redos.test.ts (all four tests)"
        status: pass
    human_judgment: false
  - id: D9
    description: "fixtures/capability-precision.md carries one row per registered analyzer (declaredCapabilities, install, observedNetwork x2 categories, observedRemoteExecution) plus the already-deleted html_comment_naive row; every rate was actually hand-checked against printed corpus hits, not estimated"
    requirement: "CAP-13"
    verification:
      - kind: unit
        ref: "src/analyze/precision.test.ts — 'every registered analyzer has at least one row'"
        status: pass
      - kind: other
        ref: "bun run precision — hand-check performed against its printed output; see 'The CAP-13 measurement, actually run' below"
        status: pass
    human_judgment: true
  - id: D10
    description: "precision.test.ts fails on a missing row (coverage), a drifted hit count (recompute vs recorded), and the kill-line inverse relationship (rate>=20% requires verdict deleted, rate<20% requires verdict not deleted); an unparseable rate throws rather than being silently skipped"
    requirement: "CAP-13"
    verification:
      - kind: unit
        ref: "src/analyze/precision.test.ts (all three describe-level assertions)"
        status: pass
    human_judgment: false
  - id: D11
    description: "No shipped detector measured at or above the 20% kill line in this plan; the closest margin (observedNetwork's network_request row, 15%) is named and explained rather than smoothed over"
    requirement: "CAP-13"
    verification:
      - kind: other
        ref: "fixtures/capability-precision.md — 'Row-by-row notes'"
        status: pass
    human_judgment: true
  - id: D12
    description: "Every analyzer added this plan has a direct unit test with no database, no network, no token"
    requirement: "QUA-03"
    verification:
      - kind: unit
        ref: "src/analyze/{declared,network,shell}.test.ts (none imports @/db or opens a socket)"
        status: pass
    human_judgment: false

duration: not machine-timed (single continuous session, no per-task timestamps recorded)
completed: 2026-08-11

actuals:
  tokens: 19100
  tasks: 3
  commits: 0
---

# Phase AGD-04 Plan 02: The Remaining Detectors, the CAP-14 Lock, and the Executed CAP-13 Measurement Summary

The declared channel (allowed-tools verbatim, MCP/hook commands, envKeys never surfaced), the request-versus-reference URL split with the measured xmlns exclusion, the narrow remote-execution shape, a runnable ReDoS lock over a committed 31KB hostile fixture, and the CAP-13 measurement actually run and recorded — six analyzer rows in `fixtures/capability-precision.md`, all under the 20% kill line, none deleted.

## Not committed

**No `git commit`, `git add`, or `git push` was run**, per this plan's hard constraint. `git status --porcelain` shows every changed file as ` M` or `??`; nothing is staged. Recommended commit message at the bottom.

## Accomplishments

**Task 1 — the declared channel.** `src/analyze/declared.ts`'s `declaredCapabilities` reads two shapes, neither by scanning text: `frontmatter['allowed-tools']`, normalized by `toolTokens` (exported from `src/detect/skill.ts` rather than re-implemented — `command.ts` already carries its own private copy; this plan adds a second call site to the original rather than a third implementation), and `meta.servers[].command` / `meta.handlers[].command` — the fields Phase 3's `mcp.ts`/`hook.ts` already store verbatim and explicitly defer to this phase. A coarse `Bash(*)` grant is one finding, itself, verbatim, never split on `:`, `(` or `*`, and never decomposed into a network/filesystem/install claim — asserted both at the function level and, per the plan's own must_haves phrasing, across the *whole registry* (`analyzeArtifact(ANALYZERS, ...)` over the coarse-grant fixture yields exactly one finding). `meta.servers[].envKeys` is never read; a test serializes every finding to JSON and asserts no env key name or value survives. The new fixture `fixtures/adversarial/allowed-tools-coarse.md` joins the flat adversarial directory with a README row, never under `fixtures/<slug>/files/`. The four frozen corpora yield zero declared findings — the one requirement in the phase with no real-world instance — and the test records that zero explicitly.

**Task 2 — network, remote execution, the ReDoS lock.** `src/analyze/network.ts`'s `observedNetwork` matches one bounded character class (`https?://[^\s<>()[\]"'`]+`), excludes an `xmlns`-preceded match on the same line (measured: exactly 1 of 65 in the corpora), and classifies the remainder as `network_request` when `FETCH_VERBS` (`WebFetch`, `WebSearch`, `Fetch from`, `GET`/`POST`/`PUT`/`DELETE`, `Navigate to`, `Open`, `curl`, `wget`, `requests.get`, `axios`) appears on the same line, `external_reference` otherwise. `src/analyze/shell.ts`'s `observedRemoteExecution` fires only on the three literal remote-execution shapes (`curl … | sh/bash`, `wget … && sh/bash`, `iwr/Invoke-WebRequest … | iex`), each pattern bounded by a negated-class terminator with no nested quantifier. `fixtures/adversarial/redos-line.md` is one committed ~31,000-character line — an unterminated `https://` run, an install-pattern near-miss run (`npm inst` repeated, never completing), a long uniform character run, and a curl-shaped near-miss that never reaches `| sh` — generated once by a throwaway script into the committed file, never generated inside `redos.test.ts`. `redos.test.ts` asserts all four shipped analyzers complete over it inside a 500ms wall-clock bound (measured: well under, per-analyzer times in the single digits of milliseconds), that `scanLines` itself reports a non-zero skipped-line count (proving `maxLineChars` fired), and that no raw analyzer output exceeds `maxFindingsPerDetector`.

**Task 3 — the CAP-13 measurement, actually run.** `scripts/capability-precision.mjs` runs the shipped `ANALYZERS` registry over the four frozen corpora with no network, no token, no database, prints total hits per analyzer grouped by category, and the first 20 hits (or all, when fewer exist) per category as `corpus/file:line — matched text`. Run via `bun run precision`, its printed output was hand-labelled per §Q5's procedure (see "The CAP-13 measurement, actually run" below) and recorded in `fixtures/capability-precision.md`. `src/analyze/precision.test.ts` mechanizes three checks: coverage (every registered analyzer id has a row), drift (re-running each analyzer over the corpora reproduces the recorded hit count, per row, per category), and the kill line — encoded as an inverse relationship (rate ≥ 20% requires `verdict: deleted`; rate < 20% requires it not be) rather than a blanket "no row ≥ 20%", because the file also carries the already-earned `html_comment_naive` row at 100%, deleted before this plan wrote any code.

## The CAP-13 measurement, actually run

`bun run precision` was executed and its output hand-labelled. No detector reached the 20% kill line; nothing was deleted in this plan.

| Analyzer | Hits | Hand-checked | FP | Rate | Verdict |
|---|---|---|---|---|---|
| `html_comment_naive` | 26 | 26 (all) | 26 | 100% | **deleted** (already, before this plan — see 04-CONTEXT.md Measurement 4) |
| `install` | 78 | 20 | 1 | 5% | shipped (carried forward from 04-01) |
| `declaredCapabilities` | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |
| `observedNetwork` — `network_request` | 13 | 13 (all — fewer than 20 exist) | 2 | **15%** | shipped |
| `observedNetwork` — `external_reference` | 51 | 20 | 1 | 5% | shipped |
| `observedRemoteExecution` | 0 | 0 (no real instance) | 0 | 0% | shipped, precision untested |

**The one detail worth flagging on its own:** `network_request` measured at **13 hits**, not CONTEXT.md's planning-time estimate of 6 — the plan's own must_haves truth ("a URL with a fetch verb on its line is a network request") is exactly the same-line rule this plan shipped, and the honest count from actually running that rule is 13, not the earlier estimate. This is not a deviation from spec; it is the actual measurement replacing a pre-code guess, recorded rather than forced to match. Two of the 13 are false positives, both on the same line (`anthropics-skills skills/claude-api/SKILL.md:185`), where `WebFetch` appears in the sentence but names a different, non-URL target (`shared/live-sources.md`) — the concrete cost of a same-line rule versus a verb-adjacent-to-URL rule, named in `fixtures/capability-precision.md`'s row-by-row notes rather than smoothed over. At 15% it is the closest margin of any shipped row, still comfortably under 20%, and not narrowed — narrowing a passing detector to chase a lower number is not what the kill line asks for.

`external_reference`'s one false positive is a CORS configuration default (`origin: ... || 'http://localhost:3000'`) — a real URL literal that does not genuinely point the reader anywhere, scored negative rather than argued into a positive per §Q5 step 4.

## Deviations from Plan

### Auto-fixed / necessary companion decisions

**1. [Rule 2 — missing critical] `toolTokens` needed to be exported from `skill.ts`, not duplicated a third time**

- **Found during:** Task 1, implementing `declared.ts`.
- **Issue:** the plan's Reference A explicitly requires reusing `skill.ts`'s existing token normalization ("a second implementation would drift from the first"), but the function was private (`function toolTokens`, no `export`).
- **Fix:** added `export` and a doc comment explaining the reuse, rather than copying the six-line function a third time (`command.ts` already carries a private copy of its own).
- **Files:** `src/detect/skill.ts`.
- **Verification:** `src/analyze/declared.test.ts`'s allowed-tools tests import and exercise the reused function through `declaredCapabilities`; `skill.test.ts:206-216` (unmodified) still covers `toolTokens` itself.

**2. [Rule 3 — blocking] `network_request`'s measured count required a corrected verb-match window, not the initially-assumed 200-character one**

- **Found during:** Task 2, reproducing the corpus measurement.
- **Issue:** a first hand-count script capped the verb-visibility window at 200 characters (matching `maxEvidenceChars`), producing 11 network_request hits — undercounting because `observedNetwork`'s actual implementation checks the verb against the full line, capped at `ANALYZE_CAPS.maxLineChars` (2,000), not the evidence cap.
- **Fix:** corrected the measurement script to use the same 2,000-char window the shipped code uses, which surfaced the true count (13, including the 2 false positives on the long `claude-api/SKILL.md:185` line) — a measurement bug, not a code bug; `network.ts` itself was never changed for this.
- **Files:** none (measurement-only; no source file changed).
- **Verification:** `src/analyze/network.test.ts`'s corpus test asserts the corrected counts (64/13/51) directly against the shipped `observedNetwork`.

### Deliberately scoped decisions (not deviations, but worth stating)

**`observedNetwork` produces two precision rows, not one.** `fixtures/capability-precision.md`'s table has one row for `network_request` and one for `external_reference`, both under the `observedNetwork` analyzer id. CONTEXT.md's own decision 6 records a separate rate for each category from research; blending them into one 20-sample hand-check would have hidden the smaller, riskier `network_request` sample (13 hits) inside the larger `external_reference` one (51 hits) and never actually hand-checked it on its own. `precision.test.ts`'s coverage check accepts a category-suffixed Analyzer cell (`` `observedNetwork` — `network_request` ``) as satisfying coverage for the registered id `observedNetwork`.

**The kill-line test is an inverse relationship, not a blanket "no row ≥ 20%" check.** Reference F requires the file to carry the already-earned `html_comment_naive` row at 100%, deleted, permanently — that row's whole purpose is to document a rate *above* the line. `precision.test.ts` therefore asserts: rate ≥ 20% ⇒ verdict is `deleted`; rate < 20% ⇒ verdict is not `deleted`. This satisfies the plan's must_haves truth ("no row … records a rate at or above 20 percent [without being] deleted") without contradicting Reference F's requirement to keep the historical row in the same file.

## Migration

None. This plan is pure `src/analyze/` code, tests, fixtures, and one script — no schema change, no new `drizzle/` migration. `scripts/migrate.mjs` is untouched (`git diff scripts/migrate.mjs` is empty).

## Verification run (in the required order)

| Command | Result |
|---|---|
| `bun run check:boundaries` | `6 migration file(s), package.json, 1 schema module, 55 source file(s)` — OK |
| `bun run lint` | clean (`biome check --write .` applied formatting to newly-created files once, then clean) |
| `bun run typecheck` | clean |
| `bun run test` | **632 passed** across **38 files** (baseline was 596/33 — +36 tests, +5 files, 0 regressions; one `src/db/queries/jobs.test.ts` concurrency test timed out once under full-suite DB-pool contention and passed on both an isolated run and a full re-run — flaky, pre-existing, unrelated to any file this plan touches) |
| `bun run ci` | all four gates above, in sequence, all green (632/632) |
| `bun run precision` | ran clean, printed the sample hand-labelled into `fixtures/capability-precision.md` |

## Requirements satisfied

| ID | Evidence |
|---|---|
| CAP-02 | `declared.ts`: allowed-tools verbatim (string/list/coarse-grant), MCP/hook commands, envKeys never surfaced, zero corpus hits recorded honestly |
| CAP-04 | `network.ts`: request-versus-reference split on an explicit same-line verb, xmlns exclusion asserted both directions, measured corpus counts reproduced |
| CAP-05 | `shell.ts`: the three literal remote-execution shapes fire; shell-word prose does not; zero corpus hits recorded as untested, not clean |
| CAP-13 | `fixtures/capability-precision.md` + `scripts/capability-precision.mjs` + `src/analyze/precision.test.ts`: every shipped analyzer hand-checked and recorded, mechanized coverage/drift/kill-line gate, nothing deleted this plan (nothing reached the line) |
| CAP-14 | `redos.test.ts` + `fixtures/adversarial/redos-line.md`: wall-clock bound, skipped-line count, and finding-volume cap all asserted as runnable tests over a committed hostile fixture |
| QUA-03 | Every analyzer added this plan has a direct, database-free, network-free, token-free unit test |
| QUA-05 | `redos-line.md` and `allowed-tools-coarse.md` join the permanent adversarial suite with README rows |

## Known Stubs

None. Every analyzer this plan ships is registered, tested, and measured; no UI element renders empty/placeholder data from this plan's work (the panel itself is 04-04's scope).

## Next Phase Readiness

- `src/analyze/index.ts`'s `ANALYZERS` array now carries four analyzers (`install`, `declaredCapabilities`, `observedNetwork`, `observedRemoteExecution`); 04-03 registers its hidden-content analyzer as the fifth element, same shape.
- `fixtures/capability-precision.md` exists with six rows; 04-03 appends its own row(s) for the fence-aware HTML-comment detector rather than creating a new file.
- `scripts/capability-precision.mjs` already groups by category and reads the live `ANALYZERS` registry — 04-03's detector needs no script change, only a new hand-check and a new row.
- `observedRemoteExecution`'s "0 hits on real data; precision untested, not proven clean" language is the exact honest-state sentence 04-04's "not checked" copy can quote verbatim, per CONTEXT.md's own framing.
- No blockers. `bun run ci` is green (632/632); no migration to apply; nothing is staged for commit.

## Recommended commit message (not executed)

```
feat(04-02): the remaining detectors, the CAP-14 lock, and the executed CAP-13 measurement

- src/detect/skill.ts: export toolTokens for reuse by declared.ts
- src/analyze/declared.ts: the declared channel — allowed-tools verbatim
  (string/list/coarse-grant, never decomposed), meta.servers[].command,
  meta.handlers[].command; envKeys never read
- src/analyze/network.ts: observedNetwork — request-vs-reference URL split,
  the named xmlns exclusion, FETCH_VERBS
- src/analyze/shell.ts: observedRemoteExecution — the three literal
  remote-execution shapes only
- fixtures/adversarial/redos-line.md, src/analyze/redos.test.ts: CAP-14's
  lock as a runnable test over a committed ~31KB hostile fixture
- scripts/capability-precision.mjs, fixtures/capability-precision.md,
  src/analyze/precision.test.ts: the CAP-13 measurement, actually run and
  hand-checked — coverage, drift and kill-line assertions; nothing deleted
- fixtures/adversarial/allowed-tools-coarse.md, README.md: the coarse-grant
  fixture
- src/analyze/index.ts: register declaredCapabilities, observedNetwork,
  observedRemoteExecution
```

## Self-Check: PASSED

- All 12 created files exist on disk (`src/analyze/{declared,declared.test,network,network.test,shell,shell.test,redos.test,precision.test}.ts`, `scripts/capability-precision.mjs`, `fixtures/capability-precision.md`, `fixtures/adversarial/{redos-line,allowed-tools-coarse}.md`) — confirmed via the tool calls that created them and via `wc -l`/`wc -c` against each.
- `bun run ci` passed in full: boundaries OK, lint clean, typecheck clean, 632/632 tests across 38 files (re-run after one flaky, unrelated DB-concurrency test timeout; passed clean on the re-run and in isolation).
- `bun run precision` runs clean and its printed output was the basis for every row in `fixtures/capability-precision.md`.
- `git status --porcelain` shows every changed/new path as ` M` or `??`, none staged — nothing was `git add`ed at any point in this session; no commit or push was run.

---
*Phase: AGD-04-capability-disclosure*
*Plan: 02*
*Completed: 2026-08-11*
