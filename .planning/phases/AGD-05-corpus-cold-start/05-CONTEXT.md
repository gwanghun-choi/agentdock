# Phase 5 Context — Corpus & Cold Start

There was no `/gsd-discuss-phase` for this phase; it was planned from `05-RESEARCH.md`,
`05-PATTERNS.md`, `REQUIREMENTS.md` and the phase brief directly, the same way Phases 3 and 4
were. Every decision below is the planner's, made explicitly, and each names the mechanism
that forced it.

Every phase of this project so far has found at least one recorded belief wrong. This one
found ten, listed first, because four plans depend on them and because the record of what
the previous pass got wrong is the most load-bearing artifact this document carries.

## Scope

Fill the index from four acquisition sources that are not a crawler — the MCP registry, an
operator seed list, catalog and curated-link fan-out, and sharded topic search — then keep
the resulting listings honest with three read-time predicates, and re-measure the detectors
against the corpus that acquisition produced.

Not in this phase: search, ranking, facets, query logging (all Phase 6). No trust or safety
scoring, of artifacts or of sources.

---

## Corrections to the research, with evidence

### C1 — The boundary scanner will **not** catch the new host. It passes silently.

`05-PATTERNS.md:27` states, in one sentence, that *"the same rule will fire for
`registry.modelcontextprotocol.io` the moment it appears outside a dedicated directory"* —
and then, in the next clause of the same paragraph, that the rule *"will simply not police
it"*. The second reading is the true one.

`scripts/check-boundaries.mjs:211-212`:
```js
const HOST_PATTERN = /api\.github\.com|raw\.githubusercontent\.com/;
const HOST_DIR = 'src/github/';
```
and `:252` fires **only** when `HOST_PATTERN.test(stripped)` is true. The registry hostname
is not in that alternation, so a registry client written into `src/app/page.tsx` would pass
`bun run check:boundaries` today. The rule's own stated purpose (`:209-210`) is that *"the
hostnames AgentDock may contact appear in one directory, so `git grep` answers 'what can
this reach' completely"* — adding a third host without extending the pattern destroys that
guarantee **and CI stays green while it happens**.

The companion edit is mandatory, and one better is cheap: rule 5 polices *registered* hosts
only, so a fourth host is unaudited until someone remembers to register it. `05-01` closes
that structurally — see D-04.

### C2 — Phase 5 needs **zero** migrations.

`05-RESEARCH.md` §Q3 recommends a nullable `enqueued_at` column on `repo_seed`;
`05-PATTERNS.md:17,87-101` plans a `drizzle/00NN_*.sql` file and walks its rules. Neither is
needed. Read against the shipped schema, every Phase 5 storage need is already satisfied:

| Need | Column that already carries it |
|---|---|
| Seed provenance per source | `repo_seed.source_kind`, `.discovered_from`, `.discovered_path`, `.hint` (`schema.ts:282-300`) |
| Fork disclosure and suppression | `repository.is_fork` (`schema.ts:83`) |
| Cross-repository duplicate detection | `package_version.content_hash` (`schema.ts:168`) |
| Visibility floor | `package_version.parse_status` (`schema.ts:175`) |
| "Has fan-out acted on this seed" | an anti-join to `ingest_job.target` — see D-02 |

The consequence is not cosmetic. It removes the entire migration surface from the phase:
no `db:generate` review cycle, no `check:boundaries` migration rules to satisfy, and no
exposure at all to the `scripts/migrate.mjs:97-121` companion-edit trap, which only fires on
hand-added seed data inside a migration file. **If an executor finds itself running
`bun run db:generate` in this phase, something has drifted — stop and re-read this section.**

### C3 — `npx` is **already** a distinct signal. The split needs no detector change.

`05-RESEARCH.md` §Q8 frames the `npx` question as a product taxonomy decision that would
"split `npx` into its own signal (e.g. `tool_invocation` vs `package_install`)". The signal
already exists: `src/analyze/install.ts:44` writes `signal: match[1]` — the matched literal.
Every `npx` hit in the database already carries `signal = 'npx'`, distinct from
`'npm install'`, `'pip install'` and the rest. Only the `category` (`:43`,
`'package_install'`) is shared.

So measuring `npx` separately is a change to the **measurement harness and the record**, not
to a shipped detector: `src/analyze/precision.test.ts:44` already splits a record row's
first cell on `—` into an analyzer and a scope, and `liveHits` (`:81-114`) already filters
`observedNetwork` by that scope. Teaching it to filter `install` by `signal` is four lines.
Nothing that ships changes, nothing that is stored changes, and the record carries a real
number for `npx` and for the non-`npx` residue **whichever way the taxonomy call goes**.

### C4 — `CORPORA` is duplicated, and a one-sided edit reads as detector drift.

