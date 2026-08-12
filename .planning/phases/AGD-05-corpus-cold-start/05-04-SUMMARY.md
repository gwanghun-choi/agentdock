---
phase: AGD-05-corpus-cold-start
plan: 04
subsystem: corpus acquisition and the cold-start runbook
status: complete
tags: [cor-06, cold-start, runbook, corpus, quota, truncation]
requirements: [COR-06]
tasks_complete: 2
tasks_total: 2
key-files:
  created:
    - scripts/test-reset.mjs
  modified:
    - README.md
    - scripts/corpus-sync.mjs
    - package.json
migrations_added: 0
actuals:
  tasks: 2
  commits: 0
---

# Phase AGD-05 Plan 04: Five Hundred Artifacts, and the Cold Start Reproduced from Empty

COR-06 was already met before this plan ran, so the plan's real work turned out
to be the second half: proving the path from nothing. That proof falsified the
mechanism the plan was built on.

`bun run ci`: **52 test files, 882 tests, all passing** — unchanged from wave 3,
as expected of an operational plan. Zero migrations; `drizzle/` still holds 6 SQL
files and `scripts/migrate.mjs` is unmodified.

| | before this plan | after |
|---|---|---|
| `countPackages()` — what the home page renders | **794** | **921** |
| `countPackages({listingOnly:false})` — everything held | 971 | 1,137 |
| repositories | 6 | **16** |
| `ingest_job` | 5, all `succeeded` | 16, all `succeeded` |

**And from an empty schema: 0 → 678 listed / 831 held, in 106 seconds and 6 core
requests.**

---

## The finding, first: `db:test:setup` does not empty anything

The plan's Reference C is built on one claim, stated twice. Step 1: *"regenerates
the test schema's DDL from `schema.ts`. This is the empty starting state."*
Step 5: *"This is not optional and it is not cleanup etiquette: without it, a real
repository name sits `queued` in the shared test schema."*

Both are false, and they fail in the same direction — the step that is supposed
to guarantee cleanliness is a no-op.

`db:test:setup` is `drizzle-kit generate` followed by `scripts/migrate.mjs`.
`generate` diffs against the snapshot in `.drizzle-test/meta`, which already
holds all six migrations, so it emits nothing. `migrate.mjs` then finds
`__drizzle_migrations` up to date and applies nothing. **Neither reads a data
row, and neither deletes one.**

Measured, not read. A probe row was inserted into `agentdock_test.repo_seed` and
`agentdock_test.ingest_job`, then `db:test:setup` was run:

```
before:  repo_seed=1 ingest_job=1
$ bun run db:test:setup
No schema changes, nothing to migrate 😴
agentdock_test: already up to date (6 migration(s) on disk).
after:   repo_seed=1 ingest_job=1
```

And again at full scale, on the real cold-start output, which is the version that
matters:

```
$ bun run db:test:setup          # the plan's step 5
agentdock_test: already up to date (6 migration(s) on disk).
schema=agentdock_test held=831 listed=678 jobs=3
  [davila7/claude-code-templates:succeeded wshobson/agents:succeeded
   anthropics/claude-code:succeeded]
```

Three real repository names still sitting in the shared test schema **after the
step whose entire stated purpose is to remove them.** So the plan's own must-have
truth — *"The cold-start proof runs against `agentdock_test` and leaves that
schema in the state the test suite expects"* — is unreachable by the plan's own
procedure, and decision 2's hazard analysis is exactly right about the
consequence while being exactly wrong about the remedy. `jobs.test.ts`'s
`clean()` deletes only `test-owner/queue-spec%`; `claimJob` takes the oldest
claimable row in the whole schema. A real name left `queued` is precisely the
nondeterminism decision 2 names, and the plan would have shipped it.

### What was built instead, and why a script rather than a runbook line

Decision 5 forbids a new script, and its stated escape is that *"the right fix is
almost always the runbook"*. It cannot be here: that decision's rationale is
*"everything this plan needs — acquire, fan out, drain, count — already exists"*,
which was written believing `db:test:setup` emptied the schema. Nothing in the
project empties `agentdock_test`. `dev-reset.mjs` names `agentdock` as a literal
in three places and lists that literal as safety property #1 of the file;
parameterising it to reach the test schema would trade a real guard for a proof.

