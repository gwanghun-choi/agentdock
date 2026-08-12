---
phase: AGD-05-corpus-cold-start
plan: 01
subsystem: corpus acquisition
status: complete
tags: [registry, seeds, fan-out, boundaries]
requirements: [COR-01, COR-03]
tasks_complete: 3
tasks_total: 3
key-files:
  created:
    - src/registry/types.ts
    - src/registry/client.ts
    - src/registry/client.test.ts
    - src/registry/sync.ts
    - src/registry/sync.test.ts
    - src/corpus/caps.ts
    - src/corpus/fanout.ts
    - src/corpus/fanout.test.ts
    - src/db/queries/seeds.ts
    - src/db/queries/seeds.test.ts
    - src/db/queries/syncState.ts
    - scripts/corpus-sync.mjs
    - fixtures/mcp-registry/list-normal.json
    - fixtures/mcp-registry/list-empty.json
    - fixtures/mcp-registry/list-malformed.json
    - fixtures/mcp-registry/list-control-byte.json
  modified:
    - scripts/check-boundaries.mjs
    - scripts/check-boundaries.test.ts
    - src/github/client.ts
    - src/db/queries/jobs.ts
    - src/db/queries/jobs.test.ts
    - src/db/schema.ts
    - package.json
    - biome.json
migrations_added: 0
---

# Phase AGD-05 Plan 01: MCP Registry Sync Summary

A public MCP registry entry became a `repo_seed` row, a queued job, an ingested
repository and 121 rendered artifacts, at a cost of exactly two GitHub core
requests. The boundary scanner now polices the registry host and fails CI on a
fourth host nobody registers. And the incremental sweep resumes itself across
invocations while refusing to advance its window until it has actually seen every
server name — a defect found by verifying against the live API mid-plan, reported,
resolved by the maintainer, and now held in place by a test.

## Tasks

| Task | Status | Verification |
|---|---|---|
| 1 — boundary scanner learns a second host, and to notice a third | complete | `bun run test scripts/check-boundaries.test.ts` (39 passed), `check:boundaries`, `typecheck` |
| 2 — tracer: one registry entry becomes one visible artifact | complete | `check:boundaries`, subset run (99 passed), `typecheck`, `lint`, plus the live tracer below |
| 3 — incremental sweeps, bounded and loud | complete | `bun run test src/registry src/corpus src/db` (68 passed), `typecheck`, `bun run ci`, plus 10 live capped runs below |

`bun run ci`: **47 test files, 756 tests, all passing.** check-boundaries scanned
6 migration files, package.json, 1 schema module, 67 source files and 15 UI files.

## The defect found mid-plan, and how Task 3 answers it

The plan's decision 3 derived `updated_since` from the maximum stored
`registryUpdatedAt`, arguing it could only lag and therefore only over-fetch. That
holds for a sweep that runs to exhaustion; `REGISTRY_CAPS.maxPages` makes that the
uncommon case. Measured live, no GitHub quota:

| query | first row | last row on page 1 |
|---|---|---|
| `?limit=100` | `ac.inference.sh/mcp` | `ai.ankimcp/anki-mcp-server` |
| `?limit=100&updated_since=2026-08-11T06:25:19.683Z` | `ai.analyticslegends/sap-analytics` | `io.oxylabs/oxylabs-mcp` |

**The registry orders by server name and treats `updated_since` as a filter over
the whole name space.** The filtered page jumps from `ai.*` to `io.*`, straight
past the alphabet a capped sweep never reached. So a watermark taken from a
capped run's prefix hides every later name whose last update predates it, from
every future run, permanently — the silent skip the phase's cap discipline exists
to prevent, arriving through the mechanism meant to make sweeps incremental.

Resolved by the maintainer as: **the watermark advances only on an exhausted
pass.** As built:

- A pass spans as many invocations as it takes. Each run resumes from a stored
  cursor, under the same window, and the pass keeps its original start time.
- A run that ends at `page_cap`, `seed_cap` or `parse_failure` stores its resume
  point and **advances nothing**. The previous watermark is preserved, not cleared.
- Only a run that reaches the end of the names writes a watermark and clears the
  cursor. The value written is **the moment the pass began**, clamped by the
  newest `updatedAt` observed. "Every name has been seen at least once as of this
  time" is true of a completed pass's start; it is not true of any later moment,
  and a row updated mid-pass after its own name was read would otherwise be
  filtered out of the next pass forever. The clamp also absorbs clock skew in the
  unsafe direction. Both deviations land on over-fetch, which costs registry
  bandwidth and no GitHub quota.