`scripts/capability-precision.mjs:26` and `src/analyze/precision.test.ts:13` each declare
their own four-element `CORPORA` array. §Q8 step 3 correctly says to add a new slug to both,
but does not name the failure mode of forgetting one: the script would print a sample over
five corpora, a human would hand-check and record numbers from it, and
`precision.test.ts:126-135` would recompute over four and fail with *"drifted from its
recorded hit count"* — a message that accuses the detector of changing when the real fault
is a missed edit in a constant. `05-04` removes the duplication rather than documenting it.

### C5 — `githubRepoFromUrl` already exists, exported for exactly this case.

`05-RESEARCH.md` §Q2's `RegistrySeed` type derives `githubFullName` from
`server.repository.url` without naming how. The helper is already there:
`src/github/client.ts:73`, whose own doc at `:62-72` says it is *"the only predicate this
project exports for recognizing a GitHub repository URL outside `src/github/`"* — written in
Phase 4 for the catalog detector, for precisely the reason the registry adapter now has. It
reuses `normalizeRepo`'s length caps, character rules and `.git` stripping, and it rejects
any host that is not `github.com`, which also disposes of the registry's 0.3% `gitlab`
rows without a second branch. The registry adapter calls it and parses no URL itself.

### C6 — The GitHub **search** bucket is untouched while core is exhausted.

Measured live at 07:26 UTC today, `GET /rate_limit` (which costs nothing):

| bucket | limit | remaining | resets |
|---|---|---|---|
| `core` | 60 | **0** | 07:50:34 UTC (24 min after this reading) |
| `search` | 10 | **10** | 07:27:02 UTC (a rolling per-minute bucket) |
| `code_search` | 60 | 0 | 07:50:34 UTC |
| `graphql` | 0 | 0 | — unavailable unauthenticated |

§Q4 established that core and search are separate buckets. The live consequence for
sequencing was not drawn: **COR-05's sharded sweep is executable right now, on an exhausted
core budget**, because search spends a different allowance. That is why the plan ordering
below is not simply "everything GitHub last".

### C7 — The visibility floor is a **package** fact, not a repository fact.