So `scripts/test-reset.mjs` — 30 lines, one `TRUNCATE ... RESTART IDENTITY
CASCADE` over the data tables, `artifact_type` and `__drizzle_migrations` kept —
plus `bun run db:test:reset`. It keeps `dev-reset.sql`'s structural guards
without borrowing its code: the schema name is a literal, the script takes no
argument and reads no environment variable naming a schema, the table list is a
catalog query filtered to that same literal, and `current_database()` is asserted
to be `mcpdb` first. It cannot reach `agentdock`, and `agentdock_app` owns
nothing outside the two schemas anyway.

`TRUNCATE` rather than `DROP` deliberately: the DDL is what `db:test:setup`
builds and what every suite expects, so rebuilding it would make the reset depend
on a migration run. Verified both directions in one sequence — `db:test:setup` on
the dirty schema left 831/678/3-jobs untouched, `db:test:reset` took it to
0/0/0.

---

## The second and third false claims, both smaller

**`--source=none` does not exist.** Reference A step 3, Reference B and
Reference C step 3 all invoke `bun run corpus:sync --source=none`.
`corpus-sync.mjs:47` allows `registry|seeds|links|search|all` and throws on
anything else. Every drain in this plan therefore used `--source=seeds`, which
re-writes the committed operator file at zero network cost and is idempotent, so
a repeated invocation is a drain-only pass in everything but name.

**The count is printed unconditionally, not behind `--count`.** Reference B
offers `--count` or a node one-liner. Neither is needed and decision 5 says no new
flag, so `corpus-sync` now ends every run with the number sourced from
`countPackages()` itself:

```
corpus-sync: listed=921 of held=1137 artifact(s) — listed is what the home page
  renders; the 216 difference is on each repository's own page carrying its reason
```

That satisfies the plan's `key_link` — `corpus-sync.mjs` → `packages.ts` via
`countPackages` — and keeps "parsed artifact", "listed artifact" and the number a
reader sees as one predicate. `src/db/queries/packages.ts` needed **no change**;
it was in `files_modified` and nothing was required of it.

---

## Task 1 — the count, and what widening the corpus actually bought

### COR-06 was already met, by 294 artifacts

The plan's objective assumes an acquisition run is needed to reach five hundred.
It is not: wave 3 left the corpus at **794 listed / 971 held**, measured with
`countPackages()` before this plan touched anything. The floor was cleared by
five repositories at ten core requests — inside 05-CONTEXT's projection of six to
fourteen, which makes it **the first cost projection in this project that
survived contact with execution.**

So no repository was ingested to make a number larger. What the corpus lacked was
not artifacts but breadth: six repositories, two of them contributing 69% of
everything. The ten remaining entries of the operator seed list — already
live-verified in wave 2, already committed, not padding — were drained to widen
it.

### The curve, per invocation

| after | listed | held | core remaining | repositories |
|---|---|---|---|---|
| baseline (wave 3) | **794** | 971 | 52 | 6 |
| drain 1 — 4 repositories | 866 | 1,043 | 44 | 10 |
| drain 2 — 4 repositories | 914 | 1,128 | 37 | 14 |
| drain 3 — 3 repositories | **921** | 1,137 | 30 | **16** |

Three invocations, eleven repository ingests, **41 seconds of wall clock**
(10:50:54 → 10:51:35 UTC). The seed list is now **exhausted**: all 15 entries hold
a job, the third invocation offered only 3 against a cap of 4, and there is no
shortfall to record because the number was already met before the file was
drained.

### What each repository contributes

