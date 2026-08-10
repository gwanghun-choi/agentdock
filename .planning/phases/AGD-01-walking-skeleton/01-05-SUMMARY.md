---
phase: AGD-01-walking-skeleton
plan: 05
subsystem: ingestion-pipeline-and-failure-copy
tags: [pipeline, idempotency, ssrf, outcomes, logging]
status: complete

requires:
  - 01-01 (persistScan, RepoScan/ScannedPackage, fixtures/anthropics-skills, agentdock_test)
  - 01-02 (normalizeRepo, GitHubError, rateLimitState, fetchRepoScanInputs)
  - 01-03 (DETECTORS, the skill detector, fixtures/adversarial)
provides:
  - src/log.ts — log(), one line with a closed field set
  - src/ingest/errors.ts — IngestOutcome, OUTCOME_MESSAGES, messageFor, toIngestOutcome
  - src/ingest/pipeline.ts — ingestRepository(), IngestResult, contentHash()
affects:
  - src/ingest/persist.test.ts (sentinel full_name; see deviation 1)

tech-stack:
  added: []
  patterns:
    - The pipeline returns an outcome and never rethrows, so no exception can reach a page
    - Version identity is the raw bytes with only line endings normalized
    - The log signature has no free-form payload parameter, so a body cannot be logged

key-files:
  created:
    - src/log.ts
    - src/ingest/errors.ts
    - src/ingest/errors.test.ts
    - src/ingest/pipeline.ts
    - src/ingest/pipeline.test.ts
  modified:
    - src/ingest/persist.test.ts