**Where the state lives.** `schema_meta`, under `corpus_sweep:mcp-registry`,
carrying `{cursor, watermark, passStartedAt}` — an existing key/value table, so no
migration (C2 holds; `git status drizzle/` is clean). 05-CONTEXT decision 3
rejected `schema_meta` for sync state, but that rejection served the derive-only
design that turned out to be unsafe, and the only alternative left is a column.
The table's own doc comment was widened to say so rather than left to become
wrong. An unreadable value is treated as no state at all: the next run walks from
the start, which over-fetches rather than skips.

**The regression test that holds the line.**
`does NOT advance when the sweep stopped at its page cap`, plus two siblings for
`seed_cap` and `parse_failure`. Verified to bite: making the non-exhausted branch
write `newestObserved` instead of preserving the previous watermark fails exactly
those three tests and nothing else. Nothing at runtime shows this bug — a run that
advances the watermark early looks identical to one that does not, and the
consequence is servers that are simply never mentioned again.

**Live resume, ten consecutive invocations** (registry only, zero GitHub
requests):

| run | resumed from | stopped at | watermark |
|---|---|---|---|
| 1 | the start | `co.pipeboard/meta-ads-mcp:1.0.52` | unset |
| 2 | `co.pipeboard/meta-ads-mcp:1.0.52` | `com.mcparmory/google-gmail:1.0.4` | unset |
| 3–10 | each from the previous stop | … `io.github.elisymlabs/elisym:0.15.5` | unset |

Every run read 40 pages / 4,000 rows and stopped at its page cap. Stored state
after run 10:
`{"cursor":"io.github.elisymlabs/elisym:0.15.5","watermark":null,"passStartedAt":"2026-08-11T08:34:09.450Z"}`
— one `passStartedAt` across all ten invocations, and a window that never moved.
7,972 registry seeds now stored.

Each run's stdout says so in words, not just a status token:

```
corpus-sync: INCOMPLETE — it hit its page cap after 40 page(s). Server names after
"<cursor>" were not reached, and how many of them there are is not known from this
run. The resume point is stored; run this again to continue the same pass. The
updated_since watermark was NOT advanced (still unset) — advancing it on a partial
pass would hide every unreached name whose last update predates it, permanently.
```

### Two measured facts the maintainer should see before 05-02

1. **The registry is far larger than the recorded 21,055.** Ten runs read 40,000
   rows and the cursor is still inside `io.github.c*`. The list returns one row
   **per published version**, not per server, and `io.github.*` is the bulk of the
   namespace. At 40 pages per invocation a pass therefore needs many more than the
   estimated six runs — and until one completes, the watermark can never advance,
   so the sweep is effectively cursor-driven rather than incremental.
2. **The API has a latest-only view.** `?version=latest` returns 200 and yields
   100 distinct server names per page against 65 on the unfiltered page — and the
   gap widens in the version-heavy tail. Switching the sweep to it would likely
   turn a pass from dozens of invocations into a handful, which is what makes the
   watermark reachable at all. **Not implemented**: it changes cursor semantics and
   the meaning of the `updatedAt` a seed carries, neither of which is this plan's
   to decide. Recorded as the highest-value follow-up for 05-02.

## What Task 1 changed

`scripts/check-boundaries.mjs:211-212`'s single `HOST_PATTERN`/`HOST_DIR` pair is
now an exported `HOST_RULES` array of `{pattern, dir, label}`, and the single
conditional is a loop over it. The problem id string stays `no-host-sprawl`
verbatim, so the two existing assertions still match something.

`src/github/client.ts` gained one word: `export const ALLOWED_HOSTS`.
`src/registry/client.ts` exports its own. The new
`describe('HOST_RULES covers every client allowlist')` block asserts every member
of every allowlist is matched by some `HOST_RULES` pattern — checked by hand
against a hypothetical fourth host (`objects.githubusercontent.com`), which the
predicate reports as uncovered, so the test fails on the commit that adds a host
without registering a directory rather than a year later.

Three further assertions: the registry host outside `src/registry/` reports
`no-host-sprawl`; inside it reports nothing; and the two pairs are not
interchangeable — the registry host inside `src/github/` is still sprawl, and
`api.github.com` inside `src/registry/` is too.

## What Task 2 changed

**`enqueueJob` normalizes at the boundary.** `target` is lowercased once and used
for the denylist check, the insert and the conflict clause alike; before this the
check lowercased (`:38`) and the insert did not (`:50`). No index change, no
migration. The regression test was verified to fail without the fix: reverting the
one-line change fails `treats a mixed-case name as the same repository, and stores
it lowercase` and nothing else.

**Legacy mixed-case rows: zero.** `SELECT count(*) FROM ingest_job WHERE target <>
lower(target)` returned **0**, out of **0** total `ingest_job` rows and **0**
`repo_seed` rows on the dev schema before this plan ran. No operator `UPDATE` was
needed and none was run.