| listed / held | repository | note |
|---|---|---|
| 289 / 402 | `davila7/claude-code-templates` | truncated; 900 candidate paths unread |
| 342 / 383 | `wshobson/agents` | |
| 99 / 121 | `frumu-ai/tandem` | |
| 45 / 46 | `anthropics/claude-code` | |
| 34 / 34 | `addyosmani/agent-skills` | new |
| 8 / 28 | `centminmod/my-claude-code-setup` | new; 20 unparsed |
| 22 / 22 | `JimLiu/baoyu-skills` | new |
| 10 / 22 | `disler/claude-code-hooks-mastery` | new; 12 unparsed |
| 18 / 18 | `anthropics/skills` | reads truncated — see below |
| 14 / 19 | `upstash/context7` | new |
| 16 / 16 | `anthropics/claude-cookbooks` | new |
| 16 / 16 | `obra/superpowers` | new |
| 5 / 7 | `anthropics/claude-agent-sdk-python` | new |
| 1 / 1 | `cloudflare/mcp-server-cloudflare` | |
| 1 / 1 | `github/github-mcp-server` | new |
| 1 / 1 | `modelcontextprotocol/servers` | new |

**Two repositories account for 631 of 921 listed (69%) and 785 of 1,137 held
(69%)**, so `config/seeds.json`'s density ordering is confirmed on live data — the
one claim in this plan's `<behavior>` block that was checked and held.

Vendor breadth is genuinely wider — Anthropic, Cloudflare, GitHub, upstash,
modelcontextprotocol, addyosmani, obra, disler, centminmod, JimLiu, frumu-ai,
davila7, wshobson — but the shape is unchanged: the corpus is still two
repositories and a long tail, and the ten added contribute 166 held artifacts
between them against davila7's 402 alone.

### The corpus by `notListedBecause`, and by type

| reason | packages |
|---|---|
| listed | **921** |
| `unparsed` | 182 |
| `duplicate` | 34 |
| `fork` | **0** |

Fork suppression still has **zero real positives** across sixteen repositories,
none of which is a fork. Recorded the way wave 3 recorded it: absence of data is
not a clean pass, and no fork was hunted down to make the number non-zero.

| type | packages (held) |
|---|---|
| skill | 605 |
| command | 387 |
| plugin | 113 |
| hook | 16 |
| mcp_server | 15 |
| catalog | 1 |

### Truncation, as a number — and a second repository the plan did not predict

Two repositories carry `tree_truncated`. Measured live at one core request each,
reusing the shipped `collectCandidates`/`orderedNeeds` selector against the real
tree, with no write and no ingest:

| repository | GitHub truncated the tree? | tree entries | candidate paths | read | **unread by the file cap** |
|---|---|---|---|---|---|
| `davila7/claude-code-templates` | no | 11,499 | **1,300** | 400 | **900** |
| `anthropics/skills` | no | 501 | 19 | 19 | **0** |

**900 candidate artifacts are unread across the whole corpus, all of them in one
repository.** 05-CONTEXT's "roughly 1,300" is now exactly 1,300, and the
permanent ceiling it accepted is confirmed: 400 of 1,300, `tree_truncated`
forever, delisting suppressed forever (`pipeline.ts:362`).

`anthropics/skills` is the surprise, and it is a real defect rather than a
rounding note. It reports truncated with **19 candidate paths against a cap of
400** — nothing was over any cap. `artifactsTruncated` is `skipped.length > 0`
(`scan.ts:122`), and `skipped` collects three unrelated things: paths past the
file cap, paths abandoned at the wall-clock deadline, and **paths whose raw fetch
threw**. All 19 candidates were re-fetched by hand for this summary and all 19
read cleanly, so the stored `true` came from a transient failure on the ingest
that set it. It will not clear: the `unchanged` path reuses the stored value
(`pipeline.ts:218`), which is correct — nothing was read, so nothing new is known
— but it means one transient blip marks a repository permanently partial, with
delisting suppressed, and its page tells readers the listing is incomplete when
it is not.

**The count itself is destroyed, which is why this had to be measured rather than
queried.** `scan.ts` computes `skipped` and `pipeline.ts:377` collapses it to a
boolean. Nothing stores or logs its length. That is the exact shape of the
`seedsSkipped` defect wave 2 closed — a number computed and discarded one
function later. Not fixed here: it is a logging change in `pipeline.ts`/`log.ts`,
outside this plan's files, and it does not affect COR-06. Carried forward below
with the one-line fix.

