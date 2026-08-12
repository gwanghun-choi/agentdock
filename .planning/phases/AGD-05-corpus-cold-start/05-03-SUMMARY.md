---
phase: AGD-05-corpus-cold-start
plan: 03
subsystem: acquisition and listing visibility
status: complete
tags: [search, sharding, fork, dedup, visibility-floor, read-time]
requirements: [COR-05, COR-07, DAT-07]
tasks_complete: 3
tasks_total: 3
key-files:
  created:
    - src/github/search.ts
    - src/github/search.test.ts
    - src/corpus/search.ts
    - src/corpus/search.test.ts
    - src/db/queries/packages.test.ts
  modified:
    - src/corpus/caps.ts
    - scripts/corpus-sync.mjs
    - src/db/queries/packages.ts
    - src/app/r/[owner]/[repo]/page.tsx
    - src/components/escaping.test.tsx
migrations_added: 0
actuals:
  tasks: 3
  commits: 0
---

# Phase AGD-05 Plan 03: Sharded Topic Search, Fork Filtering, Dedup and the Visibility Gate

A topic sweep that names what it could not reach, and three read-time
suppressions that took the listing from 971 rows to 794 without moving one
stored byte.

`bun run ci`: **52 test files, 882 tests, all passing** (wave 2: 49 / 822).
Zero migrations. Zero GitHub core requests spent by the sweep, measured
either side.

**Three plan claims did not survive contact with the data, and all three were
load-bearing.** The visibility floor as specified would have cut the corpus
below COR-06's acceptance number; the duplicate rule as specified would have
suppressed unrelated artifacts and could have emptied a whole duplicate group;
and the performance remedy named in advance turned out to fix nothing.

---

## The three findings, first

### 1. The floor's predicate would have taken the corpus below COR-06

The plan (Reference C) specifies `parse_status <> 'ok'` → `unparsed`. Measured
against the live corpus:

| latest `parse_status` | packages |
|---|---|
| `ok` | 469 |
| `partial` | 353 |
| `failed` | 149 |
| **total non-delisted** | **971** |

`<> 'ok'` therefore excludes 502 of 971 and leaves **469 listed — below COR-06's
floor of 500**, which 05-04 is about to measure.

It is also not true. `partial` is not a parse failure; it is what a detector
returns when it parsed the file completely and noticed something
(`src/detect/skill.ts:118`, `command.ts:123`, `plugin.ts:278`, all
`ok: true, status: warnings.length > 0 ? 'partial' : 'ok'`). The warnings behind
those 353 rows:

| warning | rows |
|---|---|
| `keys outside the specification: argument-hint` | 140 |
| `keys outside the specification: source` | 23 |
| `keys outside the specification: version, tags, triggers` | 20 |
| `keys outside the specification: version, author, tags, requires, triggers` | 18 |
| …14 further "keys outside the specification" variants | 149 |
| `recognised by directory shape (agents, commands, skills); no plugin.json` | 3 |

`argument-hint` is a valid Claude Code command key that this project's spec list
does not know about. Hiding those artifacts would tell a reader AgentDock could
not parse a file it parsed fine, and would make the floor a judgment about
frontmatter conventions — which is precisely what COR-07 must never be.