**`src/registry/`** is the one directory that may name the registry host:
hardcoded allowlist, https-only, `redirect: 'manual'` with every `location`
re-validated, `AbortSignal.timeout` per hop, byte-capped read with its own
`RegistryError`, and no token header. `readCapped` is duplicated with a
`ponytail:` comment naming the real reason (a `GitHubError` from a registry
adapter lies to `messageFor`), not the boundary argument.

End of pagination is the **absence** of the `nextCursor` key; a non-string cursor
is refused rather than coerced. A control-byte page is retried once with C0 bytes
other than tab/LF/CR stripped, counted as `pagesSanitized`, and its cursor is
still read.

**`src/db/queries/seeds.ts`** holds every `repo_seed` statement the corpus sources
share, with the coupling comment on the anti-join naming the `enqueueJob` change
it depends on. `upsertSeeds` deduplicates by `full_name` before inserting — the
registry lists one server once per published version, and Postgres refuses to let
`ON CONFLICT DO UPDATE` touch one row twice in a statement, so without it a normal
live page is a runtime error.

**`src/corpus/fanout.ts`** routes every seed through `enqueueJob`, stops on the
first `flooded`, and reports `remaining` measured after the loop.

**`scripts/corpus-sync.mjs`** + `"corpus:sync"` in package.json. `--drain=<n>`
calls the already-exported `claimJob` and `runJob`; no sleep, no reap, no signal.
There is no `--cursor` flag: the sweep stores its own resume point, and a resume
point an operator can type is one an operator can get wrong.

### Live registry facts, recorded

**`x-ratelimit-*` headers the live registry returned: none.** The complete
response header set on `GET /v0/servers?limit=1` was `date`, `content-type`,
`content-length`, `vary`, `strict-transport-security`, `x-registry-cache`. No
rate-limit state is invented in the client because there is none to read.

**First live `corpus:sync --no-enqueue`** (zero GitHub requests: core stayed at
57/60 across the run):

```
pages=1 sanitized=0 rows=100 invalid=0 no-github-repo=48 seeds=24
stopped=page_cap  resume with --cursor=ai.ankimcp/anki-mcp-server:0.20.0
```

48 of 100 rows named no GitHub repository (the expected ~41%), and the 52 that did
collapsed to **24 distinct repositories** — the registry lists one server once per
version. Derived watermark after the run: `2026-08-11T06:25:19.683Z`.

A second identical run wrote no new rows: still 24 `mcp-registry` seeds.

**The tracer, end to end**, at a cost of exactly **2 core requests** (57 → 55
remaining):

| step | value |
|---|---|
| registry entry | `ac.tandem/docs-mcp` |
| repository | `frumu-ai/tandem` (114 stars) |
| job | id 1, outcome `ok`, commit `c628546`, 18.1 s |
| artifacts | 121 found, 121 stored, 1 parse failure, not truncated |
| page | `GET /r/frumu-ai/tandem` → 200, 265 KB |
| first artifact rendered | skill `data-write-query`, `apps/tandem-desktop/src-tauri/resources/skill-templates/data-write-query/SKILL.md` |

Fan-out line from that run:
`considered=1 enqueued=1 denylisted=0 flooded=false still-pending=23 (cap 1)`.

## Deviations from plan

**1. [Rule 3 — blocking] `biome.json` gained one exclusion.**
`fixtures/mcp-registry/list-control-byte.json` is deliberately not valid JSON — a
raw `0x01` inside a description is the whole point of the fixture — and biome
fails the repo lint on it (`Control character '' is not allowed`). The file
is excluded by name. `biome.json` was not in the plan's `files_modified`.

**2. [Rule 3 — blocking] The control-byte strip needed a lint suppression.**
`noControlCharactersInRegex` fires on the pattern whose purpose is to match
control characters. One `biome-ignore` line, with the inversion stated.

**3. Fixture repository URLs are sentinels, not the captured ones.** Publisher
names, descriptions, versions, timestamps and the envelope are the live capture;
the two `repository.url` values were rewritten to
`test-owner/corpus-spec-*` (one mixed-case, deliberately). The plan asks for both
"a real captured page" and `test-owner/corpus-spec-*` sentinel discipline in every
DB-backed suite, and these two collide: a real repository name in a shared test
schema collides with any suite that ingests it for real. Sentinel discipline won.

**4. `RegistrySeed.updatedAt` is `string | null`, not `string`.** Forced by the
plan's own zod schema: `_meta` and every field under it are `.partial().optional()`,
so a row can carry no timestamp. Absent costs the watermark, not the seed.

**5. `fanout.test.ts` mocks its two dependencies instead of using the database.**
`unenqueuedSeeds` reads the whole table, so a real fan-out inside a test can
enqueue a sibling suite's seed and leave a queued `ingest_job` behind — the exact
nondeterminism `jobs.test.ts:24-27` warns about. The loop facts are asserted on
calls; the row facts they rest on are asserted against the real database in
`seeds.test.ts` and `jobs.test.ts`; the composition is proven by the live run.