### No job is left behind

`ingest_job` in `agentdock`: **16 rows, all `succeeded`.** None queued, none
running. `ingest_job` targets that differ from their lowercase form: 0.

---

## Task 2 — the cold start, from empty

Run against `agentdock_test` throughout. `agentdock` was never reset, never
dropped, and never pointed at by any step; the co-tenant `public` and `didim_mcp`
schemas were never read, written or named by any statement.

| step | command | result |
|---|---|---|
| 1 | `bun run db:test:reset` | emptied 9 tables |
| 2 | assert empty | `held=0 listed=0 listRows=0 seeds=0 jobs=0` |
| 3 | `DATABASE_SCHEMA=agentdock_test corpus:sync --source=seeds --no-enqueue` | 15 seeds written, 0 network |
| 4 | `... --source=seeds --enqueue=3 --drain=3` | 3 repositories, **6 core requests, 105.9 s** |
| 5 | assert usable | `held=831 listed=678 listRows=10 seeds=19 jobs=3 all succeeded` |
| 6 | `bun run db:test:reset` | `held=0 listed=0 listRows=0 seeds=0 jobs=0` |
| 7 | `bun run ci` | **52 files, 882 tests, passing** |

"Usable catalog" is `countPackages()` non-zero and `listPackages({limit:10})`
returning rows — the two queries the home page makes, not a bespoke assertion
that could pass while the page failed.

Three things worth naming:

- **The cold start alone clears COR-06.** 678 listed from nothing, in under two
  minutes, for six of the sixty requests an hour. The floor is not a property of
  four phases of accumulated dev-schema state; it is reachable from an empty
  database in one command.
- `seeds=19`, not 15. The four extra are `wshobson/agents`' marketplace fan-out
  (`anasss/qa-orchestra`, `major7apps/pensyve`, `martinforreal/storymap-skill`,
  `suniel12/ciagent`), so COR-03's catalog path is exercised by the cold start
  without being asked for.
- All three jobs finished `succeeded`. Step 6 removes them anyway, because the
  hazard is any real repository name in the shared schema, not only a `queued`
  one — `ingest_job_active_key` is unique on `target`.

### The README section

A new `## Filling the index from empty`, 60 lines, carrying the six steps
verbatim with the expected output of each, the two numbers (`listed` is the home
page's; `held` is everything, and the difference is disclosed per repository, not
lost), and the cost in the same place as the commands.

Step 5 is stated as required in its own bolded paragraph naming exactly why
`db:test:setup` will not do it — the finding above, written for a maintainer who
has never read this plan. `GITHUB_TOKEN` is documented once, as not a
requirement, with the 5,000-per-hour figure as a lever. No value of any
environment variable appears; `DATABASE_SCHEMA` and `DATABASE_URL` are named
only. Two adjacent corrections: the `Commands` table now says `db:test:setup`
applies DDL only and deletes no rows, and the `Test database` section says the
same.

---

## The real cost, replacing every projection

| | measured |
|---|---|
| Core requests at start (10:47:55 UTC) | **52 / 60** |
| Core requests at end (10:59:28 UTC) | **20 / 60** |
| **Total core spent** | **32** |
| — Task 1 drain, 11 repositories | 22 (2 each, exactly as budgeted) |
| — truncation measurement, 3 tree reads | 3 |
| — cold start, 3 repositories | 6 |
| — **unaccounted** | **1** |
| Invocations of `corpus:sync` | 5 (3 drains + 2 cold-start) |
| Wall clock, Task 1 drain | 41 s for 11 repositories |
| Wall clock, cold start | 105.9 s for 3 repositories |
| Wall clock, whole plan | 11 min 33 s |
| Migrations added | **0** |

One request is unaccounted for and was not isolated — reported rather than
rounded away, as in wave 2, where four went missing the same way.

**Against 05-CONTEXT's projection.** It said 500 parsed artifacts was reachable
in 6–14 core requests, and that wall clock rather than quota would bind. Both
held. Wave 3 reached 794 on ten requests; the cold start reached 678 on six. The
binding constraint was indeed wall clock — 105.9 seconds for three repositories,
of which 99 seconds was the two at or near the 400-file cap — and never quota.