decisions:
  - Non-existence may be mentioned only when paired with the private case (the plan's flat ban is unsatisfiable)
  - persist.test.ts gets a sentinel full_name, because vitest runs test files in parallel against one schema

metrics:
  duration: ~25m
  completed: 2026-08-10

actuals:
  tokens: 47000
  tasks: 3
  commits: 0
---

# Phase AGD-01 Plan 05: The Ingestion Pipeline Summary

`owner/repo` in, eighteen stored skills out, in one transaction — with nine fixed
outcome strings that no exception can get past, and a recorded hostname list that
turns "a URL in a body is never fetched" from a description into an assertion.

## Not committed

**No `git commit` or `git push` was run.** The maintainer commits. Every change
below is in the working tree.

## What was verified, with real output

| Command | Result |
|---|---|
| `bun run typecheck` | clean |
| `bun run lint` | `Checked 60 files. No fixes applied.` |
| `bun run check:boundaries` | `2 migration file(s), package.json, 1 schema module, 26 source file(s)` → OK |
| `bun run test` | **14 files, 229 passed** (was 12 files / 184) |
| `CI=1 bun run test` | `10 passed \| 4 skipped` files, `206 passed \| 23 skipped` — skips visibly with no database |
| `bun run ci` | boundaries OK, biome clean, tsc clean, 229 passed |

**No network requests were spent.** Every test answers from the frozen
`fixtures/anthropics-skills` capture through a stubbed `fetch`.

## The reference ingest, measured

`ingestRepository('anthropics/skills')` against the frozen bytes:

| | |
|---|---|
| found | **18** |
| stored | **18** |
| failed | **0** |
| truncated | false |
| commit sha | `f17010c9bb483898c1d9c9f42dde2b3a98889434` |
| parse status | 16 `ok`, **2 `partial`**, 0 `failed` |

The two partials are the two real specification violations plan 01-03 measured
(`claude-api`'s 1,068-character description, `template`'s name/directory
disagreement). Both are stored with the warning attached; neither is dropped.

## The hostname list the recording stub observed

Complete, for one full ingest:

```
api.github.com              × 2
raw.githubusercontent.com   × 18
```

Nothing else, ever. The set equality is asserted, not the presence of the two —
so a third host appearing anywhere fails the test rather than passing unnoticed.

The SSRF case plants three URLs inside a skill body
(`https://evil.example.test/payload`, a tracker link, and a Markdown link) and
asserts the same set afterwards, plus that the body was **stored containing the
URL as text**. Both halves of the claim, in one test.

## The exact wording of the unreadable-repository message

> AgentDock could not read that repository. GitHub returns the same response for
> a repository that does not exist and one that is private, so AgentDock cannot
> tell which. Check the spelling; if it is private, AgentDock cannot index it.

## Deviations from Plan

### 1. [Rule 1 — Bug] `persist.test.ts` borrowed a real repository's name, and the two suites collided

- **Found during:** Task 3, on the first full `bun run test` (it passed in isolation).
- **Issue:** `repository` carries `uniqueIndex('repository_full_name_key')` on
  `lower(full_name)`. `persist.test.ts` used a sentinel **node id** but the real
  `anthropics/skills` **full name**; the new pipeline suite ingests that
  repository for real. Vitest runs test files in parallel workers against the one
  `agentdock_test` schema, so the two raced and six tests failed with
  `23505 duplicate key value violates unique constraint "repository_full_name_key"`.
  Nothing was wrong with the pipeline — the older suite's fixture was.
- **Fix:** `persist.test.ts` now uses `test-owner/persist-spec`. Fixed there
  rather than in the new suite because the identity that file tests is the node
  id; the name was scenery, and the pipeline suite is the one that must use the
  real fixture values.
- **Files modified:** `src/ingest/persist.test.ts` (three lines)
- **Verified:** `bun run test` green twice in a row.

### 2. The non-existence assertion had to be paired, not flat

The plan's behaviour reads "no message contains a phrase asserting that a
repository does not exist". Written flat, that assertion **fails against the
plan's own Reference B** — the honest message has to contain the words "does not
exist" in order to name both possibilities and explain the ambiguity.

The assertion is therefore conditional and stronger where it matters: if a
message mentions non-existence at all, it must *also* mention `private` and one
of `cannot tell which` / `indistinguishable` / `same response`, and must never
say "that repository does not exist". The shorter sentence someone will
eventually write ("AgentDock could not find that repository — it does not
exist.") fails this; the correct one passes.

### 3. Two truncation tests, not one

The plan lists one. Truncation has two causes that the pipeline deliberately
collapses into one stored fact (`inputs.tree.truncated || inputs.artifactsTruncated`),
and a single test would only cover one arm of that `||`. There is one test per
cause, both asserting the same stored `tree_truncated = true`.

### 4. Per-task commits skipped

Forbidden by the phase's hard constraints.

## Requirements satisfied

| ID | Evidence |
|---|---|
| ING-01 | 18 of 18 skills discovered and stored end to end against a real repository's frozen bytes |
| ING-05 | `no-disk-write` passes over 26 source files; nothing in the path opens a file handle |
| ING-06 | Every cap comes from `fetchRepoScanInputs`; an unreadable body leaves the other artifacts stored and the repository marked incomplete |
| ING-07 | Both truncation causes store `tree_truncated = true`, each with its own test |
| ING-10 | `no-execution` passes; no execution path exists |
| ING-11 | Three planted URLs in a body; the recorded hostname set is unchanged and the body is stored as text |
| DAT-06 | Denylist test asserts `contacted` is `[]` — the refusal happens before a socket opens |
| PRV-07 | Bodies capped at 32 KB in the pipeline and again in the detector |
| QUA-06 | Exactly one log line per ingest asserted on both the success and the failure path; key set asserted exactly; line under 400 bytes |
| QUA-07 | Nine outcomes, eight messages, each asserted free of stack markers, paths, hostnames, SQL keywords and variable names |

## Known Stubs

| Stub | File | Reason |
|---|---|---|
| `ingestRepository` has no caller | `src/ingest/pipeline.ts` | The submit action is plan 01-06's. |
| `contentHash` exported but only used internally | `src/ingest/pipeline.ts` | Exported so version identity is testable as a unit; the export is the seam, not scaffolding. |
| `IngestResult.truncated` reaches no page | — | Plan 01-06 renders it on the repository page. |

## Notes for later plans

- **Test files run in parallel against one schema.** Any new database-backed
  suite must key on a sentinel that no other suite can produce — for `repository`
  that means both `github_node_id` *and* `full_name`.
- `ingestRepository` never throws. A caller that wraps it in `try/catch` is
  writing dead code.
- The rate-limit reset only reaches the message when the failure was a
  `GitHubError` carrying `rateLimit`. That is the only path that has one.

## Self-Check: PASSED

All five created files exist on disk. No commit hashes to verify — nothing was
committed, by constraint.