**Shipped as `= 'failed'`** — the detector's own `ok: false`, and the same status
`r/[owner]/[repo]/[...path]/page.tsx:171` already renders as "AgentDock could not
read this file's frontmatter". 05-CONTEXT D-03's wording (*"the floor is
`parse_status = 'ok'` on the latest version"*) needs a maintainer ratification to
match; the intent it states — parse status alone, never stars, never age — is
unchanged and is what shipped.

### 2. Content-hash equality is not always byte-identity

Measured before designing the collapse, as instructed.

**27 duplicate groups, 28 suppressed rows. Only 2 groups are cross-repository.**

The two cross-repository groups:

| hash | members (stars, package id) |
|---|---|
| `1120b3769e…` | `anthropics/skills :: skills/brand-guidelines/SKILL.md` (167,306, #2) — **kept**<br>`davila7/claude-code-templates :: cli-tool/components/skills/business-marketing/brand-guidelines-anthropic/SKILL.md` (30,193, #287)<br>`davila7/claude-code-templates :: …/brand-guidelines-community/SKILL.md` (30,193, #288) |
| `1608ea77fb…` | `anthropics/skills :: skills/frontend-design/SKILL.md` (167,306, #7) — **kept**<br>`anthropics/claude-code :: plugins/frontend-design/skills/frontend-design/SKILL.md` (141,013, #927) |

Both are genuine vendoring of an Anthropic file, and the star rule picks the
upstream copy in both cases.

The other 25 groups are **within one repository** — a repository holding one file
at two paths, e.g. `frumu-ai/tandem` mirroring `agent-templates/packs/X/…` into
`apps/tandem-desktop/src-tauri/resources/packs/X/…`, and
`davila7/claude-code-templates` mirroring `.claude/commands/Y` into
`cli-tool/components/commands/git-workflow/Y`. Same repository means same star
count, so **the survivor there is chosen by lowest `package.id` alone, and that
is arbitrary.** It is stated as arbitrary in the code and in the test. It is
stable rather than merely deterministic: `package.id` survives re-ingestion
because the row is upserted on `(repository_id, type, source_path)`, so the same
copy keeps winning. The defensible upgrade, not built, is to prefer the shortest
`source_path` — which would pick the top-level copy rather than the vendored one
— with the id as the final tie-break.

**The plan's UI copy said "byte-identical to an artifact AgentDock lists from
another repository". That is false for 25 of the 28 rows**, so the shipped copy
drops the claim: "byte-identical to an artifact AgentDock already lists".

**A third group was found that is not a duplicate at all**, and it is the one
that would have shipped a wrong exclusion:

| hash | members |
|---|---|
| `9e639308380d…` | `davila7/claude-code-templates :: cli-tool/components`<br>`davila7/claude-code-templates :: dashboard/public/component-content`<br>`anthropics/claude-code :: plugins/plugin-dev` |

All three are shape-only plugins. A plugin recognised by directory shape has no
manifest to hash, so its version is minted over `components.join(',')`
(`src/detect/plugin.ts:204`) — the literal string `agents,commands,skills`. Three
unrelated plugins collide because they contain the same three subdirectory names.
Without a guard, two of them would have been suppressed and the page would have
called them byte-identical. **Shape-only artifacts are excluded from the
duplicate test on both sides**, and that is asserted.

Two further guards, neither in the plan, both bugs rather than polish: the
surviving copy must itself be listable (`r2.is_fork = false` and its own latest
version not `failed`). Without them a failed or forked copy can out-rank a
parseable one and take the **whole group** out of the listings — every member
suppressed as a duplicate of a row that is itself suppressed.

### 3. The performance remedy named in advance fixes nothing

The gate was crossed, and the plan's escape hatch was honoured: measured, not
improvised.

Written the way the plan specifies — `EXISTS` driven by a scan over candidate
packages with a lateral latest-version lookup each — the home listing takes
**1,152 ms** at 971 packages, 11× the 100 ms gate.

| shape | no index | with `CREATE INDEX ON package_version (content_hash)` |
|---|---|---|
| as the plan specifies, `listPackages({limit:10})` | **1,152 ms** | **1,101 ms** |
| as the plan specifies, `countPackages()` | 1,205 ms | 1,169 ms |
| driven by `content_hash` instead, `listPackages({limit:10})` | **25.5 ms** | 7.1 ms |
| driven by `content_hash` instead, `countPackages()` | 22.6 ms | 6.1 ms |

The named index moves the shipped shape by 4%. It cannot help: an index on
`content_hash` is never a lookup key for a join the planner reaches only after
evaluating a lateral per candidate row.

Starting the `EXISTS` from `package_version` instead — find the versions carrying
this row's hash, keep the ones that are their package's latest — makes
`content_hash` the driving predicate. **Verified to classify all 971 rows
identically to the other shape: zero disagreements.**

**Shipped: the rewrite, no migration.** 1,152 ms → 25.5 ms clears the gate by a
factor of four, and 05-CONTEXT C2's "Phase 5 needs zero migrations" holds. The
index is now a `ponytail:` note carrying both measured numbers (25.5 → 7.1 ms),
to be built when a measured listing crosses 100 ms again.

---

## Task 1 — the topic sweep

### Live run, and the zero-core-cost proof

`bun run corpus:sync --source=search --search-requests=8 --no-enqueue`

| bucket | before | after |
|---|---|---|
| **core** | **40 / 60** | **40 / 60** |
| search | 10 / 10 | 10 / 10 (rolling per-minute) |

**Core did not move. COR-05 costs zero core requests, proven rather than
argued.** Eight requests, 723 repositories found and written from one shard.

A second live run at a 30-request budget:

```
corpus-sync: source=search topics=swept requests=28 (search bucket) core-cost=0
  shards-completed=4 unreachable-shards=0 repos-found=2428 written=2000
  min-stars=10 stopped=seed_cap
corpus-sync: INCOMPLETE — the sweep stopped on seed_cap after 28 request(s). The
  shards it had not reached are not known from this run, and neither is how many
  repositories they hold.
corpus-sync: INCOMPLETE — 49926 repositories sit below stars:10 and were not
  swept. That is a scheduling choice about which unfetched repositories to name
  first, not a statement about any artifact: a repository below the floor is
  still submittable, still ingested and still listed. Per topic:
corpus-sync:   topic:claude-code stars:<10 — 49926 repositories
```

`repo_seed` now holds **10,774** rows; `github-topic-search` accounts for 2,000
of them.

### The unreachable shard list is empty, and that is the finding

The plan expects the sweep's headline output to be a list of shards the
1,000-result cap put out of reach. **At the shipped floor of 10 stars there are
none**, measured live:

| shard | repositories | over the 1,000 cap? |
|---|---|---|
| `topic:claude-code stars:10..19` | 2,642 | yes → subdivides |
| `topic:claude-code stars:10..10` | **398** | no |
| `topic:claude-code stars:0..0` | **25,478** | yes, and indivisible |
| `topic:claude-code stars:1..1` | **11,034** | yes, and indivisible |
| `topic:mcp-server stars:0..0` | 10,306 | yes, and indivisible |
| `topic:mcp-server stars:1..1` | 3,794 | yes, and indivisible |

Every shard above the floor subdivides down to a reachable size. The unreachable
region is exactly the region below the floor — which means **a sweep that
reported only unreachable shards would have printed a completely clean run while
skipping 49,926 of topic:claude-code's 57,970 repositories.** That is the silence
COR-05 exists to prevent, arriving through a door the plan did not anticipate.

So the sweep spends **one request per topic** measuring what the floor left out
and reports it as its own category, kept separate from unreachable shards because
the reason differs: one is a limit of the API, the other is a scheduling decision
this project made and is accountable for. `stars:<10` returned 49,926, which
cross-checks exactly against the shard measurements above
(25,478 + 11,034 + ~13,414 for `stars:2..9`).

The unreachable-shard path itself is proven by test, not by the live run: a stub
reproducing the measured `stars:0..0` / `stars:1..1` shape produces exactly two
named shards with their sizes, and `shardsCompleted` does **not** count them.

### One design defect found by testing rather than by reading

`subdivide` on an open-ended range (`stars:>=N`) doubles upward and has no fixed
point, so a sweep against an API returning over-cap counts spends its entire
budget climbing into star values no repository has. Bounded at `STAR_CEILING =
1_000_000` (the most-starred repository on GitHub holds roughly 430,000), above
which the shard is reported unreachable instead. Caught by the pure ladder tests,
which is exactly what they exist for.

### Other properties, all asserted with no network

- The ladder is disjoint, gapless and descending for floors 0, 1, 2, 10, 99,
  1,024 and 5,000, checked by enumerating every star value from the floor to
  2,000 and asserting exactly one rung claims it — and that nothing below the
  floor is claimed.
- Page walking stops at page ten and at the first short page, and page eleven is
  never requested (asserted on the recorded URL list).
- An over-cap shard costs **one** request, not ten; the page already paid for is
  kept rather than discarded.
- The captured host list across every sweep test is `api.github.com` and nothing
  else.
- A repository name that fails `normalizeRepo` is dropped, not repaired
  (`../../etc/passwd`, `owner/repo\n`, `evil.com/owner/repo` all rejected).
- A 422 from the search endpoint throws with the status only — the body echoes
  the query and carries a documentation URL, and neither is logged.
- Exhausting the search bucket ends the sweep with its counters and writes what
  it found, rather than throwing.
- Re-running over the same stubbed responses produces the same seed set.

---

## Task 2 — one expression, three suppressions

### The corpus before and after

| | packages |
|---|---|
| `countPackages({ listingOnly: false })` | **971** |
| `countPackages()` — what the listing shows | **794** |
| suppressed as `unparsed` | 149 |
| suppressed as `duplicate` | 28 |
| suppressed as `fork` | **0** |

**794 is comfortably above COR-06's floor of 500.** Under the plan's specified
floor it would have been 469.

### Fork suppression ships with zero real positives

Six repositories in the corpus, **none of them a fork**. The mechanism is built,
tested against fixtures, and has suppressed nothing real — recorded here the way
Phase 4 recorded `declaredCapabilities` and `observedRemoteExecution`. Absence of
data is not a clean pass. No fork was hunted down to make the number non-zero; if
one arrives through the seed queue it will be visible in the next run's counts.

`repository.is_fork` has been fetched and stored since Phase 1 (`repo.ts:35`,
`schema.ts:83`) and read by nothing until now, so DAT-07's baseline cost zero new
GitHub requests. That is the third field this project has found fetched and
discarded.

### `countPackages` and the repository page limit

`countPackages` had **no join to repository at all** (05-CONTEXT C9 confirmed
against source; `05-PATTERNS.md:76`'s claim that both queries had one is wrong).
It now carries the same join and the same predicate.

`getRepositoryPackages`' limit is now `CAPS.maxFiles` rather than the literal 250
whose own comment claimed it was the scan's file cap. Observable immediately:
`davila7/claude-code-templates` returns **400** artifacts on its own page, where
it returned 250 before.

### DAT-07's read-only claim, proven rather than argued

A snapshot of every `repository`, `package` and `package_version` row the suite
owns — ordered, so a reordering write could not hide — is taken before running
every listing query in both modes and compared byte for byte afterwards. It is
the only assertion in the file that tests the requirement rather than the design.
No `UPDATE`, no tombstone, no canonical flag written anywhere.

### The tests bite

Mutating the shipped predicate back to what the plan specifies fails exactly the
three assertions that encode the findings, and nothing else:

```
× LISTS a partially parsed artifact, because partial is not a parse failure
× does not let an unlistable copy take the whole group out of the listings
× does not collapse shape-only plugins, whose hash is not over file bytes
```

---

## Task 3 — the page, and the measurement

### The exact new strings, for reading against rule 6's word list

1. `A fork on GitHub`
2. `{n} of these {is|are} on this page and not in AgentDock's listings elsewhere: {reasons}. Each one is still readable here.`
3. `{n} {is|are} in a fork of another repository`
4. `{n} {is|are} byte-identical to an artifact AgentDock already lists`
5. `{n} {has|have} a file whose frontmatter AgentDock could not read`

None uses `safe`, `clean`, `verified`, `trusted`, `approved`, `malicious`,
`grade` or `risk score`. Each says **where the artifact is** (a fork), **what was
measured** (byte-identical), or **what AgentDock did** (could not read) — never
what the artifact is worth, and never a comparison with a listed one. Checked
three ways: `bun run check:boundaries` over the file, a unit test running
`checkVerdictVocabulary` over each sentence in isolation so a future editor sees
the sentence rather than the file, and a second unit test rejecting ranking words
that rule 6 does not police (`better`, `worse`, `poor`, `inferior`, `spam`,
`junk`, `official`).

The control case confirms the check discriminates: `"these are verified and
safe"` returns two problems, the shipped copy returns none.

### Rendered against live data

```
[davila7/claude-code-templates] total=400 isFork=false
  "113 of these are on this page and not in AgentDock's listings elsewhere:
   6 are byte-identical to an artifact AgentDock already lists;
   107 have a file whose frontmatter AgentDock could not read.
   Each one is still readable here."

[frumu-ai/tandem] total=121 isFork=false
  "22 of these are on this page and not in AgentDock's listings elsewhere:
   21 are byte-identical to an artifact AgentDock already lists;
   1 has a file whose frontmatter AgentDock could not read.
   Each one is still readable here."

[anthropics/skills] total=18 isFork=false
  (no line rendered)
```

The zero case renders nothing rather than a zero. The singular/plural agreement
is real and was a bug found by rendering it — the first version said "1 have a
file".

### `EXPLAIN ANALYZE`, at the real corpus size

Corpus: **971 packages, 971 versions, 6 repositories.** The SQL measured is the
SQL that ships — captured by wrapping the `unsafe` call drizzle's postgres-js
driver makes, so nothing was retyped.

| query | execution time |
|---|---|
| `listPackages({ limit: 10 })` — the home listing | **23.5 ms** |
| `countPackages()` — the paginator total | **24.5 ms** |
| `getRepositoryPackages(...)` — the repository lookup | 0.04 ms |
| `getRepositoryPackages(...)` — its 400-row listing, `listingOnly: false` | 10.2 ms |

**The 100 ms gate was crossed at 1,152 ms and is now cleared at 23.5 ms, with no
migration.** Full before/after table in finding 3 above.

---

## Deviations from plan

1. **[Rule 1 — bug] The floor is `parse_status = 'failed'`, not `<> 'ok'`.**
   Measured: the specified predicate leaves 469 listed, below COR-06's floor, and
   labels 353 successfully-parsed artifacts as unparseable. Needs a maintainer
   ratification of D-03's wording. Finding 1.
2. **[Rule 1 — bug] Shape-only plugins are excluded from the duplicate test.**
   Their hash is over a component-name string, not file bytes; three unrelated
   artifacts collide. Finding 2.
3. **[Rule 2 — missing correctness] The surviving copy must itself be listable.**
   Without it a failed or forked copy can empty a whole duplicate group. Not in
   the plan. Finding 2.
4. **[Rule 1 — bug] `subdivide` bounds an open-ended range at `STAR_CEILING`.**
   Otherwise it doubles upward without a fixed point and spends the whole budget.
5. **[Rule 3 — blocking] The duplicate `EXISTS` is driven by `content_hash`.**
   The plan's shape is 1,152 ms and the plan's named remedy does not fix it.
   Finding 3. **No migration was added**, which is what C2 expects.
6. **The sweep measures and reports the sub-floor region, one request per
   topic.** Not in the plan. Without it a default sweep prints no incompleteness
   at all while skipping 49,926 repositories of one topic.
7. **`unreachableShards` and `belowFloorShards` are separate.** One is a limit of
   the API, the other a decision this project made; conflating them blurs both.
8. **The UI copy does not say "from another repository".** True of 3 of 28
   suppressed rows.
9. **`sweepTopics` returns `seedNames`** so `corpus-sync` can narrow its fan-out,
   following wave 2's `only` scope. Without it a `--source=search` fan-out hands
   back the registry backlog.
10. **`src/components/escaping.test.tsx` gained a `describe` block** for the copy.
    It was in `files_modified`; the import of `check-boundaries.mjs` into a `src/`
    test is new, following `scripts/check-boundaries.test.ts`'s own precedent.

---

## Verification checklist (the plan's own list)

| # | Item | Result |
|---|---|---|
| 1 | Shard ranges disjoint, gapless, descending, no network | pass — enumerated over 0–2,000 for seven floors |
| 2 | Over-cap shard subdivided; indivisible one reported with its size | pass |
| 3 | Page walking never requests page eleven | pass — asserted on the recorded URL list |
| 4 | Sweep spends zero core requests, proven live | pass — **core 40 → 40** |
| 5 | A fork's artifacts absent from listings, present on its page | pass — by fixture; **zero real forks in the corpus** |
| 6 | Exactly one survivor of a three-way group, deterministic tie-break | pass |
| 7 | The floor reads the latest version, not any version | pass — both directions |
| 8 | A fork holding an unparseable artifact reports exactly one reason | pass — `fork` |
| 9 | `countPackages` and the listing agree, last page included | pass — row at `offset total-1` exists, at `offset total` does not |
| 10 | Row snapshot byte-identical before and after | pass |
| 11 | `getRepositoryPackages` returns more than 250 rows | pass — 260 by fixture, **400 live** |
| 12 | Every new UI string passes rule 6; the zero case renders nothing | pass — three ways |
| 13 | `EXPLAIN ANALYZE` recorded with corpus size, under 100 ms or gate honoured | **gate crossed at 1,152 ms, honoured, remedy measured, now 23.5 ms** |
| 14 | `bun run ci` passes | pass — **52 files, 882 tests** |

---

## Known ceilings carried forward

- **Fork suppression has zero real positives.** Validated against fixtures only.
- **The within-repository canonical choice is arbitrary** — lowest `package.id`
  among identical bytes at identical star counts. Stable across re-ingestion. The
  upgrade is shortest `source_path` first, id as final tie-break. Not built.
- **Dedup is exact byte-match**, and the UI says so. Two artifacts differing by a
  trailing comment do not collapse.
- **`package_version.content_hash` is unindexed.** 25.5 ms → 7.1 ms with the
  index, both measured at 971 packages. `ponytail:` note carries both numbers.
- **`jobs.test.ts`'s two concurrency tests are intermittently flaky** — observed
  failing in isolation with no other suite running, and passing on retry; ~2 runs
  in 14 of the DB-backed suites. Pre-existing (it fails with this plan's suite not
  running at all), but this plan adds a fifth DB-backed test file and therefore
  load. `bun run ci` was run five times end to end: green, green, green, green,
  and one run with two `jobs.test.ts` timeouts. Not investigated further; recorded
  rather than smoothed over.
- **The sweep's `discoveredPath` records the shard query, first-seen wins.** A
  repository found in a sparse high-star shard keeps that shard's query even if a
  denser one also names it.
- **`search.ts` must never be imported from `src/app/` or `src/components/`.** A
  search response's `x-ratelimit-*` headers describe the search bucket and
  `githubFetch` records them in the same slot the home page reads beside copy
  describing the core budget. Harmless today only because the sweep runs in the
  batch script's own process. Nothing mechanical enforces this; the reason is
  written at the top of the file.

## Nothing was committed

Working tree left for the maintainer, branch `develop`. `.planning/STATE.md` and
`ROADMAP.md` were **not** advanced — left to the orchestrator, as in waves 1
and 2.

Recommended commit message:

```
feat(05-03): sharded topic search, fork and duplicate suppression, visibility floor

- src/github/search.ts: a pure disjoint star ladder, adaptive subdivision bounded
  above at a star ceiling, page walking that stops at ten, and an explicit list of
  shards the 1,000-result cap put out of reach. Zero core requests, measured 40 → 40
- src/corpus/search.ts: the sweep, which also measures what its star floor left
  out — 49,926 repositories below stars:10 for topic:claude-code alone. At that
  floor every shard above it is reachable, so a sweep reporting only unreachable
  shards would have printed a clean run while skipping 86% of the topic
- the visibility floor is parse_status = 'failed', not <> 'ok': `partial` is a
  successful parse with a note, 353 of 971 artifacts carry one, and the plan's
  predicate left 469 listed — below COR-06's floor — while calling a parsed file
  unparseable
- duplicate suppression skips shape-only plugins, whose hash is over a
  component-name string rather than file bytes: three unrelated artifacts in two
  repositories share one hash. The surviving copy must itself be listable, or a
  failed or forked copy empties the whole group
- the duplicate EXISTS is driven by content_hash: the shape the plan specifies
  takes 1,152 ms at 971 packages and the index it names as the remedy takes it to
  1,101 ms. Driven by the hash instead it is 25.5 ms, classifying all 971 rows
  identically. No migration
- countPackages grows the repository join it never had, and the repository page's
  limit comes from CAPS.maxFiles: davila7/claude-code-templates now shows 400
  artifacts on its own page rather than 250
- the repository page discloses a fork and names how many of its artifacts are not
  in the listings and why, in words that say where an artifact is rather than what
  it is worth
- packages.test.ts: the first direct test of this project's listing queries,
  including a before-and-after row snapshot proving no stored byte moved
- no migration
```