**Registry and search seeds were deliberately not spent on.** `repo_seed` holds
10,774 rows of which 10,758 still have no job; at two core requests each that
backlog is fifteen days of unauthenticated budget. Spending this run on MCP
servers rather than on the artifact-dense operator repositories would have made
the number harder to reach for no gain. The omission is a decision, not an
oversight.

---

## Deviations from plan

1. **[Rule 3 — blocking] `scripts/test-reset.mjs` and `bun run db:test:reset`
   added.** The plan's cold-start proof cannot be executed without them:
   `db:test:setup` empties nothing, measured twice. Decision 5's "no new script"
   rests on a premise that turned out false. Not in `files_modified`.
2. **[Rule 3 — blocking] `--source=none` replaced with `--source=seeds`
   everywhere.** The flag value does not exist and throws.
3. **The count prints unconditionally instead of behind `--count`.** Simpler,
   honours decision 5's "no new flag", and makes every run report the number
   rather than only the runs that ask.
4. **`src/db/queries/packages.ts` was not modified.** It was in `files_modified`;
   nothing was needed of it. The `key_link` is satisfied by `corpus-sync.mjs`
   importing `countPackages` from it.
5. **`package.json` modified** (one script line). Not in `files_modified`.
6. **The blocking checkpoint could not be taken in plan order**, because its own
   step 5 asks the maintainer to read and run the README section that Task 2
   creates. Both tasks were executed and the checkpoint is outstanding below.
7. **Ten repositories were ingested although COR-06 was already met.** Not to
   move the number — to widen a corpus of six repositories, using only entries
   already live-verified and committed in wave 2. No unverified repository was
   added; the seed list was not padded.
8. **The corpus-level "candidate paths unread" figure was measured live rather
   than queried**, because the pipeline destroys it. Three core requests.

---

## Verification checklist (the plan's own list)

| # | Item | Result |
|---|---|---|
| 1 | `countPackages()` ≥ 500 and it is the number the home page renders | pass — **921**, and the home page reads the same function |
| 2 | Per-drain curve recorded; two repositories account for the majority | pass — 794→866→914→921; 69% from two repositories |
| 3 | No job left queued or running in `agentdock` | pass — 16 rows, all `succeeded` |
| 4 | Corpus-level truncation figure recorded | pass — **900 unread candidate paths**, all in one repository; a second repository truncated for an unrelated and transient reason |
| 5 | Real core cost, invocations and wall clock recorded | pass — 32 core, 5 invocations, 11 min 33 s; 1 request unaccounted |
| 6 | Cold start reproduces from empty; zero before, non-zero after, `listPackages` returns rows | pass — 0 → 831 held / 678 listed / 10 rows |
| 7 | `agentdock_test` holds no real-repository `ingest_job` row after the final reset | pass — 0 rows, **using `db:test:reset`; the plan's own step leaves 3** |
| 8 | `bun run ci` passes after the proof | pass — 52 files, 882 tests |
| 9 | README section exists, names step 5 as required, states the cost | pass — 60 lines |
| 10 | No migration added; `scripts/migrate.mjs` unmodified | pass — `git status drizzle/ scripts/migrate.mjs` clean, 6 SQL files |

The paginator check from the checkpoint was run headlessly as well, since it is
the one that catches `countPackages`/listing drift: `total=921 lastPage=37
rowsOnLastPage=21 rowsPastLastPage=0` — "Showing 901–921 of 921", no dead page.

---

## The checkpoint, outstanding

`bun run dev` and a browser are needed for the rest; what could be checked
without one was:

| # | Checkpoint item | Status |
|---|---|---|
| 1 | Home page says `Browse all N skills`, N ≥ 500 | `countPackages()` = **921**; the page calls that function |
| 2 | `/skills` last page agrees with the total, no dead page | verified headlessly — 901–921 of 921, nothing past it |
| 3 | `davila7/claude-code-templates` shows the partial-read notice, count near 400 | `tree_truncated` = true, 402 held, page limit `CAPS.maxFiles` = 400 |
| 4 | A fork or duplicate reads as fact, not judgment | **no fork exists in the corpus** — that is the real outcome, not a skipped step. 34 duplicates render wave 3's copy |
| 5 | Run the README's six steps against `agentdock_test` | run, all six, `bun run ci` green after |