§Q7 phrases the floor as *"a repository clears the floor when it has at least one
non-delisted package whose latest `parse_status` is `ok`"*. COR-07's own text is about
packages (*"Submitted-but-ungated **packages** are reachable by direct link but excluded
from listings"*), and the insertion point is a package-row predicate inside `listPackages`'s
`where` (`packages.ts:54-59`). Under a repository-level floor, one parseable artifact would
readmit every unparseable sibling into the listings — the floor would gate almost nothing.
Package-level it is.

### C8 — `enqueueJob` cannot be made atomic with a `repo_seed` write without a refactor.

`05-PATTERNS.md:52` recommends wrapping the `repo_seed` UPDATE and the `enqueueJob` INSERT
in one `db.transaction` *"the same way"* `finishJob` does. That is not possible as written.
`enqueueJob` (`jobs.ts:34-62`) issues all three of its statements against the module-level
`db` handle (`:35`, `:42`, `:48`), and the codebase's `Executor` escape hatch (`jobs.ts:83`)
is `Pick<typeof db, 'update'>` — it carries neither `select` nor `insert`. Making fan-out
atomic would mean widening the signature of the one function every submit path routes
through, in the plan that also changes its normalization. D-02 removes the requirement
instead of paying for it.

### C9 — `countPackages` has no repository join.

`05-PATTERNS.md:76` says *"Both already `.innerJoin(repository, ...)` (line 53)"*. Only
`listPackages` does. `countPackages` (`packages.ts:65-71`) selects from `packageTable` alone
with a single `isNull(delistedAt)` predicate. It needs the join added, or the home page's
`Browse all {total} skills` (`src/app/page.tsx:51`) and `/skills`'s paginator
(`src/app/skills/page.tsx:33,35`) will both count rows the listing suppresses, and the last
page of the paginator will render the "there is no page N" branch it already has at
`skills/page.tsx:48-58`.

### C10 — The repository page's limit is stale against `CAPS.maxFiles`.

`packages.ts:143-146` justifies `limit: 250` (`:160`) with *"a repository cannot hold more
indexed artifacts than one pass was allowed to read, so this is bounded by construction"*.
That was true when the scan cap was 200. Phase 4 raised it: `src/github/scan.ts:24`,
`maxFiles: 400`. A repository yielding 400 artifacts now shows 250 of them on its own page,
silently. The seed list this phase ships deliberately front-loads exactly such a repository
(`davila7/claude-code-templates`, 11,499 tree entries), so the defect goes from theoretical
to certain the first time `corpus:sync` runs. Fixed in `05-03` by sourcing the limit from
`CAPS.maxFiles` rather than from a literal.

### C11 — A star ladder cannot cover a topic, and covering one would be pointless.

§Q4 costs COR-05 as *"a 10-shard-by-stars sweep at 10 pages/shard = 100 search calls,
≈10 min"*, which reads as a sweep that covers the topic. It does not. Measured live today
against the search bucket C6 found untouched, at a cost of nine search requests and zero
core requests:

| topic | repositories |
|---|---|
| `claude-code` | **57,970** |
| `mcp-server` | 23,281 |
| `agent-skills` | 14,524 |
| `claude-skills` | 6,712 |
| `claude-plugin` | 1,688 |

and the star distribution of the largest one:

| `topic:claude-code` shard | repositories | fits under the 1,000-result cap? |
|---|---|---|
| `stars:>=100` | 2,128 | after ~3 subdivisions |
| `stars:10..99` | 5,954 | after ~7 |
| `stars:2..9` | 13,401 | **no** — eight possible star values, several individually over 1,000 |
| `stars:0..1` | **36,487 (63%)** | **no, at any depth** — two indivisible star values, each ~18x the cap |

Two consequences, both load-bearing:

1. **Full topic coverage is unreachable by star sharding.** Not "expensive" — unreachable.
   A shard cannot be subdivided below a single star value, and single star values at the
   bottom of this distribution are eighteen times the cap.
2. **It would be pointless if it were reachable.** 57,970 repositories at two core requests
   each (`retry.ts:5`) is 115,940 requests — eighty days of unauthenticated budget — against
   a queue whose ceiling is `MAX_QUEUED = 500` and a drain rate of thirty repositories an
   hour. The binding constraint on COR-05 was never the search result cap. It is the core
   budget downstream of it.

So COR-05's requirement is read for what it says: *"sharded to escape the result cap"* so
that the cap **"does not silently truncate coverage"** (ROADMAP criterion 4). The
deliverable is a sweep that subdivides until a shard fits, walks from the dense end down,
and **names every shard it could not reach together with that shard's measured size** — not
a sweep that pretends to have enumerated a hundred thousand repositories. Silence is the
failure mode the requirement names; incompleteness is a fact about the world.

**On the star floor, before it is mistaken for D-03's contradiction.** The sweep walks
downward from high stars and stops at a floor it prints. That is not the popularity-as-trust
judgment D-03 rejects, and the difference is not a technicality: D-03 refuses to exclude an
artifact **AgentDock has already read** from listings on a popularity signal. A star floor
here decides **which repositories to spend a scarce fetch budget on first**, among work not
yet done — the same kind of decision the seed list makes when it orders by artifact density
and the registry makes when it sweeps by update recency. Nothing is excluded: a zero-star
repository is still submittable by hand, still ingested, still listed. Something is
deprioritized. Write that distinction down wherever the floor appears, because it will read
as a contradiction otherwise.

---

## Three things measured while planning

**M1 — the budget, live.** See C6's table. Core is at zero and resets 24 minutes from the
reading; search is full. `registry.modelcontextprotocol.io/v0/servers?limit=1` returned
`200` at the same moment, so COR-01 is executable immediately and independently of both
GitHub buckets.

**M3 — the topic and star distributions in C11**, nine search requests, zero core requests.
They are what sizes COR-05's ladder, its floor and its budget, and they are why the sweep's
headline output is a list of what it did not reach.

**M2 — `repo_seed` holds zero rows** and has held zero since it shipped (§Q3, re-confirmed
by that research pass against the live dev schema). Everything this phase builds on top of
it is therefore first-run code with no legacy shape to preserve — the one genuine freedom
this phase has.

---

## Binding decisions

### D-01 — `enqueueJob` lowercases `target` at the boundary. The index does not change.

The defect, verified: `jobs.ts:38` checks the denylist with `fullName.toLowerCase()` while
`jobs.ts:50` inserts `target: fullName` verbatim, and `schema.ts:341-343` builds
`ingest_job_active_key` on the raw `t.target` with no `lower()`. `normalizeRepo`
(`client.ts:43-60`) validates and trims but never lowercases, and `actions.ts:28` builds
`fullName` straight from it. `catalog.ts:42,58` **does** lowercase every seed it emits. So a
human submitting `Anthropics/Skills` and a seed emitting `anthropics/skills` produce two
simultaneously-active jobs for one repository.

The fix is one line in `enqueueJob`, not an expression index, for four reasons:

1. `ingest_job.target` is an internal identity key, not a display value. Its own schema
   comment says so (`schema.ts:320`: *"Always a validated `owner/repo` — normalizeRepo()
   runs before this row exists"*). Every rendered repository name comes from
   `repository.full_name`, which is written from GitHub's own canonical casing
   (`repo.ts:25`). That is exactly why `repository` needed the expression index
   (`schema.ts:96`) and `ingest_job` does not: one column is a mutable display value, the
   other is not.
2. An expression index means `DROP INDEX` + `CREATE INDEX` in a generated migration, which
   `check-boundaries.mjs:36,133-139` requires an `agentdock:reviewed-destructive:` marker
   for — and it would be the phase's only migration (C2).
3. `enqueueJob`'s `ON CONFLICT` clause (`jobs.ts:51-58`) names `ingest_job.target` as its
   target. Matching a `lower(target)` unique index means an expression conflict target,
   which is awkward in Drizzle and would rewrite the one clause whose no-op-ness the code
   comment at `:54-56` explicitly warns must not change.
4. Boundary normalization also closes the *existing* disagreement between `:38` and `:50`.
   An index change would leave the denylist check and the insert still using two different
   representations of the same string.

Residual, and it is handled rather than accepted: rows written before this fix may hold
mixed-case targets. The executor counts them
(`SELECT count(*) FROM ingest_job WHERE target <> lower(target)`) and, if non-zero, runs a
one-statement `UPDATE` as an explicit operator step recorded in the summary — **not** as a
hand-added statement inside a `drizzle/*.sql` file, which is the exact shape
`migrate.mjs:97-121` documents as never reaching `agentdock_test`.

### D-02 — `repo_seed` lifecycle is derive-by-join. No `enqueued_at`, no status column.

Not because it is smaller — because D-01 makes it strictly better. Once `ingest_job.target`
is lowercased at the boundary and `repo_seed.full_name` already is (`schema.ts:284`), the
two columns hold the **same representation of the same identity**, and the join is a plain
equality join, not the `lower()` join §Q3 costed.

```sql
select s.full_name
from repo_seed s
left join ingest_job j on j.target = s.full_name
left join repository_denylist d on d.full_name = s.full_name
where j.id is null and d.full_name is null
order by s.created_at
limit $1
```

Weighed honestly against `enqueued_at`:

| | `enqueued_at` | derive-by-join |
|---|---|---|
| Migration | one additive column + partial index | none |
| Can drift from truth | yes — it is a second copy of a fact | no — reads ground truth |
| Atomicity requirement | needs `enqueueJob` widened to accept a transaction (C8) | none |
| Answers "was fan-out here" | yes | yes |
| Answers "what happened to this seed" | no — still needs the join | yes, in the same join: status, attempts, `ingest_attempt` |

§27's bar — *no seed may sit forever in an unexplained pending state* — is met by
construction and by two explicit moves. First, the denylist anti-join above: without it a
denylisted seed would be re-offered on every run forever, since `enqueueJob` returns
`{kind:'denylisted'}` and writes no `ingest_job` row for the join to find. Second, the
summary line prints the residual: `N seed(s) still have no job` on every run, so a cap that
stopped early is a number a maintainer reads, not a silence they have to notice.

The exclusion is on *any* job row, terminal ones included. A seed whose job failed
permanently must not be re-enqueued by fan-out — retry belongs to `scheduleRetry`
(`jobs.ts:173-193`), and a fan-out that re-offered failed repositories would loop on them
forever at two core requests each.

**Ceiling, recorded rather than pre-solved:** at tens of thousands of `ingest_job` rows this
anti-join is a sequential scan. It is a manual, once-in-a-while operation over hundreds of
rows today. The upgrade is one additive `CREATE INDEX ON ingest_job (target)`, named in a
`ponytail:` comment beside the query, not built now.

### D-03 — One read-time expression produces one honest reason per row.

Fork suppression, cross-repository content-hash dedup and the visibility floor are three
requirements, but they are one question asked of one row: *is this artifact in AgentDock's
listings, and if not, why not?* They ship as a single SQL `CASE` yielding
`notListedBecause: 'fork' | 'duplicate' | 'unparsed' | null`, built once as a reusable
fragment and used in three places: `listPackages`'s projection, `listPackages`'s `where`
(when listing), and `countPackages`'s `where`.

- `listPackages({ listingOnly })` defaults to `true`. `getRepositoryPackages` passes
  `false`, following the optional-`fullName` convention already at `packages.ts:27-32`. This
  is what keeps COR-07's two halves from contradicting each other: the detail page's data
  source *is* `listPackages` (`:160`), so an unconditional predicate would hide a gated
  package from its own direct link.
- `countPackages` gains the same join and the same predicate (C9).
- The floor is `parse_status = 'ok'` on the latest version, and nothing else. Stars and age
  were considered and **rejected**: excluding an artifact from listings because its
  repository has few stars is a trust judgment wearing a different hat, which is exactly
  what `PROJECT.md`'s "capability disclosure, never a risk score" constraint and CAP-10's
  word ban exist to prevent. Parse status is a verb of observation — "AgentDock read this
  file and could not parse it" — not a verdict about the artifact.
- Dedup's canonical row is the one whose repository has the most stars, tie-broken by the
  lowest `package.id`. Deterministic, exactly one survivor per hash group. Stars here are
  *not* a quality signal being smuggled in through the back door: every row in the group is
  byte-identical, so no artifact is being ranked above another — a tie-break is being made
  among copies of one thing, and it has to be made somehow.

UI consequence, and it must pass `no-verdict-vocabulary` (`check-boundaries.mjs:270-360`):
the repository page gains a fork disclosure in the exact register of the archived one it
already renders (`r/[owner]/[repo]/page.tsx:52`), and one muted line naming how many of its
artifacts are not in AgentDock's listings and why. No banned word appears in any of it, and
none of the copy says or implies that an excluded artifact is worse than an included one.

### D-04 — The boundary scanner grows a *registry* of host/directory pairs, plus a test that a host cannot be added without registering it.

`HOST_PATTERN`/`HOST_DIR` become `HOST_RULES`, an array of `{pattern, dir, label}`, and the
loop at `:251-254` iterates it. The problem id stays the literal string `no-host-sprawl`,
because `check-boundaries.test.ts:143,162` matches on it.

That alone still leaves the hole C1 describes: a fourth host is unpoliced until someone
remembers. So both clients export their `ALLOWED_HOSTS` set, and a new test asserts that
**every host in every client's allowlist is matched by some `HOST_RULES` pattern**. Adding a
host to an allowlist without registering its directory then fails CI on the commit that adds
it, rather than silently a year later.

### D-05 — `readCapped` is duplicated into `src/registry/`, not shared.

Both `05-RESEARCH.md` §Q2 and `05-PATTERNS.md:35` recommend duplicating the ~15 lines rather
than importing across the `src/github/` boundary. Confirmed and adopted, but for a sharper
reason than either gives: importing it would *pass* rule 5 (the rule matches host literals
in a file's text, not imports), so the real argument is not the boundary — it is that
`readCapped` throws `GitHubError('too_large', ...)` (`client.ts:200`), and a registry
adapter that reports a registry failure as a GitHub failure has lied to `messageFor`. The
alternative, moving it to `src/net/capped.ts` with a generic error, means editing the
SSRF-hardened `src/github/client.ts` and changing an error type on that path — a larger,
riskier diff than fifteen duplicated lines. Duplicate, with a `ponytail:` comment naming a
third host as the extraction trigger.

### D-06 — Registry rows are validated with `zod`, skipped individually, and counted.

Live evidence from §Q1 that this is not defensive theatre: 2.8% of sampled rows carry
`repository: {}` — a present-but-empty object a naive `repository.url` read crashes on —
and one page of the live pagination contained a **raw control byte inside a publisher's
`description`**, which Node's `JSON.parse` rejects outright.

- Per-row `safeParse`; a failing row is skipped and counted, never thrown out of the loop —
  the same posture `pipeline.ts` already applies per-candidate to detectors.
- Per-page `JSON.parse` inside a `try`. On failure, **one** retry with C0 control characters
  other than tab, LF and CR stripped from the raw text, counted separately. Those bytes are
  illegal inside a JSON string and can appear legally nowhere else in the document, so
  removing them cannot change any valid value. If the retry also fails, the page is skipped
  **and pagination stops with the cursor recorded**, because continuing past a page whose
  `nextCursor` could not be read would silently skip everything after it.
- End of pagination is the **absence** of the `nextCursor` key from `metadata`, not a null
  and not an empty string (§Q1, verified by paginating to exhaustion).

### D-07 — Every cap prints what it dropped, and no run reports a bounded sweep as a complete one.

`MAX_QUEUED = 500` (`jobs.ts:11`) already bounds queue depth. Phase 5 adds
`CORPUS_CAPS` — a per-invocation enqueue ceiling of 25 (25 repos × 2 core calls = 50, inside
the 60/hr budget with headroom for the app's own worker and a concurrent human submission),
a per-source seed ceiling, a page ceiling for the registry sweep, and a request ceiling for
the search sweep. Every one of them is a documented number carrying its arithmetic, in the
`CAPS`/`ANALYZE_CAPS` doctrine this codebase already uses (`scan.ts:11-29`).

Every script run ends with one `console.log` line in `analyze-backfill.mjs`'s format
(`:33-36`) carrying, separately: enqueued, denylisted, flooded, dropped-by-cap, and **seeds
still holding no job**. A search shard whose `total_count` reaches GitHub's 1,000-result cap
is reported as an incomplete shard by name. A registry sweep stopped by its page cap prints
the cursor it stopped at. A cap that prints nothing reads as "we covered everything", and
this project has already paid for one silent drop — `seedsSkipped` (STATE.md, carried into
Phase 4), closed in `05-02`.

### D-08 — An explicit `bun run corpus:sync`. No cron, no in-app scheduler.

Adopted from §Q9 unchanged, and every reason there was re-checked against source:
`ingest_job` genuinely has no `kind` column and its schema comment (`schema.ts:324-326`)
predicts the exact migration a scheduler would force; `package.json:16-18` already
establishes `bun scripts/<name>.mjs` as the shape for manual batch operations; and
`PROJECT.md`'s one-part-time-maintainer constraint makes a scheduler infrastructure that a
manual invocation avoids needing. One script, `scripts/corpus-sync.mjs`, with a
`--source=registry|seeds|links|search|all` argument parsed by hand from `process.argv` — no
CLI library, ever (`analyze-backfill.mjs:15-19`).

### D-09 — The `npx` taxonomy call is a blocking maintainer checkpoint carrying computed numbers.

Per C3, the split is free. So `05-04` computes **all** the outcomes on the expanded corpus —
`install` overall, `install — npx` alone, and `install` with `npx` excluded — and presents
them, with the hand-check sample, at a `checkpoint:decision`. The maintainer picks the
labelling; the executor never picks it silently, and never records a row before the call is
made, because the labelling *is* the false-positive count.

CAP-13's kill rule then applies mechanically and unchanged to whatever rows result — that is
not an executor decision, it is the shipped rule in `precision.test.ts:137-151` doing its
job, with `observedNetwork`'s two independently-scored category rows
(`fixtures/capability-precision.md:19-20`) as the precedent for per-scope rows each carrying
their own verdict.

**No detector is tuned before the expanded-corpus measurement exists** (§15). Not `install`'s
unhandled negation class, not `network_request`'s 15% same-line rule. Both are recorded
weaknesses with numbers behind them, and step 6 of the procedure
(`fixtures/capability-precision.md:37`) forbids narrowing a pattern until it passes.

### D-10 — Recall gets 20 hand-picked lines and an honest label, not a framework.

Per §Q8's smallest-measurable-proxy and the project's standing refusal to build a benchmark
harness: 20 lines across the expanded corpus that a human reading the raw file confirms
genuinely declare the capability, run the shipped detector over the same files, record
found/missed. It measures recall **on a hand-selected slice**, not true recall against an
unknown ground truth, and the file that records it says exactly that — the same honesty
`declaredCapabilities`'s "absence of data, not a clean pass" row already models
(`fixtures/capability-precision.md:89-95`). Cost: roughly one afternoon per detector
category, the same hand-labelling effort that produced the existing precision rows. No new
code, no new fixture format.

### D-11 — CI never touches live GitHub or the live registry.

Registry adapter tests are fixture-backed with a stubbed `fetch` and a host-capture array,
mirroring `src/github/scan.test.ts:32-40`: four cases minimum — normal, empty, malformed,
HTTP-error — plus the control-character page as a fifth, because it is a real observed shape
and not a hypothetical. Search shard generation is a pure function tested with no network.
Every DB-backed suite keeps `test-owner/<suite>-*` sentinel discipline
(`jobs.test.ts:13-15,28-31`) with a prefix distinct from `queue-spec` and `persist`.

Live corpus and frozen test fixtures stay separate: growing the precision corpus is a
manual, pinned-SHA `scripts/capture-fixtures.mjs` run whose output is committed, exactly the
mechanism that produced the four existing corpora.

### D-12 — Seed provenance uses no host literal as a data value.

`discoveredFrom` takes `'mcp-registry'`, `'operator-seed-list'`, `'github-topic-search'`, or
the curated list's own `owner/repo`. Deliberately **not** `'registry.modelcontextprotocol.io'`:
a hostname written as a data value is a hostname literal in whatever file writes it, and
under D-04's rule that file must then live in `src/registry/`. A provenance tag should not
constrain where code can live. The `repo_seed.discoveredFrom` column comment
(`schema.ts:292`) currently reads *"The catalog's own repository, as owner/repo"* — that
meaning is being widened here, and the comment is updated to say so rather than left to
quietly become wrong.

---

## Is COR-06's "at least 500 parsed artifacts" reachable here? Yes — in under a dozen core requests.

The naive reading is that 500 artifacts needs roughly 500 repositories, which at two core
calls each and 60 calls an hour is a sixteen-hour drain. That reading is wrong, and the
arithmetic that corrects it is entirely from measured numbers:

| repository | core cost | measured shape | artifacts it can contribute |
|---|---|---|---|
| `davila7/claude-code-templates` | 2 | 11,499 tree entries; 896 skill-shaped + 393 command-shaped paths | up to **400** — `CAPS.maxFiles` (`scan.ts:24`) truncates the read |
| `wshobson/agents` | 2 | all six detector types; 180 skills + 91 plugin manifests + 109 commands | up to **400**, same cap |
| `anthropics/claude-code` | 2 | 10 skill, 12 plugin, 1 catalog, 18 command, 5 hook | ~45 |
| the four frozen-corpus repos | 8 | 81 SKILL.md plus catalogs and commands | ~100 |

**500 parsed artifacts is reachable in 6–14 core requests**, well inside one unauthenticated
hour. The binding constraint is not quota — it is wall clock: `CAPS.wallClockMs = 120_000`
per repository at `CAPS.concurrency = 2` (`scan.ts:28-29`), so a 400-file repository takes
up to two minutes to drain and the whole run is minutes, not hours.

What it takes, stated so nobody discovers it during execution:

1. **Core quota back.** Zero as of 07:26 UTC, resets 07:50:34 UTC. Nothing else in the phase
   waits on it — see the wave ordering.
2. **The seed list ordered by artifact density, not by repository count.** Two repositories
   carry more artifacts than the other thirteen combined.
3. **Accepting that `davila7/claude-code-templates` never converges.** At 400 of ~1,300
   candidate paths it is permanently truncated, and since Phase 2 a truncated scan suppresses
   delisting (`pipeline.ts:362`), so that repository will read `tree_truncated` forever and
   its listing will never be complete. The repository page already discloses this in the
   copy it renders at `r/[owner]/[repo]/page.tsx:39-45`. This is a real, permanent ceiling
   accepted in exchange for the fastest path to a browsable corpus — record it, do not
   pretend the number is clean.
4. **Counting the right thing.** "Parsed" means `parse_status = 'ok'` on a non-delisted
   package — which is *identical* to D-03's visibility floor. So COR-06's count and the
   listing's count are the same number by construction, and the acceptance query is the one
   the home page already runs.

Two caveats on the density figures, carried from the research's own assumption log: the
896/393 marker counts are raw path-suffix matches, not detector runs (A3), and four of the
MCP-server candidates were confirmed by path pattern only (A2). Both cut the same way — the
real yield may be lower per repository, and the conclusion survives either way because two
repositories at the 400-file cap already clear 500 on their own.

---

## Plan split, and why it differs from the ROADMAP's three lines

The ROADMAP names three plans. This phase ships **five**. The first three keep the ROADMAP's
names and scope verbatim. Two more exist:

1. **`05-04` (COR-06)** — the ROADMAP folds "at least 500 parsed artifacts" implicitly into
   its three build plans, but it is not build work. It is a live operational run plus a
   reproduction from an empty schema, and it can only be done after the visibility floor
   exists, because "parsed artifact" and "above the floor" are the same predicate (D-03).
2. **`05-05` (CAP-13)** — the phase brief's detector re-measurement on an expanded corpus
   appears in none of the three named plans, yet the brief requires it and it carries a
   **blocking maintainer decision**. Folding it into `05-03` would put a checkpoint plus
   five unrelated concerns — sharded search, forks, dedup, the floor, and a precision
   re-measurement — into one plan, and folding it into `05-04` would make a five-task plan.

| plan | wave | delivers | tasks | needs GitHub core? |
|---|---|---|---|---|
| `05-01` MCP registry sync with incremental updates | 1 | COR-01, COR-03 (the consumer), D-01, D-04 | 3 | only the tracer's final hop, 2 calls |
| `05-02` Seed list, catalog fan-out, and curated-link expansion | 2 | COR-02, COR-03, COR-04 | 3 | 6 calls, bounded |
| `05-03` Sharded topic search, fork filtering, content-hash dedup, and the visibility gate | 3 | COR-05, COR-07, DAT-07 | 3 | **none** — search is a separate bucket (C6) |
| `05-04` Five hundred artifacts, and the cold start reproduced from empty | 4 | COR-06 | 2 + 1 checkpoint | ~30 calls |
| `05-05` Expanded corpus, detector re-measurement, and the `npx` decision | 5 | CAP-13 | 2 + 1 checkpoint | 9 calls |

**Why the ordering is forced, edge by edge:**

- `05-02 → 05-01`: it imports the fan-out and edits `scripts/corpus-sync.mjs`, both created
  by `05-01`. File overlap, not just a logical dependency.
- `05-03 → 05-02`: it also edits `scripts/corpus-sync.mjs` (the `--source=search` branch),
  and its `EXPLAIN ANALYZE` acceptance gate on the dedup predicate is meaningless against an
  empty table — it needs the corpus `05-02` produces.
- `05-04 → 05-03`: COR-06's count is `countPackages()` itself, which only means "parsed
  artifacts" once `05-03`'s floor is in it. Counting before that would count a different set
  and would have to be redone.
- `05-05 → 05-04`: only by convention, not by dependency — `05-05` measures against frozen
  fixtures, not against the live corpus, so it could technically precede `05-04`. It is last
  because both spend the same shared core budget and `05-04`'s thirty requests are the ones
  with a user-visible outcome.
- Nothing is genuinely parallel. Core quota is a single shared 60/hr resource, so two plans
  spending it concurrently would starve each other, and one maintainer executes sequentially
  regardless. The waves are honest about that rather than pretending at parallelism.

**Quota sequencing inside the ordering.** `05-01`'s tracer is the only wave-1 work that
touches core, it needs exactly 2 calls, and it comes after roughly an hour of adapter, zod,
test and boundary-scanner work that touches no network at all. `05-03` needs none at all.
So the phase does not stall on the exhausted budget at any point, and no plan's *first* task
blocks on it.

**Requirement coverage.** COR-01 → `05-01`. COR-02 → `05-02`. COR-03 → `05-01` (consumer)
and `05-02` (catalog source). COR-04 → `05-02`. COR-05 → `05-03`. COR-06 → `05-04`.
COR-07 → `05-03`. DAT-07 → `05-03`. CAP-13 (re-measurement) → `05-05`.

---

## Anti-goals — state these so execution does not drift

- **No trust or safety scoring, of artifacts or of sources.** "Discovered from the MCP
  Registry" is provenance. "Official", "trusted", "verified source", "curated" as a quality
  claim — all forbidden. COR-07's floor is a listing-noise control and its copy must not
  read as a quality judgment. Rule 6 polices the words; this line polices the intent behind
  copy that uses none of them.
- **No arbitrary-URL fetch.** A `marketplace.json` `source.url` or `archive.url`, and a link
  extracted from an awesome list, are **stored as data and never fetched**. `catalog.ts:19-28`
  already states this posture; COR-04 does not weaken it — extraction yields `owner/repo`
  through `githubRepoFromUrl` and the repository is then fetched by the normal ingest path,
  through the same two hosts, or not at all.
- **Nothing fetched is ever executed.** No install, no build, no clone-and-run, no `docker`,
  no `make`, no shelling out to anything over fetched content.
- **No Phase 6 work.** No search index, no ranking, no facets, no query logging. The
  `notListedBecause` expression is a listing predicate, not the beginning of a relevance
  score.
- **No benchmark framework** for recall. Twenty hand-picked lines and an honest limitation
  sentence (D-10).
- **No detector tuning before the measurement** (D-09).
- **No new external package.** The research's legitimacy audit found none needed and none is
  added: native `fetch`, `zod`, `drizzle-orm`, `postgres` are all already dependencies.

## Hard constraints (unchanged from Phases 0–4, restated because they bind every task)

- Exactly three reachable hosts, all hardcoded, https-only, redirects re-validated per hop
  against the allowlist: `api.github.com`, `raw.githubusercontent.com`,
  `registry.modelcontextprotocol.io`.
- Never log a token, a credential, a database URL, or any external response body.
- `agentdock` schema only. Additive only, no `DROP`, no `REVOKE`, never `drizzle-kit
  push`/`pull`/`migrate`. This phase expects to add no migration at all (C2).
- `bun run test`, never `bun test` — Bun's own runner hangs on vitest files.
- The executor may edit files, run tests and run smokes. It must **never** `git commit`,
  `git push`, change a remote, or touch `main`. The branch stays `develop`.

## Known ceilings carried out of this phase

These update STATE.md's "Carried into Phase 5" ledger rather than replacing it; the entries
there about `install`, `network_request`, the zero-instance detectors and precision-not-recall
are all still open and are what `05-04` acts on.

| Item | Note |
|---|---|
| The dedup and anti-join predicates are unindexed | Two named `ponytail:` upgrades: `ingest_job (target)` for the seed anti-join, `package_version (content_hash)` for the duplicate check. Neither is built. `05-03` records `EXPLAIN ANALYZE` timings at the real corpus size so the threshold is a measured number, not a guess. |
| `davila7/claude-code-templates` never converges | 400 of ~1,300 candidate paths. Permanently `tree_truncated`, delisting permanently suppressed for it (`pipeline.ts:362`). Accepted for cold-start speed. |
| Sharded search escapes the 1,000-result cap by a fixed ladder, not adaptively | A shard that still reports `total_count >= 1000` is recorded as incomplete by name rather than silently truncated. Adaptive subdivision is one recursive call away and is not built. |
| Content-hash dedup is exact-match only | Two functionally identical artifacts differing by a trailing comment do not collapse. Honest, and stated in the UI copy's wording ("byte-identical"), never described as near-duplicate detection. |
| The registry's stability is a ten-month-old sentence | Its README's "API freeze (v0.1)" entry promised stability "for the next month or more" and has not been superseded. The adapter is tolerant by design; no code comment anywhere may claim the registry is stable. |
| Rule 5 still polices only *registered* hosts | D-04's allowlist-coverage test closes the case where someone adds a host to a client. It does not catch a hostname literal in a file that has no allowlist at all. |
| `fork_parent_node_id` is still not stored | GitHub returns `parent` in the response `repo.ts:22` already reads, so it is free to add — but DAT-07 needs only "stored distinctly", which `is_fork` satisfies. A "grouped under its canonical upstream" UI would need it. |

## What would falsify this phase

- A registry page shape that `zod` rejects wholesale rather than row-by-row — meaning the
  envelope, not a publisher's row, changed. The sync would report zero valid rows out of a
  200 response, which is the one outcome that must never be reported as "nothing new".
- `enqueueJob('Owner/Repo')` and `enqueueJob('owner/repo')` still producing two active rows
  after D-01.
- A gated or forked package missing from its own detail page — COR-07's two halves in direct
  contradiction, which is exactly the failure the single-function `listPackages` sharing
  makes easy.
- `countPackages()` and the rendered listing disagreeing on the last page.
- The corpus reaching 500 artifacts while `bun run precision`'s recorded numbers still
  describe four corpora — the measurement silently going stale at the exact moment it
  finally has data.
- Any UI string that survives rule 6 but still reads as a quality verdict about an excluded
  artifact.