**6. [Rule 1 — bug, found during Task 2] `seeds.test.ts` originally inserted
`queued` `ingest_job` rows** and hit the documented cross-suite race on the first
full run: `jobs.test.ts` claimed one of them, this suite's `clean()` deleted it,
and the attempt insert failed with a foreign-key violation. Fixed by inserting
`running` rows, the convention `persist.test.ts` already follows. `jobs.test.ts`'s
own `clean()` now matches on `lower(target)`, so a regression in the
normalization leaks no row instead of hiding behind the cleanup.

**7. [Task 3, maintainer-approved] The watermark is sweep state in `schema_meta`,
not a value derived from `repo_seed`.** 05-CONTEXT decision 3 is superseded for the
reason measured above. `newestRegistryUpdatedAt` survives as a read model — how
fresh the stored rows are — with its doc rewritten to say it is deliberately not
the filter, and one test asserting the two are different numbers.

**8. [Rule 1 — bug, found by the full suite] `countUnenqueuedSeeds`'s delta
assertion was inherently racy.** It counts the whole table by design, and a
sibling test file writes seeds in parallel, so `before + 2` failed reproducibly
once Task 3 made the registry suite longer. Rewritten to assert what is true
without a global freeze: this suite's rows are in the count, and a seed leaves it
the moment it has a job.

## Known ceilings

- `unenqueuedSeeds` / `countUnenqueuedSeeds` read the whole table, so any
  DB-backed suite that calls them for real is exposed to rows written by a
  sibling suite running in parallel. Handled here by mocking; a future caller
  needs the same care or a scoped variant.
- The anti-join is unindexed on `ingest_job.target` (`ponytail:` comment in
  place). Hundreds of rows today.
- `upsertSeeds` duplicates `persist.ts`'s conflict clause, deliberately
  (`ponytail:` comment names the merge trigger).
- **Cross-file test races are managed by hand, not structurally.** Three fired
  during this plan: a foreign-key violation from a claimable row left behind, a
  5-second timeout under contention, and the count drift above. Measured
  alternative: `bun run test --no-file-parallelism` passes all 756 in **52 s**
  against **19 s** parallel. One line in `vitest.config.ts` retires the whole
  class for 33 seconds; not taken, because it is a repo-wide change nobody asked
  for. Recommended.
- A registry pass cannot complete in a handful of runs at `?limit=100` over every
  published version — see the two measured facts above.

## Verification checklist (plan's own list)

| # | Item | Result |
|---|---|---|
| 1 | Registry host outside `src/registry/` fails, inside passes | pass |
| 2 | Every allowlist host covered by a `HOST_RULES` entry, asserted | pass |
| 3 | `enqueueJob('Owner/Repo')` then lowercase → one active row, stored lowercase | pass |
| 4 | Legacy mixed-case rows counted | 0 found; no `UPDATE` needed |
| 5 | Four fixtures parse to expected counters; host list names the registry only | pass |
| 6 | Control-byte page recovers on one retry, counted, cursor read | pass |
| 7 | `unenqueuedSeeds` excludes any-status jobs and denylisted seeds | pass |
| 8 | Fan-out reaches `enqueueJob` per seed, stops on first flooded | pass |
| 9 | A capped sweep prints its resume cursor, and resuming reaches new rows | pass — unit test plus 10 live invocations |
| 10 | Two consecutive full runs enqueue nothing the second time | pass — `writes nothing new on a second pass`, and two live syncs left the seed count unchanged |
| 11 | A registry entry produced a page carrying an artifact, 2 core requests | pass, recorded above |
| 12 | No `drizzle/*.sql` added or changed; `scripts/migrate.mjs` unmodified | pass — `git status drizzle/ scripts/migrate.mjs` is clean |
| 13 | `bun run ci` passes | pass — 47 files, 756 tests |

## Nothing was committed

Working tree left for the maintainer, branch `develop`. Recommended commit
message:

```
feat(05-01): sync the MCP registry into repo_seed and fan out to the queue

- check-boundaries rule 5 becomes a HOST_RULES registry, plus a coverage test
  that fails CI when a client's allowlist grows a host with no registered dir
- enqueueJob lowercases target at the boundary, so seeds and human submissions
  are one identity (regression test fails without it); no index, no migration
- src/registry/: hardcoded allowlist, manual redirects, capped read, zod per row,
  one control-byte retry, cursor by key absence
- bounded, self-resuming sweep whose updated_since watermark advances only on a
  pass that reached the end of the server names: the registry orders by name and
  filters by time, so a watermark from a capped run hides every unreached name
  whose last update predates it. Sweep state in schema_meta, no migration.
- src/db/queries/{seeds,syncState}.ts, src/corpus/{caps,fanout}.ts,
  scripts/corpus-sync.mjs, bun run corpus:sync
```