**Needs a human:** items 1, 3 and 4 rendered in a browser.

---

## Known ceilings carried forward

- **`skipped.length` is destroyed at `pipeline.ts:377`.** The number of candidate
  paths a cap left unread exists in `scan.ts` and reaches nothing. Same shape as
  wave 2's `seedsSkipped`. The fix is one required field on `IngestLog` carrying
  `inputs.skipped.length`. Not built — it is a logging change outside this plan.
- **`artifactsTruncated` conflates three causes**: the file cap, the wall-clock
  deadline, and a raw fetch that threw. `anthropics/skills` is marked permanently
  partial by the third, with 19 of 19 candidates readable today and delisting
  suppressed. Distinguishing them needs `skipped` to carry a reason.
- **`davila7/claude-code-templates` never converges**, now exactly: 400 of 1,300.
- **Fork suppression still has zero real positives** across 16 repositories.
- **10,758 seeds hold no job** — fifteen days of unauthenticated budget. The
  index is 16 repositories out of 10,774 named ones, and the corpus is still two
  repositories plus a long tail.
- **`db:test:reset` is not called by anything automatic.** A maintainer who
  ignores step 5 still leaves the schema dirty; nothing mechanical enforces it.
- **`jobs.test.ts`'s two concurrency tests remain intermittently flaky.** Not
  observed in this wave's `bun run ci` run, which was green first time. Recorded
  because wave 3 saw it roughly 2 runs in 14, and this plan adds no test file.

---

## Nothing was committed

Working tree left for the maintainer, branch `develop`. `.planning/STATE.md` and
`ROADMAP.md` were **not** advanced — left to the orchestrator, as in waves 1–3.

Recommended commit message:

```
feat(05-04): fill the index, and reproduce the cold start from empty

- COR-06 was already met before this plan: 794 listed at wave 3, against a floor
  of 500, in ten core requests — the first cost projection in this project that
  survived execution. No repository was ingested to move a number
- the ten remaining live-verified operator seeds were drained to widen a corpus
  of six repositories to sixteen: 794 -> 921 listed, 971 -> 1,137 held, 22 core
  requests, 41 seconds, seed list now exhausted. Two repositories still account
  for 69% of it, which confirms config/seeds.json's density ordering on live data
- db:test:setup does NOT empty agentdock_test, and the plan was built on the
  claim that it does. It is drizzle-kit generate plus migrate.mjs, both no-ops
  once the schema matches; measured by inserting a row, running it, and finding
  the row still there. Used as the plan specifies it would have left three real
  repository names in the schema six vitest suites share, which is exactly the
  nondeterminism the plan's own decision 2 warns about
- scripts/test-reset.mjs + bun run db:test:reset: one TRUNCATE over the data
  tables of agentdock_test, schema name a literal, no argument, no schema-naming
  environment variable, current_database() asserted. It cannot reach agentdock
- the cold start, proven end to end: 0 -> 831 held / 678 listed in 105.9 seconds
  and 6 core requests, asserted with the queries the home page runs, then reset
  to 0 and bun run ci green after
- corpus-sync prints listed/held from countPackages() on every run, so COR-06's
  "parsed artifact" and the number a reader sees cannot become two definitions.
  No --count flag; --source=none, which three plan references invoke, does not
  exist and throws
- the truncation cost as a number: 900 candidate paths unread across the corpus,
  all in davila7/claude-code-templates at exactly 1,300 candidates against a cap
  of 400. anthropics/skills also reads truncated with 19 of 19 candidates
  readable — artifactsTruncated conflates the file cap with a transient raw
  fetch failure, and the count itself is destroyed at pipeline.ts:377
- README: a 60-line cold-start runbook naming step 5 as required and why, the
  cost beside the commands, and GITHUB_TOKEN as a lever rather than a requirement
- no migration
```
